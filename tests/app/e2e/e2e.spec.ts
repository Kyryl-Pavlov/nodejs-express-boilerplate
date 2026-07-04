// Runs against a fully started stack (docker-compose.ci.yml via nginx). No mocks.
// Happy paths only.
import FormData from "form-data";
import { describe, expect, it } from "vitest";

import { apiFetch, BASE_URL, getAuthHeaders } from "./helpers.js";

describe("e2e", () => {
  it("health check responds ok", async () => {
    const res = await apiFetch("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("ok");
  });

  it("registers and logs in a user", async () => {
    const creds = {
      email: `e2e-${Date.now()}@ci-test.internal`,
      password: "E2eRunner1!",
    };
    const register = await apiFetch("/auth/register", {
      method: "POST",
      body: JSON.stringify(creds),
    });
    expect(register.status).toBe(201);

    const login = await apiFetch("/auth/login", {
      method: "POST",
      body: JSON.stringify(creds),
    });
    expect(login.status).toBe(200);
    const body = (await login.json()) as { data: { access_token: string } };
    expect(body.data.access_token).toEqual(expect.any(String));
  });

  it("accepts an authenticated request", async () => {
    const headers = await getAuthHeaders();
    const res = await apiFetch("/events", { headers });
    expect(res.status).toBe(200);
  });

  it("uploads media and returns a presigned URL", async () => {
    const headers = await getAuthHeaders();
    const form = new FormData();
    form.append("file", Buffer.from("e2e test content"), "e2e-test.png");

    const uploadRes = await fetch(`${BASE_URL}/media/upload`, {
      method: "POST",
      headers: { ...headers, ...form.getHeaders() },
      body: form.getBuffer(),
    });
    expect(uploadRes.status).toBe(201);
    const uploadBody = (await uploadRes.json()) as {
      data: { media_id: string; url: string };
    };
    expect(uploadBody.data.url).toEqual(expect.any(String));

    const urlRes = await apiFetch(`/media/${uploadBody.data.media_id}/url`, {
      headers,
    });
    expect(urlRes.status).toBe(200);
  });

  it("publishes an event", async () => {
    const headers = await getAuthHeaders();
    const res = await apiFetch("/events", {
      method: "POST",
      headers,
      body: JSON.stringify({ type: "e2e.test", payload: { source: "vitest" } }),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { data: { message_id: string } };
    expect(body.data.message_id).toEqual(expect.any(String));
  });
});
