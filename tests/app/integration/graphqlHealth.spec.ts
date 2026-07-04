import { expect } from "vitest";

import { test } from "./fixtures.js";

const HEALTH_QUERY = `{ health { success message data { version } } }`;

test("health query returns success with a version", async ({ gql }) => {
  const res = await gql(HEALTH_QUERY);
  expect(res.status).toBe(200);
  const body = res.body as {
    data: { health: { success: boolean; data: { version: string } } };
  };
  expect(body.data.health.success).toBe(true);
  expect(body.data.health.data.version).toEqual(expect.any(String));
});

test("health query always returns HTTP 200 (GraphQL convention)", async ({ gql }) => {
  const res = await gql(HEALTH_QUERY);
  expect(res.status).toBe(200);
});

test("health query includes the fixed 'server is up' message", async ({ gql }) => {
  const res = await gql(HEALTH_QUERY);
  const body = res.body as { data: { health: { message: string } } };
  expect(body.data.health.message).toBe("The server is up and running");
});
