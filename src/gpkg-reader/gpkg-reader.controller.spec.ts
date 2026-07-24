import { Test, TestingModule } from '@nestjs/testing';
import { GpkgReaderController } from './gpkg-reader.controller';
import { GpkgReaderService } from './gpkg-reader.service';

describe('GpkgReaderController', () => {
  let controller: GpkgReaderController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GpkgReaderController],
      providers: [GpkgReaderService],
    }).compile();

    controller = module.get<GpkgReaderController>(GpkgReaderController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
