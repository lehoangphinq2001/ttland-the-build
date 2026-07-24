import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Query,
  Post,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { createReadStream } from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  ExportFormat,
  ExportGeoServiceService,
  ExportResult
} from './export-geo-service.service';
import { ExportGeoDto, DownloadGeoParamsDto } from './dto/export-geo.dto';
import { SAVE_FILE } from 'src/common/common.constant';

type JobState = 'running' | 'done' | 'failed';

interface Job {
  id: string;
  state: JobState;
  spec: ExportGeoDto;
  startedAt: number;
  finishedAt?: number;
  result?: ExportResult;
  error?: string;
}

const EXT: Record<ExportFormat, string> = {
  gpkg: '.gpkg',
  geojson: '.geojson',
  geojsonseq: '.geojsonl',
};

const MIME: Record<ExportFormat, string> = {
  gpkg: 'application/geopackage+sqlite3',
  geojson: 'application/geo+json',
  geojsonseq: 'application/geo+json-seq',
};

/** Giữ job trong bộ nhớ 1 giờ sau khi xong rồi dọn. */
const JOB_TTL_MS = 60 * 60 * 1000;

@ApiTags('export-geo')
@Controller('export-geo')
export class ExportGeoServiceController {
  private readonly logger = new Logger(ExportGeoServiceController.name);

  /**
   * Job registry in-memory.
   * Hạn chế: chết theo process, không chia sẻ giữa các instance khi chạy
   * pm2 cluster / nhiều pod. Khi cần scale ngang thì thay bằng BullMQ + Redis —
   * interface của controller giữ nguyên.
   */
  private readonly jobs = new Map<string, Job>();

  /** regionKey -> jobId. Chặn build trùng cùng một vùng. */
  private readonly inFlight = new Map<string, string>();

  constructor(private readonly exportGeo: ExportGeoServiceService) {}

  // ==========================================================
  // Build
  // ==========================================================

  @Post('build')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Khởi tạo file GPKG/GeoJSON cho một huyện',
    description:
      'Trả về ngay 202 kèm jobId. ogr2ogr có thể chạy tới 15 phút nên không await trong request. ' +
      'Poll GET /export-geo/jobs/{jobId} để lấy kết quả.',
  })
  build(@Body() dto: ExportGeoDto) {
    const format = dto.format ?? 'gpkg';
    const key = this.regionKey(dto, format);

    // Nếu vùng này đang build thì trả lại job cũ, không spawn thêm ogr2ogr.
    const running = this.inFlight.get(key);
    if (running) {
      return {
        success: true,
        jobId: running,
        state: 'running' as JobState,
        message: 'Vùng này đang được build, dùng lại job hiện có',
        pollUrl: `/export-geo/jobs/${running}`,
      };
    }

    const job: Job = {
      id: randomUUID(),
      state: 'running',
      spec: dto,
      startedAt: Date.now(),
    };
    this.jobs.set(job.id, job);
    this.inFlight.set(key, job.id);

    // Cố tình không await: request trả về ngay.
    // void + catch đầy đủ để không sinh unhandled rejection.
    void this.exportGeo
      .export({ ...dto, format }, SAVE_FILE.DGN_FILE)
      .then((result) => {
        job.state = 'done';
        job.result = result;
      })
      .catch((err) => {
        job.state = 'failed';
        job.error = err?.message ?? String(err);
        this.logger.error(`Job ${job.id} thất bại (${key}): ${job.error}`);
      })
      .finally(() => {
        job.finishedAt = Date.now();
        this.inFlight.delete(key);
        this.scheduleCleanup(job.id);
      });

    return {
      success: true,
      jobId: job.id,
      state: job.state,
      pollUrl: `/export-geo/jobs/${job.id}`,
    };
  }

  // ==========================================================
  // Trạng thái job
  // ==========================================================

  @Get('jobs/:jobId')
  @ApiOperation({ summary: 'Trạng thái của một job build' })
  getJob(@Param('jobId') jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new NotFoundException(
        `Không tìm thấy job ${jobId} (có thể đã quá hạn ${JOB_TTL_MS / 60000} phút hoặc service đã restart)`,
      );
    }

    const elapsedMs = (job.finishedAt ?? Date.now()) - job.startedAt;

    if (job.state === 'failed') {
      return { success: false, jobId, state: job.state, elapsedMs, error: job.error };
    }
    if (job.state === 'running') {
      return { success: true, jobId, state: job.state, elapsedMs };
    }

    const r = job.result!;
    return {
      success: true,
      jobId,
      state: job.state,
      elapsedMs,
      data: {
        fileName: r.fileName,
        format: r.format,
        featureCount: r.featureCount,
        sourceSrid: r.sourceSrid,
        bbox: r.bbox,
        sizeBytes: r.sizeBytes,
        downloadUrl: `/export-geo/download/${job.spec.idtinh}/${job.spec.idhuyen}/${job.spec.year}?format=${r.format}`,
      },
    };
  }

  @Get('jobs')
  @ApiOperation({ summary: 'Danh sách job đang giữ trong bộ nhớ' })
  listJobs() {
    const data = [...this.jobs.values()]
      .sort((a, b) => b.startedAt - a.startedAt)
      .map((j) => ({
        jobId: j.id,
        state: j.state,
        idtinh: j.spec.idtinh,
        idhuyen: j.spec.idhuyen,
        year: j.spec.year,
        startedAt: new Date(j.startedAt).toISOString(),
        elapsedMs: (j.finishedAt ?? Date.now()) - j.startedAt,
        featureCount: j.result?.featureCount,
        error: j.error,
      }));
    return { success: true, data };
  }

  // ==========================================================
  // Download
  // ==========================================================

  @Get('download/:idtinh/:idhuyen/:year')
  @ApiOperation({ summary: 'Tải file đã build' })
  async download(
    @Param() params: DownloadGeoParamsDto,
    @Query('format') formatRaw: string | undefined,
    @Res() res: Response,
  ) {
    const format = (formatRaw ?? 'gpkg') as ExportFormat;
    if (!(format in EXT)) {
      throw new BadRequestException(
        `format không hợp lệ: ${formatRaw}. Chọn: ${Object.keys(EXT).join(', ')}`,
      );
    }

    const fileName = `${params.idtinh}_${params.idhuyen}_${params.year}${EXT[format]}`;
    const root = path.resolve(SAVE_FILE.DGN_FILE);
    const filePath = path.resolve(root, fileName);

    // params đã qua regex ^\d{1,10}$ nên không thể chứa '..',
    // nhưng vẫn chặn lần nữa: rẻ, và bảo vệ khi regex bị nới lỏng sau này.
    if (filePath !== path.join(root, fileName)) {
      throw new BadRequestException('Đường dẫn không hợp lệ');
    }

    let size: number;
    try {
      const stat = await fsp.stat(filePath);
      if (!stat.isFile()) throw new Error('not a file');
      size = stat.size;
    } catch {
      throw new NotFoundException(
        `Chưa có file ${fileName}. Gọi POST /export-geo/build trước.`,
      );
    }

    res.set({
      'Content-Type': MIME[format],
      'Content-Length': String(size),
      'Content-Disposition': `attachment; filename="${fileName}"`,
      // File deterministic theo vùng nhưng bị ghi đè mỗi lần build lại,
      // nên không đặt immutable. mtime+size là đủ để phát hiện thay đổi.
      'Cache-Control': 'private, no-cache',
    });

    const stream = createReadStream(filePath);
    stream.on('error', (err) => {
      this.logger.error(`Lỗi đọc ${fileName}: ${err.message}`);
      if (!res.headersSent) res.status(500).json({ error: 'Không đọc được file' });
      else res.destroy();
    });
    stream.pipe(res);
  }

  // ==========================================================
  // Nội bộ
  // ==========================================================
  private regionKey(dto: ExportGeoDto, format: ExportFormat): string {
    return `${dto.idtinh}_${dto.idhuyen}_${dto.year}_${format}_${dto.ssn ?? 'any'}`;
  }
  private scheduleCleanup(jobId: string): void {
    // unref() để timer không giữ event loop khi app muốn thoát.
    setTimeout(() => this.jobs.delete(jobId), JOB_TTL_MS).unref();
  }
}