/* eslint-disable prettier/prettier */
/* eslint-disable no-var */
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CreateGeoserverDto } from './dto/create-geoserver.dto';
import { UpdateGeoserverDto } from './dto/update-geoserver.dto';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { LocationNewService } from 'src/location-new/location-new.service';
import * as sharp from 'sharp';

const GEOSERVER_URL = 'http://45.119.83.59:8080/geoserver';
const WORKSPACE = 'THONGTINLAND';
const LAYER = 'load-line';

@Injectable()
export class GeoserverService {
  constructor(
    private readonly httpService: HttpService,
    private readonly locationNewService: LocationNewService,
  ) {}

  async getTileXYZ(z: number, x: number, y: number) {
    const { bbox } = await this.tileToBbox(x, y, z);
    const dataLocation: any = await this.resolveFilename(z, x, y);

    if (!dataLocation?.success || !dataLocation?.data?.infoNew) {
      console.warn(`[z=${z}] Cannot resolve location for tile ${x}/${y}`);
      return this.getTransparentTile();
    }

    const idtinh = dataLocation.data.infoNew.provinceid;
    const idhuyen = dataLocation.data.infoNew.wardid;

    return this.getTile(idtinh, idhuyen, bbox, z);
  }

  async getTile(
    idtinh: string,
    idhuyen: string,
    bbox: string,
    z?: number,
    width = 256,
    height = 256,
  ) {
    const url = `${GEOSERVER_URL}/${WORKSPACE}/wms`;
    const expandedBbox = this.expandBbox(bbox, z ?? 18);

    // ✅ Tính expandedWidth/Height tương ứng để GeoServer render đúng tỉ lệ
    const [oLonMin, oLatMin, oLonMax, oLatMax] = bbox.split(',').map(Number);
    const [eLonMin, eLatMin, eLonMax, eLatMax] = expandedBbox
      .split(',')
      .map(Number);

    const expandedWidth = Math.round(
      (width * (eLonMax - eLonMin)) / (oLonMax - oLonMin),
    );
    const expandedHeight = Math.round(
      (height * (eLatMax - eLatMin)) / (oLatMax - oLatMin),
    );

    const params = {
      SERVICE: 'WMS',
      VERSION: '1.1.1',
      REQUEST: 'GetMap',
      FORMAT: 'image/png',
      TRANSPARENT: true,
      LAYERS: `${WORKSPACE}:${LAYER}`,
      exceptions: 'application/vnd.ogc.se_inimage',
      SRS: 'EPSG:4326',
      WIDTH: expandedWidth, // ✅ dùng expanded size
      HEIGHT: expandedHeight, // ✅ dùng expanded size
      BBOX: expandedBbox,
      viewparams: `idtinh:${idtinh};idhuyen:${idhuyen}`,
    };

    try {
      const response = await firstValueFrom(
        this.httpService.get(url, { params, responseType: 'arraybuffer' }),
      );

      return await this.cropTileFromExpanded(
        Buffer.from(response.data),
        bbox,
        expandedBbox,
        expandedWidth, // ✅ truyền đúng kích thước ảnh thực
        expandedHeight,
        width,
        height,
      );
    } catch (error) {
      console.log('error', error.message);
      throw new HttpException(
        `GeoServer tile error: ${error.message}`,
        HttpStatus.BAD_GATEWAY,
      );
    }
  }
  // ✅ Mở rộng bbox theo % dựa vào zoom level
  private expandBbox(bbox: string, z: number): string {
    const [lonMin, latMin, lonMax, latMax] = bbox.split(',').map(Number);

    // Zoom càng cao → tile càng nhỏ → cần expand nhiều hơn theo tỉ lệ
    const expandRatio = z >= 18 ? 0.5 : z >= 16 ? 0.3 : 0.1;

    const dLon = (lonMax - lonMin) * expandRatio;
    const dLat = (latMax - latMin) * expandRatio;

    return [lonMin - dLon, latMin - dLat, lonMax + dLon, latMax + dLat].join(
      ',',
    );
  }

  // ✅ Crop pixel từ ảnh expanded về đúng tile gốc
  private async cropTileFromExpanded(
    imageBuffer: Buffer,
    originalBbox: string,
    expandedBbox: string,
    expandedWidth: number, // kích thước ảnh GeoServer trả về
    expandedHeight: number,
    outputWidth: number, // kích thước tile output (256)
    outputHeight: number,
  ): Promise<Buffer> {
    const [oLonMin, oLatMin, oLonMax, oLatMax] = originalBbox
      .split(',')
      .map(Number);
    const [eLonMin, eLatMin, eLonMax, eLatMax] = expandedBbox
      .split(',')
      .map(Number);

    const eLonRange = eLonMax - eLonMin;
    const eLatRange = eLatMax - eLatMin;

    const cropX = Math.round(((oLonMin - eLonMin) / eLonRange) * expandedWidth);
    const cropY = Math.round(
      ((eLatMax - oLatMax) / eLatRange) * expandedHeight,
    );

    // ✅ Clamp để tránh vượt boundary
    const safeCropX = Math.max(0, Math.min(cropX, expandedWidth - outputWidth));
    const safeCropY = Math.max(
      0,
      Math.min(cropY, expandedHeight - outputHeight),
    );

    // console.log(
    //   `crop: x=${safeCropX}, y=${safeCropY}, w=${outputWidth}, h=${outputHeight}, imgSize=${expandedWidth}x${expandedHeight}`,
    // );

    return await sharp(imageBuffer)
      .extract({
        left: safeCropX,
        top: safeCropY,
        width: outputWidth,
        height: outputHeight,
      })
      .toBuffer();
  }
  
  private getTransparentTile(): Buffer {
    return Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
  }

  // Tính BBOX từ x, y, z (Web Mercator Slippy tile)
  tileToBbox(x: number, y: number, z: number) {
    const n = Math.pow(2, z);

    const lonMin = (x / n) * 360 - 180;
    const lonMax = ((x + 1) / n) * 360 - 180;
    const latMax =
      (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
    const latMin =
      (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI;

    return {
      bbox: `${lonMin},${latMin},${lonMax},${latMax}`,
      lonMin,
      lonMax,
      latMin,
      latMax,
    };
  }

  async resolveFilename(
    z: number,
    x: number,
    y: number,
  ): Promise<string | null> {
    const zi = +z,
      xi = +x,
      yi = +y;

    const n = Math.pow(2, zi);

    // ✅ Dùng CENTER của tile thay vì góc top-left
    const lon = ((xi + 0.5) / n) * 360.0 - 180.0;
    const lat_rad = Math.atan(Math.sinh(Math.PI * (1 - (2 * (yi + 0.5)) / n)));
    const lat = (lat_rad * 180.0) / Math.PI;

    const result = await this.getDataInLocation(lat, lon);
    return result;
  }

  private async getDataInLocation(lat: number, lng: number) {
    try {
      const infoLocation: any =
        await this.locationNewService.getInfoLocationAll({ lat, lng });
      if (!infoLocation?.success) return { success: false, data: null };
      return infoLocation;
    } catch (error) {
      return { success: false, data: null };
    }
  }
}
