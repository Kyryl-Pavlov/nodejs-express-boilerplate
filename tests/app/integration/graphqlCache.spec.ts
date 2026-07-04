import { describe, expect } from "vitest";

import { test } from "./fixtures.js";

const CACHE_PING = `{ cachePing { success message data } }`;
const CACHE_TEST = `{ cacheTest { success message data { source computedAt payload ttl remainingTtl } } }`;
const CLEAR_CACHE = `mutation { clearCache { success message data } }`;

describe("cachePing query", () => {
  test("503-equivalent: fails when Redis is not configured", async ({ gql, app }) => {
    const original = app.cache;
    app.cache = null;
    const res = await gql(CACHE_PING);
    const body = res.body as {
      data: { cachePing: { success: boolean; message: string } };
    };
    expect(body.data.cachePing.success).toBe(false);
    expect(body.data.cachePing.message).toBe("Redis not configured");
    app.cache = original;
  });

  test("returns ok when redis responds", async ({ gql, mockCache }) => {
    mockCache.ping.mockResolvedValue(true);
    const res = await gql(CACHE_PING);
    const body = res.body as { data: { cachePing: { data: string } } };
    expect(body.data.cachePing.data).toBe("ok");
  });

  test("returns unavailable when redis does not respond", async ({
    gql,
    mockCache,
  }) => {
    mockCache.ping.mockResolvedValue(false);
    const res = await gql(CACHE_PING);
    const body = res.body as { data: { cachePing: { data: string } } };
    expect(body.data.cachePing.data).toBe("unavailable");
  });
});

describe("cacheTest query", () => {
  test("fails when Redis is not configured", async ({ gql, app }) => {
    const original = app.cache;
    app.cache = null;
    const res = await gql(CACHE_TEST);
    const body = res.body as { data: { cacheTest: { success: boolean } } };
    expect(body.data.cacheTest.success).toBe(false);
    app.cache = original;
  });

  test("computes and stores a value on cache miss", async ({ gql, mockCache }) => {
    mockCache.get.mockResolvedValue(null);
    const res = await gql(CACHE_TEST);
    const body = res.body as {
      data: { cacheTest: { message: string; data: { source: string; ttl: number } } };
    };
    expect(body.data.cacheTest.message).toBe("Cache miss — value computed and stored");
    expect(body.data.cacheTest.data.source).toBe("computed");
    expect(body.data.cacheTest.data.ttl).toBe(60);
  });

  test("returns the cached value with remainingTtl on cache hit", async ({
    gql,
    mockCache,
  }) => {
    mockCache.get.mockResolvedValue({ computed_at: 123, payload: "cached payload" });
    mockCache.ttl.mockResolvedValue(30);
    const res = await gql(CACHE_TEST);
    const body = res.body as {
      data: { cacheTest: { data: { source: string; remainingTtl: number } } };
    };
    expect(body.data.cacheTest.data.source).toBe("cache");
    expect(body.data.cacheTest.data.remainingTtl).toBe(30);
  });
});

describe("clearCache mutation", () => {
  test("fails when Redis is not configured", async ({ gql, app }) => {
    const original = app.cache;
    app.cache = null;
    const res = await gql(CLEAR_CACHE);
    const body = res.body as { data: { clearCache: { success: boolean } } };
    expect(body.data.clearCache.success).toBe(false);
    app.cache = original;
  });

  test("reports the key was deleted", async ({ gql, mockCache }) => {
    mockCache.delete.mockResolvedValue(true);
    const res = await gql(CLEAR_CACHE);
    const body = res.body as {
      data: { clearCache: { message: string; data: boolean } };
    };
    expect(body.data.clearCache.message).toBe("Cache key deleted");
    expect(body.data.clearCache.data).toBe(true);
  });

  test("reports the key was not in the cache", async ({ gql, mockCache }) => {
    mockCache.delete.mockResolvedValue(false);
    const res = await gql(CLEAR_CACHE);
    const body = res.body as { data: { clearCache: { data: boolean } } };
    expect(body.data.clearCache.data).toBe(false);
  });
});
