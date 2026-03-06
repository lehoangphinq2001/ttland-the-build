import { Test, TestingModule } from '@nestjs/testing';
import { MbtilesService } from './mbtiles.service';

describe('MbtilesService', () => {
  let service: MbtilesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MbtilesService],
    }).compile();

    service = module.get<MbtilesService>(MbtilesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
