# Getting Started

## Prerequisites

### Required for everyone

| Tool           | Version | Purpose                                                          |
| -------------- | ------- | ---------------------------------------------------------------- |
| Git            | any     | Clone the repository                                             |
| Docker Desktop | 4.x+    | Runs the entire infrastructure (Postgres, S3, app) in containers |

```bash
docker --version        # Docker version 26.x.x
docker compose version  # Docker Compose version v2.x.x
```

### Required for host-based debugging only

| Tool    | Version | Purpose                                |
| ------- | ------- | -------------------------------------- |
| Node.js | 22+     | Runs the app and installs dependencies |
| VSCode  | any     | IDE with integrated debugger           |

### Optional but recommended

- **Postman** — a ready-made collection is included at `postman_collection.json`, with test scripts that auto-capture tokens/IDs for chained requests. Keep it in sync whenever an endpoint's shape changes.

## Environment setup

Create `.env.local` in the project root from `.env.local.example`. This file is never committed and is the single source of truth for local config.

**Core**

```env
SECRET_KEY=dev-secret-key
JWT_SECRET_KEY=19c7a47a7b4330769667c83436293f125474076d58399761e61a4a16da3ee206
DATABASE_URL=postgresql://user:password@postgres:5432/appdb
```

Generate a production `JWT_SECRET_KEY` with `openssl rand -hex 32`. `SECRET_KEY` has no default — the app throws at startup if it's unset (see [[Security]]).

**AWS / S3 — LocalStack defaults, no real AWS needed locally**

```env
AWS_ACCESS_KEY_ID=test
AWS_SECRET_ACCESS_KEY=test
AWS_DEFAULT_REGION=us-east-1
AWS_S3_BUCKET=media-bucket
AWS_S3_ENDPOINT_URL=http://localstack:4566
AWS_S3_PUBLIC_ENDPOINT_URL=http://localhost:4566
PRESIGNED_URL_EXPIRY=86400
```

**SQS, Redis, observability** are injected automatically by Docker Compose for the `app`/`worker` containers — you only need to add overrides in `.env.local` if running the app on the host (see below). Full variable list is in the README's Environment Setup section and `.env.local.example`.

## Running the full stack

```bash
docker compose up --build
```

Migrations apply automatically before the app starts (via the one-shot `migrate` service). Startup order: `postgres` healthy → `localstack` healthy → `migrate` completes → `app` starts → `nginx` starts.

| Service                 | URL                           | Purpose                                                            |
| ----------------------- | ----------------------------- | ------------------------------------------------------------------ |
| Nginx (entry point)     | http://localhost              | Reverse proxy — all API traffic goes here                          |
| Express API (direct)    | http://localhost:5000         | Bypass Nginx for debugging                                         |
| GraphQL explorer (Ruru) | http://localhost/graphql      | Interactive query UI — `GET /graphql`, dev-only (see [[Security]]) |
| pgAdmin                 | http://localhost:5050         | Postgres GUI                                                       |
| S3 console              | http://localhost:8080         | S3 bucket browser                                                  |
| LocalStack              | http://localhost:4566         | AWS S3 + SQS emulator                                              |
| Loki                    | http://localhost:3100         | Log aggregation                                                    |
| Prometheus              | http://localhost:9090         | Metrics database + query UI                                        |
| Grafana                 | http://localhost:3000         | Dashboards (metrics + logs)                                        |
| Node Exporter           | http://localhost:9100/metrics | Host OS raw metrics                                                |

```bash
docker compose logs -f app          # tail app logs
docker compose up --build app       # rebuild only the app container
```

Code changes are reflected immediately without rebuilding — the source directory is volume-mounted and `tsx watch` restarts the process on change.

## Database migrations

Migrations are automatic on every `docker compose up --build`, but you still need to **generate** one after editing `services/app/prisma/schema.prisma`:

```bash
bash migrate.sh          # defaults to services/app/prisma/schema.prisma
bash migrate.sh payments # uses services/payments/prisma/schema.prisma, for future services
```

`migrate.sh` wraps `prisma migrate dev`, which prompts interactively for a migration name and applies it immediately — there's no separate generate/apply split.

## Debugging

Two VSCode debug configurations, defined locally in `.vscode/launch.json` (gitignored — create it yourself).

### Option 1 — Attach to the running Docker container

The `app` service (via `Dockerfile.dev`) runs the Express app under `tsx watch` with Node's inspector on port 9229, always available while the stack is running:

```bash
docker compose up --build
```

Attach VSCode's Node debugger to `localhost:9229`. Source changes are picked up immediately (volume mount + `tsx watch`) — no rebuild needed.

### Option 2 — Run the app on the host

```bash
docker compose up -d postgres localstack migrate
npm run dev --workspace=services/app
```

Point `DATABASE_URL` and the S3 endpoint vars at `localhost` instead of Docker service hostnames:

| Variable                     | Docker value                           | Host override                           |
| ---------------------------- | -------------------------------------- | --------------------------------------- |
| `DATABASE_URL`               | `postgresql://...@postgres:5432/appdb` | `postgresql://...@localhost:5432/appdb` |
| `AWS_S3_ENDPOINT_URL`        | `http://localstack:4566`               | `http://localhost:4566`                 |
| `AWS_S3_PUBLIC_ENDPOINT_URL` | `http://localhost:4566`                | `http://localhost:4566` (unchanged)     |

## Production image smoke test

```bash
bash launch_app_docker_image.sh          # builds services/app/Dockerfile
bash launch_app_docker_image.sh payments # builds services/payments/Dockerfile for future services
# stop with: docker stop nodejs-express-boilerplate-<service>
```

This starts only the app container — no database or LocalStack — so anything touching Postgres or S3 will fail. Use it only to confirm the production image builds and the process starts cleanly.

## Adding a new microservice

1. Add the service to `docker-compose.yml` (no ports needed — stays internal to the Docker network).
2. Add an upstream block and a `location` block to `nginx/nginx.conf`.
3. `docker compose up --build nginx` to reload.
4. Append the service directory to the root `package.json`'s `"workspaces"` array and add a path alias in the root `tsconfig.json` if root-level tests need to import it.

See [[Architecture]] for the full checklist including Prisma schema, Terraform, and CI/CD wiring.
