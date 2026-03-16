import { Test, TestingModule } from '@nestjs/testing';
import { GeoserverService } from './geoserver.service';

describe('GeoserverService', () => {
  let service: GeoserverService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [GeoserverService],
    }).compile();

    service = module.get<GeoserverService>(GeoserverService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
