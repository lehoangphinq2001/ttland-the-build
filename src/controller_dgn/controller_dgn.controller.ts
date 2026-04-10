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
import { ExportGeoLineByLocationDto } from './dto/form-export-by-location.dto';

@Controller('controller-dgn')
export class ControllerDgnController {
  constructor(private readonly controllerDgnService: ControllerDgnService) {}

  @Post('export-geojson') // export by wardId
  async exportGeojson(@Body() createControllerDgnDto: CreateGeojsonFIleDto) {
    return this.controllerDgnService.convertDBToMbtilesFile(
      createControllerDgnDto,
    );
  }

  @Post('export-muti/new/:provinceNewId') // export by wardId New
  async exportMutiFileByProvinceNew(
    @Param('provinceNewId') provinceNewId: string,
  ) {
    return this.controllerDgnService.runExportDataByProvinceNewId(
      provinceNewId,
    );
  }

  @Post('export-muti/old/:provinceOldId') // export by wardId Old
  async exportMutiFile(@Param('provinceOldId') provinceOldId: string) {
    return this.controllerDgnService.runExportDataByProvinceOldId(
      provinceOldId,
    );
  }

  @Post('export-geoline') // export by wardId Old
  async exportGeoLineByLocation(@Body() dto: ExportGeoLineByLocationDto) {
    return this.controllerDgnService.createGeoLineByForm(dto);
  }

  // =====================================================
  // =====================================================

  @Post('update-geom') // export by wardId Old
  async updateGeom() {
    return this.controllerDgnService.updateAllBboxGeoLineNull();
  }
}
