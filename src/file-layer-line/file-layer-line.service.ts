/* eslint-disable prettier/prettier */
/* eslint-disable no-var */
import { Injectable } from '@nestjs/common';
import { CreateFileLayerLineDto } from './dto/create-file-layer-line.dto';
import { UpdateFileLayerLineDto } from './dto/update-file-layer-line.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { FileLayerLine } from 'src/entity/file-layer-line.entity';
import { Repository } from 'typeorm';
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
