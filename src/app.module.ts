import CorsMiddleware, { RequestMethod } from '@nestjs/common';
/* eslint-disable prettier/prettier */
import { JwtModule } from '@nestjs/jwt';
import { MulterModule } from '@nestjs/platform-express';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { AUTH_TOKEN_EXPIRATION } from './common/common.constant';
import { MbtilesModule } from './mbtiles/mbtiles.module';
import { LocationNewModule } from './location-new/location-new.module';
import { SecurityMiddleware } from './common/ip-block.middleware';
import { LogIpMiddleware } from './common/log-ip.middleware';
import { ControllerDgnModule } from './controller_dgn/controller_dgn.module';
import { FileLayerLineModule } from './file-layer-line/file-layer-line.module';
import { TilesModule } from './tiles/tiles.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    
      EventEmitterModule.forRoot(),
      MulterModule.registerAsync({
        useFactory: () => ({
          dest: join(__dirname, '..', 'upload'),
        }),
      }),
    JwtModule.register({
      secret: process.env.AUTH_SECRET || 'P5f3Y--qtymBT53S-6gZ?=Tb_ngB72jYeK$',
      signOptions: { expiresIn: AUTH_TOKEN_EXPIRATION },
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'upload'),
    }),
    

    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DATABASE_HOST,
      port: 5432,
      username: process.env.USERNAME_DATABASE,
      password: process.env.PASSWORD_DATABASE,
      database: process.env.DATABASE_NAME,
      autoLoadEntities: true,
      entities: [__dirname + '/**/*.entity{.ts,.js}'],
      synchronize: true,
    }),
    JwtModule,
    MbtilesModule,
    LocationNewModule,
    ControllerDgnModule,
    FileLayerLineModule,
    TilesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
// export class AppModule {}

// export class AppModule implements NestModule {
//   configure(consumer: MiddlewareConsumer) {
//     consumer.apply(SecurityMiddleware).forRoutes('*'); // áp dụng cho tất cả routes
//   }
// }

export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(SecurityMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL }); // áp dụng cho tất cả routes
  }
}