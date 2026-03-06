// security-log.service.ts
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class SecurityLogService {
  constructor(private readonly dataSource: DataSource) {}

  async logAttackIp(ip: string, reason: string, path: string) {
    try {
      await this.dataSource.query(
        `
        INSERT INTO blocked_ip_logs (ip, reason, path, source)
        VALUES (@0, @1, @2, @3)
        `,
        [ip, reason, path, 'api-dgn'],
      );
    } catch (err) {
      // KHÔNG throw
      console.error('[SECURITY][LOG_FAIL]', err.message);
    }
  }
}
