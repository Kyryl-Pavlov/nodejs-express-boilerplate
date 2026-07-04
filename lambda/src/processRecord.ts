import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";

// Shape differs depending on caller: real Lambda SQS event source records use
// lowerCamelCase (messageId/body); poll()'s raw ReceiveMessageCommand responses
// use PascalCase (MessageId/Body) — handle both.
export interface RawSqsRecord {
  MessageId?: string;
  messageId?: string;
  Body?: string;
  body?: string;
}

export async function processRecord(
  record: RawSqsRecord,
  prisma: PrismaClient,
): Promise<void> {
  const messageId = record.MessageId ?? record.messageId ?? randomUUID();
  const rawBody = record.Body ?? record.body ?? "{}";
  const body = JSON.parse(rawBody) as { type?: string; payload?: unknown };
  const now = new Date();

  await prisma.event.createMany({
    data: [
      {
        sqsMessageId: messageId,
        type: body.type ?? "unknown",
        payload: (body.payload ?? {}) as Prisma.InputJsonValue,
        status: "processed",
        createdAt: now,
        processedAt: now,
      },
    ],
    skipDuplicates: true, // ON CONFLICT (sqs_message_id) DO NOTHING
  });
}
