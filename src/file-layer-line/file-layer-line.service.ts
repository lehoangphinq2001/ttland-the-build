/* eslint-disable prettier/prettier */
/* eslint-disable no-var */
import { Injectable } from '@nestjs/common';
import { CreateFileLayerLineDto } from './dto/create-file-layer-line.dto';
import { SearchFileLayerLineDto } from './dto/search-file-layer-line.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { FileLayerLine } from 'src/entity/file-layer-line.entity';
import { ILike, Repository } from 'typeorm';
import { CommonService } from 'src/common/common.service';
import { SAVE_FILE } from 'src/common/common.constant';
import { unlink, rename } from 'node:fs/promises';

@Injectable()
export class FileLayerLineService {
  constructor(
    @InjectRepository(FileLayerLine)
    private repository: Repository<FileLayerLine>,

    private commonService: CommonService,
  ) {}

  async getDataLayerInLocationNew(provinceid: string, wardid: string) {
    var data = await this.repository.find({
      select: {
        fullname: true,
        filename: true,
        year: true,
      },
      where: { provinceNewId: provinceid, wardNewId: wardid },
      order: { year: 'ASC' },
    });
    return this.commonService._checkArray(data);
  }

  async getDataLayerInLocationOld(provinceid: string, district: string) {
    var data = await this.repository.find({
      select: {
        fullname: true,
        filename: true,
        year: true,
      },
      where: { provinceId: provinceid, districtId: district },
      order: { year: 'ASC' },
    });
    return this.commonService._checkArray(data);
  }

  // ===================================================
  // ===================================================
  async managerSearchForm(dto: SearchFileLayerLineDto) {
    const {
      districtId,
      title,
      provinceId,
      provinceNewId,
      wardNewId,
      ssn,
      year,
    } = dto;

    // Xây dựng điều kiện where động
    const where: any = {};

    // Các trường lọc chính xác (equality)
    if (districtId !== undefined && districtId !== null) {
      where.districtId = districtId;
    }
    if (provinceId !== undefined && provinceId !== null) {
      where.provinceId = provinceId;
    }
    if (provinceNewId !== undefined && provinceNewId !== null) {
      where.provinceNewId = provinceNewId;
    }
    if (wardNewId !== undefined && wardNewId !== null) {
      where.wardNewId = wardNewId;
    }
    if (year !== undefined && year !== null) {
      where.year = year;
    }

    // Tìm kiếm gần đúng với LIKE (không phân biệt hoa thường)
    if (title?.trim()) {
      where.title = ILike(`%${title.trim()}%`);
    }
    if (ssn) {
      where.ssn = ssn;
    }

    const rs = await this.repository.find({
      where,
      order: { updated_at: 'DESC' },
      // Có thể thêm relations nếu cần sau này
      // relations: ['someRelation'],
    });

    return this.commonService._checkArray(rs);
  }
  
  async deleteFile(id: number) {
    try {
      var data = await this.repository.findOne({
        where: { id: id },
      });

      if (data) {
        await this.repository.delete(id);

        // remove geojson
        await unlink(data.fullname);

        // remove mbtiles
        await unlink(SAVE_FILE.DGN_FILE + data.filename);
      }
      return { success: true };
    } catch (error) {
      console.log('error', error.message);
      return { success: true };
    }
  }
}
