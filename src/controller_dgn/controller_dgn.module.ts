import { Module } from '@nestjs/common';
import { ControllerDgnService } from './controller_dgn.service';
import { ControllerDgnController } from './controller_dgn.controller';
import { CommonService } from 'src/common/common.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FileLayerLine } from 'src/entity/file-layer-line.entity';

@Module({
  imports: [TypeOrmModule.forFeature([FileLayerLine])],
  controllers: [ControllerDgnController],
  providers: [ControllerDgnService, CommonService],
})
export class ControllerDgnModule {}
