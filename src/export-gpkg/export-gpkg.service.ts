import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { SAVE_FILE } from 'src/common/common.constant';

const execAsync = promisify(exec);

interface CreateGeojsonLayerSpec {
  idtinh: string;
  idhuyen: string;
  year: number;
}

@Injectable()
export class ExportGpkgService {
  constructor(private readonly dataSource: DataSource) {}

  private lit(value: string): string {
    // helper escape literal string cho SQL, giữ nguyên như code hiện có của bạn
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  /**
   * Build câu SQL lấy feature JSON trực tiếp từ line/polyline theo bound_levels
   */
  private buildLineFeatureQuery(
    spec: CreateGeojsonLayerSpec,
    ssnClause: string,
  ): string {
    const geom = `ST_AsGeoJSON(ST_Multi(line.geom))::json`;

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
    SELECT json_build_object(
      'type', 'Feature',
      'id', line.gid,
      'geometry', ${geom},
      'properties', json_build_object(
        'gid', line.gid,
        'level', line.level,
        'idtobando', line.idtobando
      )
    ) AS feature
    FROM sheet s
    JOIN dgn_polyline line ON line.idtobando = s.id
    WHERE (s.levels IS NULL OR line.level = ANY(s.levels))
      AND line.geom IS NOT NULL
      AND NOT ST_IsEmpty(line.geom)
      AND ST_IsValid(line.geom)
      -- lọc geometry có tọa độ NaN/Infinity: NaN không bằng chính nó
      AND ST_XMin(line.geom) = ST_XMin(line.geom)
      AND ST_YMin(line.geom) = ST_YMin(line.geom)
      AND ST_XMax(line.geom) = ST_XMax(line.geom)
      AND ST_YMax(line.geom) = ST_YMax(line.geom)
    `.trim();
  }

  async createLineGpkg(
    spec: CreateGeojsonLayerSpec,
    ssnClause: string = '',
  ): Promise<string | null> {
    try {
      const query = this.buildLineFeatureQuery(spec, ssnClause);
      const rows = await this.dataSource.query(query);

      if (rows.length === 0) {
        return null;
      }

      const features = rows.map((row) => row.feature);
      const geojson = { type: 'FeatureCollection', features };

      const folder = path.join(SAVE_FILE.DGN_FILE);
      if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder, { recursive: true });
      }

      const baseName = `${spec.year}_line_${Date.now()}`;
      const geojsonPath = path.join(folder, `${baseName}.geojson`);
      const gpkgPath = path.join(folder, `${baseName}.gpkg`);

      fs.writeFileSync(geojsonPath, JSON.stringify(geojson));

      await this.convertGeojsonToGpkg(geojsonPath, gpkgPath, 'line_layer');

      fs.unlinkSync(geojsonPath);

      return gpkgPath;
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  private async convertGeojsonToGpkg(
    inputPath: string,
    outputPath: string,
    layerName: string,
  ): Promise<void> {
    const cmd = [
      'ogr2ogr',
      '-f GPKG',
      `"${outputPath}"`,
      `"${inputPath}"`,
      `-nln ${layerName}`,
      '-nlt PROMOTE_TO_MULTI', // an toàn cho line/multiline lẫn lộn
      '-a_srs EPSG:4326', // đổi nếu geom nguồn ở VN-2000 (EPSG:3405-3408) và cần reproject thì dùng -t_srs
      '-overwrite',
    ].join(' ');

    const { stderr } = await execAsync(cmd);
    if (stderr && !stderr.toLowerCase().includes('warning')) {
      throw new Error(stderr);
    }
  }
}
