import * as Sentry from "@sentry/node";

import type { LogData, LoggerBackend } from "./logger.js";

export interface SentryLoggerOptions {
  dsn: string;
  environment?: string;
  tracesSampleRate?: number;
}

/** Routes log calls to Sentry. info/warn become breadcrumbs; errors become captured events. */
export class SentryLogger implements LoggerBackend {
  constructor(options: SentryLoggerOptions) {
    Sentry.init({
      dsn: options.dsn,
      environment: options.environment ?? "production",
      tracesSampleRate: options.tracesSampleRate ?? 0.1,
    });
  }

  info(message: string, data?: LogData): void {
    Sentry.addBreadcrumb({ message, level: "info", data: data ?? {} });
  }

  warning(message: string, data?: LogData): void {
    Sentry.addBreadcrumb({ message, level: "warning", data: data ?? {} });
  }

  error(message: string, data?: LogData, trace?: string | null): void {
    Sentry.withScope((scope) => {
      if (data) scope.setExtra("data", data);
      if (trace) scope.setExtra("trace", trace);
      Sentry.captureMessage(message, "error");
    });
  }
}
