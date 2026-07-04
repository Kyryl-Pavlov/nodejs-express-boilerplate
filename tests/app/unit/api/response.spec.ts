import { restApiResponse } from "@app/api/utils/response.js";
import { AppLogger } from "@app/logging/logger.js";
import type { Response } from "express";
import { describe, expect, it, vi } from "vitest";

function fakeResponse(loggerAdapter?: AppLogger) {
  const sent: { body?: unknown; statusCode?: number } = {};
  const res = {
    req: { app: { loggerAdapter } },
    status(code: number) {
      sent.statusCode = code;
      return res;
    },
    json(body: unknown) {
      sent.body = body;
      return res;
    },
  } as unknown as Response;
  return { res, sent };
}

describe("restApiResponse", () => {
  it("defaults to a 200 success envelope with empty data", () => {
    const { res, sent } = fakeResponse();
    restApiResponse(res);
    expect(sent.statusCode).toBe(200);
    expect(sent.body).toEqual({ success: true, message: "", data: {} });
  });

  it("returns custom data untouched", () => {
    const { res, sent } = fakeResponse();
    restApiResponse(res, { data: { access_token: "abc" } });
    expect(sent.body).toEqual({
      success: true,
      message: "",
      data: { access_token: "abc" },
    });
  });

  it("preserves a list passed as data (e.g. the events list endpoint)", () => {
    const { res, sent } = fakeResponse();
    restApiResponse(res, { data: [{ id: "1" }, { id: "2" }] });
    expect(sent.body).toEqual({
      success: true,
      message: "",
      data: [{ id: "1" }, { id: "2" }],
    });
  });

  it("returns the given status code on failure", () => {
    const { res, sent } = fakeResponse();
    restApiResponse(res, { success: false, message: "nope", statusCode: 409 });
    expect(sent.statusCode).toBe(409);
    expect(sent.body).toEqual({ success: false, message: "nope", data: {} });
  });

  it("logs at INFO level on success", () => {
    const logAdapter = new AppLogger();
    const spy = vi.spyOn(logAdapter, "log");
    const { res } = fakeResponse(logAdapter);
    restApiResponse(res, { message: "ok" });
    expect(spy).toHaveBeenCalledWith("ok", expect.objectContaining({ level: "info" }));
  });

  it("logs at WARN level on failure with a status code below 500", () => {
    const logAdapter = new AppLogger();
    const spy = vi.spyOn(logAdapter, "log");
    const { res } = fakeResponse(logAdapter);
    restApiResponse(res, { success: false, message: "bad", statusCode: 400 });
    expect(spy).toHaveBeenCalledWith("bad", expect.objectContaining({ level: "warn" }));
  });

  it("logs at ERROR level on failure with a status code >= 500", () => {
    const logAdapter = new AppLogger();
    const spy = vi.spyOn(logAdapter, "log");
    const { res } = fakeResponse(logAdapter);
    restApiResponse(res, { success: false, message: "boom", statusCode: 500 });
    expect(spy).toHaveBeenCalledWith(
      "boom",
      expect.objectContaining({ level: "error" }),
    );
  });

  it("does not pass empty data to the logger", () => {
    const logAdapter = new AppLogger();
    const spy = vi.spyOn(logAdapter, "log");
    const { res } = fakeResponse(logAdapter);
    restApiResponse(res, { message: "ok", data: {} });
    expect(spy).toHaveBeenCalledWith("ok", expect.objectContaining({ data: null }));
  });

  it("passes non-empty data to the logger", () => {
    const logAdapter = new AppLogger();
    const spy = vi.spyOn(logAdapter, "log");
    const { res } = fakeResponse(logAdapter);
    restApiResponse(res, { message: "ok", data: { id: "1" } });
    expect(spy).toHaveBeenCalledWith(
      "ok",
      expect.objectContaining({ data: { id: "1" } }),
    );
  });

  it("does not throw when no loggerAdapter is present on the app", () => {
    const { res } = fakeResponse(undefined);
    expect(() => restApiResponse(res, { message: "ok" })).not.toThrow();
  });
});
