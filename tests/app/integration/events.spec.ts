import { getPrismaClient } from "@app/prisma.js";
import request from "supertest";
import { describe, expect, vi } from "vitest";

import { test } from "./fixtures.js";

vi.mock("@app/services/awsSqsService.js", () => ({ sendEvent: vi.fn() }));

const { sendEvent } = await import("@app/services/awsSqsService.js");

describe("POST /api/v1/events", () => {
  test("publishes an event and returns 202 with a message id", async ({
    client,
    authHeaders,
  }) => {
    vi.mocked(sendEvent).mockResolvedValue("msg-abc");
    const res = await request(client)
      .post("/api/v1/events")
      .set(authHeaders)
      .send({ type: "user.created", payload: { userId: "1" } });
    expect(res.status).toBe(202);
    expect((res.body as { data: { message_id: string } }).data.message_id).toBe(
      "msg-abc",
    );
  });

  test("400s when the event type is missing", async ({ client, authHeaders }) => {
    const res = await request(client).post("/api/v1/events").set(authHeaders).send({});
    expect(res.status).toBe(400);
  });

  test("401s without an access token", async ({ client }) => {
    const res = await request(client)
      .post("/api/v1/events")
      .send({ type: "user.created" });
    expect(res.status).toBe(401);
  });

  test("500s when publishing to SQS fails", async ({ client, authHeaders }) => {
    vi.mocked(sendEvent).mockRejectedValueOnce(new Error("SQS unavailable"));
    const res = await request(client)
      .post("/api/v1/events")
      .set(authHeaders)
      .send({ type: "user.created" });
    expect(res.status).toBe(500);
  });

  test("defaults payload to an empty object when omitted", async ({
    client,
    authHeaders,
  }) => {
    vi.mocked(sendEvent).mockResolvedValue("msg-def");
    const res = await request(client)
      .post("/api/v1/events")
      .set(authHeaders)
      .send({ type: "user.created" });
    expect(res.status).toBe(202);
    expect(sendEvent).toHaveBeenCalledWith(expect.anything(), "user.created", {});
  });
});

describe("GET /api/v1/events", () => {
  // Publishing only sends to SQS — a DB row only appears once the Lambda worker
  // consumes the message asynchronously, so "list" tests seed the table directly
  // rather than going through the publish endpoint.
  test("lists previously processed events", async ({ client, authHeaders }) => {
    await getPrismaClient().event.create({
      data: {
        sqsMessageId: "seed-1",
        type: "user.created",
        payload: { a: 1 },
        status: "processed",
      },
    });

    const res = await request(client).get("/api/v1/events").set(authHeaders);
    expect(res.status).toBe(200);
    const body = res.body as {
      data: Array<{ type: string; sqs_message_id: string }>;
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].type).toBe("user.created");
    expect(body.data[0].sqs_message_id).toBe("seed-1");
  });

  test("401s without an access token", async ({ client }) => {
    const res = await request(client).get("/api/v1/events");
    expect(res.status).toBe(401);
  });

  test("returns an empty list when no events exist", async ({
    client,
    authHeaders,
  }) => {
    const res = await request(client).get("/api/v1/events").set(authHeaders);
    expect(res.status).toBe(200);
    expect((res.body as { data: unknown[] }).data).toEqual([]);
  });
});
