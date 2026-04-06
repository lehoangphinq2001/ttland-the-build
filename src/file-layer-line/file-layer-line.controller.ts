import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { FileLayerLineService } from './file-layer-line.service';
import { SearchFileLayerLineDto } from './dto/search-file-layer-line.dto';

@Controller('file-layer-line')
export class FileLayerLineController {
  constructor(private readonly fileLayerLineService: FileLayerLineService) {}

  @Post('admin/search-form')
  async adSearchForm(@Body() dto: SearchFileLayerLineDto) {
    return this.fileLayerLineService.managerSearchForm(dto);
  }

  @Post('admin/delete/:id')
  async delete(@Param('id') id: number) {
    return this.fileLayerLineService.deleteFile(id);
  }
}
