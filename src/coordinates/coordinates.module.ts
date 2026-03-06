import { Module } from '@nestjs/common';
import { CoordinatesService } from './coordinates.service';
import { CoordinatesController } from './coordinates.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonService } from 'src/common/common.service';

@Module({
  imports: [

  ],
  controllers: [CoordinatesController],
  providers: [CoordinatesService, CommonService],
})
export class CoordinatesModule {}
