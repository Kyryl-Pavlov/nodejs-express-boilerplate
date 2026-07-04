import type { LogData, LoggerBackend } from "./logger.js";

/** Ships structured log events to Grafana Loki via the HTTP push API. */
export class LokiLogger implements LoggerBackend {
  private readonly pushUrl: string;
  private readonly labels: Record<string, string>;

  constructor(url: string, labels: Record<string, string>) {
    this.pushUrl = `${url.replace(/\/+$/, "")}/loki/api/v1/push`;
    this.labels = labels;
  }

  private push(
    level: string,
    message: string,
    data?: LogData,
    trace?: string | null,
  ): void {
    const payload: Record<string, unknown> = { level, message };
    if (data) payload.data = data;
    if (trace) payload.trace = trace;

    // Loki wants nanosecond-epoch as a string; Date.now() (ms) padded to ns precision
    // is functionally equivalent here since nothing depends on sub-millisecond ordering.
    const timestampNs = String(BigInt(Date.now()) * 1_000_000n);

    const body = JSON.stringify({
      streams: [
        {
          stream: { ...this.labels, level },
          values: [[timestampNs, JSON.stringify(payload)]],
        },
      ],
    });

    fetch(this.pushUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(2000),
    }).catch(() => {
      // non-fatal — Loki unavailability must not crash the app
    });
  }

  info(message: string, data?: LogData): void {
    this.push("info", message, data, null);
  }

  warning(message: string, data?: LogData): void {
    this.push("warning", message, data, null);
  }

  error(message: string, data?: LogData, trace?: string | null): void {
    this.push("error", message, data, trace);
  }
}
