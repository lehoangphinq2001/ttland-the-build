/* eslint-disable prettier/prettier */
/* eslint-disable no-var */
import { Controller, Get, Param, Query, Res, Req, BadGatewayException, Body, Post } from '@nestjs/common';
import { Response, Request } from 'express';
import { MbtilesService } from './mbtiles.service';
import * as MBTiles from '@mapbox/mbtiles';
import { ApiTags } from '@nestjs/swagger';
import * as path from 'path';

@ApiTags('mbtiles')
@Controller('mbtiles')
export class MbtilesController {
  constructor(private readonly mbtilesService: MbtilesService) { }

    // ===================================
  //           SUPPORT_GEOJSON
  // ===================================
  @Get('tiles/:z/:x/:y')
  async getTile(
    @Param('z') z: number,
    @Param('x') x: number,
    @Param('y') y: number,
    @Res() res: Response,
  ) {
    try {
      const tile = await this.mbtilesService.getTileGeoJsonConvert(z, x, y);
      res.setHeader('Content-Type', 'application/x-protobuf');
      // res.setHeader('Content-Encoding', 'gzip');
      if (!tile) {
        const EMPTY_TILE = Buffer.from([
          0x1a,
          0x00, // tile rỗng
        ]);
        return res.send(EMPTY_TILE);
      }
      return res.send(tile);
    } catch (error) {
      const EMPTY_TILE = Buffer.from([
        0x1a,
        0x00, // tile rỗng
      ]);
      return res.send(EMPTY_TILE);
    }
  }
}
