import { makeExecutableSchema } from "@graphql-tools/schema";
import express, { type Express } from "express";
import { NoSchemaIntrospectionCustomRule } from "graphql";
import { createHandler } from "graphql-http/lib/use/express";
import promClient from "prom-client";
import { ruruHTML } from "ruru/server";

import { type ConfigName, loadConfig } from "./config.js";
import { type AppGraphQLContext, buildContext } from "./graphql/context.js";
import {
  GRAPHQL_PATH,
  isGraphqlMultipartRequest,
  parseGraphqlMultipart,
} from "./graphql/multipartUpload.js";
import { resolvers } from "./graphql/resolvers/index.js";
import { typeDefs } from "./graphql/schema.js";
import { CloudWatchLogger } from "./logging/cloudwatchLogger.js";
import {
  AppLogger,
  ConsoleLogger,
  type LoggerBackend,
  LogLevel,
} from "./logging/logger.js";
import { LokiLogger } from "./logging/lokiLogger.js";
import { SentryLogger } from "./logging/sentryLogger.js";
import { getPrismaClient } from "./prisma.js";
import { buildV1Router } from "./routes/v1/index.js";
import { CacheService } from "./services/cacheService.js";

const APP_LABEL = "nodejs-express-boilerplate";

promClient.register.setDefaultLabels({ app: APP_LABEL });
const httpRequestDuration = new promClient.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"],
  registers: [promClient.register],
});

export async function buildApp(configName: ConfigName): Promise<Express> {
  const config = loadConfig(configName);

  const app = express();

  app.config = config;
  app.prisma = getPrismaClient();

  const loggers: LoggerBackend[] = [new ConsoleLogger(config.debug)];

  if (config.sentryDsn) {
    loggers.push(new SentryLogger({ dsn: config.sentryDsn, environment: configName }));
  }

  if (config.cloudwatchLogGroup) {
    try {
      loggers.push(
        new CloudWatchLogger({
          logGroup: config.cloudwatchLogGroup,
          streamName: config.cloudwatchStreamName,
          region: config.aws.defaultRegion,
          accessKeyId: config.aws.accessKeyId,
          secretAccessKey: config.aws.secretAccessKey,
          endpointUrl: config.cloudwatchEndpointUrl,
        }),
      );
    } catch (err) {
      // loggerAdapter doesn't exist yet at this point in bootstrap, so fall back to console.
      console.warn(`CloudWatch logger unavailable, skipping: ${String(err)}`);
    }
  }

  if (config.lokiUrl) {
    loggers.push(new LokiLogger(config.lokiUrl, { app: APP_LABEL, env: configName }));
  }

  app.loggerAdapter = new AppLogger(...loggers);
  app.cache = config.redisUrl ? CacheService.fromUrl(config.redisUrl) : null;

  // 50 MB hard limit on all requests — rejected before any handler runs (see
  // CLAUDE.md's Security Measures table).
  app.use((req, res, next) => {
    const contentLength = Number(req.headers["content-length"] ?? 0);
    if (contentLength > config.maxContentLength) {
      res.status(413).json({ msg: "Payload too large" });
      return;
    }
    next();
  });

  app.use(express.json({ limit: config.maxContentLength }));

  app.use((req, res, next) => {
    req.startTime = process.hrtime.bigint();

    res.on("finish", () => {
      const start = req.startTime;
      const durationMs = start
        ? Number(process.hrtime.bigint() - start) / 1_000_000
        : 0;
      const route = req.route ? `${req.baseUrl}${req.route.path}` : req.path;

      httpRequestDuration.observe(
        { method: req.method, route, status_code: res.statusCode },
        durationMs / 1000,
      );

      app.loggerAdapter.log("response", {
        level: LogLevel.INFO,
        data: {
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          duration_ms: Math.round(durationMs * 100) / 100,
        },
      });
    });

    next();
  });

  app.get("/metrics", async (_req, res) => {
    res.set("Content-Type", promClient.register.contentType);
    res.send(await promClient.register.metrics());
  });

  app.use(`/api/${config.restApiVersion}`, buildV1Router());

  // Rewrites GraphQL multipart requests (file uploads) into a normal {query,
  // variables} body before graphql-http parses it — see multipartUpload.ts. The
  // content-type is overwritten too: graphql-http's own request parser only reads
  // `req.body` for requests it sees as `application/json`, and returns 415 for any
  // other content-type without even looking at the (already-rewritten) body.
  app.use(GRAPHQL_PATH, async (req, _res, next) => {
    if (isGraphqlMultipartRequest(req)) {
      try {
        req.body = await parseGraphqlMultipart(req);
        req.headers["content-type"] = "application/json; charset=utf-8";
      } catch (err) {
        next(err);
        return;
      }
    }
    next();
  });

  const schema = makeExecutableSchema({ typeDefs, resolvers });

  if (config.graphqlIntrospection) {
    app.get(GRAPHQL_PATH, (_req, res) => {
      res.type("html").send(ruruHTML({ endpoint: GRAPHQL_PATH }));
    });
  }

  app.all(
    GRAPHQL_PATH,
    createHandler<AppGraphQLContext>({
      schema,
      context: (req) => buildContext(req.raw),
      validationRules: config.graphqlIntrospection
        ? []
        : [NoSchemaIntrospectionCustomRule],
    }),
  );

  return app;
}
