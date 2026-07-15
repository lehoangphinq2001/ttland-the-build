import { Test, TestingModule } from '@nestjs/testing';
import { ExportGeoServiceService } from './export-geo-service.service';

describe('ExportGeoServiceService', () => {
  let service: ExportGeoServiceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ExportGeoServiceService],
    }).compile();

    service = module.get<ExportGeoServiceService>(ExportGeoServiceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
