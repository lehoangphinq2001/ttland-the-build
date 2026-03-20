import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class LogIpMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const ip = (req.ip || '').replace('::ffff:', '');

    console.log(`
===== REQUEST DEBUG =====
IP: ${ip}
Path: ${req.originalUrl}
User-Agent: ${req.headers['user-agent']}
x-forwarded-for: ${req.headers['x-forwarded-for']}
x-real-ip: ${req.headers['x-real-ip']}
Time: ${new Date().toISOString()}
=========================
`);

    next();
  }
}
