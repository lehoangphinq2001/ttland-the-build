import { PartialType } from '@nestjs/swagger';
import { CreateTileDto } from './create-tile.dto';

export class UpdateTileDto extends PartialType(CreateTileDto) {}
