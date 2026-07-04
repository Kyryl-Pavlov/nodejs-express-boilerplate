import {
  CreateQueueCommand,
  GetQueueUrlCommand,
  QueueDoesNotExist,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";

export interface SqsConfig {
  defaultRegion: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sqsEndpointUrl?: string;
  sqsQueueUrl?: string;
}

function client(config: SqsConfig): SQSClient {
  return new SQSClient({
    region: config.defaultRegion,
    credentials:
      config.accessKeyId && config.secretAccessKey
        ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
        : undefined,
    endpoint: config.sqsEndpointUrl,
  });
}

async function ensureQueue(sqsClient: SQSClient, queueUrl: string): Promise<void> {
  const queueName = queueUrl.replace(/\/+$/, "").split("/").pop() as string;
  try {
    await sqsClient.send(new GetQueueUrlCommand({ QueueName: queueName }));
  } catch (err) {
    if (err instanceof QueueDoesNotExist) {
      await sqsClient.send(new CreateQueueCommand({ QueueName: queueName }));
    } else {
      throw err;
    }
  }
}

/** Publishes an event to the SQS queue. Returns the SQS MessageId. */
export async function sendEvent(
  config: SqsConfig,
  eventType: string,
  payload: unknown,
): Promise<string> {
  const queueUrl = config.sqsQueueUrl;
  if (!queueUrl) throw new Error("SQS_QUEUE_URL is not configured");

  const sqsClient = client(config);
  if (config.sqsEndpointUrl) {
    // LocalStack only — queue is pre-created by Terraform in production.
    await ensureQueue(sqsClient, queueUrl);
  }

  const body = JSON.stringify({ type: eventType, payload });
  const response = await sqsClient.send(
    new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: body }),
  );
  return response.MessageId as string;
}
