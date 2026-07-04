import request from "supertest";
import { expect } from "vitest";

import { test } from "./fixtures.js";

test("GET /api/v1/health returns ok with a version", async ({ client }) => {
  const res = await request(client).get("/api/v1/health");
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ status: "ok", version: expect.any(String) });
});
