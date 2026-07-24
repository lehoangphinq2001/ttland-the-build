import { Test, TestingModule } from '@nestjs/testing';
import { GpkgReaderService } from './gpkg-reader.service';

describe('GpkgReaderService', () => {
  let service: GpkgReaderService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GpkgReaderService],
    }).compile();

    service = module.get<GpkgReaderService>(GpkgReaderService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
