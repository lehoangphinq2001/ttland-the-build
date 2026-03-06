import { CommonService } from './../common/common.service';
/* eslint-disable prettier/prettier */
/* eslint-disable no-var */
import { Injectable } from '@nestjs/common';
import { CreateCoordinateDto } from './dto/vn2000-to-wgs84.dto';
import * as proj4 from 'proj4';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ArrCreateCoordinateDto } from './dto/arrvn2000-to-wgs84.dto';

@Injectable()
export class CoordinatesService {
  constructor(
    private dataSource: DataSource,
    private commonService: CommonService
  ) { }

  private readonly wgs84Proj = proj4.WGS84; // EPSG:4326

  async getEspgByProvince(provinceId: string) {
    var data = await this.dataSource.query(` SELECT * FROM province WHERE id = ${provinceId} `);
    return this.commonService._checkArray(data);
  }

  async convertVN2000ToWGS84(createCoordinateDto: CreateCoordinateDto) {
    let coor_lat: number | undefined;
    let coor_lng: number | undefined;
    const { x, y, provinceId } = createCoordinateDto;

    if (x && y) {
      if (x > y) {
        coor_lng = Number(x); // Không cần await
        coor_lat = Number(y);
      } else {
        coor_lat = Number(x);
        coor_lng = Number(y);
      }
    }

    // Lấy thông tin EPSG từ provinceId
    const dataOrigin = await this.getEspgByProvince(provinceId);
    const central_meridian = dataOrigin.data[0].central_meridian;

    // Định nghĩa hệ tọa độ VN2000 và WGS84
    proj4.defs([
      [
        'EPSG:4756', // Hệ tọa độ VN2000
        `+proj=tmerc +lat_0=0 +lon_0=${central_meridian} +k=0.9999 +x_0=500000 +y_0=0 +ellps=WGS84 +towgs84=-191.90441429,-39.30318279,-111.45032835,0.00928836,-0.01975479,0.00427372,0.252906278 +units=m +no_defs`,
      ],
      [
        'EPSG:4326', // Hệ tọa độ WGS84
        '+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs',
      ],
    ]);

    // Chuyển đổi tọa độ từ VN2000 sang WGS84
    const result = proj4('EPSG:4756', 'EPSG:4326', [coor_lng, coor_lat]);
    return { success: true, data: { lat: result[1], lng: result[0] } };
  }

  async convertArrVN2000ToWGS84(ArrCreateCoordinateDto: ArrCreateCoordinateDto) {
    const { coordinates, provinceId } = ArrCreateCoordinateDto;
    const convertedCoordinates: { lat: string, lng: string }[] = [];

    // Lấy thông tin EPSG từ provinceId
    const dataOrigin = await this.getEspgByProvince(provinceId);
    const central_meridian = dataOrigin.data[0].central_meridian;

    // Định nghĩa hệ tọa độ VN2000 và WGS84
    proj4.defs([
      [
        'EPSG:4756',
        `+proj=tmerc +lat_0=0 +lon_0=${central_meridian} +k=0.9999 +x_0=500000 +y_0=0 +ellps=WGS84 +towgs84=-191.90441429,-39.30318279,-111.45032835,0.00928836,-0.01975479,0.00427372,0.252906278 +units=m +no_defs`,
      ],
      [
        'EPSG:4326',
        '+proj=longlat +ellps=WGS84 +datum=WGS84 +no_defs',
      ],
    ]);

    // Xử lý từng cặp tọa độ
    for (const [first, second] of coordinates) {
      let coor_lat: number;
      let coor_lng: number;

      // Xác định lat/lng dựa trên điều kiện x > y
      if (first > second) {
        coor_lng = Number(first);
        coor_lat = Number(second);
      } else {
        coor_lat = Number(first);
        coor_lng = Number(second);
      }

      // Chuyển đổi tọa độ từ VN2000 sang WGS84
      const result = proj4('EPSG:4756', 'EPSG:4326', [coor_lng, coor_lat]);
      convertedCoordinates.push({ lat: result[1], lng: result[0] });
    }

    return { success: true, data: convertedCoordinates };
  }
}