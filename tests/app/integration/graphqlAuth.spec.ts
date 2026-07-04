import { describe, expect } from "vitest";

import { test } from "./fixtures.js";

const REGISTER = `
  mutation($email: String!, $password: String!) {
    register(email: $email, password: $password) { success message }
  }
`;
const LOGIN = `
  mutation($email: String!, $password: String!) {
    login(email: $email, password: $password) {
      success
      message
      data { accessToken refreshToken }
    }
  }
`;
const REFRESH = `
  mutation {
    refreshToken { success message data { accessToken } }
  }
`;

describe("register mutation", () => {
  test("registers a new user", async ({ gql }) => {
    const res = await gql(REGISTER, {
      email: "new@example.com",
      password: "Password123!",
    });
    const body = res.body as { data: { register: { success: boolean } } };
    expect(body.data.register.success).toBe(true);
  });

  test("fails when email is empty", async ({ gql }) => {
    const res = await gql(REGISTER, { email: "", password: "Password123!" });
    const body = res.body as {
      data: { register: { success: boolean; message: string } };
    };
    expect(body.data.register.success).toBe(false);
    expect(body.data.register.message).toBe("Email and password are required");
  });

  test("fails when the email is already registered", async ({
    gql,
    registeredUser,
  }) => {
    const res = await gql(REGISTER, registeredUser);
    const body = res.body as {
      data: { register: { success: boolean; message: string } };
    };
    expect(body.data.register.success).toBe(false);
    expect(body.data.register.message).toBe("Email already registered");
  });
});

describe("login mutation", () => {
  test("logs in and returns both tokens", async ({ gql, registeredUser }) => {
    const res = await gql(LOGIN, registeredUser);
    const body = res.body as {
      data: {
        login: {
          success: boolean;
          data: { accessToken: string; refreshToken: string };
        };
      };
    };
    expect(body.data.login.success).toBe(true);
    expect(body.data.login.data.accessToken).toEqual(expect.any(String));
    expect(body.data.login.data.refreshToken).toEqual(expect.any(String));
  });

  test("fails with wrong credentials", async ({ gql, registeredUser }) => {
    const res = await gql(LOGIN, { email: registeredUser.email, password: "wrong" });
    const body = res.body as {
      data: { login: { success: boolean; message: string } };
    };
    expect(body.data.login.success).toBe(false);
    expect(body.data.login.message).toBe("Invalid credentials");
  });

  // Unlike REST, GraphQL's login does not pre-validate empty fields — it goes
  // straight to the DB lookup and comes back "Invalid credentials", not a separate
  // validation error. Preserved on purpose.
  test("treats an empty password as invalid credentials, not a validation error", async ({
    gql,
    registeredUser,
  }) => {
    const res = await gql(LOGIN, { email: registeredUser.email, password: "" });
    const body = res.body as {
      data: { login: { success: boolean; message: string } };
    };
    expect(body.data.login.success).toBe(false);
    expect(body.data.login.message).toBe("Invalid credentials");
  });
});

describe("refreshToken mutation", () => {
  test("issues a new access token given a valid refresh token", async ({
    gql,
    refreshToken,
  }) => {
    const res = await gql(REFRESH, undefined, {
      Authorization: `Bearer ${refreshToken}`,
    });
    const body = res.body as {
      data: { refreshToken: { success: boolean; data: { accessToken: string } } };
    };
    expect(body.data.refreshToken.success).toBe(true);
    expect(body.data.refreshToken.data.accessToken).toEqual(expect.any(String));
  });

  test("fails with no Authorization header", async ({ gql }) => {
    const res = await gql(REFRESH);
    const body = res.body as {
      data: { refreshToken: { success: boolean; message: string } };
    };
    expect(body.data.refreshToken.success).toBe(false);
    expect(body.data.refreshToken.message).toBe("Invalid or expired refresh token");
  });

  test("fails when given an access token instead of a refresh token", async ({
    gql,
    gqlAuthHeaders,
  }) => {
    const res = await gql(REFRESH, undefined, gqlAuthHeaders.access);
    const body = res.body as { data: { refreshToken: { success: boolean } } };
    expect(body.data.refreshToken.success).toBe(false);
  });

  test("gqlAuthHeaders.refresh is independently obtained from the login mutation", async ({
    gql,
    gqlAuthHeaders,
  }) => {
    const res = await gql(REFRESH, undefined, gqlAuthHeaders.refresh);
    const body = res.body as { data: { refreshToken: { success: boolean } } };
    expect(body.data.refreshToken.success).toBe(true);
  });
});
