/* eslint-disable prettier/prettier */
import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
} from '@nestjs/common';
import { CommonService } from 'src/common/common.service';
import { HttpService } from '@nestjs/axios';
import { Redis } from 'ioredis';

// giữ import syntax
import Database = require('better-sqlite3');

import * as path from 'path';
import { LocationNewService } from 'src/location-new/location-new.service';
import { FileLayerLineService } from 'src/file-layer-line/file-layer-line.service';

@Injectable()
export class MbtilesService implements OnModuleInit, OnModuleDestroy {
  constructor(
    private commonService: CommonService,
    private httpService: HttpService,
    private locationNewService: LocationNewService,
    private fileLayerLineService: FileLayerLineService,
    @Inject('REDIS') private readonly redis: Redis,
  ) {}

  // ✅ Pool DB connections – mỗi file mbtiles chỉ mở 1 lần
  private dbPool = new Map<
    string,
    {
      db: Database.Database;
      stmt: Database.Statement;
      lastUsed: number;
    }
  >();

  onModuleInit() {
    // ✅ Dọn DB không dùng sau 10 phút
    setInterval(() => this.cleanDbPool(), 10 * 60 * 1000);
  }

  onModuleDestroy() {
    for (const { db } of this.dbPool.values()) {
      try {
        db.close();
      } catch {}
    }
    this.dbPool.clear();
  }

  // ✅ Lấy hoặc tạo DB connection từ pool
  private getDb(fullname: string): {
    db: Database.Database;
    stmt: Database.Statement;
  } {
    const existing = this.dbPool.get(fullname);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing;
    }

    const mbtilesPath = path.resolve('../DATA_BUILD/', fullname);
    console.log("mbtilesPathmbtilesPath", mbtilesPath);
    
    const db = new Database(mbtilesPath, {
      readonly: true,
      fileMustExist: true,
    });

    // ✅ Tối ưu SQLite read performance
    db.pragma('journal_mode = WAL');
    db.pragma('cache_size = -32000'); // 32MB per file
    db.pragma('mmap_size = 134217728'); // 128MB mmap

    const stmt = db.prepare(
      'SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?',
    );

    const entry = { db, stmt, lastUsed: Date.now() };
    this.dbPool.set(fullname, entry);
    return entry;
  }

  private cleanDbPool() {
    const threshold = Date.now() - 10 * 60 * 1000;
    for (const [key, { db, lastUsed }] of this.dbPool.entries()) {
      if (lastUsed < threshold) {
        try {
          db.close();
        } catch {}
        this.dbPool.delete(key);
      }
    }
  }

  // ✅ Đảm bảo z/x/y là number trước khi tính toán
  getTileFromFile(
    fullname: string,
    z: number,
    x: number,
    y: number,
  ): Buffer | null {
    try {
      const { stmt } = this.getDb(fullname);

      // ✅ Ép kiểu tường minh phòng trường hợp vẫn nhận string
      const zi = +z,
        xi = +x,
        yi = +y;
      const tmsY = (1 << zi) - 1 - yi;

      // this.logger.debug?.(`getTile ${fullname} z=${zi} x=${xi} tmsY=${tmsY}`);

      const result = stmt.get(zi, xi, tmsY) as
        | { tile_data: Buffer }
        | undefined;
      return result?.tile_data ?? null;
    } catch (err) {
      console.error(
        `[MbtilesService] getTileFromFile error ${fullname}:`,
        err.message,
      );
      return null;
    }
  }

  async resolveFilename(
    z: number,
    x: number,
    y: number,
  ): Promise<string | null> {
    // ✅ Ép kiểu tường minh
    const zi = +z,
      xi = +x,
      yi = +y;

    const n = Math.pow(2, zi);
    const lon = (xi / n) * 360.0 - 180.0;
    const lat_rad = Math.atan(Math.sinh(Math.PI * (1 - (2 * yi) / n)));
    const lat = (lat_rad * 180.0) / Math.PI;

    const latKey = lat.toFixed(2);
    const lonKey = lon.toFixed(2);
    const redisKey = `mbtiles:filename:${latKey}:${lonKey}`;

    const cached = await this.redis.get(redisKey);
    if (cached !== null) {
      return cached === 'NULL' ? null : cached;
    }

    const result = await this.checkDataInLocation(lat, lon);
    const filename = result?.success ? result?.data?.filename ?? null : null;

    await this.redis.set(redisKey, filename ?? 'NULL', 'EX', 3600);

    console.log(
      `[resolveFilename] lat=${lat.toFixed(4)} lon=${lon.toFixed(
        4,
      )} → ${filename}`,
    );

    return filename;
  }
  async checkDataInLocation(lat: number, lng: number) {
    try {
      const infoLocation: any =
        await this.locationNewService.getInfoLocationAll({ lat, lng });

      if (!infoLocation?.success) return { success: false, data: null };

      let result = await this.fileLayerLineService.getDataLayerInLocationNew(
        infoLocation.data.infoNew.provinceid,
        infoLocation.data.infoNew.wardid,
      );

      if (!result.success) {
        result = await this.fileLayerLineService.getDataLayerInLocationOld(
          infoLocation.data.infoOld.provinceid,
          infoLocation.data.infoOld.districtid,
        );
      }

      if (!result.success) return { success: false, data: null };
      return { success: true, data: result.data[0] };
    } catch (error) {
      return { success: false, data: null, message: error.message };
    }
  }
}
