import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { spawn } from 'child_process';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';

export type ExportFormat = 'gpkg' | 'geojson' | 'geojsonseq';

export interface ExportSpec {
  /** Mã tỉnh trên map_layers (chuỗi số) */
  idtinh: string;
  /** Mã huyện trên map_layers (chuỗi số) */
  idhuyen: string;
  /** Năm của tờ bản đồ */
  year: number;
  /** Mặc định 'gpkg'. Dùng 'geojsonseq' khi cần nạp vào tippecanoe. */
  format?: ExportFormat;
  /** Lọc theo cờ sáp nhập. Bỏ trống = không lọc. */
  ssn?: boolean;
}

export interface ExportResult {
  filePath: string;
  fileName: string;
  layerName: string;
  format: ExportFormat;
  featureCount: number;
  sourceSrid: number;
  /** [minLon, minLat, maxLon, maxLat] đã ở EPSG:4326 */
  bbox: [number, number, number, number];
  /** Polygon đóng vòng, gán thẳng vào cột file_layer_line.geom */
  bboxPolygon: {
    type: 'Polygon';
    coordinates: [number, number][][];
  };
  sizeBytes: number;
  elapsedMs: number;
}

interface ProbeRow {
  cnt: number;
  minx: number | null;
  miny: number | null;
  maxx: number | null;
  maxy: number | null;
}

const DRIVER: Record<ExportFormat, string> = {
  gpkg: 'GPKG',
  geojson: 'GeoJSON',
  geojsonseq: 'GeoJSONSeq',
};

const EXT: Record<ExportFormat, string> = {
  gpkg: '.gpkg',
  geojson: '.geojson',
  geojsonseq: '.geojsonl',
};

/** Phải khớp với `source-layer` trong style.json và `--layer` của tippecanoe. */
const LAYER_NAME = 'thongtinland';

/** SRID giả định khi cột geom có SRID = 0 (không khai báo). Đổi cho đúng dữ liệu của bạn. */
const ASSUMED_SRID = 4326;

const OGR_TIMEOUT_MS = 15 * 60 * 1000;

@Injectable()
export class ExportGeoServiceService {
  private readonly logger = new Logger(ExportGeoServiceService.name);

  /** Cache SRID của cột dgn_polyline.geom — không đổi trong vòng đời process. */
  private cachedSrid: number | null = null;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  // ==========================================================
  // API chính
  // ==========================================================

  /**
   * Export polyline của một huyện/năm ra file.
   * Không ghi DB — caller tự quyết định lưu gì sau khi nhận ExportResult.
   */
  async export(spec: ExportSpec, outDir: string): Promise<ExportResult> {
    const started = Date.now();
    const format = spec.format ?? 'gpkg';

    this.assertCode(spec.idtinh, 'idtinh');
    this.assertCode(spec.idhuyen, 'idhuyen');
    this.assertYear(spec.year);

    const srid = await this.resolveSrid();
    const sql = this.buildSql(spec, srid);

    // Probe bằng đúng câu SQL sẽ export -> số liệu luôn khớp với file tạo ra.
    const probe = await this.probe(sql);
    if (probe.cnt === 0) {
      throw new BadRequestException(
        `Không có polyline nào cho idtinh=${spec.idtinh}, idhuyen=${spec.idhuyen}, year=${spec.year}. ` +
          `Kiểm tra map_layers có tờ bản đồ nào khớp không, và bound_levels có loại hết level không.`,
      );
    }
    if (probe.minx === null) {
      throw new BadRequestException(
        'Không tính được extent — geometry rỗng hoặc NULL toàn bộ.',
      );
    }

    const bbox: [number, number, number, number] = [
      probe.minx,
      probe.miny!,
      probe.maxx!,
      probe.maxy!,
    ];
    this.assertBboxSane(bbox, srid);

    await fsp.mkdir(outDir, { recursive: true });

    // Tên file deterministic: build lại cùng vùng sẽ thay thế, không tích lũy rác.
    const fileName = `${spec.idtinh}_${spec.idhuyen}_${spec.year}${EXT[format]}`;
    const filePath = path.join(outDir, fileName);
    // const tmpPath = `${filePath}.${process.pid}.tmp`;
    const tmpPath = `${filePath}.${randomUUID()}.tmp`;

    await this.rm(tmpPath);

    try {
      await this.runOgr2ogr(this.ogrArgs(format, sql, tmpPath));

      const stat = await fsp.stat(tmpPath);
      if (stat.size === 0) {
        throw new Error('ogr2ogr tạo ra file 0 byte');
      }

      // rename atomic trong cùng filesystem: không bao giờ lộ file dở dang.
      await fsp.rename(tmpPath, filePath);

      const result: ExportResult = {
        filePath,
        fileName,
        layerName: LAYER_NAME,
        format,
        featureCount: probe.cnt,
        sourceSrid: srid,
        bbox,
        bboxPolygon: this.toBboxPolygon(bbox),
        sizeBytes: stat.size,
        elapsedMs: Date.now() - started,
      };

      this.logger.log(
        `Export ${fileName}: ${result.featureCount} feature, ` +
          `${(stat.size / 1024 / 1024).toFixed(2)} MB, ${result.elapsedMs}ms`,
      );
      return result;
    } catch (err) {
      await this.rm(tmpPath);
      throw err;
    }
  }

  // ==========================================================
  // SQL
  // ==========================================================

  /**
   * CTE `sheet` lọc map_layers trước rồi parse bound_levels MỘT LẦN cho mỗi tờ,
   * thay vì parse lại trên từng dòng polyline như query gốc.
   */
  private buildSql(spec: ExportSpec, srid: number): string {
    const geom = this.geomExpr(srid);
    const ssnClause =
      spec.ssn === undefined
        ? ''
        : `\n    AND l.ssn IS NOT DISTINCT FROM ${spec.ssn}`;

    return `
WITH sheet AS (
  SELECT
    l.id,
    CASE
      WHEN btrim(coalesce(l.bound_levels, '')) = '' THEN NULL::int[]
      ELSE (
        SELECT array_agg(btrim(t)::int)
        FROM unnest(string_to_array(l.bound_levels, ',')) AS t
        WHERE btrim(t) <> ''
      )
    END AS levels
  FROM map_layers l
  WHERE l.idtinh = ${this.lit(spec.idtinh)}
    AND l.idhuyen = ${this.lit(spec.idhuyen)}
    AND l.year = ${spec.year}${ssnClause}
)
SELECT
  line.gid          AS gid,
  line.level        AS level,
  line.idtobando    AS idtobando,
  ${geom}           AS geom
FROM sheet s
JOIN dgn_polyline line ON line.idtobando = s.id
WHERE (s.levels IS NULL OR line.level = ANY(s.levels))
  AND line.geom IS NOT NULL
  AND NOT ST_IsEmpty(line.geom)`.trim();
  }

  /** Reproject về 4326 ngay trong Postgres. SRID=0 thì gán SRID giả định trước. */
  private geomExpr(srid: number): string {
    if (srid === 4326) return 'line.geom';
    if (srid === 0) {
      return `ST_Transform(ST_SetSRID(line.geom, ${ASSUMED_SRID}), 4326)`;
    }
    return 'ST_Transform(line.geom, 4326)';
  }

  private async resolveSrid(): Promise<number> {
    if (this.cachedSrid !== null) return this.cachedSrid;

    const rows = await this.dataSource.query(
      `SELECT COALESCE(
         (SELECT srid FROM geometry_columns
          WHERE f_table_name = 'dgn_polyline' AND f_geometry_column = 'geom' LIMIT 1),
         (SELECT ST_SRID(geom) FROM dgn_polyline WHERE geom IS NOT NULL LIMIT 1),
         0
       )::int AS srid`,
    );
    this.cachedSrid = rows[0]?.srid ?? 0;

    if (this.cachedSrid === 0) {
      this.logger.warn(
        `dgn_polyline.geom có SRID = 0. Đang giả định EPSG:${ASSUMED_SRID}. ` +
          `Nên chạy: SELECT UpdateGeometrySRID('dgn_polyline', 'geom', ${ASSUMED_SRID});`,
      );
    }
    return this.cachedSrid;
  }

  private async probe(sql: string): Promise<ProbeRow> {
    const rows = await this.dataSource.query(`
      SELECT q.cnt,
             ST_XMin(q.e) AS minx, ST_YMin(q.e) AS miny,
             ST_XMax(q.e) AS maxx, ST_YMax(q.e) AS maxy
      FROM (
        SELECT count(*)::int AS cnt, ST_Extent(f.geom) AS e
        FROM (${sql}) f
      ) q
    `);
    return rows[0];
  }

  // ==========================================================
  // ogr2ogr
  // ==========================================================

  private ogrArgs(
    format: ExportFormat,
    sql: string,
    tmpPath: string,
  ): string[] {
    const args: string[] = ['-f', DRIVER[format]];

    if (format === 'gpkg') {
      args.push(
        '--config',
        'OGR_SQLITE_SYNCHRONOUS',
        'OFF',
        '--config',
        'OGR_SQLITE_CACHE',
        '512',
        '-lco',
        'GEOMETRY_NAME=geom',
        '-lco',
        'SPATIAL_INDEX=YES',
        '-lco',
        'FID=fid',
      );
    } else {
      // 6 chữ số ~ 11cm. Đủ cho ranh thửa, cắt ~40% dung lượng.
      args.push('-lco', 'COORDINATE_PRECISION=6');
      if (format === 'geojson') args.push('-lco', 'RFC7946=YES');
      if (format === 'geojsonseq') args.push('-lco', 'RS=NO');
    }

    args.push(
      '-nln',
      LAYER_NAME,
      '-a_srs',
      'EPSG:4326', // SQL đã ST_Transform, chỉ cần gán nhãn
      '-gt',
      '65536',
      '-overwrite',
      tmpPath,
      this.pgConnString(),
      '-sql',
      sql,
    );
    return args;
  }

  private runOgr2ogr(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn('ogr2ogr', args, {
        env: {
          ...process.env,
          // Password qua env, KHÔNG nhét vào connection string:
          // connstring lộ ra trong `ps aux`.
          PGPASSWORD: process.env.DB_PASSWORD ?? '',
        },
      });

      let stderr = '';
      let settled = false;

      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(hardKill);
        clearTimeout(softKill);
        err ? reject(err) : resolve();
      };

      const softKill = setTimeout(() => {
        this.logger.warn('ogr2ogr quá hạn, gửi SIGTERM');
        proc.kill('SIGTERM');
      }, OGR_TIMEOUT_MS);

      const hardKill = setTimeout(() => {
        proc.kill('SIGKILL');
        finish(new Error(`ogr2ogr timeout (>${OGR_TIMEOUT_MS / 60000} phút)`));
      }, OGR_TIMEOUT_MS + 10_000);

      proc.stderr.on('data', (d) => {
        const s = d.toString();
        stderr += s;
        if (stderr.length > 16_000) stderr = stderr.slice(-16_000);
      });

      proc.on('error', (err) =>
        finish(
          new InternalServerErrorException(
            `Không chạy được ogr2ogr (đã cài gdal-bin chưa?): ${err.message}`,
          ),
        ),
      );

      proc.on('close', (code) => {
        if (code === 0) return finish();
        finish(new Error(`ogr2ogr exit ${code}\n${stderr.trim()}`));
      });
    });
  }

  private pgConnString(): string {
    const host = process.env.DB_HOST ?? 'localhost';
    const port = process.env.DB_PORT ?? '5432';
    const db = process.env.DB_NAME ?? '';
    const user = process.env.DB_USER ?? '';
    return `PG:host=${host} port=${port} dbname=${db} user=${user}`;
  }

  // ==========================================================
  // Validate & tiện ích
  // ==========================================================

  /**
   * ogr2ogr nhận SQL thô, KHÔNG parameterize được.
   * Nên mọi giá trị ghép vào SQL phải qua whitelist ở đây — đừng nới lỏng regex này.
   */
  private assertCode(v: string, field: string): void {
    if (typeof v !== 'string' || !/^\d{1,10}$/.test(v)) {
      throw new BadRequestException(
        `${field} phải là chuỗi số 1-10 ký tự, nhận được: ${v}`,
      );
    }
  }

  private assertYear(y: number): void {
    if (!Number.isInteger(y) || y < 1900 || y > 2200) {
      throw new BadRequestException(`year không hợp lệ: ${y}`);
    }
  }

  private lit(v: string): string {
    return `'${v}'`; // an toàn vì assertCode đã chặn mọi thứ ngoài chữ số
  }

  /** Bắt sớm lỗi SRID: tọa độ VN-2000 chưa transform sẽ ra số hàng trăm nghìn. */
  private assertBboxSane(
    b: [number, number, number, number],
    srid: number,
  ): void {
    const [minLon, minLat, maxLon, maxLat] = b;
    const ok = minLon >= -180 && maxLon <= 180 && minLat >= -90 && maxLat <= 90;
    if (!ok) {
      throw new InternalServerErrorException(
        `BBox ngoài phạm vi WGS84: [${b.join(', ')}]. ` +
          `SRID nguồn đang là ${srid} — nhiều khả năng ST_Transform chưa đúng.`,
      );
    }
  }

  private toBboxPolygon(b: [number, number, number, number]) {
    const [minLon, minLat, maxLon, maxLat] = b;
    return {
      type: 'Polygon' as const,
      coordinates: [
        [
          [minLon, minLat],
          [maxLon, minLat],
          [maxLon, maxLat],
          [minLon, maxLat],
          [minLon, minLat],
        ] as [number, number][],
      ],
    };
  }

  private async rm(p: string): Promise<void> {
    await fsp.unlink(p).catch(() => undefined);
  }
}
