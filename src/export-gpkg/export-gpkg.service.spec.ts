import { Test, TestingModule } from '@nestjs/testing';
import { ExportGpkgService } from './export-gpkg.service';

describe('ExportGpkgService', () => {
  let service: ExportGpkgService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ExportGpkgService],
    }).compile();

    service = module.get<ExportGpkgService>(ExportGpkgService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
