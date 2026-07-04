export type ConfigName = "development" | "production" | "testing";

export interface AppConfig {
  configName: ConfigName;
  debug: boolean;
  graphqlIntrospection: boolean;
  secretKey: string;
  maxContentLength: number;
  databaseUrl: string;
  jwtSecretKey: string;
  jwtAlgorithm: "HS256";
  jwtAccessTokenExpiresIn: string;
  jwtRefreshTokenExpiresIn: string;
  restApiVersion: string;
  restApiVersionNumber: string;
  graphqlApiVersionNumber: string;
  aws: {
    accessKeyId?: string;
    secretAccessKey?: string;
    defaultRegion: string;
    s3Bucket: string;
    s3EndpointUrl?: string;
    s3PublicEndpointUrl?: string;
    presignedUrlExpiry: number;
    sqsEndpointUrl?: string;
    sqsQueueUrl?: string;
  };
  sentryDsn?: string;
  cloudwatchLogGroup?: string;
  cloudwatchStreamName: string;
  cloudwatchEndpointUrl?: string;
  lokiUrl?: string;
  redisUrl?: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is not set — refusing to start`);
  }
  return value;
}

/**
 * Callers (server.ts, tests) always pass configName explicitly rather than
 * reading it from an env var here.
 */
export function loadConfig(configName: ConfigName): AppConfig {
  const secretKey = requireEnv("SECRET_KEY");

  return {
    configName,
    debug: configName === "development",
    // Only "development" enables introspection — "testing" falls back to false like production.
    graphqlIntrospection: configName === "development",
    secretKey,
    maxContentLength: 50 * 1024 * 1024, // 50 MB
    databaseUrl:
      process.env.DATABASE_URL ?? "postgresql://user:password@localhost:5432/appdb",
    jwtSecretKey: process.env.JWT_SECRET_KEY || secretKey,
    jwtAlgorithm: "HS256",
    jwtAccessTokenExpiresIn: "15m",
    jwtRefreshTokenExpiresIn: "30d",
    restApiVersion: process.env.REST_API_V ?? "v1",
    restApiVersionNumber: process.env.REST_API_VN ?? "1.0.0",
    graphqlApiVersionNumber: process.env.GRAPHQL_API_VN ?? "1.0.0",
    aws: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      defaultRegion: process.env.AWS_DEFAULT_REGION ?? "us-east-1",
      s3Bucket: process.env.AWS_S3_BUCKET ?? "media-bucket",
      s3EndpointUrl: process.env.AWS_S3_ENDPOINT_URL,
      s3PublicEndpointUrl: process.env.AWS_S3_PUBLIC_ENDPOINT_URL,
      presignedUrlExpiry: Number(process.env.PRESIGNED_URL_EXPIRY ?? 86400),
      sqsEndpointUrl: process.env.AWS_SQS_ENDPOINT_URL,
      sqsQueueUrl: process.env.SQS_QUEUE_URL,
    },
    sentryDsn: process.env.SENTRY_DSN,
    cloudwatchLogGroup: process.env.CLOUDWATCH_LOG_GROUP,
    cloudwatchStreamName: process.env.CLOUDWATCH_STREAM_NAME ?? "app",
    cloudwatchEndpointUrl: process.env.CLOUDWATCH_ENDPOINT_URL,
    lokiUrl: process.env.LOKI_URL,
    redisUrl: process.env.REDIS_URL,
  };
}
