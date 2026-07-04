import { Router } from "express";

import { restApiResponse } from "../../api/utils/response.js";

const CACHE_KEY = "poc:test_value";
const CACHE_TTL = 60;

interface CachedValue {
  computed_at: number;
  payload: string;
}

export function cacheTestRoutes(): Router {
  const router = Router();

  router.get("/cache/ping", async (req, res) => {
    const cache = req.app.cache;
    if (!cache) {
      return restApiResponse(res, {
        success: false,
        message: "Redis not configured",
        statusCode: 503,
      });
    }
    return restApiResponse(res, {
      data: { redis: (await cache.ping()) ? "ok" : "unavailable" },
    });
  });

  router.get("/cache/test", async (req, res) => {
    const cache = req.app.cache;
    if (!cache) {
      return restApiResponse(res, {
        success: false,
        message: "Redis not configured",
        statusCode: 503,
      });
    }

    const cached = await cache.get<CachedValue>(CACHE_KEY);
    if (cached !== null) {
      return restApiResponse(res, {
        message: "Cache hit",
        data: { ...cached, source: "cache", remaining_ttl: await cache.ttl(CACHE_KEY) },
      });
    }

    const value: CachedValue = {
      computed_at: Date.now() / 1000,
      payload: "Simulated expensive computation result",
    };
    await cache.set(CACHE_KEY, value, CACHE_TTL);
    return restApiResponse(res, {
      message: "Cache miss — value computed and stored",
      data: { ...value, source: "computed", ttl: CACHE_TTL },
    });
  });

  router.delete("/cache/test", async (req, res) => {
    const cache = req.app.cache;
    if (!cache) {
      return restApiResponse(res, {
        success: false,
        message: "Redis not configured",
        statusCode: 503,
      });
    }

    const deleted = await cache.delete(CACHE_KEY);
    return restApiResponse(res, {
      message: deleted ? "Cache key deleted" : "Key was not in cache",
      data: { deleted },
    });
  });

  return router;
}
