import { getPrismaClient } from "./db.js";
import { processRecord, type RawSqsRecord } from "./processRecord.js";

interface SqsLambdaEvent {
  Records?: RawSqsRecord[];
}

/** AWS Lambda entry point — invoked by the SQS event source mapping. */
export async function handler(
  event: SqsLambdaEvent,
  _context?: unknown,
): Promise<{ statusCode: number }> {
  const prisma = await getPrismaClient();
  try {
    for (const record of event.Records ?? []) {
      await processRecord(record, prisma);
    }
  } finally {
    // Fresh connection per invocation in the serverless runtime — no cross-invocation pooling.
    await prisma.$disconnect();
  }
  return { statusCode: 200 };
}
