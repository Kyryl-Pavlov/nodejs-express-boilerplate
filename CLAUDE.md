# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Security Measures

The following security controls are intentionally in place. Do not remove or weaken them without a documented reason.

### Application

| Measure                               | Location                                                                                                         | Rule                                                                                                                                                                                                                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SECRET_KEY` fail-fast                | `services/app/src/config.ts` — `requireEnv()`                                                                    | Throws at startup if unset. Never add a default fallback value.                                                                                                                                                                                                       |
| Request body limit                    | `services/app/src/app.ts` — content-length guard middleware + `express.json({ limit: config.maxContentLength })` | 50 MB hard limit on all uploads — a middleware checks the `Content-Length` header and replies 413 before any handler runs; `express.json()`'s own `limit` option backs it up so a body that streams in without a declared length is still capped.                     |
| File upload allowlist                 | `services/app/src/routes/v1/media.ts` — `ALLOWED_EXTENSIONS`                                                     | Allowlist of safe extensions only. Extend deliberately; never switch to a blocklist.                                                                                                                                                                                  |
| SQL/connection-string masking in logs | `services/app/src/logging/dataFilter.ts` — `sanitizeTraceback()`                                                 | Strips `[SQL: ...]`, `[parameters: ...]`, and DB connection strings from every traceback before it reaches any log backend. `lambda/src/safeExc.ts` has an inline equivalent (covers 3 DB schemes, not 5 — an intentional divergence carried over from the original). |
| GraphQL introspection                 | `services/app/src/app.ts` + `services/app/src/config.ts`                                                         | `graphqlIntrospection = true` only when `configName === "development"`; `false` for `production` and `testing`. Enforced via `NoSchemaIntrospectionCustomRule` passed to `graphql-http`'s `createHandler({ validationRules })`. Do not hardcode `true`.               |
| Explicit JWT algorithm                | `jsonwebtoken` with `algorithm: config.jwtAlgorithm` ("HS256") plus a custom `type: "access" \| "refresh"` claim | `services/app/src/lib/auth.ts` signs and verifies the `type` claim explicitly since raw `jsonwebtoken` has no built-in access/refresh distinction — flask-jwt-extended's parity feature.                                                                              |

### Infrastructure (Terraform)

| Measure                  | Location                                                                   | Rule                                                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Redis TLS                | `terraform/modules/elasticache/main.tf`                                    | `transit_encryption_enabled = true`. Output URL is `rediss://` (double-s). Both must stay in sync.                                     |
| Non-root containers      | `services/app/Dockerfile`, `lambda/Dockerfile`, `lambda/Dockerfile.lambda` | App uses an `app` system user; Lambda uses `nobody`. The `USER` instruction must remain after all `COPY`/`RUN` steps.                  |
| ECS task role SQS scope  | `terraform/modules/iam/main.tf`                                            | Express app: `sqs:SendMessage` + `sqs:GetQueueAttributes` only. Lambda worker: `ReceiveMessage` + `DeleteMessage`. Never cross-assign. |
| Secrets Manager recovery | `terraform/main.tf`, `terraform/modules/rds/main.tf`                       | `recovery_window_in_days = 7`. Never set to `0` in committed code (risk of unrecoverable accidental deletion).                         |
| WAF logging              | `terraform/modules/waf/main.tf`                                            | CloudWatch log group `aws-waf-logs-{prefix}`, 90-day retention. Do not remove `aws_wafv2_web_acl_logging_configuration`.               |

### Nginx

| Measure          | Location                       | Rule                                                                                                                                                                   |
| ---------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Security headers | `nginx/nginx.conf`             | `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `server_tokens off`. All use `always` flag so they apply to error responses too. |
| HSTS             | `nginx/nginx.conf` (commented) | Enable `Strict-Transport-Security` **only after** TLS is live on the ALB. Enabling it over HTTP permanently breaks access for returning visitors.                      |

### Intentional gaps (not implemented by design)

- **Content-Security-Policy** — commented in `nginx/nginx.conf`. A CSP covering the `ruru`-powered GraphQL explorer requires per-deployment origin config; a wrong CSP silently breaks it. Add once you know your frontend origins.
- **HSTS** — see above.
- **Redis AUTH token** — cluster is in a private subnet accessible only via security group. Add an AUTH token when moving to multi-tenant or shared infrastructure.
- **MIME type sniffing** — files go to S3 and are never executed server-side; extension allowlisting is sufficient. Add server-side content-type sniffing if serving files from a public CDN without `Content-Disposition: attachment`.
- **JWT refresh token blacklisting** — stateless by design. Add a Redis-backed blacklist if logout must immediately invalidate tokens.
- **Request trust-proxy wiring** — nginx forwards `X-Forwarded-*` headers, but Express isn't configured to trust them (`app.set("trust proxy", ...)` is never called). Add it if you need accurate client IPs for logging/rate-limiting.

## Common Commands

```bash
# Start full stack (rebuilds images)
docker compose up --build

# Rebuild and start only the app container
docker compose up --build app

# Run DB migrations inside container
docker compose run --rm migrate npx prisma migrate dev --schema services/app/prisma/schema.prisma

# Migrations run automatically on every docker compose up --build.
# The migrate service runs `prisma migrate dev` (dev) / `prisma migrate deploy` (CI), generating
# and applying pending migrations against the schema in services/app/prisma/schema.prisma.

# Tail app logs
docker compose logs -f app
```

### Helper Scripts

**`migrate.sh`** — interactive migration helper for local development (runs outside Docker, requires the npm workspace installed). Accepts an optional service name argument (default: `app`). Wraps `prisma migrate dev`, which prompts interactively for a migration name and applies it immediately — there's no separate init/apply step to script, unlike Flask-Migrate's generate-then-upgrade split.

```bash
bash migrate.sh          # defaults to services/app/prisma/schema.prisma
bash migrate.sh payments # uses services/payments/prisma/schema.prisma
```

**`launch_app_docker_image.sh`** — builds and launches a single service container standalone. Accepts an optional service name argument (default: `app`).

```bash
bash launch_app_docker_image.sh          # builds services/app/Dockerfile
bash launch_app_docker_image.sh payments # builds services/payments/Dockerfile for future services
# To stop: docker stop nodejs-express-boilerplate-<service>
```

> Note: this script starts only the app container with no database or LocalStack, so any endpoint that touches Postgres or S3 will fail. Use it only to verify the image builds and the process starts cleanly.

## Debugging

Two VSCode debug configurations can be defined in `.vscode/launch.json` (gitignored — create it locally):

### Option 1 — Attach to running Docker container

The `app` service in `docker-compose.yml` uses `Dockerfile.dev`, which starts the Express app under `tsx watch` with Node's built-in inspector on port 9229. The debugger is always available while the stack is running.

```bash
docker compose up --build
```

Then attach VSCode's Node debugger to `localhost:9229`. Source changes are picked up immediately via the volume mount and `tsx watch` (no rebuild needed).

### Option 2 — Run the app on the host

Start only infrastructure (`docker compose up -d postgres localstack migrate`), then run `npm run dev --workspace=services/app` on the host with `DATABASE_URL`/S3 endpoint vars pointed at `localhost` instead of Docker service hostnames.

## Local Infrastructure

The full stack runs via Docker Compose. All services share the default Docker network.

| Service         | Port       | Purpose                                                                                                                             |
| --------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `nginx`         | 80         | Reverse proxy / load balancer — single entry point for all services                                                                 |
| `app`           | 5000, 9229 | Express app (dev server via `tsx watch` + Node inspector on 9229) — also reachable directly on 5000                                 |
| `postgres`      | 5432       | Primary database                                                                                                                    |
| `migrate`       | —          | One-shot container: runs `prisma migrate dev`/`deploy` on startup                                                                   |
| `localstack`    | 4566       | AWS S3 + CloudWatch Logs emulator                                                                                                   |
| `pgadmin`       | 5050       | Postgres GUI                                                                                                                        |
| `s3-console`    | 8080       | S3 bucket GUI (cloudlena/s3manager)                                                                                                 |
| `loki`          | 3100       | Log aggregation — receives structured JSON from `LokiLogger`                                                                        |
| `prometheus`    | 9090       | Metrics database — scrapes `/metrics` from `app` every 15 s                                                                         |
| `grafana`       | 3000       | Dashboards — queries Prometheus (metrics) and Loki (logs)                                                                           |
| `cadvisor`      | 8081       | Container resource metrics (CPU, mem, disk) — **non-functional on Docker Desktop for Windows**, included for production parity only |
| `node-exporter` | 9100       | Host OS metrics (CPU, memory, disk I/O, network, load average) via `/proc` and `/sys`                                               |

**Startup order:** `postgres` healthy → `localstack` healthy → `migrate` completes → `app` starts → `nginx` starts.

**Adding a new microservice behind Nginx:**

1. Add the service to `docker-compose.yml` (no ports needed — it stays internal).
2. Add an upstream block and a `location` block to `nginx/nginx.conf`.
3. Restart: `docker compose up --build nginx`.

Other services reach the Express API internally via `http://app:5000` (direct) or `http://nginx/api/v1/` (through the proxy). External clients always hit port 80.

**S3 bucket init:** `localstack-init/create-bucket.sh` runs via LocalStack's `/etc/localstack/init/ready.d` hook, creating the `media-bucket` and `events-queue`. The service also auto-creates the bucket on first upload via `ensureBucket()`.

**Environment:** All config lives in `.env.local`, loaded via `env_file` in compose. Never committed — use `.env.local.example` as the template.

## Multi-service npm workspaces (`package.json`)

The root `package.json` declares an npm workspaces root: `"workspaces": ["services/app", "lambda"]`. Each workspace is a self-contained package with its own `dependencies` — `services/app` carries the full Express/Prisma/`graphql-http` stack, `lambda` carries only what the worker needs (AWS SDK clients + `@prisma/client`). Shared dev tooling (TypeScript, ESLint, Prettier, Vitest) lives once at the root.

Root `tsconfig.json` adds path aliases (`@app/*` → `services/app/src/*`, `@lambda/*` → `lambda/src/*`) so root-level tests can import service code without relative-path spaghetti — this is the Node equivalent of the Python version's `pythonpath` array trick.

When you add a new Node service:

1. Append its directory to the root `package.json`'s `"workspaces"` array.
2. Add a path alias for it in the root `tsconfig.json` if root-level tests need to import it.

## Services Layout

Microservices live under `services/`. Each service is self-contained with its own Dockerfiles.

```
services/
└── app/                     # Express REST + GraphQL API
    ├── src/                 # TypeScript source (app factory, routes, resolvers, etc.)
    ├── prisma/               # schema.prisma + migrations/
    ├── Dockerfile           # Production image (multi-stage, plain `node`)
    └── Dockerfile.dev       # Dev image (tsx watch + Node inspector, hot-reload via volume)
```

### Docker build pattern

Build context stays at `.` (repo root) so Dockerfiles can access the root `package.json`/`package-lock.json`/`tsconfig.base.json` and the `lambda/` workspace's `package.json` (npm workspaces installs need every workspace's manifest present, even when building a single service's image). Only the `dockerfile:` path points into `services/`:

```yaml
build:
  context: .
  dockerfile: services/app/Dockerfile
```

**Build order matters**: `prisma generate` must run before `tsc` in every Dockerfile stage that compiles TypeScript — the generated Prisma Client types (`User`, `Media`, `Event`) don't exist until generation runs, and `tsc` will fail on missing exports from `@prisma/client` if the order is reversed.

### Dev volume mounts

The `app` service mounts `./services/app:/repo/services/app`. Because npm workspaces hoists all dependencies to the root `/repo/node_modules`, this mount never shadows `node_modules` (they live at a different path entirely) — unlike a typical single-package Node project, no anonymous-volume trick is needed to protect `node_modules` from the bind mount.

### Adding a new microservice

1. Create `services/<name>/` with `Dockerfile`, `Dockerfile.dev`, `package.json`, `tsconfig.json`, and (if it has its own DB models) `prisma/schema.prisma`.
2. Add to `docker-compose.yml` with `context: .` and `dockerfile: services/<name>/Dockerfile.dev`.
3. Add Nginx upstream + location in `nginx/nginx.conf`.
4. Add a build step in `deploy-dev.yml` and `deploy-prod.yml` with `context: .` and `file: services/<name>/Dockerfile`.
5. Add an ECR repo in `terraform/modules/ecr/main.tf` and an ECS service in `terraform/`.
6. Append `"services/<name>"` to the root `package.json`'s `"workspaces"` array.

## Architecture

### App Factory

`services/app/src/app.ts` exports `buildApp(configName)`, mirroring a Flask-style app-factory pattern: it builds config, wires up logging/cache/Prisma, assigns them straight onto the Express `app` object (`app.config`, `app.prisma`, `app.loggerAdapter`, `app.cache` — typed via `src/types/express.d.ts`'s `declare global { namespace Express { interface Application { ... } } }` augmentation), mounts the REST router and the `graphql-http` handler, and returns the `Express` instance. There is no plugin-registration system to opt into here — middleware is just `app.use()` calls in a fixed order, and cross-cutting state lives as plain properties on `app` rather than behind a decorator API. `src/server.ts` is the single entry point used by **both** Dockerfiles (`Dockerfile.dev` runs it via `tsx watch`, `Dockerfile` runs the compiled `dist/server.js`) — it picks `"production"` vs `"development"` based on the `APP_ENV` env var, since there's one entry file instead of Flask's separate `run.py`/`wsgi.py`. `server.ts` calls `app.listen(5000, "0.0.0.0")` and attaches an `error` listener to the returned `http.Server` so a bind failure (e.g. port already in use) logs and exits the process instead of hanging.

### Dual API Layer

Every feature is exposed over both REST and GraphQL. Both share the same Prisma models and service modules — only the transport layer differs.

- **REST:** `services/app/src/routes/v1/` — one `express.Router()` per resource (`export function xRoutes(): Router`), mounted under `/api/v1/` via `app.use(prefix, router)` / `router.use(prefix, subRouter)` in `routes/v1/index.ts`
- **GraphQL:** `services/app/src/graphql/` — SDL-first schema (`schema.ts`) + a resolver map, turned into an executable schema via `@graphql-tools/schema`'s `makeExecutableSchema({ typeDefs, resolvers })` and served through `graphql-http`'s `createHandler()` mounted with `app.all("/graphql", ...)`. When `config.graphqlIntrospection` is `true` (development only), `GET /graphql` additionally serves `ruruHTML()` (from the `ruru` package) as an interactive, browser-based GraphQL explorer.

GraphQL resolvers do not use route-level auth middleware — they call `verifyAccessToken(context.request)` / `verifyRefreshToken(context.request)` manually inside each resolver (`src/lib/auth.ts`), since the GraphQL context (`buildContext()` in `graphql/context.ts`) is built once per request from the raw Express `Request` and doesn't run through the REST routes' `requireAccessToken`/`requireRefreshToken` middleware chain.

### Configuration

`services/app/src/config.ts` exports `loadConfig(configName)`, mirroring Flask's `Config`/`DevelopmentConfig`/`ProductionConfig`/`TestingConfig` split as a single function with a `configName` branch rather than a class hierarchy. Callers (server.ts, tests) always pass the name explicitly rather than reading it from an env var inside `loadConfig` itself. All AWS/S3 settings live on the single returned `AppConfig` object so they're present in every environment.

### S3 / LocalStack Split Endpoint

`services/app/src/services/awsS3Service.ts` maintains two S3 client modes:

- `client(config)` — uses `AWS_S3_ENDPOINT_URL` (`http://localstack:4566`) for internal operations (upload, bucket management). Resolvable only inside Docker.
- `client(config, { public: true })` — uses `AWS_S3_PUBLIC_ENDPOINT_URL` (`http://localhost:4566`) for generating presigned URLs. Needed because presigned URLs are opened by the browser on the host machine, which cannot resolve the `localstack` hostname.

In production both env vars are unset (`undefined`), so the AWS SDK routes to real AWS automatically. `uploadFile()` uses `@aws-sdk/lib-storage`'s `Upload` class (the SDK v3 equivalent of `boto3`'s `upload_fileobj`) for streaming, arbitrary-size uploads without buffering the whole file in memory — except GraphQL uploads, which are buffered (see "GraphQL file uploads" below).

### Models

All models live in one Prisma schema: `services/app/prisma/schema.prisma`. Prisma fields are camelCase with `@map("snake_case")` per field and `@@map("table_name")` per model, so the **actual Postgres schema is snake_case** (`users`, `media`, `events` tables) while TypeScript code uses idiomatic camelCase throughout. Current models:

- `User` — `id` (UUID PK, `@default(uuid())`), `email` (unique), `passwordHash`, `createdAt`
- `Media` — `id` (UUID PK), `userId` (FK → users, `onDelete: Cascade`), `contentKey` (S3 object key, **not** a URL), `createdAt`
- `Event` — `id` (UUID PK), `sqsMessageId` (unique), `type`, `payload` (JSON), `status`, `createdAt`, `processedAt`

`contentKey` stores the S3 key (`media/<user_id>/<filename>`). Presigned URLs are generated on demand and never persisted.

### GraphQL file uploads

`graphql-http` has no first-party multipart upload support, so `services/app/src/graphql/multipartUpload.ts` hand-rolls the jaydenseric GraphQL multipart request spec (`operations`/`map`/file parts) on top of its own `busboy` parser, invoked from a middleware in `app.ts` that's scoped to `/graphql` requests (`app.use(GRAPHQL_PATH, ...)`, checked via `isGraphqlMultipartRequest(req)`). That middleware rewrites the multipart body into a normal `{ query, variables }` JSON body — with each file placeholder in `variables` replaced by a `ResolvedUpload` (`{filename, content: Buffer}`) — before `graphql-http`'s handler ever sees the request. This is a separate `busboy` instance from the one `services/app/src/lib/multipart.ts` uses for REST media uploads — there's no shared global content-type parser for either to collide over, since Express middleware is just ordered functions scoped to whichever path they're mounted on. Each uploaded file part is still buffered fully into memory (mirroring the original's `part.toBuffer()` behaviour) rather than kept as a live stream, since the resolved value must be a plain object the GraphQL executor can pass straight to a resolver argument.

Two gotchas that broke this middleware during development, both worth preserving:

- **`isGraphqlMultipartRequest()` checks `req.originalUrl`, not `req.path`/`req.url`.** Express strips the mount prefix from `req.path`/`req.url` inside anything mounted via `app.use(GRAPHQL_PATH, ...)`, so a same-path check against `req.path` inside this middleware always sees `"/"` and never matches. `req.originalUrl` is unaffected by mount-point rewriting.
- **The middleware also overwrites `req.headers["content-type"]` to `application/json; charset=utf-8`** after rewriting `req.body`. `graphql-http`'s own request parser branches on the raw `content-type` header, not on whether `req.body` looks pre-parsed — it returns a bare 415 for anything that isn't `application/json` or a GET, regardless of what's already in `req.body`. Without this header rewrite, every multipart GraphQL request 415s before `graphql-http` ever looks at the body this middleware produced.

### Logging

The app uses an Object Adapter pattern. All loggers implement `LoggerBackend` (`services/app/src/logging/logger.ts`) and are injected into `AppLogger`, which fans out calls to all of them.

| Class              | Location                                       | Behaviour                                                                                                                                                                                                           |
| ------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AppLogger`        | `services/app/src/logging/logger.ts`           | Fanout adapter; single public method `log(message, options)`. `LogLevel` enum exposed as `AppLogger.Level.{INFO,WARN,ERROR}`                                                                                        |
| `ConsoleLogger`    | `services/app/src/logging/logger.ts`           | Wraps a standalone `pino` instance — Express has no built-in request logger to disable, so this is the only console output path; level is `debug` in dev, `warn` otherwise                                          |
| `SentryLogger`     | `services/app/src/logging/sentryLogger.ts`     | `info`/`warn` → Sentry breadcrumbs; `error` → `captureMessage` with extras, via `@sentry/node`                                                                                                                      |
| `CloudWatchLogger` | `services/app/src/logging/cloudwatchLogger.ts` | Hand-rolled against `@aws-sdk/client-cloudwatch-logs` directly (no `watchtower`-equivalent library) — ensures the log group/stream exist once (memoized promise), then ships one `PutLogEventsCommand` per log call |
| `LokiLogger`       | `services/app/src/logging/lokiLogger.ts`       | POSTs structured JSON to Loki's `/loki/api/v1/push` using built-in `fetch()` (no extra dependency, mirroring the source's stdlib-only `urllib` choice); failures are silently swallowed                             |

`AppLogger` is created in `buildApp()` and assigned directly onto the Express app instance as `app.loggerAdapter` (a plain property, per `src/types/express.d.ts`'s `Express.Application` augmentation — not a decorator API). Sentry, CloudWatch, and Loki are **opt-in** — only wired when their env vars are set. CloudWatch init failure is non-fatal (logs a warning via `console.warn`, since `loggerAdapter` doesn't exist yet at that point in bootstrap — same reason the original falls back to Flask's own `app.logger` for this one message). Loki push failures are silently swallowed.

**Loki labels:** every event is tagged with `{app: "nodejs-express-boilerplate", env: <configName>, level: <info|warning|error>}`. Query in Grafana Explore with `{app="nodejs-express-boilerplate"}` or `{level="error"}`.

**Automatic logging:** `restApiResponse()` (REST) and `makeResponse()` (GraphQL) call the logger automatically on every response — no manual calls needed in handlers. Log level is derived from `success` and either `statusCode` (REST) or the presence of `exc` (GraphQL) — **these are different conditions, an intentional divergence carried over from the original**:

- REST: `success=true` → INFO; `success=false` + `statusCode >= 500` → ERROR; `success=false` + `statusCode < 500` → WARN
- GraphQL: `success=true` → INFO; `success=false` + `exc` set → ERROR; `success=false` + no `exc` → WARN

**Manual logging:**

```ts
app.loggerAdapter.log("upload failed", {
  level: LogLevel.ERROR,
  data: { key: s3Key },
  exc: err,
});
```

**Data filtering:** `maskSensitive()` in `services/app/src/logging/dataFilter.ts` recursively replaces values of sensitive keys (`password`, `token`, `secret`, `authorization`, etc. — 32 keys total) with `***`. Applied automatically in `AppLogger.log()` before any logger sees the data. To add keys, extend `SENSITIVE_KEYS` in `dataFilter.ts`. Only masks dicts found inside a top-level list (shallow recursion boundary) — matches the original exactly.

**Sentry notes:**

- JWT auth failures on REST routes reply 401 directly from the `requireAccessToken`/`requireRefreshToken` middleware, not through `restApiResponse()` — Sentry won't see them as logged events.
- `info`/`warn` calls appear as breadcrumbs inside Sentry error events, not as standalone events. This is intentional — sending every log as an event burns Sentry quota.

**CloudWatch / LocalStack notes:**

- LocalStack must have `logs` in `SERVICES` (already set in `docker-compose.yml`).
- On Windows with Git Bash, prefix every `aws logs` CLI command with `MSYS_NO_PATHCONV=1` to prevent Git Bash from converting `/myapp/dev` → `C:/Program Files/Git/myapp/dev`.
- Query logs locally: `MSYS_NO_PATHCONV=1 aws --endpoint-url=http://localhost:4566 logs get-log-events --log-group-name /myapp/dev --log-stream-name app`

### Observability Stack

The app ships a **collect → store → visualise** pipeline:

```
Express /metrics  ──scrape──►  Prometheus  ──PromQL──►  Grafana
AppLogger         ──push───►   Loki        ──LogQL───►  Grafana
node-exporter     ──scrape──►  Prometheus
cAdvisor          ──scrape──►  Prometheus  (non-functional on Docker Desktop)
```

**Grafana provisioning (auto-wired on startup):**

- `grafana/provisioning/datasources/datasources.yml` — registers Prometheus (uid: `prometheus`) and Loki (uid: `loki`) automatically. No manual UI setup needed.
- `grafana/provisioning/dashboards/dashboards.yml` — loads all JSON files from `grafana/dashboards/` on startup.
- `grafana/dashboards/flask-app.json` — App dashboard: request rate, error rate, p95/p99 latency stats, request rate by status/route, latency by route, error logs, all logs. **Filename kept for continuity; PromQL queries inside use `prom-client`'s metric names (`http_request_duration_seconds`), not `prometheus-flask-exporter`'s.**
- `grafana/dashboards/host-metrics.json` — Host Metrics dashboard: CPU usage, memory, network I/O, disk I/O, load average, open file descriptors.
- Default credentials: `admin` / `admin` (set via `GF_SECURITY_ADMIN_PASSWORD` in `docker-compose.yml`).

**Prometheus metrics (`prom-client`):**

- Registered manually in `services/app/src/app.ts` — a `Histogram` (`http_request_duration_seconds`, labels `method`/`route`/`status_code`) observed from a timing middleware that records `req.startTime` on the way in and reads the duration off a `res.on("finish", ...)` listener on the way out (Express has no built-in request/response hook pair, so this single middleware plays both roles), plus `prom-client`'s default Node process metrics.
- Exposes `/metrics` via a plain Express route (`app.get("/metrics", ...)`) returning `promClient.register.metrics()`.
- `prometheus.yml` scrapes `app:5000/metrics`, `cadvisor:8080/metrics`, and `node-exporter:9100/metrics` every 15 s.

**Node Exporter (host OS metrics):**

- Mounts `/proc`, `/sys`, and `/` read-only from the host and exposes kernel-level metrics: `node_cpu_seconds_total`, `node_memory_MemAvailable_bytes`, `node_filesystem_avail_bytes`, `node_disk_read_bytes_total`, `node_network_receive_bytes_total`, `node_load1/5/15`.
- Works correctly on Docker Desktop for Windows because it reads from `/proc` and `/sys`, which Docker Desktop maps properly into the WSL2 VM (unlike cAdvisor which needs the overlayfs layer database).
- **Scope:** entire host (or WSL2 VM on Windows) — not per-container. Use cAdvisor for per-container breakdowns.

**cAdvisor (container resource metrics):**

- `gcr.io/cadvisor/cadvisor:v0.47.2` — pinned because v0.55+ requires the containerd socket at `/run/containerd/containerd.sock`, which Docker Desktop for Windows does not expose at that path. Effectively non-functional on Windows Docker Desktop — included for production parity. On a real Linux host it works without changes.
- **Scope:** per-container CPU, memory, network, disk — complements Node Exporter which only shows host totals.

**Production on AWS Fargate — neither tool runs:**
Fargate is serverless — there is no accessible host OS, Docker socket, or cgroup filesystem. Replace the entire local observability stack with AWS-managed equivalents:

| Local                          | AWS Fargate                                                                                                                                                                       |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node Exporter + cAdvisor       | **CloudWatch Container Insights** — enabled with one ECS cluster setting; collects per-task CPU, memory, network natively from the Fargate hypervisor                             |
| Prometheus scraping `/metrics` | **ADOT sidecar** (AWS Distro for OpenTelemetry) — runs as a second container in the same Fargate task, scrapes `localhost:5000/metrics`, ships to Amazon Managed Prometheus (AMP) |
| Prometheus (storage)           | **Amazon Managed Prometheus (AMP)**                                                                                                                                               |
| Loki                           | **CloudWatch Logs** — already wired via `CloudWatchLogger`; no changes needed                                                                                                     |
| Grafana                        | **Amazon Managed Grafana (AMG)** — connects to AMP and CloudWatch as data sources                                                                                                 |

The only app-side requirement for the production setup is the `/metrics` endpoint — ADOT picks it up without any code changes.

**Adding a new logger backend:**

1. Create a class in `services/app/src/logging/` implementing `LoggerBackend` (`info`, `warning`, `error` methods).
2. Instantiate it conditionally in `buildApp()` and push it into the `loggers` array.
3. Add the required env var to `services/app/src/config.ts`'s `AppConfig`/`loadConfig`.

### Error Handling

Each REST route and GraphQL resolver wraps risky operations (DB calls, S3 calls, UUID parsing) in individual `try/catch` blocks with specific messages and appropriate status codes. Prisma's single-statement operations (`create`, `findUnique`, etc.) don't need explicit rollback the way SQLAlchemy sessions did — a thrown error simply means nothing was committed.

**S3 `ensureBucket`:** `HeadBucketCommand` throws `NotFound` (or occasionally `NoSuchBucket`, or a generic error with `$metadata.httpStatusCode === 404` depending on the S3-compatible backend) when the bucket doesn't exist. `isBucketNotFound()` in `awsS3Service.ts` checks all three shapes before falling through to `CreateBucketCommand` — catching only the named `NotFound` class would miss LocalStack's occasional deviations.

## Separation of Concerns

Each layer has a strict responsibility. Do not cross these boundaries:

| Layer                 | Location                                                                    | Responsibility                                                                                                                                                                                                                         |
| --------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Models**            | `services/app/prisma/schema.prisma`                                         | Prisma schema only — no business logic. Migrations in `services/app/prisma/migrations/`                                                                                                                                                |
| **Services**          | `services/app/src/services/`                                                | External integrations (S3, SQS, future: email, payments). Take config as an explicit parameter — no ambient "current app" access                                                                                                       |
| **REST routes**       | `services/app/src/routes/v1/`                                               | Parse request, validate input, call services/Prisma, return via `restApiResponse()`. No raw `res.send()`/`res.json()` calls outside `response.ts`                                                                                      |
| **REST utils**        | `services/app/src/api/utils/response.ts`                                    | Shared REST helper (`restApiResponse()`). All reusable REST helper functions live here — never inline them in routes                                                                                                                   |
| **GraphQL resolvers** | `services/app/src/graphql/resolvers/`                                       | Mirror REST routes but return `GraphQLResponse<T>`-shaped objects via `makeResponse()`. No direct HTTP response logic                                                                                                                  |
| **GraphQL utils**     | `services/app/src/graphql/utils.ts`, `services/app/src/graphql/response.ts` | Shared GraphQL helpers (`eventToPayload()`, `makeResponse()`). All reusable GraphQL helper functions live here — never inline them in resolvers                                                                                        |
| **GraphQL schema**    | `services/app/src/graphql/schema.ts`                                        | SDL type definitions only — no resolver logic                                                                                                                                                                                          |
| **Lib**               | `services/app/src/lib/`                                                     | Cross-cutting helpers with no clear service/route home: `auth.ts` (JWT sign/verify), `password.ts` (bcrypt), `uuid.ts` (validation)                                                                                                    |
| **Config**            | `services/app/src/config.ts`                                                | All configuration via `process.env` inside `loadConfig()`. Env vars are never read directly in routes, resolvers, or services                                                                                                          |
| **Logging**           | `services/app/src/logging/`                                                 | `AppLogger` + logger adapters (`ConsoleLogger`, `SentryLogger`, `CloudWatchLogger`, `LokiLogger`), `maskSensitive`/`sanitizeTraceback` data filter. No Express request-context assumptions except being assigned onto the app instance |

## Code Quality

Git hooks enforce formatting and linting on every `git commit`, via Husky + lint-staged (installed automatically by `npm install`'s `prepare` script).

| Hook               | Files                          | Behaviour                                                                   |
| ------------------ | ------------------------------ | --------------------------------------------------------------------------- |
| `eslint --fix`     | `*.ts`                         | Autofixes lint violations (import order, unused vars, etc.) on staged files |
| `prettier --write` | `*.ts`, `*.{json,yml,yaml,md}` | Autoformats staged files                                                    |

**Commit behaviour:** lint-staged only touches staged files, restages anything it modifies, and aborts the commit if `eslint` reports an unfixable error.

Run all checks on the entire codebase without committing:

```bash
npm run lint
npm run format:check
```

Tool config lives in `eslint.config.js` (flat config) and `.prettierrc` at the repo root — one config for the whole workspace, no per-service duplication.

## Testing

### Structure

Tests live under `tests/app/` at the repo root (not inside `services/app/`) mirroring the source tree, matching the original layout for continuity even though npm workspaces conventionally co-locate tests per-package:

```
tests/
├── setup.ts        — sets SECRET_KEY/JWT_SECRET_KEY/BCRYPT_ROUNDS before any @app/* module loads
├── globalSetup.ts  — starts one shared Postgres testcontainer for the whole run (integration/e2e only)
└── app/
    ├── unit/          — pure functions, zero external deps
    │   ├── api/         restApiResponse() tests
    │   ├── graphql/     eventToPayload() tests
    │   ├── logging/     maskSensitive(), AppLogger fanout, ConsoleLogger, CloudWatchLogger tests
    │   └── services/    CacheService JSON wrap/unwrap, TTL, ping
    ├── integration/   — supertest against the Express app + a real Postgres testcontainer
    └── e2e/           — real HTTP against the full CI stack (Docker required)
```

### Running tests

```bash
# Install dependencies (root + all workspaces)
npm install

# Unit + integration — requires Docker (integration tier uses a Postgres testcontainer)
npm test

# Unit only — no Docker needed
npm run test:unit

# With coverage report
npm run test:coverage

# E2E — requires the CI stack to be running
docker compose -f docker-compose.ci.yml up -d --wait
npm run test:e2e
docker compose -f docker-compose.ci.yml down -v
```

### Coverage

Intentional gaps (excluded in `vitest.config.ts`'s `coverage.exclude`):

- `awsS3Service.ts`, `awsSqsService.ts` — SDK wiring only, no project logic to verify
- `lokiLogger.ts`, `sentryLogger.ts` — thin SDK/fetch call wrappers
- `server.ts` — process entry point, not unit-testable

### Key fixtures (`tests/app/integration/fixtures.ts`)

Vitest's `test.extend()` API mirrors pytest's fixture dependency-injection graph closely — this is a deliberate architectural choice to keep the fixture DI model recognizable across the port.

| Fixture                        | What it does                                                                                                                                                                                                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app`                          | Builds an Express app via `buildApp("testing")`, memoized per test file (Vitest isolates modules per file, so this is "once per file" rather than pytest's true once-per-run session scope). Teardown truncates all tables (`TRUNCATE ... RESTART IDENTITY CASCADE`), mirroring the source's `clean_tables` fixture |
| `client`                       | The same Express app instance — `supertest` wraps it fresh per request, playing the role of Flask's test client                                                                                                                                                                                                     |
| `registeredUser`               | Registers a fixed test user (`user@example.com`) via the REST endpoint                                                                                                                                                                                                                                              |
| `accessToken` / `refreshToken` | Logs in `registeredUser`, extracts the respective token                                                                                                                                                                                                                                                             |
| `authHeaders`                  | `{ Authorization: "Bearer <accessToken>" }`                                                                                                                                                                                                                                                                         |
| `gql`                          | Factory fixture — a function posting a GraphQL query/mutation via `supertest`, returns the response                                                                                                                                                                                                                 |
| `gqlAuthHeaders`               | Same idea as `authHeaders` but obtained via the GraphQL `login` mutation itself — returns both `.access` and `.refresh` header sets                                                                                                                                                                                 |
| `mockCache`                    | Replaces `app.cache` with `vi.fn()`-based mocks for the test, restores the original afterward                                                                                                                                                                                                                       |

### Gotchas

**`tests/setup.ts` env vars** — `SECRET_KEY`, `JWT_SECRET_KEY`, and `BCRYPT_ROUNDS=4` (mirroring the source's `fast_bcrypt` fixture — 4 rounds instead of 13 keeps hashing fast across the suite) must be set before any `@app/*` module is imported anywhere in the run, since `config.ts` throws at import time if `SECRET_KEY` is unset and `lib/password.ts` reads `BCRYPT_ROUNDS` at module load.

**Integration tests need Postgres, unlike the Python original** — Flask's test suite achieved "no Docker needed, <2s" via SQLite `:memory:` + `StaticPool`. Prisma has no equivalent transparent SQLite swap without schema-drift risk, so `tests/globalSetup.ts` spins up one shared `@testcontainers/postgresql` container for the whole run instead. This is the one disclosed regression from the Python original's dev ergonomics.

**Test files run sequentially, not in parallel** (`fileParallelism: false` in `vitest.config.ts`) — integration/e2e tests share one Postgres container across files; parallel file execution would let them race on the same tables.

**GraphQL vs REST auth** — resolvers call `verifyAccessToken()`/`verifyRefreshToken()` manually, not via route-level middleware. GraphQL always returns HTTP 200 — success/failure lives in `response.data.<resolver>.success`. Integration tests POST to `/graphql` with the `Authorization` header directly.

**E2E `BASE_URL`** — defaults to `http://localhost/api/v1`. Override via `E2E_BASE_URL` env var to point at staging or any other environment.

### Adding tests for a new feature

1. Unit tests in `tests/app/unit/<layer>/` for any new pure/utility functions.
2. REST integration tests in `tests/app/integration/<resource>.spec.ts`.
3. GraphQL integration tests in `tests/app/integration/graphql<Resource>.spec.ts`.
4. Add the happy-path to `tests/app/e2e/e2e.spec.ts` if it involves a new infrastructure dependency (new AWS service, new DB table, etc.).
5. Mock at the service-function boundary, not at the SDK level: `vi.mock("@app/services/<module>.js")`. REST routes and GraphQL resolvers each hold independent imports of the same underlying service function — mock each layer's own import path, matching the original's per-layer patching convention.

## Style Guide

**Naming:**

- S3 object paths are called `contentKey` (never `contentUrl`) — they are keys, not URLs. Presigned URLs are transient and never stored.
- Prisma schema fields are camelCase (`passwordHash`, `sqsMessageId`) mapped via `@map` to snake_case DB columns — the physical schema stays snake_case for continuity with the original.
- GraphQL SDL fields are hand-written camelCase directly (no auto-conversion the way Strawberry did for Python) — `mediaId`, `expiresIn`, `accessToken`.
- REST response fields use snake_case throughout (`access_token`, `refresh_token`, `media_id`) — this means REST route handlers must explicitly construct snake_case response objects even though Prisma models use camelCase internally; there's no automatic case conversion at this boundary.

**Responses:**

- REST: always use `restApiResponse(res, options)` from `services/app/src/api/utils/response.ts`. Never call `res.send()`/`res.json()` directly from a route handler. The one deliberate exception is `health.ts`, which bypasses the envelope entirely (`{status, version}`) — an inconsistency in the original, preserved on purpose.
- GraphQL: always return through `makeResponse(logger, options)` from `services/app/src/graphql/response.ts`. Never throw from a resolver — catch and return `{success: false, message, exc}`.

**Authentication:**

- REST routes: use the `requireAccessToken`/`requireRefreshToken` middleware from `src/lib/auth.ts`.
- GraphQL resolvers: call `verifyAccessToken(context.request)` / `verifyRefreshToken(context.request)` manually inside a `try/catch` at the top of the resolver.

**Postman collection:** `postman_collection.json` at the repo root must be kept in sync with API changes. Update it whenever you add, remove, or rename an endpoint or change a request/response shape. The collection uses collection-level variables (`base_url`, `access_token`, `refresh_token`, `media_id`) and test scripts on Login/Upload requests to auto-capture tokens and IDs for chained requests.

**Adding a new feature:**

1. Add/update the Prisma model in `services/app/prisma/schema.prisma`.
2. Generate and apply a migration (`bash migrate.sh`).
3. Add any external service logic to `services/app/src/services/`.
4. Add a REST route module in `services/app/src/routes/v1/` and register it in `services/app/src/routes/v1/index.ts`.
5. Add GraphQL types to `services/app/src/graphql/schema.ts` and a resolver module in `services/app/src/graphql/resolvers/`, merged into the resolver map in `resolvers/index.ts`.

## Lambda Worker Dockerfiles

`lambda/src/handler.ts` and `lambda/src/poll.ts` share `lambda/src/processRecord.ts` and support two runtimes from separate entry files (unlike the Python original's single dual-mode `handler.py` with an `if __name__ == "__main__"` guard — with two files there's no need for a runtime guard, since each file is only ever used as a direct entry point):

- `handler.ts` exports `handler(event, context)` — Lambda entry point, called by AWS when SQS delivers a batch
- `poll.ts` — long-running SQS polling loop, the `Dockerfile` (non-`.lambda`) CMD target for local dev

Two Dockerfiles exist for these two runtimes:

| File                       | Used by                                                       | CMD                                                              |
| -------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------- |
| `lambda/Dockerfile`        | `docker-compose.yml` worker service                           | `npm run dev --workspace=lambda` → runs `poll()` via `tsx watch` |
| `lambda/Dockerfile.lambda` | `deploy-dev.yml` / `deploy-prod.yml` CI/CD worker image build | `dist/handler.handler` → Lambda RIC calls `handler()`            |

Never use `Dockerfile` for the CI/CD image build — it produces a long-running process, not a valid Lambda container. The deploy workflows already reference `Dockerfile.lambda`.

`processRecord.ts` handles both AWS event shapes in one function: real Lambda SQS event records use lowerCamelCase (`messageId`/`body`), while `poll()`'s raw `ReceiveMessageCommand` responses use PascalCase (`MessageId`/`Body`) — the same dual-shape handling the Python original needed.

## CI/CD Pipeline

### Workflows

**`.github/workflows/ci.yml`** — triggers on every push and pull request.

Three parallel jobs:

- `lint` — `eslint .` + `prettier --check .`
- `test` — `vitest run tests/app/unit tests/app/integration --coverage` (GitHub-hosted `ubuntu-latest` runners have Docker preinstalled, so the integration tier's testcontainer works without extra setup)
- `e2e` — spins up `docker-compose.ci.yml`, runs `vitest run tests/app/e2e`, tears down with `-v`

**`.github/workflows/deploy-dev.yml`** — targets the `dev` environment; triggers manually by default (change to `push: branches: [develop]` to enable automatic deploys on merge).

**`.github/workflows/deploy-prod.yml`** — targets the `production` environment; manual trigger only. Approval gate is on the `migrate` job — approving it unlocks `deploy` and `deploy-workers` for the same run.

The two files are intentionally separate — no branch conditionals, each file has one purpose. They are structurally identical; the only differences are the branch image tag (`develop` vs `main`) and the `environment:` value.

### Job structure

```
build  (all images in parallel)
  ├── migrate-dev          (develop branch — runs ALL migrations before any deploy)
  │     ├── deploy-dev         (needs: [build, migrate-dev] — services in tier order)
  │     └── deploy-workers-dev (needs: [build, migrate-dev] — Lambda workers, parallel with services)
  └── migrate-prod         (main branch — approval gate; approving unlocks entire prod pipeline)
        ├── deploy-prod
        └── deploy-workers-prod
```

### Deploy order within each environment

Migrations are a separate job that must complete before any service or worker is touched:

1. **`migrate-*`** — runs ALL service migrations (`npx prisma migrate deploy`) as one-off ECS Fargate tasks. If any migration fails the entire pipeline stops. Schema is always ahead of code.
2. **`deploy-*`** (services) and **`deploy-workers-*`** (Lambda) — start in parallel once migrate completes. Services deploy in tier order within the job (tier-1 first, then dependents); workers are independent.

### Backward-compatible migrations rule

During a rolling ECS update, old and new task instances run simultaneously against the same database. Every migration must be backward-compatible with the currently-deployed code:

- **Safe**: add a nullable column, add an index, add a table
- **Unsafe**: drop a column the old code still reads, rename a column, change a type non-compatibly

Use a two-phase approach for breaking changes: first deploy adds the new column (old code ignores it), second deploy removes the old column once all instances run the new code.

### Adding a new microservice

1. Create `services/<name>/` with its Dockerfile.
2. Add its ECR repo to `terraform/modules/ecr/main.tf`.
3. Add its ECS service + task definition to `terraform/`.
4. Add a build step in `deploy-dev.yml` and `deploy-prod.yml` with `context: .` and `file: services/<name>/Dockerfile`.
5. Add a `run_migration` call in `migrate` jobs if it has its own DB (command: `'["npx","prisma","migrate","deploy"]'`).
6. Add a deploy step at the correct tier.
7. Add its GitHub environment vars via `terraform output`.

### Required GitHub secrets and variables

**Repository secret** (Settings → Secrets → Actions):

- `AWS_ROLE_ARN` — IAM role for OIDC authentication, output by `terraform output github_actions_role_arn`

**Per-environment variables** (Settings → Environments → `dev` / `production`):

- `ECS_CLUSTER`, `ECS_SERVICE`, `APP_TASK_FAMILY` — from `terraform output`
- `VPC_SUBNETS`, `VPC_SECURITY_GROUPS` — from `terraform output` (used for migration task networking)
- `LAMBDA_FUNCTION_NAME` — from `terraform output`

### CI stack (`.env.ci`)

The CI stack uses `.env.ci` (committed, contains only fake test credentials). It sets `APP_ENV=production` to test the production code path (equivalent to the original's `FLASK_ENV=production`). LocalStack provides S3 and SQS. No real AWS credentials are needed for CI.

## Wiki

Source pages for the GitHub wiki live in `wiki/` at the repo root (`Home.md`, `_Sidebar.md`, and one file per topic) — never edit pages directly in the GitHub Wiki UI, since they get overwritten on the next sync.

**`.github/workflows/deploy-wiki.yml`** — triggers on push to `main` touching `wiki/**`, or manually via `workflow_dispatch`. It clones `https://github.com/<owner>/<repo>.wiki.git` (falling back to a fresh `git init -b master` the first time the wiki has never been created), mirrors `wiki/*.md` into it with `rsync --delete`, and pushes only if the sync produced a diff. Requires the repository's **Wiki** feature enabled once (Settings → General → Features → Wikis) — GitHub doesn't provision the underlying `.wiki.git` storage until a page exists or a push against it succeeds with the feature on.

Adding a new wiki page: create `wiki/<Page-Name>.md`, link it from `wiki/_Sidebar.md` and `wiki/Home.md`'s page table, and cross-link related pages with `[[Page-Name]]` wiki-link syntax.

## Terraform Infrastructure

All AWS infrastructure is declared in `terraform/`. Terraform is an infra-owner operation — run manually when provisioning or changing infrastructure. The CI/CD pipeline handles all ongoing app deployments.

**Migration note:** Terraform required almost no changes for this port — it provisions AWS resources, not application code, so it's largely language-agnostic. The only functional edits were removing `FLASK_APP`/`FLASK_ENV` container env vars from `terraform/modules/ecs/main.tf` (no replacement needed) and renaming the `flask_secret`/`flask_secret_arn` resource and variable names to `app_secret`/`app_secret_arn` for clarity (the underlying `SECRET_KEY` env var name is unchanged, since it's kept as a reserved app-wide secret — see Security Measures above).

### Module structure

```
terraform/
├── bootstrap/        # Run once: S3 state bucket + DynamoDB lock table (local state)
├── environments/
│   ├── dev.tfvars    # Small sizes, no HTTPS, relaxed WAF, no deletion protection
│   └── prod.tfvars   # Multi-AZ RDS, deletion protection, HTTPS required, 2 ECS tasks
├── modules/
│   ├── networking    # VPC, public/private subnets, NAT gateway, 5 security groups, VPC flow logs
│   ├── ecr           # ECR repos for app + worker; scan on push; keep last 10 images
│   ├── iam           # ECS task execution role, ECS task role, Lambda role, GitHub OIDC role
│   ├── rds           # PostgreSQL 16 encrypted; DATABASE_URL secret in Secrets Manager
│   ├── elasticache   # Redis 7 replication group; encrypted at rest
│   ├── s3            # Media bucket; public access blocked; HTTPS-only bucket policy
│   ├── sqs           # events queue + DLQ; SSE; redrive after 3 failures
│   ├── alb           # ALB; HTTP→HTTPS redirect; TLS 1.3; drop invalid headers
│   ├── waf           # OWASP Top 10, bad inputs, SQLi, per-IP rate limit
│   ├── ecs           # Fargate cluster; task def with secrets from Secrets Manager; service
│   └── lambda        # Container image function in VPC; SQS event source mapping
├── main.tf           # Wires all modules; creates JWT + app secrets in Secrets Manager
├── variables.tf       # All inputs (sizes, flags, image URIs, GitHub org/repo, state bucket)
├── outputs.tf        # All values needed for GitHub environment vars, labelled
└── versions.tf       # AWS ~> 5.0, random ~> 3.0; partial S3 backend
```

### State management

State is stored in S3 with DynamoDB locking. The S3 bucket and DynamoDB table are created by `terraform/bootstrap/` with local state (the bootstrap is the only exception to "never use local state").

`backend.hcl` — fill-in file referencing the state bucket and lock table. **Gitignored** — never committed.

### Bootstrap and first deploy

```bash
# 1. Create state infrastructure (once per AWS account)
cd terraform/bootstrap
terraform init
terraform apply -var="bucket_name=myorg-nodejs-express-boilerplate-tfstate" -var="lock_table_name=myorg-nodejs-express-boilerplate-tfstate-lock"
# Copy outputs → fill in backend.hcl and environments/*.tfvars

# 2. Init main module
cd ../
terraform init -backend-config=backend.hcl

# 3. Create ECR repos first (images must exist before ECS/Lambda can be created)
terraform apply -target=module.ecr -var-file=environments/dev.tfvars

# 4. Push initial images to ECR, then set app_image and worker_image in dev.tfvars

# 5. Full apply
terraform apply -var-file=environments/dev.tfvars

# 6. Populate GitHub environment vars
terraform output
```

### Secrets management

All sensitive values are generated by Terraform and stored in AWS Secrets Manager:

- `DATABASE_URL` — constructed from RDS endpoint + random password; injected into ECS containers via the `secrets` field in the task definition (not environment variables)
- `JWT_SECRET_KEY` — 64-char random string
- `SECRET_KEY` — 64-char random string (generated by the `app_secret`/`random_password.app_secret` resources — reserved app-wide secret, not currently consumed by any framework-specific mechanism, kept for parity/future cookie-signing use)

Secrets are injected at container startup by the ECS agent using the task execution role. The app code reads them as plain environment variables (`process.env.DATABASE_URL`) — no Secrets Manager SDK calls needed in app code (the Lambda worker is the exception — it resolves `DATABASE_URL` from Secrets Manager directly via `@aws-sdk/client-secrets-manager` when `DATABASE_URL_SECRET_ARN` is set, since it isn't injected as an ECS `secrets` entry the way the Express app's is).

### IAM roles

| Role                 | Principal      | Permissions                                                                                    |
| -------------------- | -------------- | ---------------------------------------------------------------------------------------------- |
| `ecs-task-execution` | ECS agent      | ECR pull, CloudWatch logs, read specific Secrets Manager ARNs                                  |
| `ecs-task`           | Express app    | S3 read/write (media bucket), SQS send/receive, CloudWatch logs                                |
| `lambda`             | Lambda service | SQS consume, S3 read/write, Secrets Manager read, VPC networking                               |
| `github-actions`     | GitHub OIDC    | ECR push, ECS update, Lambda update, register task def, read/write state bucket, DynamoDB lock |

The GitHub Actions role uses OIDC — no long-lived AWS credentials are stored in GitHub. The trust policy is scoped to the specific repo and the `main`/`develop` branches only.

### Security group rules

| From      | To        | Port    | Protocol                                         |
| --------- | --------- | ------- | ------------------------------------------------ |
| Internet  | ALB       | 80, 443 | TCP                                              |
| ALB       | ECS tasks | 5000    | TCP                                              |
| ECS tasks | RDS       | 5432    | TCP                                              |
| ECS tasks | Redis     | 6379    | TCP                                              |
| ECS tasks | Internet  | 443     | TCP (outbound: ECR, Secrets Manager, CloudWatch) |
| Lambda    | RDS       | 5432    | TCP                                              |
| Lambda    | Redis     | 6379    | TCP                                              |
| Lambda    | Internet  | 443     | TCP (outbound: AWS APIs)                         |

ECS tasks and Lambda have no inbound rules from the internet. RDS and Redis have no outbound rules.

### Lifecycle rules

- `aws_ecs_service`: `ignore_changes = [task_definition, desired_count]` — CI/CD manages these after initial deploy
- `aws_lambda_function`: `ignore_changes = [image_uri]` — CI/CD manages this
- `aws_s3_bucket` (state bucket in bootstrap): `prevent_destroy = true`
- `aws_dynamodb_table` (lock table in bootstrap): `prevent_destroy = true`
