import { Controller, Get, Param, Req, Res, Logger } from '@nestjs/common';
import { Response, Request } from 'express';
import { MbtilesService } from './mbtiles.service';
import { ApiTags } from '@nestjs/swagger';
import * as crypto from 'crypto';
import * as NodeCache from 'node-cache';

// ✅ Cache key bao gồm filename → tránh collision giữa các tỉnh
// Layer 1: tile bytes (1000 tiles, TTL 5 phút)
const tileCache = new NodeCache({ stdTTL: 300, maxKeys: 1000 });
// Layer 2: filename resolution (5000 entries, TTL 1 giờ)
const filenameCache = new NodeCache({ stdTTL: 3600, maxKeys: 5000 });

const EMPTY_TILE = Buffer.from([0x1a, 0x00]);

@ApiTags('mbtiles')
@Controller('mbtiles')
export class MbtilesController {
  private readonly logger = new Logger(MbtilesController.name);

  constructor(private readonly mbtilesService: MbtilesService) {}

  @Get('line/:z/:x/:y')
  async getTile(
    @Param('z') z: number,
    @Param('x') x: number,
    @Param('y') y: number,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      // ── Step 1: Resolve filename (memory cache → Redis → DB lookup) ──
      const fnCacheKey = `fn:${z}:${x}:${y}`;
      let filename: string | null = filenameCache.get(fnCacheKey) ?? null;

      if (filename === undefined || filename === null) {
        // undefined = not in cache; null = cached as "no file"
        filename = await this.mbtilesService.resolveFilename(z, x, y);
        filenameCache.set(fnCacheKey, filename ?? '__NULL__');
      } else if ((filename as any) === '__NULL__') {
        filename = null;
      }

      if (!filename) {
        return res.status(204).send();
      }

      // ── Step 2: Get tile bytes (memory cache → SQLite pool) ──
      // ✅ Cache key bao gồm filename để tránh collision
      const tileCacheKey = `tile:${filename}:${z}:${x}:${y}`;
      let tileBuffer: Buffer | null = tileCache.get(tileCacheKey) ?? null;

      if (!tileBuffer) {
        tileBuffer = this.mbtilesService.getTileFromFile(filename, z, x, y);

        if (!tileBuffer) {
          tileCache.set(tileCacheKey, EMPTY_TILE);
          return res.status(204).send();
        }

        tileCache.set(tileCacheKey, tileBuffer);
      } else if (tileBuffer === EMPTY_TILE) {
        return res.status(204).send();
      }

      // ── Step 3: ETag check ──
      const etag = `"${crypto
        .createHash('md5')
        .update(tileBuffer)
        .digest('hex')
        .slice(0, 16)}"`;

      if (req.headers['if-none-match'] === etag) {
        return res.status(304).send();
      }

      // ── Step 4: Send ──
      res.setHeader('Content-Type', 'application/x-protobuf');
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
      res.setHeader('ETag', etag);
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('Access-Control-Allow-Origin', '*');

      return res.status(200).send(tileBuffer);

    } catch (error) {
      this.logger.error(`Tile ${z}/${x}/${y}: ${error.message}`);
      return res.status(204).send();
    }
  }
}