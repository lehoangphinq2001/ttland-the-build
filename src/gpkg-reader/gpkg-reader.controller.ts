import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { GpkgReaderService } from './gpkg-reader.service';

@Controller('gpkg-reader')
export class GpkgReaderController {
  constructor(private readonly gpkgReaderService: GpkgReaderService) {}

}
