import { PartialType } from '@nestjs/swagger';
import { CreateGeoserverDto } from './create-geoserver.dto';

export class UpdateGeoserverDto extends PartialType(CreateGeoserverDto) {}
