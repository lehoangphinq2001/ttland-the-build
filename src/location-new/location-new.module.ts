/* eslint-disable prettier/prettier */
import { Module } from '@nestjs/common';
import { LocationNewService } from './location-new.service';
import { LocationNewController } from './location-new.controller';
import { CommonService } from 'src/common/common.service';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
const HTTP_MAX_REDIRECTS = process.env.HTTP_MAX_REDIRECTS;
const HTTP_TIMEOUT = process.env.HTTP_TIMEOUT;

@Module({
    imports: [
      HttpModule.registerAsync({
        imports: [ConfigModule],
        useFactory: async (configService: ConfigService) => ({
          timeout: configService.get(HTTP_TIMEOUT),
          maxRedirects: configService.get(HTTP_MAX_REDIRECTS),
        }), inject: [ConfigService],
      }),
    ],
  controllers: [LocationNewController],
  providers: [LocationNewService, CommonService],
})
export class LocationNewModule {}
