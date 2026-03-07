import { Module } from '@nestjs/common';
import { FileLayerLineService } from './file-layer-line.service';
import { FileLayerLineController } from './file-layer-line.controller';
import { CommonService } from 'src/common/common.service';
import { FileLayerLine } from 'src/entity/file-layer-line.entity';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [TypeOrmModule.forFeature([FileLayerLine])],
  controllers: [FileLayerLineController],
  providers: [FileLayerLineService, CommonService],
})
export class FileLayerLineModule {}
