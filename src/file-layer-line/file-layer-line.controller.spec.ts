import { Test, TestingModule } from '@nestjs/testing';
import { FileLayerLineController } from './file-layer-line.controller';
import { FileLayerLineService } from './file-layer-line.service';

describe('FileLayerLineController', () => {
  let controller: FileLayerLineController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FileLayerLineController],
      providers: [FileLayerLineService],
    }).compile();

    controller = module.get<FileLayerLineController>(FileLayerLineController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
