import { ApiProperty } from '@nestjs/swagger';

export class CreateGeojsonFIleDto {
  @ApiProperty()
  readonly provinceNewId: string;

  @ApiProperty()
  readonly wardNewId: string;

  @ApiProperty()
  readonly provinceId: string;

  @ApiProperty()
  readonly districtId: string;

  @ApiProperty()
  readonly wardId: string;

  @ApiProperty()
  readonly year: number;
}
