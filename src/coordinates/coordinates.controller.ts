import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { CoordinatesService } from './coordinates.service';
import { CreateCoordinateDto } from './dto/vn2000-to-wgs84.dto';
import { ArrCreateCoordinateDto } from './dto/arrvn2000-to-wgs84.dto';

@Controller('coordinates')
export class CoordinatesController {
  constructor(private readonly coordinatesService: CoordinatesService) { }

  @Post('vn2000-to-wgs84')
  convertVN2000ToWGS84(@Body() createCoordinateDto: CreateCoordinateDto) {
    return this.coordinatesService.convertVN2000ToWGS84(createCoordinateDto);
  }

  @Post('arr-vn2000-to-wgs84')
  convertArrVN2000ToWGS84(@Body() ArrCreateCoordinateDto: ArrCreateCoordinateDto) {
    return this.coordinatesService.convertArrVN2000ToWGS84(ArrCreateCoordinateDto);
  }
}
