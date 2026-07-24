import { TileService } from './tile.service';
import { TileController } from './tile.controller';

/* eslint-disable prettier/prettier */
import { Injectable, Module } from '@nestjs/common';
import { InjectDataSource, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { MbtilesReaderService } from './mbtiles-reader.service';
import {
  CatalogRepository,
  CatalogRow,
  FileCatalogService,
} from './file-catalog.service';
import { LocationNewService } from 'src/location-new/location-new.service';
import { CommonService } from 'src/common/common.service';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { FileLayerLineService } from 'src/file-layer-line/file-layer-line.service';
import { FileLayerLine } from 'src/entity/file-layer-line.entity';
const HTTP_MAX_REDIRECTS = process.env.HTTP_MAX_REDIRECTS;
const HTTP_TIMEOUT = process.env.HTTP_TIMEOUT;
/**
 * Cầu nối tới bảng file_layer_line.
 * Đổi sang Knex/pg thuần thì chỉ cần thay thân hàm load().
 */
@Injectable()
export class PgCatalogRepository extends CatalogRepository {
  constructor(@InjectDataSource() private readonly ds: DataSource) {
    super();
  }

  async load(since: Date | null): Promise<CatalogRow[]> {
    const rows = await this.ds.query(
      `SELECT
         id,
         filename,
         "accountId"     AS account_id,
         "provinceId"    AS province_id,
         "districtId"    AS district_id,
         "provinceNewId" AS province_new_id,
         "wardNewId"     AS ward_new_id,
         year,
         status,
         sub_address,
         updated_at,
         priority,
         minzoom,
         maxzoom,
         ST_XMin(geom::box2d) AS min_lng,
         ST_YMin(geom::box2d) AS min_lat,
         ST_XMax(geom::box2d) AS max_lng,
         ST_YMax(geom::box2d) AS max_lat
       FROM file_layer_line
       WHERE ($1::timestamp IS NULL OR updated_at > $1)
         AND geom IS NOT NULL
       ORDER BY updated_at`,
      [since],
    );

    return rows.map(
      (r: any): CatalogRow => ({
        id: Number(r.id),
        filename: r.filename,
        accountId: r.account_id == null ? null : Number(r.account_id),
        provinceId: r.province_id == null ? null : Number(r.province_id),
        districtId: r.district_id == null ? null : Number(r.district_id),
        provinceNewId:
          r.province_new_id == null ? null : Number(r.province_new_id),
        wardNewId: r.ward_new_id == null ? null : Number(r.ward_new_id),
        year: Number(r.year),
        status: r.status,
        subAddress: r.sub_address ?? null,
        updatedAt: new Date(r.updated_at),
        minLng: Number(r.min_lng),
        minLat: Number(r.min_lat),
        maxLng: Number(r.max_lng),
        maxLat: Number(r.max_lat),
        priority: r.priority == null ? null : Number(r.priority),
        minzoom: r.minzoom == null ? null : Number(r.minzoom),
        maxzoom: r.maxzoom == null ? null : Number(r.maxzoom),
      }),
    );
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([FileLayerLine]), 
    HttpModule.registerAsync({
          imports: [ConfigModule],
          useFactory: async (configService: ConfigService) => ({
            timeout: configService.get(HTTP_TIMEOUT),
            maxRedirects: configService.get(HTTP_MAX_REDIRECTS),
          }),
          inject: [ConfigService],
        }),
  ],
  controllers: [TileController],
  providers: [
    { provide: CatalogRepository, useClass: PgCatalogRepository },
    FileCatalogService, LocationNewService, CommonService, FileLayerLineService,
    MbtilesReaderService,
    TileService,
  ],
  exports: [TileService, FileCatalogService],
})
export class TileModule {}
