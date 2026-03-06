import { Test, TestingModule } from '@nestjs/testing';
import { LocationNewService } from './location-new.service';

describe('LocationNewService', () => {
  let service: LocationNewService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [LocationNewService],
    }).compile();

    service = module.get<LocationNewService>(LocationNewService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
