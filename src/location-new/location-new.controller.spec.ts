import { Test, TestingModule } from '@nestjs/testing';
import { LocationNewController } from './location-new.controller';
import { LocationNewService } from './location-new.service';

describe('LocationNewController', () => {
  let controller: LocationNewController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LocationNewController],
      providers: [LocationNewService],
    }).compile();

    controller = module.get<LocationNewController>(LocationNewController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
