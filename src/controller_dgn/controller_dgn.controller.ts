import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { ControllerDgnService } from './controller_dgn.service';
import { CreateGeojsonFIleDto } from './dto/create-file-json.dto';

@Controller('controller-dgn')
export class ControllerDgnController {
  constructor(private readonly controllerDgnService: ControllerDgnService) {}

  @Post('export-geojson') // export by wardId
  async exportGeojson(@Body() createControllerDgnDto: CreateGeojsonFIleDto) {
    return this.controllerDgnService.convertDBToMbtilesFile(
      createControllerDgnDto,
    );
  }

  @Post('export-muti/:provinceId') // export by wardId
  async exportMutiFile(@Param('provinceId') provinceId: string) {
    return this.controllerDgnService.runExportDataByProvinceNewId(provinceId);
  }
}
