import { Test, TestingModule } from '@nestjs/testing';
import { MbtilesController } from './mbtiles.controller';
import { MbtilesService } from './mbtiles.service';

describe('MbtilesController', () => {
  let controller: MbtilesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MbtilesController],
      providers: [MbtilesService],
    }).compile();

    controller = module.get<MbtilesController>(MbtilesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
