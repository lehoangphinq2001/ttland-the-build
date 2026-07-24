/* eslint-disable prettier/prettier */
import { VectorTile } from '@mapbox/vector-tile';
import Pbf = require('pbf');
import vtpbf = require('vt-pbf');
import geojsonvt = require('geojson-vt');

const DEFAULT_EXTENT = 4096;

/**
 * Ghép nhiều vector tile của cùng một ô XYZ thành một tile duy nhất.
 *
 * Lưu ý: KHÔNG dùng Buffer.concat được. Layer trong MVT là repeated field,
 * concat sẽ ra pbf hợp lệ về cú pháp nhưng hai layer trùng tên thì parser
 * chỉ giữ cái sau — mất sạch dữ liệu của file đầu. Bắt buộc phải decode,
 * gộp feature theo tên layer, rồi encode lại.
 */
export function mergeVectorTiles(
  buffers: Buffer[],
  extent = DEFAULT_EXTENT,
): Buffer | null {
  const valid = buffers.filter((b) => b && b.length);
  if (!valid.length) return null;
  if (valid.length === 1) return valid[0];

  const merged: Record<string, MergedLayer> = {};

  for (const buf of valid) {
    let tile: VectorTile;
    try {
      tile = new VectorTile(new Pbf(buf));
    } catch {
      continue;
    }

    for (const name of Object.keys(tile.layers)) {
      const layer = tile.layers[name];
      const scale = extent / (layer.extent || DEFAULT_EXTENT);

      const target = (merged[name] ??= new MergedLayer(name, extent));
      for (let i = 0; i < layer.length; i++) {
        const f = layer.feature(i);
        target.push(new MergedFeature(f, extent, scale, target.nextId()));
      }
    }
  }

  const names = Object.keys(merged);
  if (!names.length) return null;

  return Buffer.from(
    vtpbf.fromVectorTileJs({ layers: merged } as any),
  );
}

class MergedLayer {
  version = 2;
  private _features: MergedFeature[] = [];
  private _id = 0;

  constructor(
    public name: string,
    public extent: number,
  ) {}

  nextId() {
    return ++this._id;
  }

  push(f: MergedFeature) {
    this._features.push(f);
  }

  get length() {
    return this._features.length;
  }

  feature(i: number) {
    return this._features[i];
  }
}

class MergedFeature {
  id: number;
  type: number;
  properties: Record<string, any>;

  constructor(
    private src: any,
    public extent: number,
    private scale: number,
    id: number,
  ) {
    // ID gốc có thể trùng giữa các file -> đánh lại để không mất feature
    this.id = id;
    this.type = src.type;
    this.properties = src.properties;
  }

  loadGeometry() {
    const geom = this.src.loadGeometry();
    if (this.scale === 1) return geom;
    return geom.map((ring: any[]) =>
      ring.map((p: any) => ({
        x: Math.round(p.x * this.scale),
        y: Math.round(p.y * this.scale),
      })),
    );
  }
}

/**
 * Sinh tile con từ tile cha khi z vượt maxzoom của file.
 * Chỉ cần khi các file trong cùng một ô có maxzoom KHÁC nhau — lúc đó không
 * thể để MapLibre tự overzoom vì nó chỉ overzoom được ở mức source.
 */
export function overzoomTile(
  parentBuf: Buffer,
  parent: { z: number; x: number; y: number },
  target: { z: number; x: number; y: number },
  extent = DEFAULT_EXTENT,
): Buffer | null {
  if (parent.z === target.z) return parentBuf;

  let tile: VectorTile;
  try {
    tile = new VectorTile(new Pbf(parentBuf));
  } catch {
    return null;
  }

  const out: Record<string, any> = {};

  for (const name of Object.keys(tile.layers)) {
    const layer = tile.layers[name];
    const features: any[] = [];
    for (let i = 0; i < layer.length; i++) {
      const gj = layer.feature(i).toGeoJSON(parent.x, parent.y, parent.z);
      if (gj?.geometry) features.push(gj);
    }
    if (!features.length) continue;

    const index = geojsonvt(
      { type: 'FeatureCollection', features },
      {
        maxZoom: Math.max(target.z, 1),
        indexMaxZoom: 0,
        tolerance: 1,
        extent,
        buffer: 64,
      },
    );
    const t = index.getTile(target.z, target.x, target.y);
    if (t && t.features.length) out[name] = t;
  }

  if (!Object.keys(out).length) return null;
  return Buffer.from(vtpbf.fromGeojsonVt(out, { version: 2, extent }));
}
