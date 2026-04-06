import { ApiProperty } from '@nestjs/swagger';

export class ExportGeoLineByLocationDto {
  @ApiProperty()
  readonly provinceNewId: string;

  @ApiProperty()
  readonly wardNewId: string;

  @ApiProperty()
  readonly provinceId: string;

  @ApiProperty()
  readonly districtId: string;

  @ApiProperty()
  readonly ssn: boolean;
}
