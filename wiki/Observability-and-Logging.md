# Observability and Logging

## Logging architecture

The app uses an Object Adapter pattern. All loggers implement `LoggerBackend` (`services/app/src/logging/logger.ts`) and are injected into `AppLogger`, which fans out every call to all of them.

| Class              | Location                      | Behaviour                                                                                                                                                                                                                           |
| ------------------ | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AppLogger`        | `logging/logger.ts`           | Fanout adapter; single public method `log(message, options)`. `LogLevel` enum exposed as `AppLogger.Level.{INFO,WARN,ERROR}`                                                                                                        |
| `ConsoleLogger`    | `logging/logger.ts`           | Wraps a standalone `pino` instance created directly — Express has no built-in request logger to disable; the request-timing middleware in `app.ts` is what feeds this logger per request. Level is `debug` in dev, `warn` otherwise |
| `SentryLogger`     | `logging/sentryLogger.ts`     | `info`/`warn` → breadcrumbs; `error` → `captureMessage` with extras, via `@sentry/node`                                                                                                                                             |
| `CloudWatchLogger` | `logging/cloudwatchLogger.ts` | Hand-rolled against `@aws-sdk/client-cloudwatch-logs` — ensures the log group/stream exist once (memoized promise), then ships one `PutLogEventsCommand` per call                                                                   |
| `LokiLogger`       | `logging/lokiLogger.ts`       | POSTs structured JSON to Loki's `/loki/api/v1/push` using built-in `fetch()`; failures are silently swallowed                                                                                                                       |

`AppLogger` is created in `buildApp()` and assigned directly onto the Express app object as `app.loggerAdapter` (see the `Express.Application` augmentation in `services/app/src/types/express.d.ts`). Sentry, CloudWatch, and Loki are **opt-in** — only wired when their env vars are set.

**Automatic logging:** `restApiResponse()` (REST) and `makeResponse()` (GraphQL) call the logger automatically on every response. Log level derivation differs by transport — **an intentional divergence**:

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

**Data filtering:** `maskSensitive()` in `logging/dataFilter.ts` recursively replaces values of sensitive keys (`password`, `token`, `secret`, `authorization`, etc. — 32 keys total) with `***`, applied automatically in `AppLogger.log()` before any backend sees the data. It only masks dicts found inside a top-level list (shallow recursion boundary), matching the original exactly.

**Sentry notes:**

- JWT auth failures on REST routes reply 401 directly from the `requireAccessToken`/`requireRefreshToken` middleware, not through `restApiResponse()` — Sentry won't see them as logged events.
- `info`/`warn` calls appear only as breadcrumbs inside Sentry error events, not standalone events — sending every log as an event would burn Sentry quota.

**CloudWatch / LocalStack notes:**

- LocalStack must have `logs` in `SERVICES` (already set in `docker-compose.yml`).
- On Windows with Git Bash, prefix every `aws logs` CLI command with `MSYS_NO_PATHCONV=1` to prevent path conversion of the log group name.
- Query locally: `MSYS_NO_PATHCONV=1 aws --endpoint-url=http://localhost:4566 logs get-log-events --log-group-name /myapp/dev --log-stream-name app`

**Adding a new logger backend:**

1. Create a class in `services/app/src/logging/` implementing `LoggerBackend` (`info`, `warning`, `error`).
2. Instantiate it conditionally in `buildApp()` and push it into the `loggers` array.
3. Add the required env var to `config.ts`'s `AppConfig`/`loadConfig`.

## Observability stack

```
Express /metrics  ──scrape──►  Prometheus  ──PromQL──►  Grafana
AppLogger         ──push───►   Loki        ──LogQL───►  Grafana
node-exporter     ──scrape──►  Prometheus
cAdvisor          ──scrape──►  Prometheus  (non-functional on Docker Desktop)
```

### Grafana

- `grafana/provisioning/datasources/datasources.yml` — registers Prometheus (uid: `prometheus`) and Loki (uid: `loki`) automatically.
- `grafana/provisioning/dashboards/dashboards.yml` — loads all JSON files from `grafana/dashboards/` on startup.
- `grafana/dashboards/flask-app.json` — App dashboard: request rate, error rate, p95/p99 latency, request rate by status/route, latency by route, error logs, all logs. Filename kept for continuity; PromQL inside uses `prom-client`'s metric names (`http_request_duration_seconds`), not `prometheus-flask-exporter`'s.
- `grafana/dashboards/host-metrics.json` — CPU, memory, network I/O, disk I/O, load average, open file descriptors.
- Login: `admin` / `admin` (via `GF_SECURITY_ADMIN_PASSWORD`).

### Prometheus metrics (`prom-client`)

Registered manually in `app.ts` — a `Histogram` (`http_request_duration_seconds`, labels `method`/`route`/`status_code`) observed via a `res.on("finish", ...)` listener inside a request-timing middleware, plus `prom-client`'s default Node process metrics. Exposed via `/metrics`. `prometheus.yml` scrapes `app:5000/metrics`, `cadvisor:8080/metrics`, and `node-exporter:9100/metrics` every 15s.

```promql
# Request rate per route (last 5 min)
rate(http_request_duration_seconds_count[5m])

# 95th percentile response time
histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))

# Error rate (non-2xx responses)
rate(http_request_duration_seconds_count{status_code!~"2.."}[5m])
```

### Host metrics (Node Exporter)

Mounts `/proc`, `/sys`, and `/` read-only from the host; exposes `node_cpu_seconds_total`, `node_memory_MemAvailable_bytes`, `node_filesystem_avail_bytes`, `node_disk_read_bytes_total`, `node_network_receive_bytes_total`, `node_load1/5/15`. Works correctly on Docker Desktop for Windows (reads from `/proc`/`/sys`, mapped into the WSL2 VM). Scope: entire host/VM, not per-container.

```promql
100 - (avg(rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)   # CPU usage %
(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100  # Memory usage %
```

> On Windows with Docker Desktop, Node Exporter reports WSL2 VM metrics, not Windows host metrics — expected, since containers run inside WSL2.

### cAdvisor (container metrics)

`gcr.io/cadvisor/cadvisor:v0.47.2` — pinned because v0.55+ requires the containerd socket at `/run/containerd/containerd.sock`, which Docker Desktop for Windows doesn't expose there. Effectively non-functional on Windows Docker Desktop, included for production parity; works without changes on a real Linux host. Scope: per-container CPU, memory, network, disk.

### Logs (Loki)

Every event is tagged `{app: "nodejs-express-boilerplate", env: <configName>, level: <info|warning|error>}`.

```logql
{app="nodejs-express-boilerplate"}
{app="nodejs-express-boilerplate", level="error"}
{app="nodejs-express-boilerplate"} |= "upload"
```

## Production on AWS Fargate

Fargate is serverless — no accessible host OS, Docker socket, or cgroup filesystem. The local stack is replaced entirely:

| Local                          | AWS Fargate                                                                                                                 |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Node Exporter + cAdvisor       | **CloudWatch Container Insights** — one ECS cluster setting; native per-task CPU/memory/network from the Fargate hypervisor |
| Prometheus scraping `/metrics` | **ADOT sidecar** in the same Fargate task, scrapes `localhost:5000/metrics`, ships to Amazon Managed Prometheus             |
| Prometheus (storage)           | **Amazon Managed Prometheus (AMP)**                                                                                         |
| Loki                           | **CloudWatch Logs** — already wired via `CloudWatchLogger`, no changes needed                                               |
| Grafana                        | **Amazon Managed Grafana (AMG)** — connects to AMP and CloudWatch                                                           |

The only app-side requirement is the `/metrics` endpoint — ADOT picks it up without any code changes.
