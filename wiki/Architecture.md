# Architecture

## Project structure

```
.
├── services/app/                    # Express REST + GraphQL API
│   ├── src/
│   │   ├── app.ts                   # App factory (buildApp)
│   │   ├── server.ts                # Entry point — used by both Dockerfiles
│   │   ├── config.ts                # loadConfig(configName) — dev/prod/testing
│   │   ├── prisma.ts                # Prisma client singleton
│   │   ├── lib/                     # auth.ts (JWT), password.ts (bcrypt), uuid.ts
│   │   ├── services/                # External integrations (S3, SQS, cache)
│   │   ├── logging/                 # AppLogger, SentryLogger, CloudWatchLogger, dataFilter
│   │   ├── api/utils/                # restApiResponse()
│   │   ├── routes/v1/               # REST route modules (auth, media, events, cacheTest, health)
│   │   └── graphql/                 # schema.ts, resolvers/, multipartUpload.ts, response.ts, utils.ts
│   ├── prisma/                      # schema.prisma + migrations/
│   ├── Dockerfile                   # Production image (multi-stage, plain node)
│   └── Dockerfile.dev                # Dev image (tsx watch + Node inspector)
├── lambda/
│   ├── src/handler.ts                # Lambda entry point: handler(event, context)
│   ├── src/poll.ts                   # Long-poll loop entry point, for local dev
│   ├── src/processRecord.ts          # Shared record-processing logic
│   ├── Dockerfile                    # Local dev worker (docker-compose)
│   └── Dockerfile.lambda             # AWS Lambda image
├── docker-compose.yml
├── package.json                      # npm workspaces root (services/app, lambda)
├── tsconfig.base.json
└── .github/workflows/
```

## App factory

`services/app/src/app.ts` exports `buildApp(configName)`, mirroring a Flask-style app-factory pattern: it builds config, wires up logging/cache/Prisma, and assigns them directly as properties on the Express `app` object — `app.config`, `app.prisma`, `app.loggerAdapter`, `app.cache` — via the `Express.Application` augmentation in `services/app/src/types/express.d.ts`. It then registers a body-size guard middleware, `express.json()`, a request-timing middleware, the REST router, the GraphQL multipart-rewriting middleware, and the `graphql-http` handler, and returns the Express `Application`.

`src/server.ts` is the single entry point used by **both** Dockerfiles — `Dockerfile.dev` runs it via `tsx watch`, `Dockerfile` runs the compiled `dist/server.js`. It calls `app.listen(5000, "0.0.0.0")` and attaches an `error` listener to the returned server so startup failures (e.g. port already in use) exit the process immediately instead of hanging. It picks `"production"` vs `"development"` based on `APP_ENV`.

## Dual API layer

Every feature is exposed over both REST and GraphQL, sharing the same Prisma models and service modules — only the transport layer differs.

- **REST**: `services/app/src/routes/v1/` — one `express.Router()` per resource (`export function xRoutes(): Router`), mounted under `/api/v1/` via `app.use(prefix, router)`
- **GraphQL**: `services/app/src/graphql/` — SDL-first schema (`schema.ts`) built into an executable schema by `@graphql-tools/schema`'s `makeExecutableSchema()`, served through `graphql-http`'s `createHandler()` mounted at `/graphql` via `app.all(GRAPHQL_PATH, ...)`. In development (`config.graphqlIntrospection === true`), `GET /graphql` additionally serves `ruruHTML()` from the `ruru` package — an interactive GraphQL explorer, the Express-era replacement for Mercurius's bundled GraphiQL.

GraphQL resolvers don't use route-level middleware — they call `verifyAccessToken(context.request)` / `verifyRefreshToken(context.request)` manually inside each resolver (`src/lib/auth.ts`), since `graphql-http`'s single `createHandler` entry point has no per-resolver middleware chain the way Express routes do.

## Configuration

`services/app/src/config.ts` exports `loadConfig(configName)`, mirroring Flask's `Config`/`DevelopmentConfig`/`ProductionConfig`/`TestingConfig` split as a single function with a `configName` branch. Callers (`server.ts`, tests) always pass the name explicitly rather than reading it from an env var inside `loadConfig` itself. All AWS/S3 settings live on the single returned `AppConfig` object so they're present in every environment.

## S3 / LocalStack split endpoint

`services/app/src/services/awsS3Service.ts` maintains two S3 client modes:

- `client(config)` — uses `AWS_S3_ENDPOINT_URL` (`http://localstack:4566`) for internal operations. Resolvable only inside Docker.
- `client(config, { public: true })` — uses `AWS_S3_PUBLIC_ENDPOINT_URL` (`http://localhost:4566`) for presigned URLs, since those are opened by the browser on the host machine, which cannot resolve the `localstack` hostname.

In production both env vars are unset, so the AWS SDK routes to real AWS automatically. `uploadFile()` uses `@aws-sdk/lib-storage`'s `Upload` class for streaming, arbitrary-size uploads — except GraphQL uploads, which are buffered (see below).

## Models

All models live in one Prisma schema: `services/app/prisma/schema.prisma`. Fields are camelCase with `@map("snake_case")` per field and `@@map("table_name")` per model — the actual Postgres schema is snake_case (`users`, `media`, `events`) while TypeScript code uses idiomatic camelCase throughout.

| Model   | Key fields                                                                                                      |
| ------- | --------------------------------------------------------------------------------------------------------------- |
| `User`  | `id` (UUID PK), `email` (unique), `passwordHash`, `createdAt`                                                   |
| `Media` | `id` (UUID PK), `userId` (FK → users, cascade delete), `contentKey` (S3 object key, **not** a URL), `createdAt` |
| `Event` | `id` (UUID PK), `sqsMessageId` (unique), `type`, `payload` (JSON), `status`, `createdAt`, `processedAt`         |

`contentKey` stores the S3 key (`media/<user_id>/<filename>`). Presigned URLs are generated on demand and never persisted.

## GraphQL file uploads

`graphql-http` has no first-party multipart upload support. `services/app/src/graphql/multipartUpload.ts` hand-rolls the jaydenseric GraphQL multipart request spec (`operations`/`map`/file parts) directly on top of `busboy` — the same low-level library `lib/multipart.ts` uses for the REST upload endpoint, just a second, independent parser instance scoped to `/graphql` requests.

A middleware in `app.ts`, mounted on `GRAPHQL_PATH` ahead of the `graphql-http` handler, detects `multipart/form-data` requests to `/graphql` (`isGraphqlMultipartRequest()`) and replaces `req.body` with the result of `parseGraphqlMultipart(req)` — a normal `{ query, variables }` object with each file placeholder resolved to a `ResolvedUpload` — before `graphql-http` ever parses the request. Each uploaded file part is buffered fully into memory (`Buffer.concat` over the part's `data` events) rather than kept as a live stream, since the resolved value must be a plain object a resolver argument can hold directly.

## Async event processing

```
Express app  →  SQS queue  →  Lambda (locally: worker container)  →  PostgreSQL
```

Locally, the `worker` container (`lambda/src/poll.ts`) long-polls SQS (`WaitTimeSeconds=5`); on a message it inserts into `events` via `createMany({ skipDuplicates: true })` (→ `ON CONFLICT DO NOTHING` on `sqs_message_id`), safe for at-least-once delivery. Messages are deleted from the queue only after a successful DB write.

`processRecord.ts` handles both AWS event shapes in one function: real Lambda SQS event records use lowerCamelCase (`messageId`/`body`), while `poll()`'s raw `ReceiveMessageCommand` responses use PascalCase (`MessageId`/`Body`).

Two Dockerfiles, two runtimes — **never swap them**:

| File                       | Used by                                    | Behavior                                                                        |
| -------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------- |
| `lambda/Dockerfile`        | `docker-compose.yml` worker service        | `npm run dev --workspace=lambda` → `poll()` via `tsx watch` (long-running loop) |
| `lambda/Dockerfile.lambda` | `deploy-dev.yml` / `deploy-prod.yml` CI/CD | `dist/handler.handler` → Lambda RIC calls `handler()` per batch                 |

## Separation of concerns

| Layer             | Location                                           | Responsibility                                                                 |
| ----------------- | -------------------------------------------------- | ------------------------------------------------------------------------------ |
| Models            | `services/app/prisma/schema.prisma`                | Schema only, no business logic                                                 |
| Services          | `services/app/src/services/`                       | External integrations (S3, SQS, cache); take config as an explicit parameter   |
| REST routes       | `services/app/src/routes/v1/`                      | Parse, validate, call services/Prisma, return via `restApiResponse()`          |
| REST utils        | `services/app/src/api/utils/response.ts`           | The one shared REST helper — `restApiResponse()`                               |
| GraphQL resolvers | `services/app/src/graphql/resolvers/`              | Mirror REST routes, return `GraphQLResponse<T>` via `makeResponse()`           |
| GraphQL utils     | `services/app/src/graphql/utils.ts`, `response.ts` | Shared GraphQL helpers                                                         |
| GraphQL schema    | `services/app/src/graphql/schema.ts`               | SDL type definitions only                                                      |
| Lib               | `services/app/src/lib/`                            | Cross-cutting helpers with no service/route home: JWT, bcrypt, UUID validation |
| Config            | `services/app/src/config.ts`                       | All configuration reads via `process.env`; never read directly elsewhere       |
| Logging           | `services/app/src/logging/`                        | `AppLogger` + adapters, data filtering — see [[Observability-and-Logging]]     |

## Multi-service npm workspaces

Root `package.json` declares `"workspaces": ["services/app", "lambda"]`. Each workspace is self-contained with its own `dependencies`; shared dev tooling (TypeScript, ESLint, Prettier, Vitest) lives once at the root. Root `tsconfig.json` adds path aliases (`@app/*`, `@lambda/*`) so root-level tests can import service code without relative-path spaghetti.

**Docker build context** stays at `.` (repo root) so Dockerfiles can reach the root `package.json`/`package-lock.json`/`tsconfig.base.json` and every workspace's manifest (npm workspaces installs need all of them present). Only `dockerfile:` points into `services/`.

**Build order matters**: `prisma generate` must run before `tsc` in every Dockerfile stage — the generated Prisma Client types don't exist until generation runs.

## Adding a new feature end to end

1. Add/update the Prisma model in `services/app/prisma/schema.prisma`.
2. Generate and apply a migration (`bash migrate.sh`).
3. Add any external service logic to `services/app/src/services/`.
4. Add a REST route module in `services/app/src/routes/v1/`, register it in `routes/v1/index.ts`.
5. Add GraphQL types to `schema.ts` and a resolver module, merged into `resolvers/index.ts`.
6. Add tests (see [[Testing]]) and update `postman_collection.json`.
