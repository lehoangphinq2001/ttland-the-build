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
import { CreateFileLayerLineDto } from './dto/create-file-layer-line.dto';
import { UpdateFileLayerLineDto } from './dto/update-file-layer-line.dto';

@Controller('file-layer-line')
export class FileLayerLineController {
  constructor(private readonly fileLayerLineService: FileLayerLineService) {}

  @Post('delete/:id')
  async delete(@Param('id') id: number) {
    return this.fileLayerLineService.deleteFile(id);
  }
}
