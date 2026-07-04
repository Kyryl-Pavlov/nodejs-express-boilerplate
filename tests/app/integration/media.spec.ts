import { getPrismaClient } from "@app/prisma.js";
import type { Express } from "express";
import FormData from "form-data";
import request from "supertest";
import { describe, expect, vi } from "vitest";

import { test } from "./fixtures.js";

vi.mock("@app/services/awsS3Service.js", () => ({
  uploadFile: vi.fn(),
  getPresignedUrl: vi.fn(),
}));

const { uploadFile, getPresignedUrl } = await import("@app/services/awsS3Service.js");

const FAKE_S3_KEY = "media/user-id/test.png";
const FAKE_URL = "https://example.com/presigned";

function upload(
  client: Express,
  headers: Record<string, string>,
  {
    content = Buffer.from("hello"),
    filename = "test.png",
  }: { content?: Buffer; filename?: string } = {},
) {
  vi.mocked(uploadFile).mockResolvedValue(FAKE_S3_KEY);
  vi.mocked(getPresignedUrl).mockResolvedValue(FAKE_URL);

  const form = new FormData();
  form.append("file", content, filename);

  return request(client)
    .post("/api/v1/media/upload")
    .set({ ...headers, ...form.getHeaders() })
    .send(form.getBuffer());
}

describe("POST /api/v1/media/upload", () => {
  test("uploads a file and returns a presigned URL", async ({
    client,
    authHeaders,
  }) => {
    const res = await upload(client, authHeaders);
    expect(res.status).toBe(201);
    const body = res.body as {
      data: { media_id: string; url: string; expires_in: number };
    };
    expect(body.data.url).toBe(FAKE_URL);
    expect(body.data.media_id).toEqual(expect.any(String));
    // Hardcoded 3600 in the REST handler, not PRESIGNED_URL_EXPIRY (see media.ts).
    expect(body.data.expires_in).toBe(3600);
  });

  test("401s without an access token", async ({ client }) => {
    const form = new FormData();
    form.append("file", Buffer.from("hello"), "test.png");
    const res = await request(client)
      .post("/api/v1/media/upload")
      .set(form.getHeaders())
      .send(form.getBuffer());
    expect(res.status).toBe(401);
  });

  test("415s for a disallowed file extension", async ({ client, authHeaders }) => {
    const res = await upload(client, authHeaders, { filename: "malware.exe" });
    expect(res.status).toBe(415);
  });

  test("400s when no file part is present", async ({ client, authHeaders }) => {
    const form = new FormData();
    form.append("not-a-file", "just text");
    const res = await request(client)
      .post("/api/v1/media/upload")
      .set({ ...authHeaders, ...form.getHeaders() })
      .send(form.getBuffer());
    expect(res.status).toBe(400);
  });

  test("500s when the S3 upload fails", async ({ client, authHeaders }) => {
    vi.mocked(uploadFile).mockRejectedValueOnce(new Error("S3 unavailable"));
    const form = new FormData();
    form.append("file", Buffer.from("hello"), "test.png");
    const res = await request(client)
      .post("/api/v1/media/upload")
      .set({ ...authHeaders, ...form.getHeaders() })
      .send(form.getBuffer());
    expect(res.status).toBe(500);
  });

  test("persists a Media record in the database", async ({ client, authHeaders }) => {
    const res = await upload(client, authHeaders);
    const body = res.body as { data: { media_id: string } };
    const record = await getPrismaClient().media.findUnique({
      where: { id: body.data.media_id },
    });
    expect(record).not.toBeNull();
    expect(record?.contentKey).toBe(FAKE_S3_KEY);
  });
});

describe("GET /api/v1/media/:mediaId/url", () => {
  test("returns a presigned URL for the owner's media", async ({
    client,
    authHeaders,
  }) => {
    const uploadRes = await upload(client, authHeaders);
    const { media_id: mediaId } = (uploadRes.body as { data: { media_id: string } })
      .data;

    vi.mocked(getPresignedUrl).mockResolvedValue(FAKE_URL);
    const res = await request(client)
      .get(`/api/v1/media/${mediaId}/url`)
      .set(authHeaders);
    expect(res.status).toBe(200);
    expect((res.body as { data: { url: string } }).data.url).toBe(FAKE_URL);
  });

  test("400s for a malformed media ID", async ({ client, authHeaders }) => {
    const res = await request(client)
      .get("/api/v1/media/not-a-uuid/url")
      .set(authHeaders);
    expect(res.status).toBe(400);
  });

  test("404s for a nonexistent media ID", async ({ client, authHeaders }) => {
    const res = await request(client)
      .get("/api/v1/media/11111111-1111-1111-1111-111111111111/url")
      .set(authHeaders);
    expect(res.status).toBe(404);
  });

  test("404s (not 403) when the media belongs to another user", async ({ client }) => {
    // Register a second user, upload as them, then try to access as the first user.
    const other = { email: "other@example.com", password: "Password123!" };
    await request(client).post("/api/v1/auth/register").send(other);
    const otherLogin = await request(client).post("/api/v1/auth/login").send(other);
    const otherHeaders = {
      Authorization: `Bearer ${(otherLogin.body as { data: { access_token: string } }).data.access_token}`,
    };
    const uploadRes = await upload(client, otherHeaders);
    const { media_id: mediaId } = (uploadRes.body as { data: { media_id: string } })
      .data;

    const first = { email: "first@example.com", password: "Password123!" };
    await request(client).post("/api/v1/auth/register").send(first);
    const firstLogin = await request(client).post("/api/v1/auth/login").send(first);
    const firstHeaders = {
      Authorization: `Bearer ${(firstLogin.body as { data: { access_token: string } }).data.access_token}`,
    };

    const res = await request(client)
      .get(`/api/v1/media/${mediaId}/url`)
      .set(firstHeaders);
    expect(res.status).toBe(404);
  });
});
