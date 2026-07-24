/* eslint-disable prettier/prettier */
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createHash } from 'crypto';

export interface CatalogRow {
  id: number;
  filename: string;
  accountId: number | null;
  provinceId: number | null;
  districtId: number | null;
  provinceNewId: number | null;
  wardNewId: number | null;
  year: number;
  status: string;
  subAddress: string | null;
  updatedAt: Date;
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
  priority?: number | null;
  minzoom?: number | null;
  maxzoom?: number | null;
}

export interface CatalogEntry extends CatalogRow {
  area: number;
  isNew: boolean;
  groupKey: string;
}

export interface CatalogQuery {
  accountId?: number | null;
  year?: number | null;
}

export abstract class CatalogRepository {
  abstract load(since: Date | null): Promise<CatalogRow[]>;

  /**
   * Tuỳ chọn. Khai báo dạng property (không phải `abstract method`) vì
   * abstract member trong TS luôn bắt buộc implement — dấu `?` không giúp gì.
   * Lớp con nào có bảng audit thì định nghĩa thêm method cùng tên là đủ.
   */
  deletedIds?: (since: Date) => Promise<number[]>;
}

const INDEX_Z = Number(process.env.CATALOG_INDEX_Z ?? 10);

@Injectable()
export class FileCatalogService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FileCatalogService.name);

  private byId = new Map<number, CatalogEntry>();
  private grid = new Map<string, number[]>();

  private lastSync: Date | null = null;
  private timer: NodeJS.Timeout | null = null;

  version = '0';

  constructor(private readonly repo: CatalogRepository) {}

  async onModuleInit() {
    await this.reload(true);
    const ms = Number(process.env.CATALOG_REFRESH_MS ?? 60_000);
    this.timer = setInterval(() => {
      this.reload(false).catch((e) =>
        this.logger.warn(`Refresh catalog lỗi: ${e.message}`),
      );
    }, ms);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ------------------------------------------------------------------

  async reload(full: boolean) {
    const t0 = Date.now();
    // Giữ mốc gốc: vòng lặp bên dưới sẽ đẩy this.lastSync lên, nếu dùng lại
    // giá trị đó cho deletedIds thì sẽ bỏ sót đúng những dòng vừa bị xoá.
    const since = full ? null : this.lastSync;
    const rows = await this.repo.load(since);

    if (full) this.byId.clear();
    let changed = full;

    for (const r of rows) {
      if (r.status !== 'ACTIVE') {
        if (this.byId.delete(r.id)) changed = true;
      } else if (this.validBbox(r)) {
        this.byId.set(r.id, this.decorate(r));
        changed = true;
      } else {
        this.logger.warn(`Bỏ qua id=${r.id} (${r.filename}): bbox không hợp lệ`);
      }
      if (!this.lastSync || r.updatedAt > this.lastSync) this.lastSync = r.updatedAt;
    }

    if (!full && since && this.repo.deletedIds) {
      for (const id of await this.repo.deletedIds(since)) {
        if (this.byId.delete(id)) changed = true;
      }
    }

    if (!changed) return;

    this.buildIndex();
    this.bumpVersion();
    this.logger.log(
      `Catalog: ${this.byId.size} file / ${this.grid.size} ô lưới, ` +
        `${rows.length} dòng ${full ? 'nạp đầy' : 'cập nhật'} trong ${Date.now() - t0}ms, v=${this.version}`,
    );
  }

  private validBbox(r: CatalogRow): boolean {
    return (
      Number.isFinite(r.minLng) &&
      Number.isFinite(r.minLat) &&
      Number.isFinite(r.maxLng) &&
      Number.isFinite(r.maxLat) &&
      r.maxLng > r.minLng &&
      r.maxLat > r.minLat
    );
  }

  private decorate(r: CatalogRow): CatalogEntry {
    const isNew = r.provinceNewId != null || r.wardNewId != null;
    return {
      ...r,
      area: (r.maxLng - r.minLng) * (r.maxLat - r.minLat),
      isNew,
      groupKey: isNew
        ? `N:${r.provinceNewId ?? 0}:${r.wardNewId ?? 0}`
        : `O:${r.provinceId ?? 0}:${r.districtId ?? 0}`,
    };
  }

  private buildIndex() {
    this.grid.clear();
    for (const e of this.byId.values()) {
      const x0 = lonToTileX(e.minLng, INDEX_Z);
      const x1 = lonToTileX(e.maxLng, INDEX_Z);
      const y0 = latToTileY(e.maxLat, INDEX_Z);
      const y1 = latToTileY(e.minLat, INDEX_Z);
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const k = `${x}/${y}`;
          const arr = this.grid.get(k);
          if (arr) arr.push(e.id);
          else this.grid.set(k, [e.id]);
        }
      }
    }
  }

  private bumpVersion() {
    const h = createHash('md5');
    for (const e of [...this.byId.values()].sort((a, b) => a.id - b.id)) {
      h.update(`${e.id}:${+e.updatedAt};`);
    }
    this.version = h.digest('hex').slice(0, 12);
  }

  // ------------------------------------------------------------------

  private rough(
    minLng: number,
    minLat: number,
    maxLng: number,
    maxLat: number,
  ): CatalogEntry[] {
    const x0 = lonToTileX(minLng, INDEX_Z);
    const x1 = lonToTileX(maxLng, INDEX_Z);
    const y0 = latToTileY(maxLat, INDEX_Z);
    const y1 = latToTileY(minLat, INDEX_Z);

    const seen = new Set<number>();
    const out: CatalogEntry[] = [];
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        for (const id of this.grid.get(`${x}/${y}`) ?? []) {
          if (seen.has(id)) continue;
          seen.add(id);
          const e = this.byId.get(id);
          if (e) out.push(e);
        }
      }
    }
    return out;
  }

  filesForTile(z: number, x: number, y: number, q: CatalogQuery = {}) {
    const [w, s, e, n] = tileBounds(z, x, y);
    return this.filesForBbox(w, s, e, n, q);
  }

  filesForBbox(
    minLng: number,
    minLat: number,
    maxLng: number,
    maxLat: number,
    q: CatalogQuery = {},
  ): CatalogEntry[] {
    const list = this.rough(minLng, minLat, maxLng, maxLat).filter(
      (e) =>
        !(
          e.maxLng < minLng ||
          e.minLng > maxLng ||
          e.maxLat < minLat ||
          e.minLat > maxLat
        ) && this.allowed(e, q),
    );
    return this.dedupe(list);
  }

  filesForPoint(lat: number, lng: number, q: CatalogQuery = {}) {
    return this.filesForBbox(lng, lat, lng, lat, q);
  }

  private allowed(e: CatalogEntry, q: CatalogQuery): boolean {
    if (q.accountId != null && e.accountId != null && e.accountId !== q.accountId) {
      return false;
    }
    if (q.year != null && e.year > q.year) return false;
    return true;
  }

  private dedupe(list: CatalogEntry[]): CatalogEntry[] {
    const best = new Map<string, CatalogEntry>();
    for (const e of list) {
      const cur = best.get(e.groupKey);
      if (!cur || e.year > cur.year || (e.year === cur.year && e.id > cur.id)) {
        best.set(e.groupKey, e);
      }
    }
    return [...best.values()].sort((a, b) => {
      const pa = a.priority ?? 0;
      const pb = b.priority ?? 0;
      if (pa !== pb) return pa - pb;
      if (a.area !== b.area) return b.area - a.area; // bbox lớn vẽ trước
      return a.id - b.id;
    });
  }

  /** Lấy tối đa n bản ghi (đã lọc theo scope) — dùng cho tilejson / health. */
  sample(n: number, q: CatalogQuery = {}): CatalogEntry[] {
    const out: CatalogEntry[] = [];
    for (const e of this.byId.values()) {
      if (!this.allowed(e, q)) continue;
      out.push(e);
      if (out.length >= n) break;
    }
    return out;
  }

  boundsFor(q: CatalogQuery = {}): [number, number, number, number] | null {
    let b: [number, number, number, number] | null = null;
    for (const e of this.byId.values()) {
      if (!this.allowed(e, q)) continue;
      b = b
        ? [
            Math.min(b[0], e.minLng),
            Math.min(b[1], e.minLat),
            Math.max(b[2], e.maxLng),
            Math.max(b[3], e.maxLat),
          ]
        : [e.minLng, e.minLat, e.maxLng, e.maxLat];
    }
    return b;
  }

  cacheKey(z: number, x: number, y: number, q: CatalogQuery = {}): string {
    return `${this.version}/${q.accountId ?? 'pub'}/${q.year ?? 'latest'}/${z}/${x}/${y}`;
  }

  get(id: number) {
    return this.byId.get(id);
  }

  stats() {
    const years = new Map<number, number>();
    for (const e of this.byId.values()) {
      years.set(e.year, (years.get(e.year) ?? 0) + 1);
    }
    return {
      files: this.byId.size,
      gridCells: this.grid.size,
      indexZoom: INDEX_Z,
      version: this.version,
      lastSync: this.lastSync,
      byYear: Object.fromEntries([...years].sort((a, b) => a[0] - b[0])),
    };
  }
}

// ----------------------------------------------------------------------

export function lonToTileX(lon: number, z: number): number {
  const n = 2 ** z;
  return Math.max(0, Math.min(n - 1, Math.floor(((lon + 180) / 360) * n)));
}

export function latToTileY(lat: number, z: number): number {
  const n = 2 ** z;
  const c = Math.max(-85.0511, Math.min(85.0511, lat));
  const rad = (c * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n,
  );
  return Math.max(0, Math.min(n - 1, y));
}

export function tileBounds(
  z: number,
  x: number,
  y: number,
): [number, number, number, number] {
  const n = 2 ** z;
  const lon = (i: number) => (i / n) * 360 - 180;
  const lat = (j: number) =>
    (180 / Math.PI) * Math.atan(Math.sinh(Math.PI * (1 - (2 * j) / n)));
  return [lon(x), lat(y + 1), lon(x + 1), lat(y)];
}