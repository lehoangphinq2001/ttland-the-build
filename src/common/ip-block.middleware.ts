// import { Injectable, NestMiddleware, ForbiddenException } from '@nestjs/common';
// import { Request, Response, NextFunction } from 'express';
// import { blockedIps } from './blocked-ips';

// @Injectable()
// export class SecurityMiddleware implements NestMiddleware {
//   private requestsPerIp = new Map<
//     string,
//     { count: number; timestamp: number }
//   >();
//   private readonly limit = 200; // số request tối đa
//   private readonly windowMs = 60 * 1000; // 1 phút
//   private readonly rateLimit = 220; // giới hạn chung cho API
//   private readonly openRoutes = ['/v1/mbtiles/', '/api/health']; // ngoại lệ

//   // Các pattern URL nguy hiểm cần chặn
//   private readonly blockedPatterns: RegExp[] = [
//     /\.env/i,
//     /\.php/i,
//     /proc\/self\/environ/i,
//     /\/@fs\//i,
//     /\.\.\//,
//     /%2f/i, // path traversal
//     /%252f/i, // encoded slash
//     /\/root\//i,
//     /\/app\//i,
//   ]; // double encoded slash

//   use(req: Request, res: Response, next: NextFunction) {
//     const ip =
//       (req.headers['x-forwarded-for'] as string) ||
//       req.socket.remoteAddress ||
//       '';

//     // 🚫 Ngoại trừ route mbtiles/:z/:x/:y
//     if (req.path.startsWith('/v1/mbtiles/')) {
//       return next(); // bỏ qua middleware cho route này
//     }

//     // 2. Kiểm tra URL bất thường
//     for (const pattern of this.blockedPatterns) {
//       if (pattern.test(req.url)) {
//         blockedIps.add(ip); // tự động thêm IP vào danh sách chặn
//         throw new ForbiddenException('Access denied: Suspicious URL');
//       }
//     }

//     // 1. Kiểm tra danh sách chặn
//     if (blockedIps.has(ip)) {
//       throw new ForbiddenException('Access denied');
//     }

//     // 3. Theo dõi số request để tự động chặn
//     const now = Date.now();
//     const record = this.requestsPerIp.get(ip);

//     if (!record || now - record.timestamp > this.windowMs) {
//       this.requestsPerIp.set(ip, { count: 1, timestamp: now });
//     } else {
//       record.count++;
//       if (record.count > this.limit) {
//         blockedIps.add(ip); // thêm vào danh sách chặn
//         throw new ForbiddenException('Access denied: Too many requests');
//       }
//     }

//     // 3. Rate limit cho API (ngoại trừ openRoutes)
//     if (!this.openRoutes.includes(req.path)) {
//       if (record && record.count > this.rateLimit) {
//         res
//           .status(429)
//           .json({ message: 'Too many requests, please try again later.' });
//         return;
//       }
//     }

//     next();
//   }
// }

import { Injectable, NestMiddleware, ForbiddenException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { blockedIps } from './blocked-ips';

@Injectable()
export class SecurityMiddleware implements NestMiddleware {
  private requestsPerIp = new Map<
    string,
    { count: number; timestamp: number }
  >();
  private readonly limit = 200;
  private readonly windowMs = 60 * 1000;
  private readonly rateLimit = 220;
  private readonly openRoutes = ['/v1/mbtiles/', '/api/health'];

  // Các pattern URL nguy hiểm cần chặn ngay
  private readonly blockedPatterns: RegExp[] = [
    // File nhạy cảm
    /\.env/i,
    /\.php/i,
    /\.aspx/i,
    /\.jsp/i,
    /\.html/i,
    /\.htm/i,

    // Path traversal / encoded
    /\.\.\//,
    /%2f/i,
    /%252f/i,

    // Thư mục nhạy cảm
    /\/@fs\//i,
    /\/root\//i,
    /\/app\//i,
    /\/config/i,

    // Các endpoint thường bị scan
    /\/login/i,
    /\/register/i,
    /\/index/i,
    /\/admin/i,
    /\/system/i,
    /\/public/i,
    /\/api\/.*config/i,
    /proc\/self\/environ/i,
  ];

  use(req: Request, res: Response, next: NextFunction) {
    const ip =
      (req.headers['x-forwarded-for'] as string) ||
      req.socket.remoteAddress ||
      '';

    // 🚫 Ngoại trừ route mbtiles/:z/:x/:y
    if (req.path.startsWith('/v1/mbtiles/')) {
      return next();
    }

    // 1. Chặn ngay nếu URL khớp pattern nguy hiểm
    for (const pattern of this.blockedPatterns) {
      if (pattern.test(req.url)) {
        blockedIps.add(ip);
        throw new ForbiddenException('Access denied: Suspicious URL');
      }
    }

    // 2. Kiểm tra danh sách chặn IP
    if (blockedIps.has(ip)) {
      throw new ForbiddenException('Access denied');
    }

    // 3. Theo dõi số request để tự động chặn
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

    // 4. Rate limit cho API (ngoại trừ openRoutes)
    if (!this.openRoutes.includes(req.path)) {
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
