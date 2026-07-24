import { Module } from '@nestjs/common';
import { ExportGpkgService } from './export-gpkg.service';
import { ExportGpkgController } from './export-gpkg.controller';

@Module({
  controllers: [ExportGpkgController],
  providers: [ExportGpkgService]
})
export class ExportGpkgModule {}
