import { getPrismaClient } from "@app/prisma.js";
import { describe, expect, vi } from "vitest";

import { test } from "./fixtures.js";

vi.mock("@app/services/awsSqsService.js", () => ({ sendEvent: vi.fn() }));

const { sendEvent } = await import("@app/services/awsSqsService.js");

const EVENTS_QUERY = `
  { events { success message data { id sqsMessageId type status createdAt processedAt } } }
`;
const PUBLISH_EVENT = `
  mutation($type: String!, $payload: JSON) {
    publishEvent(type: $type, payload: $payload) { success message data }
  }
`;

describe("events query", () => {
  test("fails without an access token", async ({ gql }) => {
    const res = await gql(EVENTS_QUERY);
    const body = res.body as {
      data: { events: { success: boolean; message: string } };
    };
    expect(body.data.events.success).toBe(false);
    expect(body.data.events.message).toBe("Unauthorized");
  });

  test("lists previously processed events", async ({ gql, authHeaders }) => {
    await getPrismaClient().event.create({
      data: { sqsMessageId: "gql-seed-1", type: "order.paid", status: "processed" },
    });
    const res = await gql(EVENTS_QUERY, undefined, authHeaders);
    const body = res.body as {
      data: { events: { success: boolean; data: Array<{ type: string }> } };
    };
    expect(body.data.events.success).toBe(true);
    expect(body.data.events.data).toHaveLength(1);
    expect(body.data.events.data[0].type).toBe("order.paid");
  });

  test("returns an empty list when no events exist", async ({ gql, authHeaders }) => {
    const res = await gql(EVENTS_QUERY, undefined, authHeaders);
    const body = res.body as { data: { events: { data: unknown[] } } };
    expect(body.data.events.data).toEqual([]);
  });
});

describe("publishEvent mutation", () => {
  test("publishes and returns the SQS message id", async ({ gql, authHeaders }) => {
    vi.mocked(sendEvent).mockResolvedValue("msg-gql-1");
    const res = await gql(
      PUBLISH_EVENT,
      { type: "user.created", payload: { a: 1 } },
      authHeaders,
    );
    const body = res.body as {
      data: { publishEvent: { success: boolean; data: string } };
    };
    expect(body.data.publishEvent.success).toBe(true);
    expect(body.data.publishEvent.data).toBe("msg-gql-1");
  });

  test("fails without an access token", async ({ gql }) => {
    const res = await gql(PUBLISH_EVENT, { type: "user.created" });
    const body = res.body as {
      data: { publishEvent: { success: boolean; message: string } };
    };
    expect(body.data.publishEvent.success).toBe(false);
    expect(body.data.publishEvent.message).toBe("Unauthorized");
  });

  test("fails when the event type is blank", async ({ gql, authHeaders }) => {
    const res = await gql(PUBLISH_EVENT, { type: "   " }, authHeaders);
    const body = res.body as {
      data: { publishEvent: { success: boolean; message: string } };
    };
    expect(body.data.publishEvent.success).toBe(false);
    expect(body.data.publishEvent.message).toBe("Event type is required");
  });
});
