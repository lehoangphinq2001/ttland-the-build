/* eslint-disable prettier/prettier */
/* eslint-disable no-var */
import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import Database = require('better-sqlite3');
import mbgl = require('@maplibre/maplibre-gl-native');
import sharp = require('sharp');
import * as zlib from 'zlib';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';
import { LocationNewService } from 'src/location-new/location-new.service';
import { FileLayerLineService } from 'src/file-layer-line/file-layer-line.service';
import * as LRUCache from 'lru-cache'; // npm i lru-cache

const gunzip = promisify(zlib.gunzip);

type RequestCallback = (
  err?: Error | null,
  response?: { data: Buffer },
) => void;
type RequestParameters = { url: string; kind: number };

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

interface DbEntry {
  db: Database.Database;
  stmt: Database.Statement;
  metadata: TileMetadata | null;
  lastUsed: number;
}

@Injectable()
export class TilesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TilesService.name);

  private dbPool = new Map<string, DbEntry>();

  private rendererPool: InstanceType<typeof mbgl.Map>[] = [];
  private rendererAvailable: boolean[] = [];
  private readonly POOL_SIZE = Math.max(2, require('os').cpus().length);

  private styleJson: object;
  private dbCleanupInterval: NodeJS.Timeout;

  private rendererFilename = new Map<number, string>();

  constructor(
    private readonly locationNewService: LocationNewService,
    private readonly fileLayerLineService: FileLayerLineService,
  ) {}

  async onModuleInit() {
    this.loadStyle();
    await this.initRendererPool();

    this.dbCleanupInterval = setInterval(
      () => this.cleanDbPool(),
      10 * 60 * 1000,
    );
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
  }

  private loadStyle() {
    const stylePath = path.resolve(process.cwd(), 'style.json');
    if (!fs.existsSync(stylePath)) {
      throw new Error(`style.json not found at: ${stylePath}`);
    }
    this.styleJson = JSON.parse(fs.readFileSync(stylePath, 'utf8'));
  }

  private initRendererPool(): Promise<void> {
    const initOne = (index: number): Promise<InstanceType<typeof mbgl.Map>> =>
      new Promise((resolve, reject) => {
        const renderer = new mbgl.Map({
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

    const db = new Database(mbtilesPath, { fileMustExist: true });
    db.pragma('journal_mode = WAL');
    db.pragma('cache_size = -32000');
    db.pragma('mmap_size = 134217728');

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
      }
    }
  }

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

  // Trong class TilesService, thêm cache
  private filenameCache = new LRUCache<string, string | null>({
    max: 2000,
    ttl: 1000 * 60 * 30, // 30 phút
  });

  // Thay thế resolveFilename cũ
  async resolveFilename(
    z: number,
    x: number,
    y: number,
  ): Promise<string | null> {
    const cacheKey = `${z}/${x}/${y}`;

    // Check cache trước
    if (this.filenameCache.has(cacheKey)) {
      return this.filenameCache.get(cacheKey) ?? null;
    }

    const n = Math.pow(2, z);

    // Sample 5 điểm: center + 4 góc lệch vào trong ~15%
    const sampleOffsets = [
      [0.5, 0.5], // center
      [0.15, 0.15], // top-left
      [0.85, 0.15], // top-right
      [0.15, 0.85], // bottom-left
      [0.85, 0.85], // bottom-right
    ];

    for (const [dx, dy] of sampleOffsets) {
      const lon = ((x + dx) / n) * 360.0 - 180.0;
      const lat_rad = Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + dy)) / n)));
      const lat = (lat_rad * 180.0) / Math.PI;

      const result = await this.checkDataInLocation(lat, lon);
      console.log("result", result.data);
      
      if (result?.success && result?.data?.filename) {
        const filename = result?.data?.filename;
        this.filenameCache.set(cacheKey, filename);
        return filename;
      }
    }

    // Không tìm thấy ở bất kỳ điểm nào
    this.filenameCache.set(cacheKey, null);
    return null;
  }

  private async checkDataInLocation(lat: number, lng: number) {
    try {
      const infoLocation: any =
        await this.locationNewService.getInfoLocationAll({ lat, lng });
      if (!infoLocation?.success) return { success: false, data: null };
      let result = await this.fileLayerLineService.getDataLayerInLocationNew(
        infoLocation.data.infoNew.provinceid,
        infoLocation.data.infoNew.wardid,
        lat,
        lng,
      );

      var dataTemp = [];
      if (result?.success == true) {
        dataTemp = result?.data;
        var filterTrue = await result?.data?.filter(
          (item: any) => item?.ingeom == true,
        );
        if (filterTrue.length > 0) {
          // tồn tại bằng true ==> trả thằng dữ liệu hiện có
          return { success: true, data: filterTrue[0] };
        } else {
          // Ngược lại ==> lọc tìm dữ liệu cũ tạm rồi check
          result = await this.fileLayerLineService.getDataLayerInLocationOld(
            infoLocation.data.infoOld.provinceid,
            infoLocation.data.infoOld.districtid,
            lat,
            lng,
          );
          if (result?.success == true) {
            var filterTrue = await result?.data?.filter(
              (item: any) => item?.ingeom == true,
            );
            if (filterTrue?.length > 0) { // tồn tại bằng true ==> trả thằng dữ liệu hiện có
              return { success: true, data: filterTrue[0] };
            } else if (dataTemp.length > 0) { // Kiểm tra lại data temp
              return { success: true, data: filterTrue[0] };
            } else {
              return { success: false, data: null };
            }
          } else {
            // Dữ liệu cũ không tồn tại
            if (dataTemp.length > 0) { // Kiểm tra lại data temp
              return { success: true, data: filterTrue[0] };
            } else {
              return { success: false, data: null };
            }
          }
        }
      }

      if (!result.success) {
        result = await this.fileLayerLineService.getDataLayerInLocationOld(
          infoLocation.data.infoOld.provinceid,
          infoLocation.data.infoOld.districtid,
          lat,
          lng,
        );
      }

      if (!result.success) return { success: false, data: null };
      return { success: true, data: result.data[0] };
    } catch (error) {
      return { success: false, data: null };
    }
  }

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

    const filename = this.rendererFilename.get(rendererIndex);
    if (!filename) {
      return callback(null, { data: Buffer.alloc(0) });
    }

    let entry: DbEntry;
    try {
      entry = this.getDb(filename);
    } catch (err) {
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

  async getRasterTile(z: number, x: number, y: number): Promise<Buffer> {
    // Resolve filename trực tiếp, không qua cache
    const filename = await this.resolveFilename(z, x, y);
    if (!filename) {
      return this.emptyPNG();
    }

    let entry: DbEntry;
    try {
      entry = this.getDb(filename);
    } catch (err) {
      return this.emptyPNG();
    }

    if (entry.metadata) {
      const { minzoom, maxzoom } = entry.metadata;
      if (z < minzoom || z > maxzoom) return this.emptyPNG();
    }

    const { renderer, index } = await this.acquireRenderer();
    this.rendererFilename.set(index, filename);

    try {
      const rawPixels = await this.renderTile(renderer, z, x, y);

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

  getMetadata(filename?: string): TileMetadata | null {
    if (filename) {
      return this.dbPool.get(filename)?.metadata ?? null;
    }
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
}
