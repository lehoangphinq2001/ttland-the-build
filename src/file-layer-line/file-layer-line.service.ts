/* eslint-disable no-var */
import { Injectable } from '@nestjs/common';
import { CreateFileLayerLineDto } from './dto/create-file-layer-line.dto';
import { UpdateFileLayerLineDto } from './dto/update-file-layer-line.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { FileLayerLine } from 'src/entity/file-layer-line.entity';
import { Repository } from 'typeorm';
import { CommonService } from 'src/common/common.service';

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
    console.log("provinceid", provinceid);
    console.log("district", district);

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
}
