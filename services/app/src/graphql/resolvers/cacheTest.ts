import type { AppGraphQLContext } from "../context.js";
import { makeResponse } from "../response.js";

const CACHE_KEY = "poc:test_value";
const CACHE_TTL = 60;

interface CachedValue {
  computed_at: number;
  payload: string;
}

export const cacheTestResolvers = {
  Query: {
    cachePing: async (_root: unknown, _args: unknown, context: AppGraphQLContext) => {
      const logger = context.app.loggerAdapter;
      const cache = context.app.cache;
      if (!cache)
        return makeResponse(logger, {
          success: false,
          message: "Redis not configured",
        });
      return makeResponse(logger, {
        data: (await cache.ping()) ? "ok" : "unavailable",
      });
    },

    cacheTest: async (_root: unknown, _args: unknown, context: AppGraphQLContext) => {
      const logger = context.app.loggerAdapter;
      const cache = context.app.cache;
      if (!cache)
        return makeResponse(logger, {
          success: false,
          message: "Redis not configured",
        });

      const cached = await cache.get<CachedValue>(CACHE_KEY);
      if (cached !== null) {
        return makeResponse(logger, {
          message: "Cache hit",
          data: {
            source: "cache",
            computedAt: cached.computed_at,
            payload: cached.payload,
            remainingTtl: await cache.ttl(CACHE_KEY),
          },
        });
      }

      const value: CachedValue = {
        computed_at: Date.now() / 1000,
        payload: "Simulated expensive computation result",
      };
      await cache.set(CACHE_KEY, value, CACHE_TTL);
      return makeResponse(logger, {
        message: "Cache miss — value computed and stored",
        data: {
          source: "computed",
          computedAt: value.computed_at,
          payload: value.payload,
          ttl: CACHE_TTL,
        },
      });
    },
  },

  Mutation: {
    clearCache: async (_root: unknown, _args: unknown, context: AppGraphQLContext) => {
      const logger = context.app.loggerAdapter;
      const cache = context.app.cache;
      if (!cache)
        return makeResponse(logger, {
          success: false,
          message: "Redis not configured",
        });

      const deleted = await cache.delete(CACHE_KEY);
      return makeResponse(logger, {
        message: deleted ? "Cache key deleted" : "Key was not in cache",
        data: deleted,
      });
    },
  },
};
