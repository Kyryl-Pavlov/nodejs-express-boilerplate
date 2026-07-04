import type { Event as PrismaEvent } from "@prisma/client";

export function eventToPayload(row: PrismaEvent) {
  return {
    id: row.id,
    sqsMessageId: row.sqsMessageId,
    type: row.type,
    payload: row.payload,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    processedAt: row.processedAt ? row.processedAt.toISOString() : null,
  };
}
