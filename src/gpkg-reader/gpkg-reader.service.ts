// gpkg-reader.service.ts
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
// import * as gdal from 'gdal-async';
import { LRUCache } from 'lru-cache';

// interface LayerHandle {
//   dataset: gdal.Dataset;
//   layer: gdal.Layer;
//   transform: gdal.CoordinateTransformation | null; // null nếu srs nguồn đã là đích, khỏi transform thừa
//   srsAuthCode: string;
// }

export interface RawFeature {
  gid: number;
  level: number;
  lines: number[][][]; // toạ độ đã ở hệ đích (vd 3857), sẵn sàng để vẽ
}

@Injectable()
export class GpkgReaderService { //implements OnModuleDestroy
  private readonly logger = new Logger(GpkgReaderService.name);

  // Chỉ cache HANDLE (nhẹ, không phải feature data) — giới hạn theo ulimit -n của OS
  // private handleCache = new LRUCache<string, LayerHandle>({
  //   max: 200,
  //   ttl: 1000 * 60 * 10, // đóng handle nếu không dùng 10 phút
  //   dispose: (handle, key) => {
  //     try {
  //       handle.dataset.close();
  //     } catch (e) {
  //       this.logger.warn(`Lỗi đóng dataset ${key}: ${e.message}`);
  //     }
  //     this.logger.debug(`Đóng handle GPKG: ${key}`);
  //   },
  // });

  // // Request coalescing: nhiều request cùng xin 1 handle chưa mở -> gộp lại 1 lần open
  // private openingInFlight = new Map<string, Promise<LayerHandle>>();

  // private async getOrOpenLayer(
  //   gpkgPath: string,
  //   layerName: string,
  //   targetEpsg = 3857,
  // ): Promise<LayerHandle> {
  //   const key = `${gpkgPath}::${layerName}`;
  //   const cached = this.handleCache.get(key);
  //   if (cached) return cached;

  //   if (this.openingInFlight.has(key)) {
  //     return this.openingInFlight.get(key)!;
  //   }

  //   const openPromise = (async () => {
  //     const dataset = gdal.open(gpkgPath); // GDAL lazy — KHÔNG đọc hết file, chỉ mở connection SQLite
  //     const layer = dataset.layers.get(layerName);

  //     const srcSrs = layer.srs;
  //     const srcAuthCode = srcSrs?.getAuthorityCode(null) ?? null;

  //     let transform: gdal.CoordinateTransformation | null = null;
  //     if (srcAuthCode !== String(targetEpsg)) {
  //       const dstSrs = gdal.SpatialReference.fromEPSG(targetEpsg);
  //       transform = new gdal.CoordinateTransformation(srcSrs, dstSrs);
  //     }

  //     const handle: LayerHandle = {
  //       dataset,
  //       layer,
  //       transform,
  //       srsAuthCode: srcAuthCode ?? 'unknown',
  //     };

  //     this.handleCache.set(key, handle);
  //     return handle;
  //   })();

  //   this.openingInFlight.set(key, openPromise);
  //   try {
  //     return await openPromise;
  //   } finally {
  //     this.openingInFlight.delete(key);
  //   }
  // }

  // /**
  //  * Query trực tiếp qua GDAL spatial filter — tận dụng R-tree index có sẵn
  //  * trong GPKG, chỉ đọc đúng phần feature giao với bbox, không đụng phần còn lại của file
  //  */
  // async queryFeaturesInBbox(
  //   gpkgPath: string,
  //   layerName: string,
  //   bbox: { minx: number; miny: number; maxx: number; maxy: number },
  //   targetEpsg = 3857,
  // ): Promise<RawFeature[]> {
  //   const handle = await this.getOrOpenLayer(gpkgPath, layerName, targetEpsg);
  //   const { layer, transform } = handle;

  //   // Nếu bbox đang ở targetEpsg (vd 3857) nhưng layer gốc khác hệ,
  //   // cần transform NGƯỢC bbox về hệ gốc trước khi setSpatialFilter
  //   let filterBox = bbox;
  //   if (transform) {
  //     filterBox = this.inverseTransformBbox(bbox, handle);
  //   }

  //   layer.setSpatialFilter(
  //     filterBox.minx,
  //     filterBox.miny,
  //     filterBox.maxx,
  //     filterBox.maxy,
  //   );

  //   const results: RawFeature[] = [];

  //   try {
  //     layer.features.forEach((feature) => {
  //       const geom = feature.getGeometry();
  //       if (!geom) return;

  //       if (transform) {
  //         geom.transform(transform);
  //       }

  //       results.push({
  //         gid: feature.fields.get('gid') ?? feature.fid,
  //         level: feature.fields.get('level') ?? 0,
  //         lines: this.extractLines(geom),
  //       });
  //     });
  //   } finally {
  //     // Luôn reset filter, tránh filter cũ ảnh hưởng query tiếp theo trên cùng layer handle
  //     layer.setSpatialFilter(null as any);
  //   }

  //   return results;
  // }

  // private inverseTransformBbox(
  //   bbox: { minx: number; miny: number; maxx: number; maxy: number },
  //   handle: LayerHandle,
  // ) {
  //   // Transform 4 góc bbox theo chiều ngược lại (target -> source) để filter đúng hệ gốc
  //   const dstSrs = gdal.SpatialReference.fromEPSG(3857);
  //   const inverse = new gdal.CoordinateTransformation(dstSrs, handle.layer.srs);

  //   const corners = [
  //     [bbox.minx, bbox.miny],
  //     [bbox.maxx, bbox.maxy],
  //   ].map(([x, y]) => inverse.transformPoint(x, y));

  //   return {
  //     minx: Math.min(corners[0].x, corners[1].x),
  //     miny: Math.min(corners[0].y, corners[1].y),
  //     maxx: Math.max(corners[0].x, corners[1].x),
  //     maxy: Math.max(corners[0].y, corners[1].y),
  //   };
  // }

  // private extractLines(geom: gdal.Geometry): number[][][] {
  //   const result: number[][][] = [];

  //   const pushLineString = (ls: gdal.LineString) => {
  //     const coords: number[][] = [];
  //     const count = ls.points.count();
  //     for (let i = 0; i < count; i++) {
  //       const p = ls.points.get(i);
  //       coords.push([p.x, p.y]);
  //     }
  //     result.push(coords);
  //   };

  //   if (geom.name === 'MULTILINESTRING') {
  //     (geom as gdal.MultiLineString).children.forEach((child) =>
  //       pushLineString(child as gdal.LineString),
  //     );
  //   } else if (geom.name === 'LINESTRING') {
  //     pushLineString(geom as gdal.LineString);
  //   }

  //   return result;
  // }

  // /** Chủ động invalidate khi có file GPKG mới ghi đè (batch job vài lần/ngày) */
  // invalidateLayer(gpkgPath: string, layerName: string) {
  //   const key = `${gpkgPath}::${layerName}`;
  //   this.handleCache.delete(key); // dispose() sẽ tự đóng handle cũ
  // }

  // onModuleDestroy() {
  //   // Đóng sạch handle khi app shutdown, tránh giữ file lock
  //   for (const key of this.handleCache.keys()) {
  //     this.handleCache.delete(key);
  //   }
  // }
}