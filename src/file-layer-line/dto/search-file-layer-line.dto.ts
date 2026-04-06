import { PartialType } from '@nestjs/swagger';
import { CreateFileLayerLineDto } from './create-file-layer-line.dto';

export class SearchFileLayerLineDto {
  readonly provinceNewId: string;
  readonly wardNewId: string;

  readonly provinceId: string;
  readonly districtId: string;

  readonly ssn: boolean;
  readonly year: number;
  readonly title: string;
}
