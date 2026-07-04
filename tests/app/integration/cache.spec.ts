import request from "supertest";
import { describe, expect } from "vitest";

import { test } from "./fixtures.js";

describe("GET /api/v1/cache/ping", () => {
  test("503s when Redis is not configured", async ({ client, app }) => {
    const original = app.cache;
    app.cache = null;
    const res = await request(client).get("/api/v1/cache/ping");
    expect(res.status).toBe(503);
    app.cache = original;
  });

  test("returns ok when redis responds", async ({ client, mockCache }) => {
    mockCache.ping.mockResolvedValue(true);
    const res = await request(client).get("/api/v1/cache/ping");
    expect(res.status).toBe(200);
    expect((res.body as { data: { redis: string } }).data.redis).toBe("ok");
  });

  test("returns unavailable when the cache reports it can't reach redis", async ({
    client,
    mockCache,
  }) => {
    mockCache.ping.mockResolvedValue(false);
    const res = await request(client).get("/api/v1/cache/ping");
    expect((res.body as { data: { redis: string } }).data.redis).toBe("unavailable");
  });
});

describe("GET /api/v1/cache/test", () => {
  test("503s when Redis is not configured", async ({ client, app }) => {
    const original = app.cache;
    app.cache = null;
    const res = await request(client).get("/api/v1/cache/test");
    expect(res.status).toBe(503);
    app.cache = original;
  });

  test("computes and stores a value on cache miss", async ({ client, mockCache }) => {
    mockCache.get.mockResolvedValue(null);
    const res = await request(client).get("/api/v1/cache/test");
    expect(res.status).toBe(200);
    const body = res.body as {
      message: string;
      data: { source: string; ttl: number };
    };
    expect(body.message).toBe("Cache miss — value computed and stored");
    expect(body.data.source).toBe("computed");
    expect(body.data.ttl).toBe(60);
    expect(mockCache.set).toHaveBeenCalledOnce();
  });

  test("returns the cached value with remaining_ttl on cache hit", async ({
    client,
    mockCache,
  }) => {
    mockCache.get.mockResolvedValue({ computed_at: 123, payload: "cached payload" });
    mockCache.ttl.mockResolvedValue(45);
    const res = await request(client).get("/api/v1/cache/test");
    const body = res.body as {
      message: string;
      data: { source: string; remaining_ttl: number; payload: string };
    };
    expect(body.message).toBe("Cache hit");
    expect(body.data.source).toBe("cache");
    expect(body.data.remaining_ttl).toBe(45);
    expect(body.data.payload).toBe("cached payload");
  });
});

describe("DELETE /api/v1/cache/test", () => {
  test("503s when Redis is not configured", async ({ client, app }) => {
    const original = app.cache;
    app.cache = null;
    const res = await request(client).delete("/api/v1/cache/test");
    expect(res.status).toBe(503);
    app.cache = original;
  });

  test("reports the key was deleted", async ({ client, mockCache }) => {
    mockCache.delete.mockResolvedValue(true);
    const res = await request(client).delete("/api/v1/cache/test");
    const body = res.body as { message: string; data: { deleted: boolean } };
    expect(body.message).toBe("Cache key deleted");
    expect(body.data.deleted).toBe(true);
  });

  test("reports the key was not in the cache", async ({ client, mockCache }) => {
    mockCache.delete.mockResolvedValue(false);
    const res = await request(client).delete("/api/v1/cache/test");
    const body = res.body as { message: string; data: { deleted: boolean } };
    expect(body.message).toBe("Key was not in cache");
    expect(body.data.deleted).toBe(false);
  });
});
