import { PartialType } from '@nestjs/swagger';
import { CreateExportGpkgDto } from './create-export-gpkg.dto';

export class UpdateExportGpkgDto extends PartialType(CreateExportGpkgDto) {}
