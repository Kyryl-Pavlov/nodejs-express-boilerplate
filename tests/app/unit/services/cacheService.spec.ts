import { CacheService } from "@app/services/cacheService.js";
import type { Redis } from "ioredis";
import { describe, expect, it, vi } from "vitest";

function fakeRedis(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    get: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
    ttl: vi.fn(),
    ping: vi.fn(),
    ...overrides,
  } as unknown as Redis;
}

describe("CacheService.get", () => {
  it("returns the parsed JSON value when the key exists", async () => {
    const client = fakeRedis({ get: vi.fn().mockResolvedValue('{"a":1}') });
    const cache = new CacheService(client);
    await expect(cache.get("k")).resolves.toEqual({ a: 1 });
  });

  it("returns null when the key does not exist", async () => {
    const client = fakeRedis({ get: vi.fn().mockResolvedValue(null) });
    const cache = new CacheService(client);
    await expect(cache.get("k")).resolves.toBeNull();
  });
});

describe("CacheService.set", () => {
  it("JSON-serializes the value and uses the default TTL of 60", async () => {
    const setex = vi.fn().mockResolvedValue("OK");
    const cache = new CacheService(fakeRedis({ setex }));
    await cache.set("k", { a: 1 });
    expect(setex).toHaveBeenCalledWith("k", 60, '{"a":1}');
  });

  it("respects a custom TTL", async () => {
    const setex = vi.fn().mockResolvedValue("OK");
    const cache = new CacheService(fakeRedis({ setex }));
    await cache.set("k", "v", 120);
    expect(setex).toHaveBeenCalledWith("k", 120, '"v"');
  });
});

describe("CacheService.delete", () => {
  it("returns true when a key was removed", async () => {
    const cache = new CacheService(fakeRedis({ del: vi.fn().mockResolvedValue(1) }));
    await expect(cache.delete("k")).resolves.toBe(true);
  });

  it("returns false when the key did not exist", async () => {
    const cache = new CacheService(fakeRedis({ del: vi.fn().mockResolvedValue(0) }));
    await expect(cache.delete("k")).resolves.toBe(false);
  });
});

describe("CacheService.ttl", () => {
  it("passes through the raw ttl value from redis", async () => {
    const cache = new CacheService(fakeRedis({ ttl: vi.fn().mockResolvedValue(42) }));
    await expect(cache.ttl("k")).resolves.toBe(42);
  });

  it("passes through -2 (key does not exist)", async () => {
    const cache = new CacheService(fakeRedis({ ttl: vi.fn().mockResolvedValue(-2) }));
    await expect(cache.ttl("k")).resolves.toBe(-2);
  });
});

describe("CacheService.ping", () => {
  it("returns true when redis responds", async () => {
    const cache = new CacheService(
      fakeRedis({ ping: vi.fn().mockResolvedValue("PONG") }),
    );
    await expect(cache.ping()).resolves.toBe(true);
  });

  it("returns false when redis throws", async () => {
    const cache = new CacheService(
      fakeRedis({ ping: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) }),
    );
    await expect(cache.ping()).resolves.toBe(false);
  });
});
