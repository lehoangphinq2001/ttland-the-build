import { Test, TestingModule } from '@nestjs/testing';
import { ControllerDgnController } from './controller_dgn.controller';
import { ControllerDgnService } from './controller_dgn.service';

describe('ControllerDgnController', () => {
  let controller: ControllerDgnController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ControllerDgnController],
      providers: [ControllerDgnService],
    }).compile();

    controller = module.get<ControllerDgnController>(ControllerDgnController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
