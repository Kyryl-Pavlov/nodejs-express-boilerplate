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

const UPLOAD_FILE_MUTATION = `
  mutation($file: Upload!) {
    uploadFile(file: $file) {
      success
      message
      data { mediaId url expiresIn }
    }
  }
`;

const SIGNED_URL_QUERY = `
  query($mediaId: String!) {
    signedUrl(mediaId: $mediaId) { success message data }
  }
`;

function uploadViaGraphql(client: Express, headers: Record<string, string>) {
  vi.mocked(uploadFile).mockResolvedValue(FAKE_S3_KEY);
  vi.mocked(getPresignedUrl).mockResolvedValue(FAKE_URL);

  const form = new FormData();
  form.append(
    "operations",
    JSON.stringify({ query: UPLOAD_FILE_MUTATION, variables: { file: null } }),
  );
  form.append("map", JSON.stringify({ "0": ["variables.file"] }));
  form.append("0", Buffer.from("hello"), "test.png");

  return request(client)
    .post("/graphql")
    .set({ ...headers, ...form.getHeaders() })
    .send(form.getBuffer());
}

describe("uploadFile mutation", () => {
  test("uploads a file and returns a presigned URL", async ({
    client,
    authHeaders,
  }) => {
    const res = await uploadViaGraphql(client, authHeaders);
    const body = res.body as {
      data: {
        uploadFile: {
          success: boolean;
          data: { mediaId: string; url: string; expiresIn: number };
        };
      };
    };
    expect(body.data.uploadFile.success).toBe(true);
    expect(body.data.uploadFile.data.url).toBe(FAKE_URL);
    // Unlike REST's hardcoded 3600, GraphQL uses the configured PRESIGNED_URL_EXPIRY.
    expect(body.data.uploadFile.data.expiresIn).toBe(86400);
  });

  test("fails without an access token", async ({ client }) => {
    const form = new FormData();
    form.append(
      "operations",
      JSON.stringify({ query: UPLOAD_FILE_MUTATION, variables: { file: null } }),
    );
    form.append("map", JSON.stringify({ "0": ["variables.file"] }));
    form.append("0", Buffer.from("hello"), "test.png");

    const res = await request(client)
      .post("/graphql")
      .set(form.getHeaders())
      .send(form.getBuffer());
    const body = res.body as {
      data: { uploadFile: { success: boolean; message: string } };
    };
    expect(body.data.uploadFile.success).toBe(false);
    expect(body.data.uploadFile.message).toBe("Unauthorized");
  });

  test("fails when the S3 upload throws", async ({ client, authHeaders }) => {
    vi.mocked(uploadFile).mockRejectedValueOnce(new Error("S3 unavailable"));
    vi.mocked(getPresignedUrl).mockResolvedValue(FAKE_URL);

    const form = new FormData();
    form.append(
      "operations",
      JSON.stringify({ query: UPLOAD_FILE_MUTATION, variables: { file: null } }),
    );
    form.append("map", JSON.stringify({ "0": ["variables.file"] }));
    form.append("0", Buffer.from("hello"), "test.png");

    const res = await request(client)
      .post("/graphql")
      .set({ ...authHeaders, ...form.getHeaders() })
      .send(form.getBuffer());
    const body = res.body as {
      data: { uploadFile: { success: boolean; message: string } };
    };
    expect(body.data.uploadFile.success).toBe(false);
    expect(body.data.uploadFile.message).toBe("File upload failed");
  });
});

describe("signedUrl query", () => {
  test("returns a presigned URL for the owner's media", async ({
    client,
    authHeaders,
  }) => {
    const uploadRes = await uploadViaGraphql(client, authHeaders);
    const mediaId = (
      uploadRes.body as { data: { uploadFile: { data: { mediaId: string } } } }
    ).data.uploadFile.data.mediaId;

    vi.mocked(getPresignedUrl).mockResolvedValue(FAKE_URL);
    const res = await request(client)
      .post("/graphql")
      .set(authHeaders)
      .send({ query: SIGNED_URL_QUERY, variables: { mediaId } });
    const body = res.body as {
      data: { signedUrl: { success: boolean; data: string } };
    };
    expect(body.data.signedUrl.success).toBe(true);
    expect(body.data.signedUrl.data).toBe(FAKE_URL);
  });

  test("fails with 'Invalid media ID' for a malformed UUID", async ({
    client,
    authHeaders,
  }) => {
    const res = await request(client)
      .post("/graphql")
      .set(authHeaders)
      .send({ query: SIGNED_URL_QUERY, variables: { mediaId: "not-a-uuid" } });
    const body = res.body as {
      data: { signedUrl: { success: boolean; message: string } };
    };
    expect(body.data.signedUrl.success).toBe(false);
    expect(body.data.signedUrl.message).toBe("Invalid media ID");
  });

  test("fails with a generic 'Not found' for a nonexistent media ID", async ({
    client,
    authHeaders,
  }) => {
    const res = await request(client)
      .post("/graphql")
      .set(authHeaders)
      .send({
        query: SIGNED_URL_QUERY,
        variables: { mediaId: "11111111-1111-1111-1111-111111111111" },
      });
    const body = res.body as {
      data: { signedUrl: { success: boolean; message: string } };
    };
    expect(body.data.signedUrl.success).toBe(false);
    expect(body.data.signedUrl.message).toBe("Not found");
  });

  test("fails without an access token", async ({ gql }) => {
    const res = await gql(SIGNED_URL_QUERY, {
      mediaId: "11111111-1111-1111-1111-111111111111",
    });
    const body = res.body as {
      data: { signedUrl: { success: boolean; message: string } };
    };
    expect(body.data.signedUrl.success).toBe(false);
    expect(body.data.signedUrl.message).toBe("Unauthorized");
  });
});
