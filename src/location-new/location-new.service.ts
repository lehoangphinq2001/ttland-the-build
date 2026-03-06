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

@Injectable()
export class LocationNewService {

  constructor(
    private readonly dataSource: DataSource,
    private commonService: CommonService,
    private httpService: HttpService,
  ) { }


  async searchText(searchTextLocationNewDto: SearchTextLocationNewDto) {
    try {
      var { stringSearch } = searchTextLocationNewDto;

      var tileLower = await stringSearch?.toLowerCase();
      var query = `
      SELECT TOP 15
          w.[name] AS ward_name,
          district.[name] AS district_name,
          province.[name] AS province_name,
          province.id as province_id,
          district.id as district_id,
          w.id as ward_id,
          CONCAT(w.[name], ', ', district.[name], ', ', province.[name]) AS title
      FROM ward AS w WITH (NOLOCK)
      INNER JOIN district WITH (NOLOCK) ON district.id = w.districtId
      INNER JOIN province WITH (NOLOCK) ON province.id = district.provinceId
      WHERE
          (w.[name] COLLATE Vietnamese_CI_AI LIKE N'%${tileLower}%'
          OR district.[name] COLLATE Vietnamese_CI_AI LIKE N'%${tileLower}%'
          OR province.[name] COLLATE Vietnamese_CI_AI LIKE N'%${tileLower}%');
    `;
      var rs = await this.dataSource.query(query);

      // LOCATION NEWS
      const rsProvince = await this.dataSource.query(
        `
          SELECT name, slug, type, "code" as "provinceId", 
            name_with_type, latitude, longitude
          FROM add_new_provinces
          WHERE name LIKE @0 COLLATE SQL_Latin1_General_CP1_CI_AS
        `,
        [`%${stringSearch}%`] // Tham số hóa để tránh SQL injection
      );

      if (rsProvince?.length == 0) {
        try {
          const rsWard = await this.dataSource.query(
            `
          SELECT w.id, w.name, w.type, w.[path], w.name_with_type as ten, w.slug, w.path_with_type, p.name as province_name
          FROM add_new_wards as w
          INNER JOIN add_new_provinces as p ON p.id = w.province_code
          WHERE 
            w.name LIKE N'%${tileLower}%' COLLATE Vietnamese_CI_AI
            OR w.name_with_type LIKE N'%${tileLower}%' COLLATE Vietnamese_CI_AI
            OR w.[path] LIKE N'%${tileLower}%' COLLATE Vietnamese_CI_AI
            OR w.path_with_type LIKE N'%${tileLower}%' COLLATE Vietnamese_CI_AI;
          ` // Tham số hóa để tránh SQL injection
          );
          return { success: true, data: rsWard, data_last: rs, type: 'ward' }
        } catch (error) {
          console.error('Error message:', error.message);
          return { success: false, data: [], data_last: [], type: null }
        }

      } else {
        return { success: true, data: rsProvince, data_last: rs, type: 'province' }
      }
    } catch (error) {
      console.log("error", error?.message);
      return { success: false, data: [], data_last: [], type: null }
    }
  }

  async addGeoJsonWithWardId(wardId: string) {
    try {
      var url = `http://localhost:5555/v1/location-new/polygon-in-ward/` + wardId;
      var response = await lastValueFrom(this.httpService.post(url, {
        headers: { "Content-Type": "application/json" },
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      }));
      return response.data;
    } catch (ex) {
      console.log("1. Find Parcel", ex.message);
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

  // ******************************************************
  // SUPPORT
  // ******************************************************
  async getAddressNameByArrWardOld(wardId: string) {
    var rs = await this.dataSource.query(`
        SELECT concat(w.type, ' ', w.name, ', ', d.name, ', ', p.name) as address FROM ward w
        INNER JOIN district d on d.id = w.districtId
        INNER JOIN province p on p.id = d.provinceId
        WHERE w.id = '${wardId}'
    `);
    return rs[0];
  }
  async getAddressNameByArrWardNews(arrString: any) {
    var rs = await this.dataSource.query(`
        SELECT 
          STUFF((
              SELECT ', ' + loai + ' ' + ten_xa
              FROM ward_news
              WHERE ma_xa IN (${arrString})
              FOR XML PATH(''), TYPE
          ).value('.', 'NVARCHAR(MAX)'), 1, 2, '')
          + ' - ' + (SELECT TOP 1 ten_tinh FROM ward_news WHERE ma_xa IN (${arrString}))
          AS address;
    `);
    return rs[0];
  }
}
