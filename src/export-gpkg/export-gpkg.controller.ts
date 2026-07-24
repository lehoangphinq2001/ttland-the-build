import {
  Controller,
  Get,
  Post,
  Body,
  Res,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ExportGpkgService } from './export-gpkg.service';
import { Response } from 'express';
import * as fs from 'fs';
import { ApiProperty } from '@nestjs/swagger';
class CreateLineGpkgDto {
  @ApiProperty()
  idtinh: string;

  @ApiProperty()
  idhuyen: string;

  @ApiProperty()
  year: number;
  
  @ApiProperty()
  ssn?: boolean; // true = chỉ lấy bản ghi đã duyệt (ssn=true), tuỳ nghiệp vụ
}
@Controller('export-gpkg')
export class ExportGpkgController {
  constructor(private readonly exportGpkgService: ExportGpkgService) {}

  @Post('line/export-gpkg')
  async exportLineGpkg(@Body() dto: CreateLineGpkgDto, @Res() res: Response) {
    try {
      const { idtinh, idhuyen, year, ssn } = dto;

      if (!idtinh || !idhuyen || !year) {
        throw new HttpException(
          'Thiếu tham số idtinh, idhuyen hoặc year',
          HttpStatus.BAD_REQUEST,
        );
      }

      // build ssnClause tuỳ theo có filter ssn hay không, khớp với chỗ service đang mong đợi
      const ssnClause =
        ssn === undefined
          ? ''
          : ssn
          ? ' AND (l.ssn = true)'
          : ' AND (l.ssn = false OR l.ssn IS NULL)';

      const gpkgPath = await this.exportGpkgService.createLineGpkg(
        { idtinh, idhuyen, year },
        ssnClause,
      );

      if (!gpkgPath) {
        throw new HttpException(
          'Không có dữ liệu phù hợp để xuất file',
          HttpStatus.NOT_FOUND,
        );
      }

      const fileName = `line_${idtinh}_${idhuyen}_${year}.gpkg`;

      res.download(gpkgPath, fileName, (err) => {
        // xoá file tạm sau khi client tải xong (hoặc lỗi), tránh rác trên server
        fs.unlink(gpkgPath, () => {});
        if (err && !res.headersSent) {
          res.status(500).json({ message: 'Lỗi khi tải file' });
        }
      });
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      console.error(error);
      throw new HttpException(
        'Lỗi hệ thống khi xuất file GPKG',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
