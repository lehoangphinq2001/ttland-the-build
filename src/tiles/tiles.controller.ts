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
import { ApiTags } from '@nestjs/swagger';
@ApiTags('tiles')
@Controller('tiles')
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
}
