import { Module } from '@nestjs/common';
import { ExportGeoServiceService } from './export-geo-service.service';
import { ExportGeoServiceController } from './export-geo-service.controller';

@Module({
  controllers: [ExportGeoServiceController],
  providers: [ExportGeoServiceService]
})
export class ExportGeoServiceModule {}
