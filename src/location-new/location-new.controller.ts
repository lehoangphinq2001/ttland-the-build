/* eslint-disable prettier/prettier */
/* eslint-disable no-var */
import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { LocationNewService } from './location-new.service';
import { CommonService } from 'src/common/common.service';
import { SearchTextLocationNewDto } from './dto/search-text-location-new.dto';

@Controller('location-new')
export class LocationNewController {
  constructor(
    private readonly locationNewService: LocationNewService,
    private readonly commonService: CommonService,
  ) { }
}
