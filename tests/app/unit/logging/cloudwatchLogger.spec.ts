import { describe, expect, it, vi } from "vitest";

const send = vi.fn().mockResolvedValue({});

class FakeResourceAlreadyExistsException extends Error {}

vi.mock("@aws-sdk/client-cloudwatch-logs", () => {
  return {
    CloudWatchLogsClient: vi.fn().mockImplementation(() => ({ send })),
    CreateLogGroupCommand: vi.fn().mockImplementation((input: unknown) => ({
      __type: "CreateLogGroupCommand",
      input,
    })),
    CreateLogStreamCommand: vi.fn().mockImplementation((input: unknown) => ({
      __type: "CreateLogStreamCommand",
      input,
    })),
    PutLogEventsCommand: vi.fn().mockImplementation((input: unknown) => ({
      __type: "PutLogEventsCommand",
      input,
    })),
    ResourceAlreadyExistsException: FakeResourceAlreadyExistsException,
  };
});

const { CloudWatchLogger } = await import("@app/logging/cloudwatchLogger.js");

function commandOfType(type: string) {
  return send.mock.calls.map((call) => call[0]).find((cmd) => cmd.__type === type);
}

describe("CloudWatchLogger", () => {
  it("ensures the log group and stream exist on construction", async () => {
    send.mockClear();
    new CloudWatchLogger({ logGroup: "/myapp/dev", streamName: "app" });
    await vi.waitFor(() => {
      expect(commandOfType("CreateLogGroupCommand")).toBeDefined();
      expect(commandOfType("CreateLogStreamCommand")).toBeDefined();
    });
  });

  it("swallows ResourceAlreadyExistsException when the group/stream already exist", async () => {
    send.mockClear();
    send.mockRejectedValueOnce(new FakeResourceAlreadyExistsException("exists"));
    send.mockRejectedValueOnce(new FakeResourceAlreadyExistsException("exists"));
    send.mockResolvedValue({});
    const logger = new CloudWatchLogger({ logGroup: "/myapp/dev", streamName: "app" });
    logger.info("hello");
    await vi.waitFor(() => {
      expect(commandOfType("PutLogEventsCommand")).toBeDefined();
    });
  });

  it("ships a serialized info event", async () => {
    send.mockClear();
    send.mockResolvedValue({});
    const logger = new CloudWatchLogger({ logGroup: "/myapp/dev", streamName: "app" });
    logger.info("hello", { key: "val" });

    await vi.waitFor(() => expect(commandOfType("PutLogEventsCommand")).toBeDefined());
    const put = commandOfType("PutLogEventsCommand");
    const message = JSON.parse(put.input.logEvents[0].message);
    expect(message).toEqual({ level: "info", message: "hello", data: { key: "val" } });
  });

  it("ships a serialized error event including the trace", async () => {
    send.mockClear();
    send.mockResolvedValue({});
    const logger = new CloudWatchLogger({ logGroup: "/myapp/dev", streamName: "app" });
    logger.error("boom", null, "stack trace here");

    await vi.waitFor(() => expect(commandOfType("PutLogEventsCommand")).toBeDefined());
    const put = commandOfType("PutLogEventsCommand");
    const message = JSON.parse(put.input.logEvents[0].message);
    expect(message).toEqual({
      level: "error",
      message: "boom",
      trace: "stack trace here",
    });
  });

  it("omits data/trace keys entirely when not provided", async () => {
    send.mockClear();
    send.mockResolvedValue({});
    const logger = new CloudWatchLogger({ logGroup: "/myapp/dev", streamName: "app" });
    logger.warning("careful");

    await vi.waitFor(() => expect(commandOfType("PutLogEventsCommand")).toBeDefined());
    const put = commandOfType("PutLogEventsCommand");
    const message = JSON.parse(put.input.logEvents[0].message);
    expect(message).toEqual({ level: "warning", message: "careful" });
  });

  it("targets the configured log group and stream", async () => {
    send.mockClear();
    send.mockResolvedValue({});
    const logger = new CloudWatchLogger({
      logGroup: "/custom/group",
      streamName: "custom-stream",
    });
    logger.info("hello");

    await vi.waitFor(() => expect(commandOfType("PutLogEventsCommand")).toBeDefined());
    const put = commandOfType("PutLogEventsCommand");
    expect(put.input.logGroupName).toBe("/custom/group");
    expect(put.input.logStreamName).toBe("custom-stream");
  });
});
