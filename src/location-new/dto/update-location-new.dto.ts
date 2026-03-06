import { PartialType } from '@nestjs/swagger';
import { CreateLocationNewDto } from './create-location-new.dto';

export class UpdateLocationNewDto extends PartialType(CreateLocationNewDto) {}
