import {
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";

import { getPrismaClient } from "./db.js";
import { processRecord } from "./processRecord.js";
import { safeExc } from "./safeExc.js";

const SQS_QUEUE_URL = process.env.SQS_QUEUE_URL;
if (!SQS_QUEUE_URL) throw new Error("SQS_QUEUE_URL environment variable is not set");

const POLL_WAIT_SECONDS = Number(process.env.POLL_WAIT_SECONDS ?? 5);

const sqs = new SQSClient({
  region: process.env.AWS_DEFAULT_REGION ?? "us-east-1",
  credentials:
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      : undefined,
  endpoint: process.env.AWS_SQS_ENDPOINT_URL,
});

async function poll(): Promise<void> {
  const prisma = await getPrismaClient();
  console.log(`[worker] polling ${SQS_QUEUE_URL} …`);

  for (;;) {
    let response;
    try {
      response = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: SQS_QUEUE_URL,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: POLL_WAIT_SECONDS,
        }),
      );
    } catch (err) {
      console.log(`[worker] receive failed: ${safeExc(err)}`);
      await new Promise((resolve) => setTimeout(resolve, POLL_WAIT_SECONDS * 1000));
      continue;
    }

    for (const message of response.Messages ?? []) {
      try {
        await processRecord(message, prisma);
        await sqs.send(
          new DeleteMessageCommand({
            QueueUrl: SQS_QUEUE_URL,
            ReceiptHandle: message.ReceiptHandle,
          }),
        );
      } catch (err) {
        console.log(`[worker] failed ${message.MessageId}: ${safeExc(err)}`);
      }
    }
  }
}

// This file is only ever run directly (never imported by handler.ts), so it can just
// start polling unconditionally — no __main__-style guard needed.
await poll();
