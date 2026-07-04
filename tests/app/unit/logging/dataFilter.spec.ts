import { maskSensitive, sanitizeTraceback } from "@app/logging/dataFilter.js";
import { describe, expect, it } from "vitest";

describe("maskSensitive", () => {
  it("returns null for null input", () => {
    expect(maskSensitive(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(maskSensitive(undefined)).toBeNull();
  });

  it("passes through non-sensitive keys unchanged", () => {
    expect(maskSensitive({ email: "user@example.com", count: 3 })).toEqual({
      email: "user@example.com",
      count: 3,
    });
  });

  it.each([
    "password",
    "passwd",
    "pass",
    "secret",
    "secret_key",
    "token",
    "access_token",
    "refresh_token",
    "id_token",
    "auth_token",
    "bearer_token",
    "bearer",
    "jwt",
    "session_token",
    "session",
    "oauth_token",
    "client_secret",
    "client_token",
    "authorization",
    "auth",
    "api_key",
    "apikey",
    "private_key",
    "signing_key",
    "credential",
    "credentials",
    "credit_card",
    "card_number",
    "cvv",
    "cvc",
    "ssn",
    "pin",
  ])("masks the sensitive key %s", (key) => {
    const result = maskSensitive({ [key]: "secret-value" }) as Record<string, unknown>;
    expect(result[key]).toBe("***");
  });

  it("matches sensitive keys case-insensitively but keeps original key casing", () => {
    const result = maskSensitive({ Password: "hunter2" }) as Record<string, unknown>;
    expect(result.Password).toBe("***");
  });

  it("recursively masks nested dicts", () => {
    const result = maskSensitive({
      user: { email: "a@b.com", password: "hunter2" },
    }) as Record<string, unknown>;
    expect(result.user).toEqual({ email: "a@b.com", password: "***" });
  });

  it("masks dicts found inside a top-level list", () => {
    const result = maskSensitive([{ token: "abc" }, { email: "a@b.com" }]) as unknown[];
    expect(result).toEqual([{ token: "***" }, { email: "a@b.com" }]);
  });

  it("does not recurse into nested lists (shallow boundary)", () => {
    const input = { items: [{ token: "abc" }] };
    const result = maskSensitive(input) as Record<string, unknown>;
    // items is masked because it's a top-level dict value that's a list of dicts —
    // this confirms one level of list recursion works...
    expect(result.items).toEqual([{ token: "***" }]);
  });

  it("leaves non-dict items inside a list untouched", () => {
    const result = maskSensitive([1, "two", { token: "abc" }]) as unknown[];
    expect(result).toEqual([1, "two", { token: "***" }]);
  });

  it("does not mutate the input object", () => {
    const input = { password: "hunter2" };
    maskSensitive(input);
    expect(input.password).toBe("hunter2");
  });
});

describe("sanitizeTraceback", () => {
  it("redacts a [SQL: ...] block", () => {
    const trace = "Error\n[SQL: SELECT * FROM users WHERE email = %s]\nmore text";
    expect(sanitizeTraceback(trace)).toContain("[SQL redacted]");
    expect(sanitizeTraceback(trace)).not.toContain("SELECT * FROM users");
  });

  it("redacts a [parameters: ...] block", () => {
    const trace = "[parameters: ('secret@example.com',)]";
    expect(sanitizeTraceback(trace)).toBe("[parameters redacted]");
  });

  it("redacts a multi-line SQL block (DOTALL equivalent)", () => {
    const trace = "[SQL: SELECT *\nFROM users\nWHERE id = 1]";
    expect(sanitizeTraceback(trace)).toBe("[SQL redacted]");
  });

  it.each(["postgresql", "mysql", "sqlite", "mongodb", "redis"])(
    "redacts a %s connection string",
    (scheme) => {
      const trace = `connection failed: ${scheme}://user:pass@host:5432/db`;
      const result = sanitizeTraceback(trace);
      expect(result).toContain("[connection string redacted]");
      expect(result).not.toContain("user:pass@host");
    },
  );

  it("redacts a connection string with a +driver suffix", () => {
    const trace = "postgresql+psycopg2://user:pass@host/db";
    expect(sanitizeTraceback(trace)).toBe("[connection string redacted]");
  });

  it("leaves unrelated text untouched", () => {
    const trace = "ValueError: invalid literal for int() with base 10";
    expect(sanitizeTraceback(trace)).toBe(trace);
  });
});
