import { PartialType } from '@nestjs/swagger';
import { CreateMbtileDto } from './create-mbtile.dto';

export class UpdateMbtileDto extends PartialType(CreateMbtileDto) {}
