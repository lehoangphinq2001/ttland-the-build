import { Test, TestingModule } from '@nestjs/testing';
import { FileLayerLineService } from './file-layer-line.service';

describe('FileLayerLineService', () => {
  let service: FileLayerLineService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FileLayerLineService],
    }).compile();

    service = module.get<FileLayerLineService>(FileLayerLineService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
