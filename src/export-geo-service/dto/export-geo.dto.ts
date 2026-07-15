import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { ExportFormat } from '../export-geo-service.service';

/**
 * Regex phải khớp với assertCode() trong ExportGeoService.
 * Đây là lớp chặn thứ nhất; service vẫn tự validate lại vì nó có thể
 * được gọi từ job/CLI chứ không chỉ từ HTTP.
 */
const CODE = /^\d{1,10}$/;

export class ExportGeoDto {
  @ApiProperty({ example: '11', description: 'Mã tỉnh trên map_layers' })
  @Matches(CODE, { message: 'idtinh phải là chuỗi số, tối đa 10 ký tự' })
  idtinh: string;

  @ApiProperty({ example: '149', description: 'Mã huyện trên map_layers' })
  @Matches(CODE, { message: 'idhuyen phải là chuỗi số, tối đa 10 ký tự' })
  idhuyen: string;

  @ApiProperty({ example: 2025 })
  @Type(() => Number)
  @IsInt({ message: 'year phải là số nguyên' })
  @Min(1900)
  @Max(2200)
  year: number;

  @ApiPropertyOptional({
    enum: ['gpkg', 'geojson', 'geojsonseq'],
    default: 'gpkg',
    description: 'geojsonseq dùng khi cần nạp tiếp vào tippecanoe',
  })
  @IsOptional()
  @IsIn(['gpkg', 'geojson', 'geojsonseq'])
  format?: ExportFormat;

  @ApiPropertyOptional({
    description: 'Lọc theo cờ sáp nhập. Bỏ trống = không lọc.',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return value; // để IsBoolean bắt lỗi
  })
  @IsBoolean()
  ssn?: boolean;
}

export class DownloadGeoParamsDto {
  @Matches(CODE)
  idtinh: string;

  @Matches(CODE)
  idhuyen: string;

  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(2200)
  year: number;
}