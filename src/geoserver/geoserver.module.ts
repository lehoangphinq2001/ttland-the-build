import { Module } from '@nestjs/common';
import { GeoserverService } from './geoserver.service';
import { GeoserverController } from './geoserver.controller';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LocationNewService } from 'src/location-new/location-new.service';
import { CommonService } from 'src/common/common.service';
const HTTP_MAX_REDIRECTS = process.env.HTTP_MAX_REDIRECTS;
const HTTP_TIMEOUT = process.env.HTTP_TIMEOUT;

@Module({
  imports: [
    HttpModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        timeout: configService.get(HTTP_TIMEOUT),
        maxRedirects: configService.get(HTTP_MAX_REDIRECTS),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [GeoserverController],
  providers: [GeoserverService, LocationNewService, CommonService],
})
export class GeoserverModule {}
