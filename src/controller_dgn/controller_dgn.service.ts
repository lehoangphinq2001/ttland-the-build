/* eslint-disable prettier/prettier */
/* eslint-disable no-var */
import { Injectable } from '@nestjs/common';
import { CreateGeojsonFIleDto } from './dto/create-file-json.dto';
import { CommonService } from 'src/common/common.service';
import { DataSource, Repository } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { SAVE_FILE } from 'src/common/common.constant';
import { FileLayerLine } from 'src/entity/file-layer-line.entity';
import { execFile, spawn } from 'child_process';
import * as fsp from 'fs/promises';
import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class ControllerDgnService {
  constructor(
    @InjectRepository(FileLayerLine)
    private repository: Repository<FileLayerLine>,

    private commonService: CommonService,
    private dataSource: DataSource, // private httpService: HttpService,
  ) {}
  async convertDBToMbtilesFile(createControllerDgnDto: CreateGeojsonFIleDto) {
    const { districtId, provinceId, provinceNewId, wardId, wardNewId, year } =
      createControllerDgnDto;
    // B1: convert geojson
    var pathFile = await this.createFileGeoJson(createControllerDgnDto);

    var dataLine = new FileLayerLine();
    dataLine.accountId = 1;
    dataLine.provinceNewId = provinceNewId;
    dataLine.wardNewId = wardNewId;
    dataLine.provinceId = provinceId;
    dataLine.districtId = districtId;
    dataLine.wardId = wardId;
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

  // =============================================
  async convertGeoJsonToMbtilesUpdate(
    input: string,
    output: string,
  ): Promise<{ success: boolean; message: string }> {
    if (!fs.existsSync(input)) {
      throw new Error(`File không tồn tại: ${input}`);
    }
    return new Promise((resolve, reject) => {
      // const args = [
      //   '--force',
      //   '-o',
      //   output,
      //   '--projection=EPSG:4326', // WGS84
      //   '--layer=thongtinland',
      //   '--minimum-zoom=10', // Min Zoom
      //   '--maximum-zoom=18',

      //   '--no-tile-compression',
      //   '--no-feature-limit',
      //   '--no-tile-size-limit',

      //   input,
      // ];
      
      const args = [
        '--force',
        '-o',
        output,
        '--projection=EPSG:4326',
        '--layer=thongtinland',
        '--minimum-zoom=10',
        '--maximum-zoom=18',

        // ✅ BẬT nén gzip (mặc định của tippecanoe, giảm 60-70% dung lượng)
        // Bỏ --no-tile-compression

        // ✅ Simplify geometry theo từng zoom level
        '--simplification=10', // zoom thấp: simplify mạnh
        '--simplify-only-low-zooms', // zoom cao giữ nguyên chi tiết

        // ✅ Tự động drop feature khi tile quá lớn thay vì reject
        '--coalesce-densest-as-needed',
        '--extend-zooms-if-still-dropping',

        // ✅ Giới hạn tile size hợp lý (500KB) thay vì unlimited
        '--maximum-tile-bytes=500000',

        // ✅ Chỉ giữ properties cần thiết (thay YOUR_PROPS bằng tên thực)
        // '--include=id,name,loaidat',

        // ✅ Tăng performance conversion
        '--read-parallel',

        '--no-feature-limit',
        input,
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

  async createFileGeoJson(createControllerDgnDto: CreateGeojsonFIleDto) {
    try {
      const { districtId, provinceId, provinceNewId, wardId, wardNewId, year } =
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
}
