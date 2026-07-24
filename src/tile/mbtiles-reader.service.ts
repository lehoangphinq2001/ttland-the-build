/* eslint-disable prettier/prettier */
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import Database = require('better-sqlite3');
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import * as LRUCache from 'lru-cache';

export const MBTILES_DIR = path.resolve(
  process.env.MBTILES_DIR ?? '../DATA_BUILD/',
);

export interface MbtilesMeta {
  minzoom: number;
  maxzoom: number;
  format: string;
  vectorLayers: any[];
}

export interface TileRead {
  /** blob đã giải gzip */
  data: Buffer;
  /** toạ độ tile thực sự đọc được — khác z/x/y yêu cầu nghĩa là đang overzoom */
  srcZ: number;
  srcX: number;
  srcY: number;
}

interface Conn {
  db: Database.Database;
  stmt: Database.Statement;
  meta: MbtilesMeta;
}

/**
 * Tầng truy cập file .mbtiles.
 *
 * Nguyên tắc tối ưu:
 *  1. Connection mở lazy, giữ trong LRU — không mở hết vài nghìn file cùng lúc.
 *  2. Prepared statement giữ theo connection, không prepare lại mỗi lần đọc.
 *  3. mmap + WAL + cache_size để SQLite đọc thẳng từ page cache của OS.
 *  4. Overzoom xử lý ngay ở tầng này: z vượt maxzoom thì tự lùi về tile cha.
 *  5. Cache âm TTL NGẮN — không để một lần lỗi khoá cứng vùng dữ liệu.
 */
@Injectable()
export class MbtilesReaderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MbtilesReaderService.name);

  private conns = new LRUCache<string, Conn>({
    max: Number(process.env.MBTILES_MAX_OPEN ?? 128),
    dispose: (c) => {
      try {
        c.db.close();
      } catch {
        /* noop */
      }
    },
  });

  /** file mở lỗi -> thử lại sau BAD_TTL, không spam log */
  private bad = new LRUCache<string, number>({
    max: 5000,
    ttl: Number(process.env.MBTILES_BAD_TTL_MS ?? 60_000),
  });

  /** "file này KHÔNG có ô z/x/y" — tiết kiệm truy vấn ở vùng rìa */
  private miss = new LRUCache<string, true>({
    max: 500_000,
    ttl: Number(process.env.MBTILES_MISS_TTL_MS ?? 300_000),
  });

  private reads = 0;
  private hits = 0;
  private gunzips = 0;

  onModuleInit() {
    if (!fs.existsSync(MBTILES_DIR)) {
      this.logger.error(`MBTILES_DIR không tồn tại: ${MBTILES_DIR}`);
    } else {
      this.logger.log(`MBTILES_DIR = ${MBTILES_DIR}`);
    }
  }

  onModuleDestroy() {
    this.conns.clear();
  }

  // ------------------------------------------------------------------

  private resolvePath(filename: string): string | null {
    if (!filename || filename.includes('\0')) return null;
    const safe = path.basename(filename);
    const full = path.resolve(MBTILES_DIR, safe);
    if (!full.startsWith(MBTILES_DIR)) return null;
    return full;
  }

  private conn(filename: string): Conn | null {
    const key = path.basename(filename);

    const hit = this.conns.get(key);
    if (hit) return hit;

    if (this.bad.has(key)) return null;

    const full = this.resolvePath(key);
    if (!full || !fs.existsSync(full)) {
      this.bad.set(key, 1);
      this.logger.warn(`Không thấy file: ${key}`);
      return null;
    }

    try {
      const db = new Database(full, { readonly: true, fileMustExist: true });
      db.pragma('query_only = ON');
      db.pragma('cache_size = -16000'); // 16MB / file
      db.pragma('mmap_size = 134217728'); // 128MB
      db.pragma('temp_store = MEMORY');

      const stmt = db.prepare(
        'SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?',
      );

      const conn: Conn = { db, stmt, meta: this.readMeta(db) };
      this.conns.set(key, conn);
      return conn;
    } catch (err: any) {
      this.bad.set(key, 1);
      this.logger.warn(`Mở ${key} lỗi: ${err.message}`);
      return null;
    }
  }

  private readMeta(db: Database.Database): MbtilesMeta {
    let rows: { name: string; value: string }[] = [];
    try {
      rows = db.prepare('SELECT name, value FROM metadata').all() as any[];
    } catch {
      /* file thiếu bảng metadata */
    }
    const m: Record<string, string> = {};
    rows.forEach((r) => (m[r.name] = r.value));

    let vectorLayers: any[] = [];
    try {
      if (m.json) vectorLayers = JSON.parse(m.json).vector_layers ?? [];
    } catch {
      /* noop */
    }

    let minzoom = parseInt(m.minzoom ?? '', 10);
    let maxzoom = parseInt(m.maxzoom ?? '', 10);
    if (!Number.isFinite(minzoom) || !Number.isFinite(maxzoom)) {
      // metadata thiếu -> hỏi thẳng bảng tiles (chỉ 1 lần / connection)
      try {
        const r = db
          .prepare('SELECT MIN(zoom_level) a, MAX(zoom_level) b FROM tiles')
          .get() as any;
        minzoom = Number.isFinite(minzoom) ? minzoom : (r?.a ?? 0);
        maxzoom = Number.isFinite(maxzoom) ? maxzoom : (r?.b ?? 14);
      } catch {
        minzoom = 0;
        maxzoom = 14;
      }
    }

    return { minzoom, maxzoom, format: m.format ?? 'pbf', vectorLayers };
  }

  meta(filename: string): MbtilesMeta | null {
    return this.conn(filename)?.meta ?? null;
  }

  // ------------------------------------------------------------------

  /**
   * Đọc ô z/x/y. Nếu z > maxzoom của file thì tự lùi về tile cha
   * (đây là chỗ code cũ trả emptyPNG và làm trắng bản đồ khi zoom sâu).
   *
   * `hintMax` cho phép truyền maxzoom lấy từ catalog để bỏ qua luôn những
   * file chắc chắn không có dữ liệu mà không cần mở file.
   */
  read(
    filename: string,
    z: number,
    x: number,
    y: number,
    hintMin?: number | null,
    hintMax?: number | null,
  ): TileRead | null {
    if (hintMin != null && z < hintMin) return null;

    const conn = this.conn(filename);
    if (!conn) return null;

    const { minzoom, maxzoom } = conn.meta;
    if (z < minzoom) return null;

    const srcZ = Math.min(z, hintMax != null ? Math.min(maxzoom, hintMax) : maxzoom);
    const shift = z - srcZ;
    const srcX = x >> shift;
    const srcY = y >> shift;

    const mk = `${path.basename(filename)}|${srcZ}/${srcX}/${srcY}`;
    if (this.miss.has(mk)) return null;

    this.reads++;
    const tmsY = (1 << srcZ) - 1 - srcY;

    let row: { tile_data: Buffer } | undefined;
    try {
      row = conn.stmt.get(srcZ, srcX, tmsY) as any;
    } catch (err: any) {
      this.logger.warn(`Đọc ${filename} ${srcZ}/${srcX}/${srcY}: ${err.message}`);
      return null;
    }

    if (!row?.tile_data?.length) {
      this.miss.set(mk, true);
      return null;
    }

    this.hits++;
    let data = row.tile_data;
    if (data[0] === 0x1f && data[1] === 0x8b) {
      this.gunzips++;
      try {
        data = zlib.gunzipSync(data);
      } catch (err: any) {
        this.logger.warn(`Gunzip ${filename} ${srcZ}/${srcX}/${srcY} lỗi`);
        return null;
      }
    }

    return { data, srcZ, srcX, srcY };
  }

  /** Mở sẵn connection cho danh sách file (dùng khi seed / warm-up). */
  warm(filenames: string[]) {
    let ok = 0;
    for (const f of filenames.slice(0, this.conns.max)) {
      if (this.conn(f)) ok++;
    }
    this.logger.log(`Warm-up: mở sẵn ${ok}/${filenames.length} file`);
  }

  /** Kiểm tra sức khoẻ toàn bộ file trong catalog — chạy lúc boot hoặc qua API. */
  health(filenames: string[]) {
    const missing: string[] = [];
    const broken: string[] = [];
    const empty: string[] = [];

    for (const f of filenames) {
      const full = this.resolvePath(f);
      if (!full || !fs.existsSync(full)) {
        missing.push(f);
        continue;
      }
      const c = this.conn(f);
      if (!c) {
        broken.push(f);
        continue;
      }
      try {
        const r = c.db.prepare('SELECT COUNT(*) n FROM tiles LIMIT 1').get() as any;
        if (!r?.n) empty.push(f);
      } catch {
        broken.push(f);
      }
    }

    return {
      total: filenames.length,
      ok: filenames.length - missing.length - broken.length - empty.length,
      missing,
      broken,
      empty,
    };
  }

  /** Đóng hết connection — gọi khi catalog đổi version / file được build lại. */
  flush() {
    this.conns.clear();
    this.miss.clear();
    this.bad.clear();
  }

  stats() {
    return {
      dir: MBTILES_DIR,
      openConnections: this.conns.size,
      maxOpen: this.conns.max,
      badFiles: this.bad.size,
      missCached: this.miss.size,
      reads: this.reads,
      hits: this.hits,
      hitRate: this.reads ? +(this.hits / this.reads).toFixed(3) : 0,
      gunzips: this.gunzips,
    };
  }
}
