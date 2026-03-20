/* eslint-disable prettier/prettier */
import { Injectable, NestMiddleware, ForbiddenException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { blockedIps } from './blocked-ips';

@Injectable()
export class SecurityMiddleware implements NestMiddleware {
  private requestsPerIp = new Map<
    string,
    { count: number; timestamp: number }
  >();
  private readonly limit = 1000;
  private readonly windowMs = 60 * 1000;
  private readonly rateLimit = 550;
  private readonly openRoutes = ['/v1/mbtiles/', '/v1/tiles/'];

  private readonly allowedDomains: string[] = [
    'quyhoach.thongtin.land',
    'dev3.thongtin.land',
  ];

  private readonly allowedDomainSuffix = '.thongtin.land';

  private readonly mobileAppSecret: string =
    process.env.MOBILE_APP_SECRET || 'your-secret-key-here';

  private readonly blockedPatterns: RegExp[] = [
    /\.env/i,
    /\.php/i,
    /\.aspx/i,
    /\.jsp/i,
    /\.html/i,
    /\.htm/i,
    /\.\.\//,
    /%2f/i,
    /%252f/i,
    /\/@fs\//i,
    /\/root\//i,
    /\/app\//i,
    /\/config/i,
    /\/login/i,
    /\/register/i,
    /\/index/i,
    /\/admin/i,
    /\/system/i,
    /\/public/i,
    /\/api\/.*config/i,
    /proc\/self\/environ/i,
  ];

  private extractHostname(url: string): string | null {
    try {
      return new URL(url).hostname;
    } catch {
      return null;
    }
  }

  private isAllowedDomain(hostname: string): boolean {
    if (this.allowedDomains.includes(hostname)) return true;
    if (hostname.endsWith(this.allowedDomainSuffix)) return true;
    return false;
  }

  private isAllowedMobileApp(req: Request): boolean {
    const appSecret = req.headers['x-app-secret'] as string | undefined;
    return appSecret === this.mobileAppSecret;
  }

  use(req: Request, res: Response, next: NextFunction): void {
    const ip =
      (req.headers['x-forwarded-for'] as string) ||
      req.socket.remoteAddress ||
      '';

    if (
      req.path.startsWith('/v1/mbtiles/') ||
      req.path.startsWith('/v1/tiles/')
    ) {
      next();
      return;
    }

    const origin = req.headers['origin'] as string | undefined;
    const referer = req.headers['referer'] as string | undefined;
    const sourceUrl = origin || referer;

    if (sourceUrl) {
      const hostname = this.extractHostname(sourceUrl);
      if (!hostname || !this.isAllowedDomain(hostname)) {
        throw new ForbiddenException('Access denied: Domain not allowed');
      }
    } else {
      if (!this.isAllowedMobileApp(req)) {
        throw new ForbiddenException('Access denied: Unauthorized client');
      }
    }

    for (const pattern of this.blockedPatterns) {
      if (pattern.test(req.url)) {
        blockedIps.add(ip);
        throw new ForbiddenException('Access denied: Suspicious URL');
      }
    }

    if (blockedIps.has(ip)) {
      throw new ForbiddenException('Access denied');
    }

    const now = Date.now();
    const record = this.requestsPerIp.get(ip);

    if (!record || now - record.timestamp > this.windowMs) {
      this.requestsPerIp.set(ip, { count: 1, timestamp: now });
    } else {
      record.count++;
      if (record.count > this.limit) {
        blockedIps.add(ip);
        throw new ForbiddenException('Access denied: Too many requests');
      }
    }

    if (!this.openRoutes.some((route) => req.path.startsWith(route))) {
      if (record && record.count > this.rateLimit) {
        res
          .status(429)
          .json({ message: 'Too many requests, please try again later.' });
        return;
      }
    }

    next();
  }
}
