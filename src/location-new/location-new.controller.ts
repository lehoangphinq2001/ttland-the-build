/* eslint-disable prettier/prettier */
/* eslint-disable no-var */
import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { LocationNewService } from './location-new.service';
import { CommonService } from 'src/common/common.service';
import { SearchTextLocationNewDto } from './dto/search-text-location-new.dto';

@Controller('location-new')
export class LocationNewController {
  constructor(
    private readonly locationNewService: LocationNewService,
    private readonly commonService: CommonService,
  ) { }

  @Post('search-address')
  async searchText(@Body() searchTextLocationNewDto: SearchTextLocationNewDto) {
    return this.locationNewService.searchText(searchTextLocationNewDto);
  }

  @Post('data-json-ward/:wardId')
  async dataGeoJsonWard(@Param('wardId') wardId: string) {
    return this.locationNewService.addGeoJsonWithWardId(wardId);
  }

  @Post('app/call/list-province')
  async appListProvince() {
    return this.locationNewService.listProvince();
  }

  @Post('web-call/list-province')
  async webCallListProvince() {
    var result = await this.locationNewService.listProvince();
    return result;
  }

  //=======================================
  @Post('app/call/list-wards/:provinceId')
  appCallListWard(@Param('provinceId') provinceId: string) {
    return this.locationNewService.listWardByProvinceId(provinceId);
  }

  @Post('web-call/list-wards/:provinceId')
  async webCallListWard(@Param('provinceId') provinceId: string) {
    var result = await this.locationNewService.listWardByProvinceId(provinceId);
      return result;
  }
}
