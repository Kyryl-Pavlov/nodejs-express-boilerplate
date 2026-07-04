import type { Readable } from "node:stream";

import {
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export interface S3Config {
  defaultRegion: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  s3EndpointUrl?: string;
  s3PublicEndpointUrl?: string;
  s3Bucket: string;
  presignedUrlExpiry: number;
}

function client(config: S3Config, opts: { public?: boolean } = {}): S3Client {
  const endpoint = opts.public ? config.s3PublicEndpointUrl : config.s3EndpointUrl;
  return new S3Client({
    region: config.defaultRegion,
    credentials:
      config.accessKeyId && config.secretAccessKey
        ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
        : undefined,
    endpoint,
    forcePathStyle: Boolean(endpoint), // LocalStack-style endpoints need path-style addressing
  });
}

function isBucketNotFound(err: unknown): boolean {
  const name = (err as { name?: string } | undefined)?.name;
  const status = (err as { $metadata?: { httpStatusCode?: number } } | undefined)
    ?.$metadata?.httpStatusCode;
  return name === "NotFound" || name === "NoSuchBucket" || status === 404;
}

/** Caller must pass the internal (non-public) client. */
async function ensureBucket(s3Client: S3Client, bucket: string): Promise<void> {
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (err) {
    if (isBucketNotFound(err)) {
      await s3Client.send(new CreateBucketCommand({ Bucket: bucket }));
    } else {
      throw err;
    }
  }
}

export async function uploadFile(
  config: S3Config,
  fileStream: Readable | Buffer,
  userId: string,
  filename: string,
): Promise<string> {
  const key = `media/${userId}/${filename}`;
  const s3Client = client(config);
  await ensureBucket(s3Client, config.s3Bucket);
  const upload = new Upload({
    client: s3Client,
    params: { Bucket: config.s3Bucket, Key: key, Body: fileStream },
  });
  await upload.done();
  return key;
}

export async function getPresignedUrl(
  config: S3Config,
  s3Key: string,
): Promise<string> {
  const s3Client = client(config, { public: true });
  return getSignedUrl(
    s3Client,
    new GetObjectCommand({ Bucket: config.s3Bucket, Key: s3Key }),
    {
      expiresIn: config.presignedUrlExpiry,
    },
  );
}
