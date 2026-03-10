// import {
//   Injectable,
//   Logger,
//   OnModuleInit,
//   OnModuleDestroy,
// } from '@nestjs/common';
// import { Inject } from '@nestjs/common';
// import { CACHE_MANAGER } from '@nestjs/cache-manager';
// import { Cache } from 'cache-manager';
// import Database = require('better-sqlite3');
// // maplibre-gl-native exports the Map class via require() — NOT a default ESM export
// import mbgl = require('@maplibre/maplibre-gl-native');
// import sharp = require('sharp');
// import * as zlib from 'zlib';
// import * as path from 'path';
// import * as fs from 'fs';
// import { promisify } from 'util';

// const gunzip = promisify(zlib.gunzip);

// // ─── maplibre-gl-native callback types (not publicly exported in all versions) ─
// // Source: https://github.com/maplibre/maplibre-gl-native/blob/main/platform/node/index.d.ts
// type RequestCallback = (
//   err?: Error | null,
//   response?: { data: Buffer },
// ) => void;

// type RequestParameters = {
//   url: string;
//   kind: number;
// };

// // ─── Fixed MBTiles file path ─────────────────────────────────────────────────
// const MBTILES_PATH = path.resolve('../DATA_BUILD/', '2025_1773104884392.mbtiles');

// // ─── Tile render size ─────────────────────────────────────────────────────────
// const TILE_SIZE = 512;
// const PIXEL_RATIO = 2; // Render at 2x → resize to 1x for sharpness

// export interface TileMetadata {
//   name: string;
//   description: string;
//   format: string;
//   minzoom: number;
//   maxzoom: number;
//   center: [number, number, number] | null;
//   bounds: [number, number, number, number] | null;
//   vectorLayers: any[];
// }

// @Injectable()
// export class TilesService implements OnModuleInit, OnModuleDestroy {
//   private readonly logger = new Logger(TilesService.name);

//   private db: Database.Database;

//   // Renderer pool — one maplibre.Map per CPU core for parallel rendering
//   private rendererPool: InstanceType<typeof mbgl.Map>[] = [];
//   private rendererAvailable: boolean[] = [];
//   private readonly POOL_SIZE = Math.max(2, require('os').cpus().length);

//   private stmtGetTile: Database.Statement;
//   private stmtGetAllMetadata: Database.Statement;

//   private metadata: TileMetadata | null = null;
//   private styleJson: object;

//   constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}

//   // ─── Lifecycle ──────────────────────────────────────────────────────────────

//   async onModuleInit() {
//     this.validateMBTilesFile();
//     this.openDatabase();
//     this.prepareStatements();
//     await this.loadMetadata();
//     this.loadStyle();
//     await this.initRendererPool();
//     this.logger.log(`✅ MBTiles server ready — ${MBTILES_PATH}`);
//     this.logger.log(`🖥️  Renderer pool: ${this.POOL_SIZE} parallel renderers`);
//   }

//   async onModuleDestroy() {
//     this.rendererPool.forEach((r) => {
//       try {
//         r.release();
//       } catch (_) {}
//     });
//     if (this.db?.open) {
//       this.db.close();
//     }
//     this.logger.log('🔒 MBTiles database closed');
//   }

//   // ─── Init helpers ───────────────────────────────────────────────────────────

//   private validateMBTilesFile() {
//     if (!fs.existsSync(MBTILES_PATH)) {
//       throw new Error(
//         `MBTiles file not found: ${MBTILES_PATH}\n` +
//           `→ Place your file at: data/map.mbtiles`,
//       );
//     }
//     const mb = (fs.statSync(MBTILES_PATH).size / 1024 / 1024).toFixed(1);
//     this.logger.log(`📦 MBTiles: ${mb} MB`);
//   }

//   private openDatabase() {
//     this.db = new Database(MBTILES_PATH, {
//       readonly: true,
//       fileMustExist: true,
//     });
//     // Chỉ dùng pragma READ-ONLY safe (không cần ghi vào file)
//     // journal_mode và synchronous KHÔNG dùng được với readonly — sẽ lỗi
//     this.db.pragma('cache_size = -65536');    // 64 MB SQLite page cache (read-only safe)
//     this.db.pragma('mmap_size = 536870912');  // 512 MB memory-mapped I/O (read-only safe)
//     this.db.pragma('temp_store = MEMORY');    // temp tables in RAM (read-only safe)
//     this.logger.log('📂 SQLite opened (WAL + 512MB mmap)');
//   }

//   private prepareStatements() {
//     // MBTiles uses TMS Y (bottom-origin) — we flip to XYZ in SQL
//     this.stmtGetTile = this.db.prepare(`
//       SELECT tile_data
//       FROM   tiles
//       WHERE  zoom_level = @z
//         AND  tile_column = @x
//         AND  tile_row    = @y
//     `);

//     this.stmtGetAllMetadata = this.db.prepare(
//       `SELECT name, value FROM metadata`,
//     );
//   }

//   private async loadMetadata() {
//     const rows = this.stmtGetAllMetadata.all() as {
//       name: string;
//       value: string;
//     }[];
//     const meta: Record<string, string> = {};
//     rows.forEach((r) => (meta[r.name] = r.value));

//     let center: [number, number, number] | null = null;
//     if (meta.center) {
//       const p = meta.center.split(',').map(Number);
//       if (p.length === 3) center = [p[0], p[1], p[2]];
//     }

//     let bounds: [number, number, number, number] | null = null;
//     if (meta.bounds) {
//       const p = meta.bounds.split(',').map(Number);
//       if (p.length === 4) bounds = [p[0], p[1], p[2], p[3]];
//     }

//     let vectorLayers: any[] = [];
//     try {
//       if (meta.json) vectorLayers = JSON.parse(meta.json).vector_layers ?? [];
//     } catch (_) {}

//     this.metadata = {
//       name: meta.name || 'MBTiles Map',
//       description: meta.description || '',
//       format: meta.format || 'pbf',
//       minzoom: parseInt(meta.minzoom || '0', 10),
//       maxzoom: parseInt(meta.maxzoom || '14', 10),
//       center,
//       bounds,
//       vectorLayers,
//     };

//     this.logger.log(
//       `📋 "${this.metadata.name}" z${this.metadata.minzoom}-${this.metadata.maxzoom} [${this.metadata.format}]`,
//     );
//   }

//   private loadStyle() {
//     const stylePath = path.resolve(process.cwd(), 'style.json');
//     if (!fs.existsSync(stylePath)) {
//       throw new Error(`style.json not found at: ${stylePath}`);
//     }
//     this.styleJson = JSON.parse(fs.readFileSync(stylePath, 'utf8'));
//     this.logger.log('🎨 style.json loaded');
//   }

//   private initRendererPool(): Promise<void> {
//     this.logger.log(`🔧 Initializing ${this.POOL_SIZE} MapLibre renderers...`);

//     const initOne = (): Promise<InstanceType<typeof mbgl.Map>> =>
//       new Promise((resolve, reject) => {
//         const renderer = new mbgl.Map({
//           request: (req: RequestParameters, callback: RequestCallback) =>
//             this.handleRequest(req, callback),
//           ratio: PIXEL_RATIO,
//         });

//         // .load() in maplibre-gl-native accepts only the style object (1 arg).
//         // It is synchronous — throws on error, no callback.
//         try {
//           renderer.load(this.styleJson);
//           resolve(renderer);
//         } catch (err) {
//           reject(err);
//         }
//       });

//     return Promise.all(
//       Array.from({ length: this.POOL_SIZE }, () => initOne()),
//     ).then((renderers) => {
//       this.rendererPool = renderers;
//       this.rendererAvailable = renderers.map(() => true);
//       this.logger.log(`✅ ${this.POOL_SIZE} renderers ready`);
//     });
//   }

//   // ─── MapLibre resource handler ───────────────────────────────────────────────
//   // Called by MapLibre for every resource: tiles, fonts, sprites

//   private handleRequest(req: RequestParameters, callback: RequestCallback) {
//     const { url } = req;

//     if (url.startsWith('mbtiles://')) {
//       this.handleMBTilesRequest(url, callback);
//     } else if (url.includes('/fonts/') || url.includes('glyphs')) {
//       this.handleFontRequest(url, callback);
//     } else if (url.includes('/sprite')) {
//       this.handleSpriteRequest(url, callback);
//     } else {
//       // Return empty for anything else (e.g. remote sources not expected here)
//       callback(null, { data: Buffer.alloc(0) });
//     }
//   }

//   private handleMBTilesRequest(url: string, callback: RequestCallback) {
//     // URL format: mbtiles://map/{z}/{x}/{y}  hoặc  mbtiles://map/{z}/{x}/{y}.pbf
//     // Regex bắt 3 số cuối cùng trong URL, bỏ qua phần host/path phía trước
//     const match = url.match(/mbtiles:\/\/[^/]+\/(\d+)\/(\d+)\/(\d+)(?:\.pbf)?(?:\?.*)?$/);
//     if (!match) {
//       return callback(new Error(`Invalid mbtiles URL: ${url}`));
//     }

//     const z = parseInt(match[1], 10);
//     const x = parseInt(match[2], 10);
//     const y = parseInt(match[3], 10);
//     const tmsY = (1 << z) - 1 - y; // XYZ → TMS Y flip

//     const row = this.stmtGetTile.get({ z, x, y: tmsY }) as
//       | { tile_data: Buffer }
//       | undefined;

//     if (!row) {
//       return callback(null, { data: Buffer.alloc(0) });
//     }

//     const buf: Buffer = row.tile_data;
//     const isGzipped = buf[0] === 0x1f && buf[1] === 0x8b;

//     if (isGzipped) {
//       gunzip(buf)
//         .then((decompressed) =>
//           // gunzip returns Buffer in Node 20 (subclass of Uint8Array)
//           callback(null, { data: Buffer.from(decompressed) }),
//         )
//         .catch((err) => callback(err));
//     } else {
//       callback(null, { data: buf });
//     }
//   }

//   private handleFontRequest(url: string, callback: RequestCallback) {
//     const fontsDir = path.resolve(process.cwd(), 'fonts');
//     const match = url.match(/fonts\/([^/]+)\/(\d+)-(\d+)\.pbf/);

//     if (match) {
//       const fontName = decodeURIComponent(match[1]);
//       const fontPath = path.join(fontsDir, fontName, `${match[2]}-${match[3]}.pbf`);
//       if (fs.existsSync(fontPath)) {
//         return callback(null, { data: fs.readFileSync(fontPath) });
//       }
//     }
//     // No font available — labels won't render but tiles will
//     callback(null, { data: Buffer.alloc(0) });
//   }

//   private handleSpriteRequest(url: string, callback: RequestCallback) {
//     const spritesDir = path.resolve(process.cwd(), 'sprites');
//     const fileName = url.endsWith('.png') ? 'sprite.png' : 'sprite.json';
//     const spritePath = path.join(spritesDir, fileName);

//     if (fs.existsSync(spritePath)) {
//       return callback(null, { data: fs.readFileSync(spritePath) });
//     }
//     callback(null, { data: Buffer.alloc(0) });
//   }

//   // ─── Renderer pool management ────────────────────────────────────────────────

//   private acquireRenderer(): Promise<{
//     renderer: InstanceType<typeof mbgl.Map>;
//     index: number;
//   }> {
//     return new Promise((resolve) => {
//       const tryAcquire = () => {
//         const idx = this.rendererAvailable.indexOf(true);
//         if (idx !== -1) {
//           this.rendererAvailable[idx] = false;
//           resolve({ renderer: this.rendererPool[idx], index: idx });
//         } else {
//           setTimeout(tryAcquire, 5);
//         }
//       };
//       tryAcquire();
//     });
//   }

//   private releaseRenderer(index: number) {
//     this.rendererAvailable[index] = true;
//   }

//   // ─── Public: get raster PNG tile ─────────────────────────────────────────────

//   async getRasterTile(z: number, x: number, y: number): Promise<Buffer> {
//     // 1. LRU cache check (~1ms hit)
//     const cacheKey = `t:${z}:${x}:${y}`;
//     const cached = await this.cache.get<Buffer>(cacheKey);
//     if (cached) return cached;

//     // 2. Zoom range guard
//     if (
//       this.metadata &&
//       (z < this.metadata.minzoom || z > this.metadata.maxzoom)
//     ) {
//       return this.emptyPNG();
//     }

//     // 3. Grab a renderer from the pool
//     const { renderer, index } = await this.acquireRenderer();

//     try {
//       // 4. Render vector → raw RGBA pixels at 2× resolution
//       const rawPixels = await this.renderTile(renderer, z, x, y);

//       // 5. Encode RGBA → PNG via Sharp (libvips C++, very fast)
//       //    Downsample 1024→512 with lanczos3 for sharp edges & text
//       const png = await sharp(rawPixels, {
//         raw: {
//           width: TILE_SIZE * PIXEL_RATIO,
//           height: TILE_SIZE * PIXEL_RATIO,
//           channels: 4,
//         },
//       })
//         .resize(TILE_SIZE, TILE_SIZE, { kernel: sharp.kernel.lanczos3 })
//         .png({ compressionLevel: 6, adaptiveFiltering: false })
//         .toBuffer();

//       // 6. Cache and return
//       await this.cache.set(cacheKey, png);
//       return png;
//     } finally {
//       this.releaseRenderer(index);
//     }
//   }

//   private renderTile(
//     renderer: InstanceType<typeof mbgl.Map>,
//     z: number,
//     x: number,
//     y: number,
//   ): Promise<Buffer> {
//     return new Promise((resolve, reject) => {
//       renderer.render(
//         {
//           zoom: z,
//           center: this.tileCenter(x, y, z),
//           width: TILE_SIZE,
//           height: TILE_SIZE,
//         },
//         (err: Error | null, pixels: Uint8Array) => {
//           if (err) return reject(err);
//           // Convert Uint8Array → Buffer (same memory, no copy)
//           resolve(Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength));
//         },
//       );
//     });
//   }

//   // ─── Utilities ───────────────────────────────────────────────────────────────

//   private tileCenter(x: number, y: number, z: number): [number, number] {
//     const n = Math.PI - (2 * Math.PI * (y + 0.5)) / Math.pow(2, z);
//     const lng = ((x + 0.5) / Math.pow(2, z)) * 360 - 180;
//     const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
//     return [lng, lat];
//   }

//   private emptyPNG(): Promise<Buffer> {
//     return sharp({
//       create: {
//         width: TILE_SIZE,
//         height: TILE_SIZE,
//         channels: 4,
//         background: { r: 0, g: 0, b: 0, alpha: 0 },
//       },
//     })
//       .png()
//       .toBuffer();
//   }

//   // ─── Public accessors ────────────────────────────────────────────────────────

//   getMetadata(): TileMetadata | null {
//     return this.metadata;
//   }

//   getTileJSON(baseUrl: string): object {
//     const m = this.metadata;
//     if (!m) return {};
//     return {
//       tilejson: '3.0.0',
//       name: m.name,
//       description: m.description,
//       version: '1.0.0',
//       scheme: 'xyz',
//       tiles: [`${baseUrl}/tiles/{z}/{x}/{y}.png`],
//       minzoom: m.minzoom,
//       maxzoom: m.maxzoom,
//       bounds: m.bounds ?? [-180, -85.051129, 180, 85.051129],
//       center: m.center ?? [0, 0, 2],
//       format: 'png',
//       type: 'raster',
//     };
//   }
// }