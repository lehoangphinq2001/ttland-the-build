/* eslint-disable prettier/prettier */
import {
  Controller,
  Get,
  Header,
  Logger,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { TileService, TileScope } from './tile.service';
import { FileCatalogService } from './file-catalog.service';

const LONG_CACHE = 'public, max-age=86400, stale-while-revalidate=604800';
const SHORT_CACHE = 'public, max-age=60';

@Controller('tile')
export class TileController {
  private readonly logger = new Logger(TileController.name);

  constructor(
    private readonly tiles: TileService,
    private readonly catalog: FileCatalogService,
  ) {}

  /**
   * Scope quyết định nội dung tile. accountId nên lấy từ token đã xác thực,
   * KHÔNG lấy từ query — nếu không, đổi query là xem được dữ liệu tenant khác.
   */
  private scope(req: Request, year?: string): TileScope {
    const user: any = (req as any).user;
    return {
      accountId: user?.accountId ?? null,
      year: year ? parseInt(year, 10) : null,
    };
  }

  // ------------------------------------------------------------------
  // Vector tile — endpoint chính
  // ------------------------------------------------------------------
  @Get(':z/:x/:y.pbf')
  async vector(
    @Param('z', ParseIntPipe) z: number,
    @Param('x', ParseIntPipe) x: number,
    @Param('y', ParseIntPipe) y: number,
    @Query('year') year: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const scope = this.scope(req, year);
    const etag = `"${this.catalog.cacheKey(z, x, y, scope)}"`;

    res.set({
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': LONG_CACHE,
      ETag: etag,
    });
    if (req.headers['if-none-match'] === etag) return res.status(304).end();

    const gz = await this.tiles.getVectorTileGz(z, x, y, scope);
    if (!gz) {
      // 204 = "ô này không có dữ liệu", MapLibre hiểu và không báo lỗi
      return res.status(204).set('Cache-Control', SHORT_CACHE).end();
    }

    res
      .status(200)
      .set({
        'Content-Type': 'application/vnd.mapbox-vector-tile',
        'Content-Encoding': 'gzip',
      })
      .send(gz);
  }

  // ------------------------------------------------------------------
  // Raster tile — giữ nguyên đường dẫn cũ cho client hiện có
  // ------------------------------------------------------------------
  @Get('load/:z/:x/:y.png')
  async raster(
    @Param('z', ParseIntPipe) z: number,
    @Param('x', ParseIntPipe) x: number,
    @Param('y', ParseIntPipe) y: number,
    @Query('year') year: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const start = Date.now();
    const scope = this.scope(req, year);
    const etag = `"png-${this.catalog.cacheKey(z, x, y, scope)}"`;

    try {
      res.set({
        'Content-Type': 'image/png',
        'Cache-Control': LONG_CACHE,
        ETag: etag,
        'Access-Control-Allow-Origin': '*',
      });
      if (req.headers['if-none-match'] === etag) return res.status(304).end();

      const png = await this.tiles.getRasterTile(z, x, y, scope);
      const ms = Date.now() - start;
      res.set('X-Render-Time', `${ms}ms`).status(200).send(png);

      if (ms > 500) this.logger.warn(`Tile chậm ${z}/${x}/${y}: ${ms}ms`);
    } catch (err: any) {
      // Không bao giờ trả 5xx: MapLibre gặp lỗi sẽ hiện ô đỏ rồi retry dồn dập.
      this.logger.error(`Tile ${z}/${x}/${y}: ${err.message}`);
      res
        .status(200)
        .set({
          'Content-Type': 'image/png',
          'Cache-Control': SHORT_CACHE,
          'Access-Control-Allow-Origin': '*',
          'X-Tile-Error': '1',
        })
        .send(this.tiles.emptyPNG());
    }
  }

  // ------------------------------------------------------------------
  // Metadata & vận hành
  // ------------------------------------------------------------------
  @Get('tilejson.json')
  @Header('Access-Control-Allow-Origin', '*')
  tilejson(@Query('year') year: string, @Req() req: Request) {
    return this.tiles.tilejson(
      `${req.protocol}://${req.get('host')}`,
      this.scope(req, year),
    );
  }

  /** Tra file theo toạ độ — thay cho việc gọi service địa giới trong lúc render. */
  @Get('locate')
  @Header('Access-Control-Allow-Origin', '*')
  locate(
    @Query('lat') lat: string,
    @Query('lng') lng: string,
    @Query('year') year: string,
    @Req() req: Request,
  ) {
    const entries = this.catalog.filesForPoint(
      parseFloat(lat),
      parseFloat(lng),
      this.scope(req, year),
    );
    return {
      success: true,
      count: entries.length,
      data: entries.map((e) => ({
        id: e.id,
        filename: e.filename,
        year: e.year,
        subAddress: e.subAddress,
        provinceId: e.provinceId,
        districtId: e.districtId,
        provinceNewId: e.provinceNewId,
        wardNewId: e.wardNewId,
        bbox: [e.minLng, e.minLat, e.maxLng, e.maxLat],
      })),
      note:
        'bbox chồng lấn nên có thể trả nhiều kết quả; cần point-in-polygon ' +
        'thật thì dùng cột geom_real',
    };
  }

  @Get('debug/:z/:x/:y')
  @Header('Access-Control-Allow-Origin', '*')
  debug(
    @Param('z', ParseIntPipe) z: number,
    @Param('x', ParseIntPipe) x: number,
    @Param('y', ParseIntPipe) y: number,
    @Query('year') year: string,
    @Req() req: Request,
  ) {
    return this.tiles.debugTile(z, x, y, this.scope(req, year));
  }

  @Get('health')
  @Header('Access-Control-Allow-Origin', '*')
  health() {
    return this.tiles.health();
  }

  @Get('stats')
  @Header('Access-Control-Allow-Origin', '*')
  stats() {
    return this.tiles.stats();
  }

  @Post('reload')
  async reload() {
    await this.catalog.reload(true);
    return { success: true, version: this.catalog.version };
  }
}