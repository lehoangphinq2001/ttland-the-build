import { PartialType } from '@nestjs/swagger';
import { CreateGpkgReaderDto } from './create-gpkg-reader.dto';

export class UpdateGpkgReaderDto extends PartialType(CreateGpkgReaderDto) {}
