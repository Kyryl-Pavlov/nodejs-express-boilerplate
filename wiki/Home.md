# nodejs-express-boilerplate

A production-ready **Node.js / TypeScript / Express** boilerplate for building scalable **REST** and **GraphQL** APIs — engineered for teams who want a clean architecture without spending weeks on infrastructure.

Ships fully wired: **JWT authentication**, **PostgreSQL** with Prisma ORM and migrations, **AWS S3** file uploads with presigned URLs, async event processing via **AWS SQS + Lambda**, **Redis** caching, **Nginx** reverse proxy with DDoS protection, structured logging to **Sentry / CloudWatch / Loki**, **Prometheus** metrics with **Grafana** dashboards, **Docker Compose** full-stack setup, and a **Vitest** test suite (unit · integration · E2E) — all production-wired from the first commit.

This wiki is the reference documentation for the project. The [README](https://github.com/Kyryl-Pavlov/nodejs-express-boilerplate#readme) is the quick-start entry point; this wiki goes deeper on architecture, operations, and infrastructure.

## Pages

| Page                          | What's in it                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| [[Getting-Started]]           | Prerequisites, environment variables, running the stack, debugging                 |
| [[Architecture]]              | App factory, dual REST/GraphQL layer, config, models, separation of concerns       |
| [[API-Reference]]             | REST and GraphQL endpoints, request/response shapes, an end-to-end example flow    |
| [[Testing]]                   | Test tiers (unit/integration/e2e), fixtures, running tests, known gotchas          |
| [[Security]]                  | Application, Nginx, and infrastructure security controls; intentional gaps and why |
| [[Observability-and-Logging]] | AppLogger fanout, Prometheus/Grafana/Loki stack, PromQL/LogQL examples             |
| [[CI-CD-Pipeline]]            | GitHub Actions workflows, job graph, deploy order, backward-compatible migrations  |
| [[Infrastructure-Terraform]]  | AWS architecture, Terraform module layout, bootstrap, secrets, IAM, cost estimate  |

## At a glance

- REST API at `/api/v1/` (Express routers) and GraphQL at `/graphql` (`graphql-http`, SDL-first via `@graphql-tools/schema`) — same Prisma models and service layer underneath, only the transport differs.
- Full local stack via `docker compose up --build`: Postgres, LocalStack (S3 + SQS), Redis, Nginx, Loki, Prometheus, Grafana, pgAdmin, S3 console.
- Migrations run automatically on every `docker compose up --build` via the one-shot `migrate` service.
- Two GitHub Actions deploy workflows (`deploy-dev.yml`, `deploy-prod.yml`) target AWS ECS Fargate + Lambda, provisioned by the `terraform/` module tree.

## Repository layout

```
.
├── services/app/     # Express REST + GraphQL API
├── lambda/           # SQS consumer (Lambda + local poll worker share processRecord.ts)
├── terraform/        # AWS infrastructure as code
├── nginx/            # Reverse proxy config
├── grafana/          # Dashboards + datasource provisioning
├── tests/            # Vitest suite (unit, integration, e2e)
├── wiki/             # Source of this wiki — synced by .github/workflows/deploy-wiki.yml
└── .github/workflows/
```

For the authoritative, most-current architectural rules and conventions, see the repo's `CLAUDE.md` — this wiki is a reader-friendly companion to it, not a replacement.
