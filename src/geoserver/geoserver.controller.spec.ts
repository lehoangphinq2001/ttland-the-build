import { Test, TestingModule } from '@nestjs/testing';
import { GeoserverController } from './geoserver.controller';
import { GeoserverService } from './geoserver.service';

describe('GeoserverController', () => {
  let controller: GeoserverController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [GeoserverController],
      providers: [GeoserverService],
    }).compile();

    controller = module.get<GeoserverController>(GeoserverController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
