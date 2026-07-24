import { Module } from '@nestjs/common';
import { GpkgReaderService } from './gpkg-reader.service';
import { GpkgReaderController } from './gpkg-reader.controller';

@Module({
  controllers: [GpkgReaderController],
  providers: [GpkgReaderService]
})
export class GpkgReaderModule {}
