import { Redis } from "ioredis";

export class CacheService {
  constructor(private readonly client: Redis) {}

  async get<T = unknown>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    return raw !== null ? (JSON.parse(raw) as T) : null;
  }

  async set(key: string, value: unknown, ttl = 60): Promise<void> {
    await this.client.setex(key, ttl, JSON.stringify(value));
  }

  async delete(key: string): Promise<boolean> {
    const removed = await this.client.del(key);
    return Boolean(removed);
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(key);
  }

  async ping(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return Boolean(result);
    } catch {
      return false;
    }
  }

  static fromUrl(url: string): CacheService {
    return new CacheService(new Redis(url));
  }
}
