/* eslint-disable prettier/prettier */
import { Controller, Get, Param, Req, Res, Logger } from '@nestjs/common';
import { Response, Request } from 'express';
import { MbtilesService } from './mbtiles.service';
import { ApiTags } from '@nestjs/swagger';
import * as crypto from 'crypto';
import * as NodeCache from 'node-cache';

const tileCache = new NodeCache({ stdTTL: 300, maxKeys: 1000 });
const filenameCache = new NodeCache({ stdTTL: 3600, maxKeys: 5000 });

// Sentinel value để đánh dấu "đã kiểm tra, không có file"
const NULL_SENTINEL = '__NULL__';

@ApiTags('mbtiles')
@Controller('mbtiles')
export class MbtilesController {
  private readonly logger = new Logger(MbtilesController.name);

  constructor(private readonly mbtilesService: MbtilesService) {}

  @Get('line/:z/:x/:y')
  async getLine(
    @Param('z') z: string, // ✅ string, parseInt sau
    @Param('x') x: string,
    @Param('y') y: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // ✅ Parse sang number đúng chỗ
    const zi = parseInt(z, 10);
    const xi = parseInt(x, 10);
    const yi = parseInt(y, 10);

    // ✅ Validate params
    if (isNaN(zi) || isNaN(xi) || isNaN(yi)) {
      return res.status(400).send();
    }

    try {
      // ── Step 1: Resolve filename ──────────────────────────────────────────
      const fnCacheKey = `fn:${zi}:${xi}:${yi}`;

      // ✅ Dùng has() để phân biệt "miss" vs "cached null"
      let filename: string | null;

      if (filenameCache.has(fnCacheKey)) {
        const cached = filenameCache.get<string>(fnCacheKey);
        filename = cached === NULL_SENTINEL ? null : cached ?? null;
      } else {
        filename = await this.mbtilesService.resolveFilename(zi, xi, yi);
        filenameCache.set(fnCacheKey, filename ?? NULL_SENTINEL);
      }

      if (!filename) {
        return res.status(204).send();
      }

      // ── Step 2: Get tile bytes ────────────────────────────────────────────
      const tileCacheKey = `tile:${filename}:${zi}:${xi}:${yi}`;

      let tileBuffer: Buffer | null = null;
      let fromCache = false;

      if (tileCache.has(tileCacheKey)) {
        const cached = tileCache.get<Buffer | 'EMPTY'>(tileCacheKey);
        if (cached === 'EMPTY') {
          return res.status(204).send(); // ✅ Sentinel string thay Buffer
        }
        tileBuffer = cached ?? null;
        fromCache = true;
      }

      if (!tileBuffer) {
        tileBuffer = this.mbtilesService.getTileFromFile(filename, zi, xi, yi);

        if (!tileBuffer) {
          tileCache.set(tileCacheKey, 'EMPTY'); // ✅ String sentinel
          return res.status(204).send();
        }

        tileCache.set(tileCacheKey, tileBuffer);
      }

      // ── Step 3: ETag ──────────────────────────────────────────────────────
      const etag = `"${crypto
        .createHash('md5')
        .update(tileBuffer)
        .digest('hex')
        .slice(0, 16)}"`;

      if (req.headers['if-none-match'] === etag) {
        return res.status(304).send();
      }

      // ── Step 4: Detect compression ────────────────────────────────────────
      // ✅ Tự detect tile có gzip hay không thay vì hardcode
      const isGzip = tileBuffer[0] === 0x1f && tileBuffer[1] === 0x8b;

      res.setHeader('Content-Type', 'application/x-protobuf');
      if (isGzip) {
        res.setHeader('Content-Encoding', 'gzip');
      }
      res.setHeader(
        'Cache-Control',
        'public, max-age=3600, stale-while-revalidate=86400',
      );
      res.setHeader('ETag', etag);
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('X-Tile-Cache', fromCache ? 'HIT' : 'MISS'); // debug header

      return res.status(200).send(tileBuffer);
    } catch (error) {
      this.logger.error(`Tile ${z}/${x}/${y}: ${error.message}`);
      return res.status(204).send();
    }
  }

    // ===================================
  // @Get('tiles/:z/:x/:y')
  // async getTile(
  //   @Param('z') z: number,
  //   @Param('x') x: number,
  //   @Param('y') y: number,
  //   @Res() res: Response,
  // ) {
  //   try {
  //     const tile = await this.mbtilesService.getTileGeoJsonConvert(z, x, y);
  //     res.setHeader('Content-Type', 'application/x-protobuf');
  //     // res.setHeader('Content-Encoding', 'gzip');
  //     if (!tile) {
  //       const EMPTY_TILE = Buffer.from([
  //         0x1a,
  //         0x00, // tile rỗng
  //       ]);
  //       return res.send(EMPTY_TILE);
  //     }
  //     return res.send(tile);
  //   } catch (error) {
  //     const EMPTY_TILE = Buffer.from([
  //       0x1a,
  //       0x00, // tile rỗng
  //     ]);
  //     return res.send(EMPTY_TILE);
  //   }
  // }
}
