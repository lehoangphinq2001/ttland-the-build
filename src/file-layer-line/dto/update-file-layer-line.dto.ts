import { PartialType } from '@nestjs/swagger';
import { CreateFileLayerLineDto } from './create-file-layer-line.dto';

export class UpdateFileLayerLineDto extends PartialType(CreateFileLayerLineDto) {}
