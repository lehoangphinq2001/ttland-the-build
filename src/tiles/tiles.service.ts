import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import Database = require('better-sqlite3');
import mbgl = require('@maplibre/maplibre-gl-native');
import sharp = require('sharp');
import * as zlib from 'zlib';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';
import type Redis from 'ioredis';
import { LocationNewService } from 'src/location-new/location-new.service';
import { FileLayerLineService } from 'src/file-layer-line/file-layer-line.service';

// Token used by your project's Redis provider.
// Common values:
//   @nestjs-modules/ioredis  → 'default_IORedisModuleConnectionToken'
//   @liaoliaots/nestjs-redis → getRedisToken('default') from that package
// Export this constant so TilesModule can use it in `provide:` if needed.
export const REDIS_CLIENT = 'REDIS_CLIENT';

// ─── Import your existing services (adjust paths) ────────────────────────────

const gunzip = promisify(zlib.gunzip);

type RequestCallback = (
  err?: Error | null,
  response?: { data: Buffer },
) => void;
type RequestParameters = { url: string; kind: number };

// ─── Tile render config ───────────────────────────────────────────────────────
const MBTILES_DIR = path.resolve('../DATA_BUILD/');
const TILE_SIZE = 512;
const PIXEL_RATIO = 2;

export interface TileMetadata {
  name: string;
  description: string;
  format: string;
  minzoom: number;
  maxzoom: number;
  center: [number, number, number] | null;
  bounds: [number, number, number, number] | null;
  vectorLayers: any[];
}

// ─── DB pool entry ────────────────────────────────────────────────────────────
interface DbEntry {
  db: Database.Database;
  stmt: Database.Statement;
  metadata: TileMetadata | null;
  lastUsed: number;
}

@Injectable()
export class TilesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TilesService.name);

  // ─── DB pool: one entry per mbtiles filename ──────────────────────────────
  private dbPool = new Map<string, DbEntry>();

  // ─── Renderer pool: shared across all mbtiles files ──────────────────────
  private rendererPool: InstanceType<typeof mbgl.Map>[] = [];
  private rendererAvailable: boolean[] = [];
  private readonly POOL_SIZE = Math.max(2, require('os').cpus().length);

  private styleJson: object;
  private dbCleanupInterval: NodeJS.Timeout;

  // Per-renderer active filename context.
  // Keyed by renderer pool index so concurrent renders don't overwrite each other.
  private rendererFilename = new Map<number, string>();

  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    @Inject('REDIS') private readonly redis: Redis,
    private readonly locationNewService: LocationNewService,
    private readonly fileLayerLineService: FileLayerLineService,
  ) {}

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  async onModuleInit() {
    this.loadStyle();
    await this.initRendererPool();

    // Clean up idle DB connections every 10 minutes
    this.dbCleanupInterval = setInterval(
      () => this.cleanDbPool(),
      10 * 60 * 1000,
    );

    // this.logger.log(`✅ TilesService ready — dynamic mbtiles mode`);
    // this.logger.log(`🖥️  Renderer pool: ${this.POOL_SIZE} parallel renderers`);
  }

  async onModuleDestroy() {
    clearInterval(this.dbCleanupInterval);

    this.rendererPool.forEach((r) => {
      try {
        r.release();
      } catch (_) {}
    });

    for (const { db } of this.dbPool.values()) {
      try {
        db.close();
      } catch (_) {}
    }
    this.dbPool.clear();

    // this.logger.log('🔒 TilesService destroyed');
  }

  // ─── Style ───────────────────────────────────────────────────────────────────

  private loadStyle() {
    const stylePath = path.resolve(process.cwd(), 'style.json');
    if (!fs.existsSync(stylePath)) {
      throw new Error(`style.json not found at: ${stylePath}`);
    }
    this.styleJson = JSON.parse(fs.readFileSync(stylePath, 'utf8'));
    // this.logger.log('🎨 style.json loaded');
  }

  // ─── Renderer pool ────────────────────────────────────────────────────────────

  private initRendererPool(): Promise<void> {
    // this.logger.log(`🔧 Initializing ${this.POOL_SIZE} MapLibre renderers...`);

    const initOne = (index: number): Promise<InstanceType<typeof mbgl.Map>> =>
      new Promise((resolve, reject) => {
        const renderer = new mbgl.Map({
          // Capture `index` in closure so each renderer's request handler
          // knows which slot to look up in rendererFilename.
          request: (req: RequestParameters, callback: RequestCallback) =>
            this.handleRequest(req, callback, index),
          ratio: PIXEL_RATIO,
        });
        try {
          renderer.load(this.styleJson);
          resolve(renderer);
        } catch (err) {
          reject(err);
        }
      });

    return Promise.all(
      Array.from({ length: this.POOL_SIZE }, (_, i) => initOne(i)),
    ).then((renderers) => {
      this.rendererPool = renderers;
      this.rendererAvailable = renderers.map(() => true);
      // this.logger.log(`✅ ${this.POOL_SIZE} renderers ready`);
    });
  }

  private acquireRenderer(): Promise<{
    renderer: InstanceType<typeof mbgl.Map>;
    index: number;
  }> {
    return new Promise((resolve) => {
      const tryAcquire = () => {
        const idx = this.rendererAvailable.indexOf(true);
        if (idx !== -1) {
          this.rendererAvailable[idx] = false;
          resolve({ renderer: this.rendererPool[idx], index: idx });
        } else {
          setTimeout(tryAcquire, 5);
        }
      };
      tryAcquire();
    });
  }

  private releaseRenderer(index: number) {
    this.rendererAvailable[index] = true;
  }

  // ─── DB pool ──────────────────────────────────────────────────────────────────

  private getDb(fullname: string): DbEntry {
    const existing = this.dbPool.get(fullname);
    if (existing) {
      existing.lastUsed = Date.now();
      return existing;
    }

    const mbtilesPath = path.resolve(MBTILES_DIR, fullname);
    if (!fs.existsSync(mbtilesPath)) {
      throw new Error(`MBTiles file not found: ${mbtilesPath}`);
    }

    const mb = (fs.statSync(mbtilesPath).size / 1024 / 1024).toFixed(1);
    // this.logger.log(`📦 Opening MBTiles: ${fullname} (${mb} MB)`);

    const db = new Database(mbtilesPath, { fileMustExist: true });
    db.pragma('journal_mode = WAL');
    db.pragma('cache_size = -32000'); // 32 MB
    db.pragma('mmap_size = 134217728'); // 128 MB

    const stmt = db.prepare(
      'SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?',
    );

    const metadata = this.readMetadataFromDb(db);

    const entry: DbEntry = { db, stmt, metadata, lastUsed: Date.now() };
    this.dbPool.set(fullname, entry);
    return entry;
  }

  private cleanDbPool() {
    const threshold = Date.now() - 10 * 60 * 1000;
    for (const [key, { db, lastUsed }] of this.dbPool.entries()) {
      if (lastUsed < threshold) {
        try {
          db.close();
        } catch (_) {}
        this.dbPool.delete(key);
        // this.logger.log(`🗑️  Closed idle DB: ${key}`);
      }
    }
  }

  // ─── Metadata ─────────────────────────────────────────────────────────────────

  private readMetadataFromDb(db: Database.Database): TileMetadata {
    const rows = db.prepare('SELECT name, value FROM metadata').all() as {
      name: string;
      value: string;
    }[];

    const meta: Record<string, string> = {};
    rows.forEach((r) => (meta[r.name] = r.value));

    let center: [number, number, number] | null = null;
    if (meta.center) {
      const p = meta.center.split(',').map(Number);
      if (p.length === 3) center = [p[0], p[1], p[2]];
    }

    let bounds: [number, number, number, number] | null = null;
    if (meta.bounds) {
      const p = meta.bounds.split(',').map(Number);
      if (p.length === 4) bounds = [p[0], p[1], p[2], p[3]];
    }

    let vectorLayers: any[] = [];
    try {
      if (meta.json) vectorLayers = JSON.parse(meta.json).vector_layers ?? [];
    } catch (_) {}

    return {
      name: meta.name || 'MBTiles Map',
      description: meta.description || '',
      format: meta.format || 'pbf',
      minzoom: parseInt(meta.minzoom || '0', 10),
      maxzoom: parseInt(meta.maxzoom || '14', 10),
      center,
      bounds,
      vectorLayers,
    };
  }

  // ─── Filename resolution (from file 2 flow) ───────────────────────────────────

  /**
   * Resolve which .mbtiles file covers the tile at (z, x, y).
   * Uses Redis cache to avoid repeated DB/API lookups.
   */
  async resolveFilename(
    z: number,
    x: number,
    y: number,
  ): Promise<string | null> {
    const zi = +z,
      xi = +x,
      yi = +y;

    // Convert tile XYZ → lat/lng (top-left corner of tile)
    const n = Math.pow(2, zi);
    const lon = (xi / n) * 360.0 - 180.0;
    const lat_rad = Math.atan(Math.sinh(Math.PI * (1 - (2 * yi) / n)));
    const lat = (lat_rad * 180.0) / Math.PI;

    const latKey = lat.toFixed(2);
    const lonKey = lon.toFixed(2);
    const redisKey = `mbtiles:filename:${latKey}:${lonKey}`;

    // 1. Redis cache hit
    const cached = await this.redis.get(redisKey);
    if (cached !== null) {
      return cached === 'NULL' ? null : cached;
    }

    // 2. Lookup location → filename
    const result = await this.checkDataInLocation(lat, lon);
    const filename = result?.success ? result?.data?.filename ?? null : null;

    // 3. Cache result (1 hour TTL; cache nulls too to avoid re-lookup)
    await this.redis.set(redisKey, filename ?? 'NULL', 'EX', 3600);

    return filename;
  }

  private async checkDataInLocation(lat: number, lng: number) {
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
      // this.logger.warn(`checkDataInLocation error: ${error.message}`);
      return { success: false, data: null };
    }
  }

  // ─── MapLibre resource handler ────────────────────────────────────────────────

  private handleRequest(
    req: RequestParameters,
    callback: RequestCallback,
    rendererIndex: number,
  ) {
    const { url } = req;

    if (url.startsWith('mbtiles://')) {
      this.handleMBTilesRequest(url, callback, rendererIndex);
    } else if (url.includes('/fonts/') || url.includes('glyphs')) {
      this.handleFontRequest(url, callback);
    } else if (url.includes('/sprite')) {
      this.handleSpriteRequest(url, callback);
    } else {
      callback(null, { data: Buffer.alloc(0) });
    }
  }

  /**
   * style.json hardcodes "map" as the mbtiles source name → URL is always
   * mbtiles://map/{z}/{x}/{y}.pbf regardless of the actual file.
   * We IGNORE the hostname and use rendererFilename[rendererIndex] instead,
   * which was set by getRasterTile() just before renderer.render() was called.
   */
  private handleMBTilesRequest(
    url: string,
    callback: RequestCallback,
    rendererIndex: number,
  ) {
    const match = url.match(
      /mbtiles:\/\/[^/]+\/(\d+)\/(\d+)\/(\d+)(?:\.pbf)?(?:\?.*)?$/,
    );
    if (!match) {
      return callback(new Error(`Invalid mbtiles URL: ${url}`));
    }

    const z = parseInt(match[1], 10);
    const x = parseInt(match[2], 10);
    const y = parseInt(match[3], 10);
    const tmsY = (1 << z) - 1 - y;

    // Precise per-renderer lookup — safe for concurrent renders
    const filename = this.rendererFilename.get(rendererIndex);
    if (!filename) {
      // this.logger.warn(
      //   `No filename context for renderer #${rendererIndex}, url=${url}`,
      // );
      return callback(null, { data: Buffer.alloc(0) });
    }

    let entry: DbEntry;
    try {
      entry = this.getDb(filename);
    } catch (err) {
      // this.logger.warn(
      //   `DB not found for filename "${filename}": ${err.message}`,
      // );
      return callback(null, { data: Buffer.alloc(0) });
    }

    const row = entry.stmt.get(z, x, tmsY) as { tile_data: Buffer } | undefined;
    if (!row) {
      return callback(null, { data: Buffer.alloc(0) });
    }

    const buf: Buffer = row.tile_data;
    const isGzipped = buf[0] === 0x1f && buf[1] === 0x8b;

    if (isGzipped) {
      gunzip(buf)
        .then((decompressed) =>
          callback(null, { data: Buffer.from(decompressed) }),
        )
        .catch((err) => callback(err));
    } else {
      callback(null, { data: buf });
    }
  }

  private handleFontRequest(url: string, callback: RequestCallback) {
    const fontsDir = path.resolve(process.cwd(), 'fonts');
    const match = url.match(/fonts\/([^/]+)\/(\d+)-(\d+)\.pbf/);
    if (match) {
      const fontName = decodeURIComponent(match[1]);
      const fontPath = path.join(
        fontsDir,
        fontName,
        `${match[2]}-${match[3]}.pbf`,
      );
      if (fs.existsSync(fontPath)) {
        return callback(null, { data: fs.readFileSync(fontPath) });
      }
    }
    callback(null, { data: Buffer.alloc(0) });
  }

  private handleSpriteRequest(url: string, callback: RequestCallback) {
    const spritesDir = path.resolve(process.cwd(), 'sprites');
    const fileName = url.endsWith('.png') ? 'sprite.png' : 'sprite.json';
    const spritePath = path.join(spritesDir, fileName);
    if (fs.existsSync(spritePath)) {
      return callback(null, { data: fs.readFileSync(spritePath) });
    }
    callback(null, { data: Buffer.alloc(0) });
  }

  // ─── Public: render raster PNG tile ──────────────────────────────────────────

  async getRasterTile(z: number, x: number, y: number): Promise<Buffer> {
    // 1. LRU cache check
    const cacheKey = `t:${z}:${x}:${y}`;
    const cached = await this.cache.get<Buffer>(cacheKey);
    if (cached) return cached;

    // 2. Resolve which mbtiles file serves this tile
    const filename = await this.resolveFilename(z, x, y);
    if (!filename) {
      // this.logger.debug(`No mbtiles file found for tile z${z}/${x}/${y}`);
      return this.emptyPNG();
    }

    // 3. Pre-warm DB into pool (sync, no async I/O during render)
    let entry: DbEntry;
    try {
      entry = this.getDb(filename);
    } catch (err) {
      // this.logger.warn(`Cannot open mbtiles "${filename}": ${err.message}`);
      return this.emptyPNG();
    }

    // 4. Zoom range guard (per-file metadata)
    if (entry.metadata) {
      const { minzoom, maxzoom } = entry.metadata;
      if (z < minzoom || z > maxzoom) return this.emptyPNG();
    }

    // 5. Acquire renderer from pool
    const { renderer, index } = await this.acquireRenderer();

    // Set filename context so handleMBTilesRequest knows which file to use
    this.rendererFilename.set(index, filename);

    try {
      // 6. Render vector → raw RGBA pixels at 2× resolution
      const rawPixels = await this.renderTile(renderer, z, x, y);

      // 7. Encode RGBA → PNG (downsample 2x → 1x)
      const png = await sharp(rawPixels, {
        raw: {
          width: TILE_SIZE * PIXEL_RATIO,
          height: TILE_SIZE * PIXEL_RATIO,
          channels: 4,
        },
      })
        .resize(TILE_SIZE, TILE_SIZE, { kernel: sharp.kernel.lanczos3 })
        .png({ compressionLevel: 6, adaptiveFiltering: false })
        .toBuffer();

      // 8. Cache and return
      await this.cache.set(cacheKey, png);
      return png;
    } finally {
      this.rendererFilename.delete(index);
      this.releaseRenderer(index);
    }
  }

  private renderTile(
    renderer: InstanceType<typeof mbgl.Map>,
    z: number,
    x: number,
    y: number,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      renderer.render(
        {
          zoom: z,
          center: this.tileCenter(x, y, z),
          width: TILE_SIZE,
          height: TILE_SIZE,
        },
        (err: Error | null, pixels: Uint8Array) => {
          if (err) return reject(err);
          resolve(
            Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength),
          );
        },
      );
    });
  }

  // ─── Utilities ────────────────────────────────────────────────────────────────

  private tileCenter(x: number, y: number, z: number): [number, number] {
    const n = Math.PI - (2 * Math.PI * (y + 0.5)) / Math.pow(2, z);
    const lng = ((x + 0.5) / Math.pow(2, z)) * 360 - 180;
    const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    return [lng, lat];
  }

  private emptyPNG(): Promise<Buffer> {
    return sharp({
      create: {
        width: TILE_SIZE,
        height: TILE_SIZE,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
  }

  // ─── Public accessors ─────────────────────────────────────────────────────────

  /**
   * Returns metadata for a specific mbtiles file (by filename).
   * Pass null to get the first loaded file's metadata (legacy compat).
   */
  getMetadata(filename?: string): TileMetadata | null {
    if (filename) {
      return this.dbPool.get(filename)?.metadata ?? null;
    }
    // Fallback: return first entry
    return this.dbPool.values().next().value?.metadata ?? null;
  }

  getTileJSON(baseUrl: string, filename?: string): object {
    const m = this.getMetadata(filename);
    if (!m) return {};
    return {
      tilejson: '3.0.0',
      name: m.name,
      description: m.description,
      version: '1.0.0',
      scheme: 'xyz',
      tiles: [`${baseUrl}/tiles/{z}/{x}/{y}.png`],
      minzoom: m.minzoom,
      maxzoom: m.maxzoom,
      bounds: m.bounds ?? [-180, -85.051129, 180, 85.051129],
      center: m.center ?? [0, 0, 2],
      format: 'png',
      type: 'raster',
    };
  }

  // ================================================
  async clearAllCache(): Promise<{ tile: number; filename: number }> {
    const [tileKeys, filenameKeys] = await Promise.all([
      this.redis.keys('t:*'),
      this.redis.keys('mbtiles:filename:*'),
    ]);

    await Promise.all([
      tileKeys.length ? this.redis.del(...tileKeys) : Promise.resolve(),
      filenameKeys.length ? this.redis.del(...filenameKeys) : Promise.resolve(),
    ]);

    this.logger.log(
      `🗑️ Cache cleared: ${tileKeys.length} tiles, ${filenameKeys.length} filenames`,
    );
    return { tile: tileKeys.length, filename: filenameKeys.length };
  }
}
