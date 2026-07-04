import { eventToPayload } from "@app/graphql/utils.js";
import type { Event as PrismaEvent } from "@prisma/client";
import { describe, expect, it } from "vitest";

function fakeEvent(overrides: Partial<PrismaEvent> = {}): PrismaEvent {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    sqsMessageId: "msg-1",
    type: "user.created",
    payload: { foo: "bar" },
    status: "processed",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    processedAt: new Date("2026-01-01T00:00:01.000Z"),
    ...overrides,
  };
}

describe("eventToPayload", () => {
  it("maps id to a plain string", () => {
    expect(eventToPayload(fakeEvent()).id).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("maps sqsMessageId, type, status through unchanged", () => {
    const payload = eventToPayload(fakeEvent());
    expect(payload.sqsMessageId).toBe("msg-1");
    expect(payload.type).toBe("user.created");
    expect(payload.status).toBe("processed");
  });

  it("passes payload through as-is", () => {
    expect(eventToPayload(fakeEvent()).payload).toEqual({ foo: "bar" });
  });

  it("formats createdAt as an ISO-8601 string", () => {
    expect(eventToPayload(fakeEvent()).createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("formats a null processedAt as null rather than an ISO string", () => {
    expect(eventToPayload(fakeEvent({ processedAt: null })).processedAt).toBeNull();
  });
});
