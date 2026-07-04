import pino from "pino";

import { maskSensitive, sanitizeTraceback } from "./dataFilter.js";

export type LogData = Record<string, unknown> | null;

export interface LoggerBackend {
  info(message: string, data?: LogData): void;
  warning(message: string, data?: LogData): void;
  error(message: string, data?: LogData, trace?: string | null): void;
}

/** Logs to stdout via pino. Level is debug when the app runs in debug mode, warn otherwise. */
export class ConsoleLogger implements LoggerBackend {
  private readonly logger: pino.Logger;

  constructor(debug = false, name = "app", destination?: pino.DestinationStream) {
    this.logger = destination
      ? pino({ name, level: debug ? "debug" : "warn" }, destination)
      : pino({ name, level: debug ? "debug" : "warn" });
  }

  info(message: string, data?: LogData): void {
    if (data) this.logger.info({ data }, message);
    else this.logger.info(message);
  }

  warning(message: string, data?: LogData): void {
    if (data) this.logger.warn({ data }, message);
    else this.logger.warn(message);
  }

  error(message: string, data?: LogData, trace?: string | null): void {
    const fields: Record<string, unknown> = {};
    if (data) fields.data = data;
    if (trace) fields.trace = trace;
    if (Object.keys(fields).length > 0) this.logger.error(fields, message);
    else this.logger.error(message);
  }
}

export enum LogLevel {
  INFO = "info",
  WARN = "warn",
  ERROR = "error",
}

export interface LogOptions {
  level?: LogLevel;
  data?: LogData;
  exc?: unknown;
}

/** Fanout adapter — dispatches a single log call to every configured backend. */
export class AppLogger {
  static readonly Level = LogLevel;

  private readonly loggers: LoggerBackend[];

  constructor(...loggers: LoggerBackend[]) {
    this.loggers = loggers;
  }

  log(message: string, options: LogOptions = {}): void {
    const { level = LogLevel.INFO, data = null, exc = null } = options;
    const safeData = maskSensitive(data) as LogData;

    switch (level) {
      case LogLevel.INFO:
        for (const logger of this.loggers) logger.info(message, safeData);
        break;
      case LogLevel.WARN:
        for (const logger of this.loggers) logger.warning(message, safeData);
        break;
      case LogLevel.ERROR: {
        let trace: string | null = null;
        if (exc !== null && exc !== undefined) {
          const raw = exc instanceof Error ? (exc.stack ?? String(exc)) : String(exc);
          trace = sanitizeTraceback(raw);
        }
        for (const logger of this.loggers) logger.error(message, safeData, trace);
        break;
      }
    }
  }
}
