/* eslint-disable @typescript-eslint/no-inferrable-types */
/* eslint-disable prettier/prettier */
/* eslint-disable no-var */
import { BadGatewayException, Injectable } from '@nestjs/common';
import { SearchTextLocationNewDto } from './dto/search-text-location-new.dto';
import { DataSource } from 'typeorm';
import { CommonService } from 'src/common/common.service';
import { HttpService } from '@nestjs/axios';
import { lastValueFrom } from 'rxjs';
import * as https from 'https';
import { LocationDto } from './dto/location.dto';

@Injectable()
export class LocationNewService {
  constructor(
    private readonly dataSource: DataSource,
    private commonService: CommonService,
    private httpService: HttpService,
  ) {}

  async addGeoJsonWithWardId(wardId: string) {
    try {
      var url =
        `http://localhost:5555/v1/location-new/polygon-in-ward/` + wardId;
      var response = await lastValueFrom(
        this.httpService.post(url, {
          headers: { 'Content-Type': 'application/json' },
          httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        }),
      );
      return response.data;
    } catch (ex) {
      console.log('1. Find Parcel', ex.message);
      return new BadGatewayException('Error', ex.message);
    }
  }

  async listProvince() {
    var rs = await this.dataSource.query(`
    SELECT ten_tinh as name, ma_tinh as province_code, 
    lat as latitude, lng as longitude, uri, central
    FROM province_news ORDER BY ten_tinh asc`);
    return this.commonService._checkArray(rs);
  }

  async listWardByProvinceId(provinceId: string) {
    var rs = await this.dataSource.query(`
      SELECT ma_xa as code, ma_tinh as province_code, CONCAT(loai, ' ', ten_Xa)  as name,
      lat as latitude, lng as longitude, uri
      FROM ward_news
          WHERE ma_tinh = '${provinceId}' ORDER BY ten_Xa asc
      `);
    return this.commonService._checkArray(rs);
  }

  // =========================================
  // =========================================
  async getInfoLocationAll(locationDto: LocationDto) {
    try {
      var rsOld = await this.getInfoLocationOld(locationDto);
      var rsNew = await this.getInfoLocationNew(locationDto);
      var rsAll = { infoOld: rsOld.data, infoNew: rsNew.data };
      return this.commonService._checkObject(rsAll);
    } catch (error) {
      return this.commonService._checkObject(null);
    }
  }

  async getInfoLocationOld(locationDto: LocationDto) {
    try {
      var { lat, lng } = locationDto;
      var rs = await this.dataSource.query(`
      SELECT 
          provinceid,
          districtid,
          name
      FROM load_districts
      WHERE ST_Contains(
          geom, 
          ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)
      );
    `);
      return this.commonService._checkObject(rs[0]);
    } catch (error) {
      return this.commonService._checkObject(null);
    }
  }

  async getInfoLocationNew(locationDto: LocationDto) {
    var { lat, lng } = locationDto;

    try {
      var { lat, lng } = locationDto;
      var rs = await this.dataSource.query(`
      SELECT 
        concat(loai, ' ', "name") as ward_name, ten_tinh as province_name, ma_tinh as provinceid, code as wardid
        FROM load_ward_news
      WHERE ST_Contains(
          geom, 
          ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)
      );
    `);
      return this.commonService._checkObject(rs[0]);
    } catch (error) {
      return this.commonService._checkObject(null);
    }
  }
}
