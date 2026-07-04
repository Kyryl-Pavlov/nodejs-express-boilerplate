import type { PrismaClient } from "@prisma/client";

import type { AppConfig } from "../config.js";
import type { AppLogger } from "../logging/logger.js";
import type { CacheService } from "../services/cacheService.js";

declare global {
  namespace Express {
    interface Application {
      config: AppConfig;
      loggerAdapter: AppLogger;
      cache: CacheService | null;
      prisma: PrismaClient;
    }

    interface Request {
      userId?: string;
      startTime?: bigint;
    }
  }
}

export {};
