import { Module } from '@nestjs/common';
import { TilesService, REDIS_CLIENT } from './tiles.service';
import { TilesController } from './tiles.controller';
import { CacheModule } from '@nestjs/cache-manager';
import { getRedisConnectionToken } from '@nestjs-modules/ioredis';
import { LocationNewService } from 'src/location-new/location-new.service';
import { FileLayerLineService } from 'src/file-layer-line/file-layer-line.service';
import { CommonService } from 'src/common/common.service';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { FileLayerLine } from 'src/entity/file-layer-line.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
const HTTP_MAX_REDIRECTS = process.env.HTTP_MAX_REDIRECTS;
const HTTP_TIMEOUT = process.env.HTTP_TIMEOUT;
import { Redis } from 'ioredis';

@Module({
  imports: [
    TypeOrmModule.forFeature([FileLayerLine]),
    CacheModule.register({
      ttl: 3600, // 1 hour
      max: 1000, // ~80MB RAM for rendered PNGs
    }),
    HttpModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        timeout: configService.get(HTTP_TIMEOUT),
        maxRedirects: configService.get(HTTP_MAX_REDIRECTS),
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [TilesController],
  exports: ['REDIS'],
  providers: [
    TilesService,
    LocationNewService,
    FileLayerLineService,
    CommonService,
    // {
    //   // useFactory + inject pulls the Redis instance already registered
    //   // in a parent/global module — no need to re-import IoRedisModule here.
    //   provide: REDIS_CLIENT,
    //   useFactory: (redis: Redis) => redis,
    //   inject: [getRedisConnectionToken()], // resolves 'default_IORedisModuleConnectionToken'
    // },
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
  ],
})
export class TilesModule {}
