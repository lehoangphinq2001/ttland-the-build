import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  Res,
} from '@nestjs/common';
import { GeoserverService } from './geoserver.service';
import { CreateGeoserverDto } from './dto/create-geoserver.dto';
import { UpdateGeoserverDto } from './dto/update-geoserver.dto';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('geoserver')
@Controller('geoserver')
export class GeoserverController {
  constructor(private readonly geoserverService: GeoserverService) {}

  // GET /api/geoserver/tile/:z/:x/:y?idtinh=66
  // Proxy WMS tile PNG — URL dạng chuẩn TMS giống Leaflet
  @Get('tile/:z/:x/:y')
  async getTileXYZ(
    @Param('z') z: number,
    @Param('x') x: number,
    @Param('y') y: number,
    @Res() res: Response,
  ) {
    const buffer = await this.geoserverService.getTileXYZ(
      Number(z),
      Number(x),
      Number(y),
    );
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=300');
    res.send(buffer);
  }
}
