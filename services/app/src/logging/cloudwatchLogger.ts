import {
  CloudWatchLogsClient,
  CreateLogGroupCommand,
  CreateLogStreamCommand,
  PutLogEventsCommand,
  ResourceAlreadyExistsException,
} from "@aws-sdk/client-cloudwatch-logs";

import type { LogData, LoggerBackend } from "./logger.js";

export interface CloudWatchLoggerOptions {
  logGroup: string;
  streamName: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  endpointUrl?: string;
}

/** Ships structured JSON log events to AWS CloudWatch Logs. */
export class CloudWatchLogger implements LoggerBackend {
  private readonly client: CloudWatchLogsClient;
  private readonly logGroup: string;
  private readonly streamName: string;
  private readonly ready: Promise<void>;

  constructor(options: CloudWatchLoggerOptions) {
    this.logGroup = options.logGroup;
    this.streamName = options.streamName;
    this.client = new CloudWatchLogsClient({
      region: options.region ?? "us-east-1",
      credentials:
        options.accessKeyId && options.secretAccessKey
          ? {
              accessKeyId: options.accessKeyId,
              secretAccessKey: options.secretAccessKey,
            }
          : undefined,
      endpoint: options.endpointUrl,
    });
    // Ensures the log group/stream exist exactly once, no matter how many log() calls
    // race in before the first one resolves.
    this.ready = this.ensureLogStream();
  }

  private async ensureLogStream(): Promise<void> {
    try {
      await this.client.send(
        new CreateLogGroupCommand({ logGroupName: this.logGroup }),
      );
    } catch (err) {
      if (!(err instanceof ResourceAlreadyExistsException)) throw err;
    }
    try {
      await this.client.send(
        new CreateLogStreamCommand({
          logGroupName: this.logGroup,
          logStreamName: this.streamName,
        }),
      );
    } catch (err) {
      if (!(err instanceof ResourceAlreadyExistsException)) throw err;
    }
  }

  private serialize(
    level: string,
    message: string,
    data?: LogData,
    trace?: string | null,
  ): string {
    const payload: Record<string, unknown> = { level, message };
    if (data) payload.data = data;
    if (trace) payload.trace = trace;
    return JSON.stringify(payload);
  }

  private async ship(message: string): Promise<void> {
    await this.ready;
    await this.client.send(
      new PutLogEventsCommand({
        logGroupName: this.logGroup,
        logStreamName: this.streamName,
        logEvents: [{ message, timestamp: Date.now() }],
      }),
    );
  }

  info(message: string, data?: LogData): void {
    this.ship(this.serialize("info", message, data)).catch(() => {
      // non-fatal — CloudWatch unavailability must not crash the app
    });
  }

  warning(message: string, data?: LogData): void {
    this.ship(this.serialize("warning", message, data)).catch(() => {
      // non-fatal — CloudWatch unavailability must not crash the app
    });
  }

  error(message: string, data?: LogData, trace?: string | null): void {
    this.ship(this.serialize("error", message, data, trace)).catch(() => {
      // non-fatal — CloudWatch unavailability must not crash the app
    });
  }
}
