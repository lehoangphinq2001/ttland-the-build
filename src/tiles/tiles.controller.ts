import {
  Controller,
  Get,
  Param,
  Res,
  Req,
  ParseIntPipe,
  Logger,
  Delete,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { TilesService } from './tiles.service';

@Controller()
export class TilesController {
  private readonly logger = new Logger(TilesController.name);

  constructor(private readonly tilesService: TilesService) {}

  /**
   * GET /tiles/:z/:x/:y.png
   * Trả về PNG raster tile render từ vector MBTiles
   */
  @Get('load/:z/:x/:y.png')
  async getTile(
    @Param('z', ParseIntPipe) z: number,
    @Param('x', ParseIntPipe) x: number,
    @Param('y', ParseIntPipe) y: number,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const start = Date.now();
    try {
      const png = await this.tilesService.getRasterTile(z, x, y);
      const elapsed = Date.now() - start;

      res
        .status(200)
        .set({
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600',
          ETag: `"${z}-${x}-${y}-${png.length}"`,
          'Access-Control-Allow-Origin': '*',
          'X-Render-Time': `${elapsed}ms`,
        })
        .send(png);

      // if (elapsed > 500) {
      //   this.logger.warn(`Slow tile z=${z} x=${x} y=${y}: ${elapsed}ms`);
      // }
    } catch (err) {
      // this.logger.error(`Tile error z=${z} x=${x} y=${y}: ${err.message}`);
      res.status(500).json({ error: 'Tile rendering failed' });
    }
  }

  /** GET /tiles/:z/:x/:y  (không có .png extension) */
  @Get('load/:z/:x/:y')
  async getTileNoExt(
    @Param('z', ParseIntPipe) z: number,
    @Param('x', ParseIntPipe) x: number,
    @Param('y', ParseIntPipe) y: number,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.getTile(z, x, y, req, res);
  }

  // tiles.controller.ts
  // @Delete('cache')
  // async clearCache() {
  //   return this.tilesService.clearAllCache();
  // }

  /** GET /tiles.json — TileJSON descriptor */
  // @Get('tiles.json')
  // async getTileJSON(@Req() req: Request, @Res() res: Response) {
  //   const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  //   const host  = req.headers['x-forwarded-host']  || req.headers.host || 'localhost:3000';
  //   const baseUrl = `${proto}://${host}`;

  //   res
  //     .status(200)
  //     .set({
  //       'Content-Type': 'application/json',
  //       'Cache-Control': 'public, max-age=300',
  //       'Access-Control-Allow-Origin': '*',
  //     })
  //     .json(this.tilesService.getTileJSON(baseUrl));
  // }

  // /** GET /metadata */
  // @Get('metadata')
  // async getMetadata(@Res() res: Response) {
  //   const metadata = this.tilesService.getMetadata();
  //   if (!metadata) {
  //     return res.status(503).json({ error: 'Metadata not yet loaded' });
  //   }
  //   res
  //     .status(200)
  //     .set({
  //       'Content-Type': 'application/json',
  //       'Cache-Control': 'public, max-age=300',
  //       'Access-Control-Allow-Origin': '*',
  //     })
  //     .json(metadata);
  // }

  // /** GET /health */
  // @Get('health')
  // health(@Res() res: Response) {
  //   res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  // }
}
