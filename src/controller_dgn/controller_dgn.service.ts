/* eslint-disable prettier/prettier */
/* eslint-disable no-var */
import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateGeojsonFIleDto } from './dto/create-file-json.dto';
import { CommonService } from 'src/common/common.service';
import { DataSource, IsNull, Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { SAVE_FILE } from 'src/common/common.constant';
import { FileLayerLine } from 'src/entity/file-layer-line.entity';
import { execFile, spawn } from 'child_process';
import * as fsp from 'fs/promises';
import { InjectRepository } from '@nestjs/typeorm';
import { ExportGeoLineByLocationDto } from './dto/form-export-by-location.dto';
import { FileLayerLineService } from 'src/file-layer-line/file-layer-line.service';
import { CREATE_SUCCESSFULLY } from 'src/common/common.message';

export interface BoundingBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
}

@Injectable()
export class ControllerDgnService {
  constructor(
    @InjectRepository(FileLayerLine)
    private repository: Repository<FileLayerLine>,

    private commonService: CommonService,
    private fileLayerLineService: FileLayerLineService,

    private dataSource: DataSource, // private httpService: HttpService,
  ) {}

  async convertDBToMbtilesFileNew(
    createControllerDgnDto: CreateGeojsonFIleDto,
  ) {
    const { districtId, provinceId, provinceNewId, wardNewId, year } =
      createControllerDgnDto;
    // B1: convert geojson
    var pathFile = await this.createFileGeoJson(createControllerDgnDto);

    var dataLine = new FileLayerLine();
    dataLine.accountId = 1;
    dataLine.provinceNewId = provinceNewId;
    dataLine.wardNewId = wardNewId;
    dataLine.provinceId = provinceId;
    dataLine.districtId = districtId;
    dataLine.wardId = districtId;
    dataLine.year = year;
    dataLine.note = null;
    dataLine.ssn = provinceId == null ? false : true;
    if (pathFile) {
      // dataLine.fullname = pathFile; // đường dẫn đầy đủ
      // dataLine.filename = path.basename(pathFile); // chỉ tên file
      dataLine.filename = path.parse(pathFile).name + '.mbtiles';
      // dataLine.extension = path.parse(pathFile).ext;
      dataLine.fullname = pathFile;
    }

    await this.repository.save(dataLine);

    // B2: convert mbtiles
    try {
      if (!pathFile) return null;
      const pathFolder = SAVE_FILE.DGN_FILE;
      // đảm bảo folder tồn tại
      await fsp.mkdir(pathFolder, { recursive: true });
      // tên file không có extension
      const fileName = path.parse(pathFile).name;
      // output mbtiles
      const output = path.join(pathFolder, `${fileName}.mbtiles`);
      // gọi tippecanoe
      const result = await this.convertGeoJsonToMbtilesUpdate(pathFile, output);
      return result;
    } catch (error) {
      console.error('convert mbtiles error:', error);
      return null;
    }
  }

  async convertDBToMbtilesFile(createControllerDgnDto: CreateGeojsonFIleDto) {
    const { districtId, provinceId, provinceNewId, wardNewId, year } =
      createControllerDgnDto;
    // B1: convert geojson
    var pathFile = await this.createFileGeoJsonProvinceOld(
      createControllerDgnDto,
    );

    if (pathFile == null) {
      return null;
    }

    var dataLine = new FileLayerLine();
    dataLine.accountId = 1;
    dataLine.provinceNewId = provinceNewId;
    dataLine.wardNewId = wardNewId;
    dataLine.provinceId = provinceId;
    dataLine.districtId = districtId;
    dataLine.wardId = districtId;
    dataLine.year = year;
    dataLine.note = null;
    dataLine.ssn = provinceId == null ? false : true;
    if (pathFile) {
      dataLine.filename = path.parse(pathFile).name + '.mbtiles';
      dataLine.fullname = pathFile;
    }

    await this.repository.save(dataLine);

    // B2: convert mbtiles
    try {
      if (!pathFile) return null;
      const pathFolder = SAVE_FILE.DGN_FILE;
      // đảm bảo folder tồn tại
      await fsp.mkdir(pathFolder, { recursive: true });
      // tên file không có extension
      const fileName = path.parse(pathFile).name;
      // output mbtiles
      const output = path.join(pathFolder, `${fileName}.mbtiles`);
      // gọi tippecanoe
      const result = await this.convertGeoJsonToMbtilesUpdate(pathFile, output);
      return result;
    } catch (error) {
      console.error('convert mbtiles error:', error);
      return null;
    }
  }

  // =============================================
  async convertGeoJsonToMbtilesUpdate(
    input: string,
    output: string,
  ): Promise<{ success: boolean; message: string }> {
    if (!fs.existsSync(input)) {
      throw new Error(`File không tồn tại: ${input}`);
    }

    // ✅ Clean trước
    const cleanedInput = input.replace('.geojson', '_cleaned.geojson');
    await this.cleanGeoJson(input, cleanedInput);

    return new Promise((resolve, reject) => {
      const args = [
        '--force',
        '-o',
        output,
        '--projection=EPSG:4326',
        '--layer=thongtinland',
        '--minimum-zoom=10',
        '--maximum-zoom=20',

        // ✅ Tile size
        '--no-tile-compression',
        '--no-feature-limit',
        '--no-tile-size-limit',
        // '--extend-zooms-if-still-dropping',

        // ✅ Buffer - giữ line ở rìa tile
        // '--buffer=80',

        // ✅ Chống mất góc nhọn & shared border
        // '--no-simplification-of-shared-nodes',
        // '--detect-shared-borders',

        // // ✅ Simplification nhẹ nhất có thể
        // '--simplification=1',

        // // ✅ Giữ polygon nhỏ ở zoom cao
        // // '--no-tiny-polygon-reduction',

        // // ✅ Giữ thứ tự vertex gốc (quan trọng cho góc nhọn)
        // '--preserve-input-order',

        // // ✅ Tăng tốc & giảm drop
        // '--hilbert',
        // '--read-parallel',

        cleanedInput,
      ];

      const proc = spawn('tippecanoe', args, {
        env: process.env,
      });

      const timeout = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error('Tippecanoe timeout (>10 phút)'));
      }, 10 * 60 * 1000);

      proc.stdout.on('data', (d) => console.log('[tippecanoe]', d.toString()));

      proc.stderr.on('data', (d) =>
        console.error('[tippecanoe]', d.toString()),
      );

      proc.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      proc.on('close', (code) => {
        clearTimeout(timeout);

        if (code !== 0) {
          return reject(new Error(`Tippecanoe exit code ${code}`));
        }

        if (!fs.existsSync(output)) {
          return reject(new Error('Không tạo được file MBTiles'));
        }

        const size = fs.statSync(output).size;
        if (size === 0) {
          return reject(new Error('MBTiles = 0 byte (GeoJSON rỗng)'));
        }

        resolve({
          success: true,
          message: `OK ${(size / 1024 / 1024).toFixed(2)} MB`,
        });
      });
    });
  }

  // ****************************************************
  async cleanGeoJson(inputPath: string, outputPath: string): Promise<void> {
    const raw = fs.readFileSync(inputPath, 'utf-8');
    const geojson = JSON.parse(raw);

    let removed = 0;

    const cleaned = geojson.features.filter((feature: any) => {
      try {
        const coords = this.extractCoords(feature.geometry);
        for (const [lng, lat] of coords) {
          // ✅ Lọc tọa độ ngoài bounds hoặc NaN
          if (
            !isFinite(lng) ||
            !isFinite(lat) ||
            lng < -180 ||
            lng > 180 ||
            lat < -90 ||
            lat > 90 ||
            (lng === 0 && lat === 0) // tọa độ null island
          ) {
            removed++;
            return false;
          }
        }
        return true;
      } catch {
        removed++;
        return false;
      }
    });

    console.log(
      `[clean] Removed ${removed} bad features, kept ${cleaned.length}`,
    );

    fs.writeFileSync(
      outputPath,
      JSON.stringify({
        type: 'FeatureCollection',
        features: cleaned,
      }),
    );
  }

  extractCoords(geometry: any): [number, number][] {
    if (!geometry) return [];
    const flat = (arr: any[]): [number, number][] => {
      if (typeof arr[0] === 'number') return [arr as [number, number]];
      return arr.flatMap(flat);
    };
    return flat(geometry.coordinates);
  }
  // ****************************************************

  async createFileGeoJson(createControllerDgnDto: CreateGeojsonFIleDto) {
    try {
      const { districtId, provinceId, provinceNewId, wardNewId, year } =
        createControllerDgnDto;

      const rows = await this.dataSource.query(`
      SELECT json_build_object(
        'type','Feature',
        'id',id,
        'geometry', ST_AsGeoJSON(geom)::json,
        'properties', json_build_object('gid', id)
      ) AS feature
      FROM dgn_polygon_layers
      WHERE idtinh= '${provinceNewId}'
        AND idxa= '${wardNewId}'
        AND year= ${year}
        AND (ssn=false OR ssn IS NULL)
    `);

      const features = rows.map((row) => row.feature);

      const geojson = {
        type: 'FeatureCollection',
        features,
      };

      const folder = path.join(SAVE_FILE.DGN_FILE);

      if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder, { recursive: true });
      }

      const filePath = path.join(folder, `${year}_${Date.now()}.geojson`);

      fs.writeFileSync(filePath, JSON.stringify(geojson));

      return filePath;
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  async createFileGeoJsonProvinceOld(
    createControllerDgnDto: CreateGeojsonFIleDto,
  ) {
    try {
      const { districtId, provinceId, provinceNewId, wardNewId, year } =
        createControllerDgnDto;

      const rows = await this.dataSource.query(`
      SELECT json_build_object(
        'type','Feature',
        'id',id,
        'geometry', ST_AsGeoJSON(geom)::json,
        'properties', json_build_object('gid', id)
      ) AS feature
      FROM dgn_polygon_layers
      WHERE idtinh= '${provinceId}'
        AND idhuyen= '${districtId}'
        AND year= ${year}
        AND (ssn=false OR ssn IS NULL)
    `);

      if (rows.length == 0) {
        return null;
      }

      const features = rows.map((row) => row.feature);

      const geojson = {
        type: 'FeatureCollection',
        features,
      };

      const folder = path.join(SAVE_FILE.DGN_FILE);

      if (!fs.existsSync(folder)) {
        fs.mkdirSync(folder, { recursive: true });
      }

      const filePath = path.join(folder, `${year}_${Date.now()}.geojson`);

      fs.writeFileSync(filePath, JSON.stringify(geojson));

      return filePath;
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  // =============================================
  // =============================================
  async runExportDataByProvinceNewId(provinceId: string) {
    try {
      // provinceNew
      // Danh sách file hiện có
      var rs = await this.repository.find({
        select: { provinceNewId: true, wardNewId: true },
        where: { provinceNewId: provinceId },
      });

      // Danh sách Xã/P thuộc province new id
      var listWardAndYear = await this.dataSource.query(`
        SELECT DISTINCT ON ("idxa") "idxa", "year"
        FROM map_layers
        WHERE "idtinh" = '${provinceId}'
          AND ssn = true
        ORDER BY "idxa", "year" DESC;`);

      for (var i = 0; i < listWardAndYear.length; i++) {
        console.log('Index: ', i);

        var checkExit = rs.find((item: any) => {
          item.wardNewId == listWardAndYear[i].idxa;
        });
        if (!checkExit) {
          // Khởi tạo thông tin
          var dataConvert = {
            provinceNewId: provinceId,
            wardNewId: listWardAndYear[i].idxa,
            provinceId: null,
            districtId: null,
            year: listWardAndYear[i].year,
            ssn: null,
          };
          await this.convertDBToMbtilesFileNew(dataConvert);
        }
      }
      return { success: true };
    } catch (error) {
      console.log('error: ', error.message);
      return { success: false };
    }
  }

  async runExportDataByProvinceOldId(provinceId: string) {
    try {
      // provinceNew
      // Danh sách file hiện có
      var rs = await this.repository.find({
        select: { provinceId: true, districtId: true },
        where: { provinceId: provinceId },
      });

      // Danh sách Xã/P thuộc province new id
      var listDistrictAndYear = await this.dataSource.query(`
        SELECT DISTINCT ON ("idhuyen") "idhuyen", "year"
        FROM map_layers
        WHERE "idtinh" = '${provinceId}'
          AND (ssn = false OR ssn IS NULL)
        ORDER BY "idhuyen", "year" DESC;`);

      for (var i = 0; i < listDistrictAndYear.length; i++) {
        var checkExit = rs.find((item: any) => {
          item.districtId == listDistrictAndYear[i].idhuyen;
        });
        if (!checkExit) {
          // Khởi tạo thông tin
          var dataConvert = {
            provinceNewId: null,
            wardNewId: null,
            provinceId: provinceId,
            districtId: listDistrictAndYear[i].idhuyen,
            year: listDistrictAndYear[i].year,
            ssn: null,
          };
          await this.convertDBToMbtilesFile(dataConvert);
        }
      }
      return { success: true };
    } catch (error) {
      console.log('error: ', error.message);
      return { success: false };
    }
  }
  // ************************************************
  async createGeoLineByForm(dto: ExportGeoLineByLocationDto) {
    const { districtId, provinceId, provinceNewId, wardNewId, ssn } = dto;

    if (ssn == false) {
      if (provinceId && districtId) {
        // Xác định dữ liệu hiện có
        var rsFindOne = await this.repository.findOne({
          where: { provinceId: provinceId, districtId: districtId },
        });
        if (rsFindOne) {
          // Xóa file và thông tin lưu
          await this.fileLayerLineService.deleteFile(rsFindOne.id);
        }

        // xác định lại year cao nhất
        var topYear = await this.dataSource.query(
          `
            SELECT MAX(year) FROM map_layers
            WHERE idtinh = $1 AND idhuyen = $2
            `,
          [provinceId, districtId],
        );

        // Export
        // Khởi tạo thông tin
        var dataConvert: any = {
          provinceNewId: null,
          wardNewId: null,
          provinceId: provinceId,
          districtId: districtId,
          year: topYear[0]?.max,
          ssn: null,
        };

        await this.convertDBToMbtilesFile(dataConvert); // Khởi tạo geoline location cũ
        return { success: true, message: CREATE_SUCCESSFULLY };
      }
    } else if (ssn == true) {
      if (provinceNewId && wardNewId) {
        // Xác định dữ liệu hiện có
        var rsFindOne = await this.repository.findOne({
          where: { provinceNewId: provinceNewId, wardNewId: wardNewId },
        });
        if (rsFindOne) {
          // Xóa file và thông tin lưu
          await this.fileLayerLineService.deleteFile(rsFindOne.id);
        }

        // xác định lại year cao nhất
        var topYear = await this.dataSource.query(
          `
            SELECT MAX(year) FROM map_layers
            WHERE idtinh = $1 AND idhuyen = $2
            `,
          [provinceNewId, wardNewId],
        );

        // Export
        // Khởi tạo thông tin
        var dataConvert: any = {
          provinceNewId: provinceNewId,
          wardNewId: wardNewId,
          provinceId: null,
          districtId: null,
          year: topYear[0]?.max,
          ssn: true,
        };

        await this.convertDBToMbtilesFileNew(dataConvert); // Khởi tạo geoline location cũ
        return { success: true, message: CREATE_SUCCESSFULLY };
      }
    } else {
      return { success: false, message: 'Vui lòng truyền thông tin!' };
    }
  }

  // ============================================
  // UPDATE ALL BBOX DỮ LIỆU
  async updateAllBboxGeoLineNull() {
    // Lấy danh sách dữ liệu null
    const listData = await this.repository.find({
      where: {
        geom: IsNull(),
      },
    });

    if (listData.length === 0) return;
    for (const item of listData) {
      try {
        const dataBbox = await this.getBboxFromFile(item.fullname);
        const { minLon, minLat, maxLon, maxLat } = dataBbox;

        // Tạo geometry dạng Polygon từ bbox
        const bboxPolygon: any = {
          type: 'Polygon',
          coordinates: [
            [
              [minLon, minLat],
              [maxLon, minLat],
              [maxLon, maxLat],
              [minLon, maxLat],
              [minLon, minLat], // Đóng vòng
            ],
          ],
        };

        await this.repository.update(item.id, {
          geom: bboxPolygon,
        });
      } catch (error) {
        // Bỏ qua file lỗi, tiếp tục xử lý các file còn lại
        console.error(`Lỗi xử lý file ${item.fullname}:`, error?.message);
        continue;
      }
    }
  }

  // ============================================
  // EXTRACT BBOX GEOJSON
  async getBboxFromFile(filePath: string): Promise<any> {
    const absolutePath = path.resolve(filePath);

    if (!fs.existsSync(absolutePath)) {
      throw new BadRequestException(`File không tồn tại: ${absolutePath}`);
    }

    // Dùng stream + json parse để tránh load cả file vào RAM
    const raw = fs.readFileSync(absolutePath, 'utf-8');
    let geojson: any;

    try {
      geojson = JSON.parse(raw);
    } catch {
      throw new BadRequestException('File không phải định dạng JSON hợp lệ');
    }

    // Dùng iterative thay vì recursive
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    let found = false;

    const updateBbox = (coord: [number, number]) => {
      const [lon, lat] = coord;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      found = true;
    };

    // Stack-based traversal, không dùng đệ quy
    const stack: any[] = [geojson];

    while (stack.length > 0) {
      const node = stack.pop();
      if (!node || !node.type) continue;

      switch (node.type) {
        case 'FeatureCollection':
          if (Array.isArray(node.features)) {
            for (const f of node.features) stack.push(f);
          }
          break;

        case 'Feature':
          if (node.geometry) stack.push(node.geometry);
          break;

        case 'GeometryCollection':
          if (Array.isArray(node.geometries)) {
            for (const g of node.geometries) stack.push(g);
          }
          break;

        case 'Point':
          updateBbox(node.coordinates);
          break;

        case 'MultiPoint':
        case 'LineString':
          for (const coord of node.coordinates) updateBbox(coord);
          break;

        case 'MultiLineString':
        case 'Polygon':
          for (const ring of node.coordinates)
            for (const coord of ring) updateBbox(coord);
          break;

        case 'MultiPolygon':
          for (const polygon of node.coordinates)
            for (const ring of polygon)
              for (const coord of ring) updateBbox(coord);
          break;

        default:
          console.warn(`Bỏ qua geometry type không hỗ trợ: ${node.type}`);
          break;
      }
    }

    if (!found) {
      throw new BadRequestException(
        'Không tìm thấy tọa độ nào trong file GeoJSON',
      );
    }

    return {
      minLon,
      minLat,
      maxLon,
      maxLat,
      bbox: [minLon, minLat, maxLon, maxLat],
    };
  }

  private extractCoordinates(geojson: any, coords: [number, number][]): void {
    switch (geojson.type) {
      case 'FeatureCollection':
        geojson.features?.forEach((f: any) =>
          this.extractCoordinates(f, coords),
        );
        break;

      case 'Feature':
        if (geojson.geometry) {
          this.extractCoordinates(geojson.geometry, coords);
        }
        break;

      case 'GeometryCollection':
        geojson.geometries?.forEach((g: any) =>
          this.extractCoordinates(g, coords),
        );
        break;

      case 'Point':
        coords.push(geojson.coordinates);
        break;

      case 'MultiPoint':
      case 'LineString':
        coords.push(...geojson.coordinates);
        break;

      case 'MultiLineString':
      case 'Polygon':
        geojson.coordinates?.forEach((ring: [number, number][]) =>
          coords.push(...ring),
        );
        break;

      case 'MultiPolygon':
        geojson.coordinates?.forEach((polygon: [number, number][][]) =>
          polygon.forEach((ring) => coords.push(...ring)),
        );
        break;

      default:
        throw new BadRequestException(
          `Geometry type không hỗ trợ: ${geojson.type}`,
        );
    }
  }
}
