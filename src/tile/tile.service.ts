/* eslint-disable prettier/prettier */
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import mbgl = require('@maplibre/maplibre-gl-native');
import sharp = require('sharp');
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as zlib from 'zlib';
import * as LRUCache from 'lru-cache';

import {
  FileCatalogService,
  CatalogEntry,
  tileBounds,
} from './file-catalog.service';
import { MbtilesReaderService, TileRead } from './mbtiles-reader.service';
import { mergeVectorTiles, overzoomTile } from './vector-tile.util';

// ----------------------------------------------------------------------
// Cấu hình
// ----------------------------------------------------------------------
const TILE_SIZE = Number(process.env.TILE_SIZE ?? 512);
const PIXEL_RATIO = Number(process.env.TILE_RATIO ?? 2);
const RENDER_TIMEOUT_MS = Number(process.env.RENDER_TIMEOUT_MS ?? 15_000);
const ACQUIRE_TIMEOUT_MS = Number(process.env.ACQUIRE_TIMEOUT_MS ?? 8_000);
const RENDERERS_PER_SCOPE = Number(process.env.RENDERERS_PER_SCOPE ?? 2);
const MAX_SCOPES = Number(process.env.MAX_RENDER_SCOPES ?? 8);
const MAX_FILES_PER_TILE = Number(process.env.MAX_FILES_PER_TILE ?? 24);
const DISK_CACHE_DIR = process.env.TILE_CACHE_DIR ?? '';

/** buffer rỗng = "đã dựng và xác nhận không có dữ liệu", khác với null = chưa dựng */
const EMPTY = Buffer.alloc(0);

export interface TileScope {
  accountId?: number | null;
  year?: number | null;
}

type RequestCallback = (err?: Error | null, response?: { data: Buffer }) => void;
type RequestParameters = { url: string; kind: number };

interface ScopePool {
  key: string;
  scope: TileScope;
  maps: InstanceType<typeof mbgl.Map>[];
  free: number[];
  waiters: {
    resolve: (i: number) => void;
    reject: (e: Error) => void;
    timer: NodeJS.Timeout;
  }[];
  lastUsed: number;
  stale: boolean;
}

@Injectable()
export class TileService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TileService.name);

  private styleJson: any;

  // ---- cache tile vector đã ghép ----
  private vtCache = new LRUCache<string, Buffer>({
    max: Number(process.env.VT_CACHE_MAX ?? 20_000),
    maxSize: Number(process.env.VT_CACHE_BYTES ?? 512 * 1024 * 1024),
    sizeCalculation: (b) => b.length || 1,
    ttl: Number(process.env.VT_CACHE_TTL_MS ?? 30 * 60_000),
  });

  /** tile rỗng cache riêng với TTL NGẮN: vùng vừa build xong không phải chờ lâu */
  private emptyCache = new LRUCache<string, true>({
    max: 200_000,
    ttl: Number(process.env.EMPTY_TTL_MS ?? 60_000),
  });

  // ---- cache PNG ----
  private pngCache = new LRUCache<string, Buffer>({
    max: Number(process.env.PNG_CACHE_MAX ?? 4_000),
    maxSize: Number(process.env.PNG_CACHE_BYTES ?? 256 * 1024 * 1024),
    sizeCalculation: (b) => b.length || 1,
    ttl: Number(process.env.PNG_CACHE_TTL_MS ?? 15 * 60_000),
  });

  /** gộp các request trùng nhau đang bay */
  private inflight = new Map<string, Promise<Buffer>>();

  private pools = new Map<string, ScopePool>();
  private versionSeen = '';

  private emptyPng: Buffer;
  private metrics = { vtBuilt: 0, vtCacheHit: 0, diskHit: 0, rendered: 0, merged: 0, overzoomed: 0 };

  constructor(
    private readonly catalog: FileCatalogService,
    private readonly reader: MbtilesReaderService,
  ) {}

  async onModuleInit() {
    this.emptyPng = await this.buildEmptyPng();
    this.loadStyle();
    await this.prepareDiskCache();
    this.versionSeen = this.catalog.version;
    this.logger.log(
      `TilesService sẵn sàng — tile ${TILE_SIZE}px @${PIXEL_RATIO}x, ` +
        `disk cache: ${DISK_CACHE_DIR || 'tắt'}`,
    );
  }

  onModuleDestroy() {
    for (const p of this.pools.values()) this.disposePool(p);
    this.pools.clear();
  }

  // ==================================================================
  // 1. Vector tile — đường đi chính
  // ==================================================================

  /**
   * Trả về vector tile đã ghép từ TẤT CẢ file phủ ô này (chưa nén).
   * Buffer rỗng nghĩa là không có dữ liệu, không phải lỗi.
   */
  async getVectorTile(
    z: number,
    x: number,
    y: number,
    scope: TileScope = {},
  ): Promise<Buffer> {
    if (!this.validXYZ(z, x, y)) return EMPTY;

    this.checkVersion();

    const key = this.catalog.cacheKey(z, x, y, scope);

    if (this.emptyCache.has(key)) return EMPTY;
    const mem = this.vtCache.get(key);
    if (mem) {
      this.metrics.vtCacheHit++;
      return mem;
    }

    const flying = this.inflight.get(key);
    if (flying) return flying;

    const task = this.buildVectorTile(key, z, x, y, scope)
      .catch((err) => {
        this.logger.warn(`Dựng tile ${z}/${x}/${y} lỗi: ${err.message}`);
        return EMPTY;
      })
      .finally(() => this.inflight.delete(key));

    this.inflight.set(key, task);
    return task;
  }

  private async buildVectorTile(
    key: string,
    z: number,
    x: number,
    y: number,
    scope: TileScope,
  ): Promise<Buffer> {
    // --- tầng cache đĩa ---
    const fromDisk = await this.diskGet(key);
    if (fromDisk) {
      this.metrics.diskHit++;
      if (!fromDisk.length) {
        this.emptyCache.set(key, true);
        return EMPTY;
      }
      this.vtCache.set(key, fromDisk);
      return fromDisk;
    }

    // --- chọn file: TẤT CẢ file phủ ô, không phải file đầu tiên ---
    const entries = this.catalog.filesForTile(z, x, y, scope);
    if (!entries.length) {
      this.emptyCache.set(key, true);
      return EMPTY;
    }

    if (entries.length > MAX_FILES_PER_TILE) {
      this.logger.warn(
        `Ô ${z}/${x}/${y} khớp ${entries.length} file, cắt còn ${MAX_FILES_PER_TILE}`,
      );
    }

    // --- đọc song song về mặt logic (SQLite đồng bộ nên là vòng lặp) ---
    const parts: Buffer[] = [];
    for (const e of entries.slice(0, MAX_FILES_PER_TILE)) {
      const read = this.reader.read(e.filename, z, x, y, e.minzoom, e.maxzoom);
      if (!read) continue;

      const buf = this.normalize(read, z, x, y, e);
      if (buf?.length) parts.push(buf);
    }

    this.metrics.vtBuilt++;

    if (!parts.length) {
      this.emptyCache.set(key, true);
      await this.diskSet(key, EMPTY);
      return EMPTY;
    }

    let out: Buffer;
    if (parts.length === 1) {
      out = parts[0];
    } else {
      this.metrics.merged++;
      out = mergeVectorTiles(parts) ?? EMPTY;
    }

    if (!out.length) {
      this.emptyCache.set(key, true);
      await this.diskSet(key, EMPTY);
      return EMPTY;
    }

    this.vtCache.set(key, out);
    await this.diskSet(key, out);
    return out;
  }

  /**
   * Đưa tile về đúng z/x/y yêu cầu.
   *
   * Khi các file trong cùng một ô có maxzoom KHÁC nhau, tile cha của file
   * maxzoom thấp phủ diện tích gấp 4^n lần nhưng vẫn dùng extent 4096 —
   * ghép thẳng sẽ lệch toạ độ. Phải cắt lại về ô con trước khi ghép.
   */
  private normalize(
    read: TileRead,
    z: number,
    x: number,
    y: number,
    entry: CatalogEntry,
  ): Buffer | null {
    if (read.srcZ === z) return read.data;

    const ozKey = `oz:${entry.filename}:${z}/${x}/${y}`;
    const cached = this.vtCache.get(ozKey);
    if (cached) return cached;

    this.metrics.overzoomed++;
    const cut = overzoomTile(
      read.data,
      { z: read.srcZ, x: read.srcX, y: read.srcY },
      { z, x, y },
    );
    if (cut?.length) this.vtCache.set(ozKey, cut);
    return cut;
  }

  /** Bản gzip để trả thẳng cho client. */
  async getVectorTileGz(
    z: number,
    x: number,
    y: number,
    scope: TileScope = {},
  ): Promise<Buffer | null> {
    const raw = await this.getVectorTile(z, x, y, scope);
    return raw.length ? zlib.gzipSync(raw, { level: 6 }) : null;
  }

  // ==================================================================
  // 2. Raster tile — cho client cũ
  // ==================================================================

  async getRasterTile(
    z: number,
    x: number,
    y: number,
    scope: TileScope = {},
  ): Promise<Buffer> {
    if (!this.validXYZ(z, x, y)) return this.emptyPng;

    this.checkVersion();
    const key = `png:${this.catalog.cacheKey(z, x, y, scope)}`;

    const mem = this.pngCache.get(key);
    if (mem) return mem;

    const flying = this.inflight.get(key);
    if (flying) return flying;

    const task = this.renderPng(z, x, y, scope)
      .catch((err) => {
        this.logger.warn(`Render ${z}/${x}/${y} lỗi: ${err.message}`);
        return this.emptyPng;
      })
      .finally(() => this.inflight.delete(key));

    this.inflight.set(key, task);
    const png = await task;
    if (png !== this.emptyPng) this.pngCache.set(key, png);
    return png;
  }

  private async renderPng(
    z: number,
    x: number,
    y: number,
    scope: TileScope,
  ): Promise<Buffer> {
    // Không có file nào phủ ô -> khỏi đánh thức renderer
    if (!this.catalog.filesForTile(z, x, y, scope).length) return this.emptyPng;

    const pool = this.pool(scope);
    const idx = await this.acquire(pool);

    try {
      const raw = await new Promise<Buffer>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('render timeout')),
          RENDER_TIMEOUT_MS,
        );
        pool.maps[idx].render(
          {
            zoom: z,
            center: this.tileCenter(z, x, y),
            width: TILE_SIZE,
            height: TILE_SIZE,
          },
          (err: Error | null, pixels: Uint8Array) => {
            clearTimeout(timer);
            if (err) return reject(err);
            resolve(
              Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength),
            );
          },
        );
      });

      this.metrics.rendered++;

      return await sharp(raw, {
        raw: {
          width: TILE_SIZE * PIXEL_RATIO,
          height: TILE_SIZE * PIXEL_RATIO,
          channels: 4,
        },
      })
        .resize(TILE_SIZE, TILE_SIZE, { kernel: sharp.kernel.lanczos3 })
        .png({ compressionLevel: 6, adaptiveFiltering: false })
        .toBuffer();
    } finally {
      this.release(pool, idx);
    }
  }

  // ==================================================================
  // 3. Renderer pool — mỗi scope một pool riêng
  // ==================================================================

  /**
   * Vì sao tách pool theo scope: mbgl.Map có tile cache nội bộ khoá theo URL.
   * Dùng chung renderer cho nhiều account/năm thì tile của scope này sẽ hiện
   * ở scope khác — vừa sai dữ liệu vừa rò rỉ giữa các tenant. Mỗi renderer
   * gắn chặt với một scope trong suốt vòng đời nên cache của nó luôn đúng.
   *
   * Callback request đóng gói sẵn scope, nên không còn map rendererIndex ->
   * filename như bản cũ. Đây cũng là chỗ bản cũ xoá context trong `finally`
   * trước khi MapLibre kịp xin tile lân cận.
   */
  private scopeKey(scope: TileScope): string {
    return `${scope.accountId ?? 'pub'}:${scope.year ?? 'latest'}`;
  }

  private pool(scope: TileScope): ScopePool {
    const key = this.scopeKey(scope);
    const hit = this.pools.get(key);
    if (hit && !hit.stale) {
      hit.lastUsed = Date.now();
      return hit;
    }

    const maps: InstanceType<typeof mbgl.Map>[] = [];
    for (let i = 0; i < RENDERERS_PER_SCOPE; i++) {
      const map = new mbgl.Map({
        request: (req: RequestParameters, cb: RequestCallback) =>
          this.handleRequest(req, cb, scope),
        ratio: PIXEL_RATIO,
      });
      map.load(this.styleJson);
      maps.push(map);
    }

    const pool: ScopePool = {
      key,
      scope,
      maps,
      free: maps.map((_, i) => i),
      waiters: [],
      lastUsed: Date.now(),
      stale: false,
    };
    this.pools.set(key, pool);
    this.evictScopes();
    this.logger.log(`Tạo renderer pool cho scope "${key}"`);
    return pool;
  }

  private acquire(pool: ScopePool): Promise<number> {
    const i = pool.free.pop();
    if (i !== undefined) return Promise.resolve(i);

    return new Promise<number>((resolve, reject) => {
      const w = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const k = pool.waiters.indexOf(w);
          if (k !== -1) pool.waiters.splice(k, 1);
          reject(new Error('hết renderer (quá tải)'));
        }, ACQUIRE_TIMEOUT_MS),
      };
      pool.waiters.push(w);
    });
  }

  private release(pool: ScopePool, idx: number) {
    if (pool.stale) {
      try {
        pool.maps[idx].release();
      } catch {
        /* noop */
      }
      return;
    }
    const w = pool.waiters.shift();
    if (w) {
      clearTimeout(w.timer);
      w.resolve(idx);
    } else {
      pool.free.push(idx);
    }
  }

  private disposePool(pool: ScopePool) {
    pool.stale = true;
    for (const w of pool.waiters) {
      clearTimeout(w.timer);
      w.reject(new Error('pool bị huỷ'));
    }
    pool.waiters = [];
    for (const i of pool.free) {
      try {
        pool.maps[i].release();
      } catch {
        /* noop */
      }
    }
    pool.free = [];
  }

  private evictScopes() {
    if (this.pools.size <= MAX_SCOPES) return;
    const sorted = [...this.pools.values()].sort(
      (a, b) => a.lastUsed - b.lastUsed,
    );
    while (this.pools.size > MAX_SCOPES && sorted.length) {
      const p = sorted.shift()!;
      this.pools.delete(p.key);
      this.disposePool(p);
    }
  }

  /** Catalog đổi -> tile cũ trong cache của mbgl không còn đúng, phải dựng lại. */
  private checkVersion() {
    if (this.catalog.version === this.versionSeen) return;

    this.logger.log(
      `Catalog đổi ${this.versionSeen} -> ${this.catalog.version}, xoá cache`,
    );
    this.versionSeen = this.catalog.version;

    for (const p of this.pools.values()) this.disposePool(p);
    this.pools.clear();
    this.reader.flush();
    this.emptyCache.clear();
    // vtCache/pngCache khoá theo version nên tự hết hạn, không cần xoá tay
    void this.prepareDiskCache();
  }

  // ==================================================================
  // 4. Protocol handler của MapLibre
  // ==================================================================

  private loadStyle() {
    const p = path.resolve(process.cwd(), 'style.json');
    if (!fs.existsSync(p)) throw new Error(`Không tìm thấy style.json tại ${p}`);
    this.styleJson = JSON.parse(fs.readFileSync(p, 'utf8'));

    const srcs = this.styleJson.sources ?? {};
    const hasMbtiles = Object.values(srcs).some((s: any) =>
      (s.tiles ?? []).some((u: string) => u.startsWith('mbtiles://')),
    );
    if (!hasMbtiles) {
      this.logger.warn(
        'style.json không có source nào dùng mbtiles:// — kiểm tra lại cấu hình',
      );
    }
  }

  private handleRequest(
    req: RequestParameters,
    cb: RequestCallback,
    scope: TileScope,
  ) {
    const { url } = req;
    try {
      if (url.startsWith('mbtiles://')) {
        const m = url.match(
          /mbtiles:\/\/[^/]+\/(\d+)\/(\d+)\/(\d+)(?:\.(?:pbf|mvt))?(?:\?.*)?$/,
        );
        if (!m) return cb(null, { data: EMPTY });

        // Tra catalog cho ĐÚNG ô được hỏi, kể cả ô lân cận mà MapLibre
        // prefetch — nhờ vậy đường và nhãn không bị cắt ở mép tile.
        this.getVectorTile(+m[1], +m[2], +m[3], scope)
          .then((data) => cb(null, { data }))
          .catch(() => cb(null, { data: EMPTY }));
        return;
      }

      if (url.includes('/fonts/') || url.includes('glyphs')) {
        return this.serveFont(url, cb);
      }
      if (url.includes('/sprite')) {
        return this.serveSprite(url, cb);
      }
    } catch {
      return cb(null, { data: EMPTY });
    }
    cb(null, { data: EMPTY });
  }

  private serveFont(url: string, cb: RequestCallback) {
    const m = url.match(/fonts\/([^/]+)\/(\d+)-(\d+)\.pbf/);
    if (m) {
      const p = path.join(
        path.resolve(process.cwd(), 'fonts'),
        decodeURIComponent(m[1]),
        `${m[2]}-${m[3]}.pbf`,
      );
      if (fs.existsSync(p)) return cb(null, { data: fs.readFileSync(p) });
    }
    cb(null, { data: EMPTY });
  }

  private serveSprite(url: string, cb: RequestCallback) {
    const p = path.join(
      path.resolve(process.cwd(), 'sprites'),
      url.endsWith('.png') ? 'sprite.png' : 'sprite.json',
    );
    if (fs.existsSync(p)) return cb(null, { data: fs.readFileSync(p) });
    cb(null, { data: EMPTY });
  }

  // ==================================================================
  // 5. Cache đĩa
  // ==================================================================

  private async prepareDiskCache() {
    if (!DISK_CACHE_DIR) return;
    try {
      await fsp.mkdir(path.join(DISK_CACHE_DIR, this.catalog.version), {
        recursive: true,
      });
      // dọn thư mục của các version cũ
      const dirs = await fsp.readdir(DISK_CACHE_DIR);
      for (const d of dirs) {
        if (d === this.catalog.version) continue;
        fsp
          .rm(path.join(DISK_CACHE_DIR, d), { recursive: true, force: true })
          .catch(() => undefined);
      }
    } catch (err: any) {
      this.logger.warn(`Cache đĩa không dùng được: ${err.message}`);
    }
  }

  private diskPath(key: string): string {
    return path.join(DISK_CACHE_DIR, `${key}.pbf`);
  }

  private async diskGet(key: string): Promise<Buffer | null> {
    if (!DISK_CACHE_DIR) return null;
    try {
      return await fsp.readFile(this.diskPath(key));
    } catch {
      return null;
    }
  }

  private async diskSet(key: string, buf: Buffer) {
    if (!DISK_CACHE_DIR) return;
    const p = this.diskPath(key);
    try {
      await fsp.mkdir(path.dirname(p), { recursive: true });
      const tmp = `${p}.${process.pid}.tmp`;
      await fsp.writeFile(tmp, buf);
      await fsp.rename(tmp, p); // ghi nguyên tử, tránh đọc phải file dở
    } catch {
      /* cache hỏng không được làm chết request */
    }
  }

  // ==================================================================
  // 6. Metadata & chẩn đoán
  // ==================================================================

  tilejson(baseUrl: string, scope: TileScope = {}) {
    const st = this.catalog.stats();
    const layers = new Map<string, any>();
    let minzoom = 22;
    let maxzoom = 0;

    // gom vector_layers từ vài file đại diện, tránh mở toàn bộ
    for (const e of this.catalog.sample(50, scope)) {
      const meta = this.reader.meta(e.filename);
      if (!meta) continue;
      minzoom = Math.min(minzoom, meta.minzoom);
      maxzoom = Math.max(maxzoom, meta.maxzoom);
      for (const l of meta.vectorLayers) if (!layers.has(l.id)) layers.set(l.id, l);
    }

    const q = new URLSearchParams();
    if (scope.accountId != null) q.set('accountId', String(scope.accountId));
    if (scope.year != null) q.set('year', String(scope.year));
    const qs = q.toString() ? `?${q}` : '';

    return {
      tilejson: '3.0.0',
      name: 'Tileset ranh giới',
      scheme: 'xyz',
      tiles: [`${baseUrl}/tiles/{z}/{x}/{y}.pbf${qs}`],
      minzoom: minzoom === 22 ? 0 : minzoom,
      maxzoom: maxzoom || 14, // client tự overzoom quá mức này
      bounds: this.catalog.boundsFor(scope) ?? [102, 8, 110, 24],
      vector_layers: [...layers.values()],
      version: this.catalog.version,
      files: st.files,
    };
  }

  /** Ô này lấy dữ liệu từ những file nào — dùng để soi chỗ mất nền. */
  debugTile(z: number, x: number, y: number, scope: TileScope = {}) {
    const entries = this.catalog.filesForTile(z, x, y, scope);
    return {
      tile: { z, x, y },
      bounds: tileBounds(z, x, y),
      version: this.catalog.version,
      count: entries.length,
      files: entries.map((e) => {
        const read = this.reader.read(e.filename, z, x, y, e.minzoom, e.maxzoom);
        return {
          id: e.id,
          filename: e.filename,
          year: e.year,
          area: e.subAddress ?? null,
          bbox: [e.minLng, e.minLat, e.maxLng, e.maxLat],
          hasData: !!read,
          overzoomFrom: read && read.srcZ !== z ? read.srcZ : null,
          bytes: read?.data.length ?? 0,
        };
      }),
    };
  }

  health() {
    return this.reader.health(
      this.catalog.sample(Number.MAX_SAFE_INTEGER).map((e) => e.filename),
    );
  }

  emptyPNG(): Buffer {
    return this.emptyPng;
  }

  stats() {
    return {
      version: this.catalog.version,
      catalog: this.catalog.stats(),
      reader: this.reader.stats(),
      metrics: this.metrics,
      cache: {
        vector: { items: this.vtCache.size, bytes: this.vtCache.calculatedSize },
        png: { items: this.pngCache.size, bytes: this.pngCache.calculatedSize },
        empty: this.emptyCache.size,
        disk: DISK_CACHE_DIR || null,
      },
      renderers: [...this.pools.values()].map((p) => ({
        scope: p.key,
        total: p.maps.length,
        free: p.free.length,
        waiting: p.waiters.length,
      })),
      inflight: this.inflight.size,
    };
  }

  // ==================================================================
  // Helpers
  // ==================================================================

  private validXYZ(z: number, x: number, y: number): boolean {
    if (!Number.isInteger(z) || z < 0 || z > 24) return false;
    const n = 2 ** z;
    return (
      Number.isInteger(x) &&
      Number.isInteger(y) &&
      x >= 0 &&
      y >= 0 &&
      x < n &&
      y < n
    );
  }

  private tileCenter(z: number, x: number, y: number): [number, number] {
    const n = Math.PI - (2 * Math.PI * (y + 0.5)) / 2 ** z;
    return [
      ((x + 0.5) / 2 ** z) * 360 - 180,
      (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))),
    ];
  }

  private buildEmptyPng(): Promise<Buffer> {
    return sharp({
      create: {
        width: TILE_SIZE,
        height: TILE_SIZE,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
  }
}