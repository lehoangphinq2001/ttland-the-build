import { Test, TestingModule } from '@nestjs/testing';
import { ControllerDgnService } from './controller_dgn.service';

describe('ControllerDgnService', () => {
  let service: ControllerDgnService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ControllerDgnService],
    }).compile();

    service = module.get<ControllerDgnService>(ControllerDgnService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
