/* eslint-disable prettier/prettier */
import { Module } from '@nestjs/common';
import { MbtilesService } from './mbtiles.service';
import { MbtilesController } from './mbtiles.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { CommonService } from 'src/common/common.service';
import { LocationNewService } from 'src/location-new/location-new.service';
import { Redis } from 'ioredis';
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
  controllers: [MbtilesController],
  exports: ['REDIS'],
  providers: [
    {
      provide: 'REDIS',
      useFactory: () => {
        return new Redis({
          host: '127.0.0.1',
          port: 6379,
          maxRetriesPerRequest: 3,
        });
      },
    },
    MbtilesService, CommonService]
})
export class MbtilesModule { }
