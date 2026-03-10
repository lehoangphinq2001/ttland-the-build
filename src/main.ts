/* eslint-disable prettier/prettier */
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as bodyParser from 'body-parser';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';

async function bootstrap() {
  const app = await NestFactory.create(
    AppModule, 
    { cors: true }, 
  );
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set('trust proxy', true); // cho phép đọc IP từ X-Forwarded-For
  
  app.enableCors();
  app.useGlobalPipes(new ValidationPipe());
  app.setGlobalPrefix('v1');

  app.use(bodyParser.json({limit: '1GB'}));
  app.use(bodyParser.urlencoded({limit: '1GB', extended: true}));

  app.use((req, res, next) => {
    res.setTimeout(10999999, () => {
      res.status(408).send('Request timed out');
    });
    next();
  });

  const config = new DocumentBuilder()
    .setTitle('SMARTGIS DATA API')
    .setDescription('API Gateway for SMARTGIS')
    .setVersion('SAG.v.0.1')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  await app.listen(process.env.HTTP_PORT);
  Logger.log(`User service is running in port ${process.env.HTTP_PORT}`);
}
bootstrap();
