import { Test, TestingModule } from '@nestjs/testing';
import { ExportGpkgController } from './export-gpkg.controller';
import { ExportGpkgService } from './export-gpkg.service';

describe('ExportGpkgController', () => {
  let controller: ExportGpkgController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExportGpkgController],
      providers: [ExportGpkgService],
    }).compile();

    controller = module.get<ExportGpkgController>(ExportGpkgController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
