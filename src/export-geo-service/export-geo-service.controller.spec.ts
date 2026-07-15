import { Test, TestingModule } from '@nestjs/testing';
import { ExportGeoServiceController } from './export-geo-service.controller';
import { ExportGeoServiceService } from './export-geo-service.service';

describe('ExportGeoServiceController', () => {
  let controller: ExportGeoServiceController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExportGeoServiceController],
      providers: [ExportGeoServiceService],
    }).compile();

    controller = module.get<ExportGeoServiceController>(ExportGeoServiceController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
