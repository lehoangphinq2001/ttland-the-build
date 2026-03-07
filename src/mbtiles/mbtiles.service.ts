/* eslint-disable no-var */
/* eslint-disable prettier/prettier */
import {
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Param,
  Res,
} from '@nestjs/common';
import { CommonService } from 'src/common/common.service';
import { HttpService } from '@nestjs/axios';
import { Redis } from 'ioredis';
import Database from "better-sqlite3";
import path from 'path';
@Injectable()
export class MbtilesService {
  constructor(
    private commonService: CommonService,
    private httpService: HttpService,

    @Inject('REDIS') private readonly redis: Redis,
  ) {}


  // Hàm chọn file dựa trên vị trí, rồi trả tile
  async getTileGeoJsonConvert(
    z: number,
    x: number,
    y: number,
  ): Promise<Buffer | null> {
    const n = Math.pow(2, z);

    // Tính kinh độ/vĩ độ từ z/x/y
    const lon_deg = (x / n) * 360.0 - 180.0;
    const lat_rad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
    const lat_deg = (lat_rad * 180.0) / Math.PI;

    // Kiểm tra vị trí để chọn file MBTiles
    const result2 = await this.checkDataInLocation(lat_deg, lon_deg);
    if (result2?.success && result2?.data?.fullname) {
      return this.getTile(result2?.data?.fullname, z, x, y);
    } else {
      return null;
    }
  }
    // Mở file và lấy tile theo z/x/y
  async getTile(
    fullname: string,
    z: number,
    x: number,
    y: number,
  ): Promise<Buffer | null> {
    const mbtilesPath = await path.resolve(
      process.env.DATA_CONVERT_ || '/home/UPLOAD_FILE',
      fullname,
    );

    const db = new Database(mbtilesPath);
    try {
      const stmt = db.prepare(
        'SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?',
      );

      const row = (1 << z) - 1 - y;
      const result = stmt.get(z, x, row);
      return result ? result.tile_data : null;
    } finally {
      db.close(); // Đảm bảo đóng database
    }
  }


  async checkDataInLocation(lat, lng) {
    try {
      //   var infoLocation: any = await this.locationNewService.getInfoLocationAll({
      //     lat,
      //     lng,
      //   });
      //   if (infoLocation?.success == false) {
      //     return { success: false, data: null };
      //   }
      //   var result = await this.fileUploadDgnService.getDataLayerInLocationNew(
      //     infoLocation?.data?.infoNew?.province_id,
      //     infoLocation?.data?.infoNew?.ward_id,
      //     null,
      //   );
      //   if (result.success == false) {
      //     var result = await this.fileUploadDgnService.getDataLayerInLocationOld(
      //       infoLocation?.data?.infoOld?.province_id,
      //       infoLocation?.data?.infoOld?.district_id,
      //       null,
      //     );
      //     if (result.success == false) {
      //       return { success: false, data: null, message: null };
      //     }
      //     return { success: true, data: result.data[0], message: null };
      //   } else {
      //     return { success: true, data: result.data[0], message: null };
      //   }
    } catch (error) {
      return { success: false, data: null, message: error.message };
    }
  }
}
