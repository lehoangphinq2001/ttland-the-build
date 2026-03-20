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

@Controller('file-layer-line')
export class FileLayerLineController {
  constructor(private readonly fileLayerLineService: FileLayerLineService) {}

  @Post('delete/:id')
  async delete(@Param('id') id: number) {
    return this.fileLayerLineService.deleteFile(id);
  }
}
