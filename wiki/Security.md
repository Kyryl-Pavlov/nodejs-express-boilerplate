# Security

The boilerplate ships with a hardened baseline. These measures are intentionally in place — do not remove or weaken them without a documented reason (see the repo's `CLAUDE.md` for the canonical, enforced rule set).

## Application

| Measure                               | Location                                                                                                         | Rule                                                                                                                                                                                                                                                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SECRET_KEY` fail-fast                | `services/app/src/config.ts` — `requireEnv()`                                                                    | Throws at startup if unset. Never add a default fallback value.                                                                                                                                                                                                                                            |
| Request body limit                    | `services/app/src/app.ts` — content-length guard middleware + `express.json({ limit: config.maxContentLength })` | 50 MB hard limit on all uploads — a middleware checks the `Content-Length` header and replies 413 before any handler runs; `express.json()`'s own `limit` backs it up for bodies that stream in without a declared length.                                                                                 |
| File upload allowlist                 | `services/app/src/routes/v1/media.ts` — `ALLOWED_EXTENSIONS`                                                     | Allowlist of `jpg`, `jpeg`, `png`, `gif`, `webp`, `pdf`, `mp4`, `mov` only. Extend deliberately; never switch to a blocklist.                                                                                                                                                                              |
| SQL/connection-string masking in logs | `services/app/src/logging/dataFilter.ts` — `sanitizeTraceback()`                                                 | Strips `[SQL: ...]`, `[parameters: ...]`, and DB connection strings from every traceback before it reaches any log backend. `lambda/src/safeExc.ts` has an inline equivalent (covers 3 DB schemes, not 5 — an intentional divergence carried over from the original).                                      |
| GraphQL introspection                 | `services/app/src/app.ts` + `config.ts`                                                                          | `graphqlIntrospection = true` only when `configName === "development"`; `false` for `production`/`testing`. Enforced via `NoSchemaIntrospectionCustomRule` passed to `graphql-http`'s `createHandler({ validationRules })`. Do not hardcode `true`.                                                        |
| Explicit JWT algorithm                | `services/app/src/lib/auth.ts`                                                                                   | Signs/verifies via the `jsonwebtoken` package directly, algorithm pinned to `config.jwtAlgorithm` ("HS256"), with a custom `type: "access" \| "refresh"` claim checked on every verify — `jsonwebtoken` has no built-in access/refresh distinction, so this is hand-rolled parity with flask-jwt-extended. |

## Nginx

| Measure              | Rule                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Security headers     | `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `server_tokens off` — all with `always` so they apply to error responses too. |
| HSTS                 | Commented out in `nginx/nginx.conf`. Enable **only after** TLS is live on the ALB — enabling it over HTTP permanently breaks access for returning visitors.         |
| Rate limiting        | 300 req/min per IP general, 20 req/min per IP on auth routes (burst 5) to slow brute-force.                                                                         |
| Connection cap       | 20 concurrent connections per IP.                                                                                                                                   |
| Slowloris mitigation | Body/header/send timeouts: 10s, keepalive: 30s.                                                                                                                     |
| Oversized requests   | Header buffer 1k, body buffer 16k.                                                                                                                                  |
| Metrics lockdown     | `/metrics` reachable only from the Docker internal network.                                                                                                         |

## Infrastructure (Terraform)

| Measure                  | Location                                             | Rule                                                                                                                                   |
| ------------------------ | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Redis TLS                | `terraform/modules/elasticache/main.tf`              | `transit_encryption_enabled = true`. Output URL is `rediss://` (double-s). Both must stay in sync.                                     |
| Non-root containers      | `services/app/Dockerfile`, `lambda/Dockerfile*`      | App uses an `app` system user; Lambda uses `nobody`. The `USER` instruction must remain after all `COPY`/`RUN` steps.                  |
| ECS task role SQS scope  | `terraform/modules/iam/main.tf`                      | Express app: `sqs:SendMessage` + `sqs:GetQueueAttributes` only. Lambda worker: `ReceiveMessage` + `DeleteMessage`. Never cross-assign. |
| Secrets Manager recovery | `terraform/main.tf`, `terraform/modules/rds/main.tf` | `recovery_window_in_days = 7`. Never set to `0` in committed code.                                                                     |
| WAF logging              | `terraform/modules/waf/main.tf`                      | CloudWatch log group `aws-waf-logs-{prefix}`, 90-day retention. Do not remove `aws_wafv2_web_acl_logging_configuration`.               |

See [[Infrastructure-Terraform]] for the full module layout these controls live in.

## Intentional gaps (not implemented by design)

| Gap                            | Why                                                                                                                        | How to add                                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Content-Security-Policy        | Covering the GraphQL explorer (Ruru) requires per-deployment origin config; a wrong CSP silently breaks it                 | Add to `nginx/nginx.conf` once frontend origins are known                                                          |
| HSTS                           | Enabling over HTTP permanently breaks returning visitors                                                                   | Enable only after TLS is live on the ALB                                                                           |
| Redis AUTH token               | Cluster is in a private subnet accessible only via security group                                                          | Add an AUTH token when moving to multi-tenant or shared infrastructure                                             |
| MIME type sniffing             | Files go to S3 and are never executed server-side; extension allowlisting is sufficient                                    | Add server-side content-type sniffing if serving files from a public CDN without `Content-Disposition: attachment` |
| JWT refresh token blacklisting | Stateless by design                                                                                                        | Add a Redis-backed blacklist if logout must immediately invalidate tokens                                          |
| Request trust-proxy wiring     | Nginx forwards `X-Forwarded-*`, but Express isn't configured to trust them (`app.set("trust proxy", ...)` is never called) | Add it if you need accurate client IPs for logging/rate-limiting                                                   |

## Reporting a concern

If you find a security issue in this boilerplate, treat it as you would any vulnerability report for code you maintain — open it privately with the maintainer rather than as a public issue if it's exploitable in deployed instances.
