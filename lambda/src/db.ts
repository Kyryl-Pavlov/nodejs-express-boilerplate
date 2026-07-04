import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { PrismaClient } from "@prisma/client";

async function resolveDatabaseUrl(): Promise<string> {
  const secretArn = process.env.DATABASE_URL_SECRET_ARN;
  if (secretArn) {
    const client = new SecretsManagerClient({
      region: process.env.AWS_DEFAULT_REGION ?? "us-east-1",
    });
    const response = await client.send(
      new GetSecretValueCommand({ SecretId: secretArn }),
    );
    if (!response.SecretString) {
      throw new Error(`Secret ${secretArn} has no SecretString`);
    }
    return response.SecretString;
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL environment variable is not set");
  return url;
}

let clientPromise: Promise<PrismaClient> | undefined;

/** Memoized so Secrets Manager is only hit once per process. */
export function getPrismaClient(): Promise<PrismaClient> {
  clientPromise ??= resolveDatabaseUrl().then(
    (url) => new PrismaClient({ datasources: { db: { url } } }),
  );
  return clientPromise;
}
