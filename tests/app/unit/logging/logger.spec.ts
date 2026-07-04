import {
  AppLogger,
  ConsoleLogger,
  LogLevel,
  type LoggerBackend,
} from "@app/logging/logger.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

class CapturingDestination {
  lines: Record<string, unknown>[] = [];
  write(chunk: string): void {
    this.lines.push(JSON.parse(chunk) as Record<string, unknown>);
  }
}

describe("ConsoleLogger", () => {
  it("logs info messages when debug=true", () => {
    const dest = new CapturingDestination();
    const logger = new ConsoleLogger(true, "app", dest);
    logger.info("hello");
    expect(dest.lines).toHaveLength(1);
    expect(dest.lines[0].msg).toBe("hello");
  });

  it("suppresses info messages when debug=false", () => {
    const dest = new CapturingDestination();
    const logger = new ConsoleLogger(false, "app", dest);
    logger.info("hello");
    expect(dest.lines).toHaveLength(0);
  });

  it("includes data in the log record when provided", () => {
    const dest = new CapturingDestination();
    const logger = new ConsoleLogger(true, "app", dest);
    logger.info("hello", { key: "val" });
    expect(dest.lines[0].data).toEqual({ key: "val" });
  });

  it("always emits warning messages regardless of debug flag", () => {
    const dest = new CapturingDestination();
    const logger = new ConsoleLogger(false, "app", dest);
    logger.warning("careful");
    expect(dest.lines).toHaveLength(1);
    expect(dest.lines[0].msg).toBe("careful");
  });

  it("always emits error messages regardless of debug flag", () => {
    const dest = new CapturingDestination();
    const logger = new ConsoleLogger(false, "app", dest);
    logger.error("boom");
    expect(dest.lines).toHaveLength(1);
  });

  it("includes trace in the log record when provided", () => {
    const dest = new CapturingDestination();
    const logger = new ConsoleLogger(false, "app", dest);
    logger.error("boom", null, "Error: boom\n  at foo");
    expect(dest.lines[0].trace).toBe("Error: boom\n  at foo");
  });
});

describe("AppLogger", () => {
  let backend: LoggerBackend;

  beforeEach(() => {
    backend = { info: vi.fn(), warning: vi.fn(), error: vi.fn() };
  });

  it("defaults to INFO level", () => {
    new AppLogger(backend).log("hello");
    expect(backend.info).toHaveBeenCalledWith("hello", null);
  });

  it("dispatches WARN to logger.warning", () => {
    new AppLogger(backend).log("careful", { level: LogLevel.WARN });
    expect(backend.warning).toHaveBeenCalledWith("careful", null);
  });

  it("dispatches ERROR to logger.error", () => {
    new AppLogger(backend).log("boom", { level: LogLevel.ERROR });
    expect(backend.error).toHaveBeenCalledWith("boom", null, null);
  });

  it("fans out to every configured backend", () => {
    const second: LoggerBackend = { info: vi.fn(), warning: vi.fn(), error: vi.fn() };
    new AppLogger(backend, second).log("hello");
    expect(backend.info).toHaveBeenCalledOnce();
    expect(second.info).toHaveBeenCalledOnce();
  });

  it("masks sensitive data before dispatching", () => {
    new AppLogger(backend).log("login", {
      data: { password: "hunter2", email: "a@b.com" },
    });
    expect(backend.info).toHaveBeenCalledWith("login", {
      password: "***",
      email: "a@b.com",
    });
  });

  it("converts a real Error into a sanitized trace on ERROR level", () => {
    const err = new Error("db connection failed: postgresql://user:pass@host/db");
    new AppLogger(backend).log("failure", { level: LogLevel.ERROR, exc: err });
    const [, , trace] = (backend.error as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      unknown,
      string,
    ];
    expect(trace).toContain("[connection string redacted]");
    expect(trace).not.toContain("user:pass@host");
  });

  it("passes a null trace when no exception is given on ERROR level", () => {
    new AppLogger(backend).log("failure", { level: LogLevel.ERROR });
    expect(backend.error).toHaveBeenCalledWith("failure", null, null);
  });

  it("exposes Level as a static alias, matching AppLogger.Level.X call sites", () => {
    expect(AppLogger.Level.INFO).toBe(LogLevel.INFO);
    expect(AppLogger.Level.WARN).toBe(LogLevel.WARN);
    expect(AppLogger.Level.ERROR).toBe(LogLevel.ERROR);
  });

  it("works with zero backends configured", () => {
    expect(() => new AppLogger().log("hello")).not.toThrow();
  });
});
