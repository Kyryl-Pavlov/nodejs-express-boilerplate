# Testing

## Structure

Tests live under `tests/app/` at the repo root (not inside `services/app/`), mirroring the source tree:

```
tests/
├── setup.ts        — sets SECRET_KEY/JWT_SECRET_KEY/BCRYPT_ROUNDS before any @app/* module loads
├── globalSetup.ts  — starts one shared Postgres testcontainer for the whole run
└── app/
    ├── unit/          — pure functions, zero external deps
    │   ├── api/         restApiResponse() tests
    │   ├── graphql/     eventToPayload() tests
    │   ├── logging/     maskSensitive(), AppLogger fanout, ConsoleLogger, CloudWatchLogger tests
    │   └── services/    CacheService JSON wrap/unwrap, TTL, ping
    ├── integration/   — supertest requests against the Express app + a real Postgres testcontainer
    │   ├── REST:        auth, media, events, cache, health
    │   └── GraphQL:     graphqlAuth, graphqlMedia, graphqlEvents, graphqlCache, graphqlHealth
    └── e2e/           — real HTTP against the full CI stack (Docker required)
```

## Running tests

```bash
npm install                 # root + all workspaces

npm test                    # unit + integration — needs Docker (testcontainer)
npm run test:unit           # unit only — no Docker needed
npm run test:coverage       # with coverage report

# E2E — requires the CI stack running
docker compose -f docker-compose.ci.yml up -d --wait
npm run test:e2e
docker compose -f docker-compose.ci.yml down -v
```

Override the E2E target to hit a deployed environment:

```bash
E2E_BASE_URL=https://staging.example.com/api/v1 npm run test:e2e
```

## Key fixtures (`tests/app/integration/fixtures.ts`)

Vitest's `test.extend()` API mirrors pytest's fixture dependency-injection graph closely — deliberate, to keep the fixture DI model recognizable across the port from the Python original.

| Fixture                        | What it does                                                                                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app`                          | Builds an Express app via `buildApp("testing")`, memoized per test file. Teardown truncates all tables (`TRUNCATE ... RESTART IDENTITY CASCADE`)                     |
| `client`                       | The same Express app — `supertest`'s `request(client)` plays the role of Flask's test client (supertest wraps the app fresh per request, no listening server needed) |
| `registeredUser`               | Registers a fixed test user (`user@example.com`) via the REST endpoint                                                                                               |
| `accessToken` / `refreshToken` | Logs in `registeredUser`, extracts the respective token                                                                                                              |
| `authHeaders`                  | `{ Authorization: "Bearer <accessToken>" }`                                                                                                                          |
| `gql`                          | Factory fixture — posts a GraphQL query/mutation, returns the injected response                                                                                      |
| `gqlAuthHeaders`               | Same idea as `authHeaders` but obtained via the GraphQL `login` mutation — returns both `.access` and `.refresh` header sets                                         |
| `mockCache`                    | Replaces `app.cache` with `vi.fn()` mocks for the test, restores the original afterward                                                                              |

## Coverage exclusions

Intentional gaps in `vitest.config.ts`'s `coverage.exclude`:

- `awsS3Service.ts`, `awsSqsService.ts` — SDK wiring only, no project logic to verify
- `lokiLogger.ts`, `sentryLogger.ts` — thin SDK/fetch call wrappers
- `server.ts` — process entry point, not unit-testable

## Gotchas

- **`tests/setup.ts` env vars** (`SECRET_KEY`, `JWT_SECRET_KEY`, `BCRYPT_ROUNDS=4`) must be set before any `@app/*` module is imported anywhere in the run — `config.ts` throws at import time if `SECRET_KEY` is unset, and `lib/password.ts` reads `BCRYPT_ROUNDS` at module load. `BCRYPT_ROUNDS=4` mirrors the source's `fast_bcrypt` fixture to keep hashing fast across the suite.
- **Integration tests need Postgres**, unlike the Python original's SQLite `:memory:` + `StaticPool` trick — Prisma has no equivalent transparent SQLite swap without schema-drift risk. `tests/globalSetup.ts` spins up one shared `@testcontainers/postgresql` container for the whole run instead. This is the one disclosed regression from the Python original's dev ergonomics.
- **Test files run sequentially, not in parallel** (`fileParallelism: false` in `vitest.config.ts`) — integration/e2e tests share one Postgres container across files; parallel file execution would let them race on the same tables.
- **GraphQL vs REST auth** — resolvers call `verifyAccessToken()`/`verifyRefreshToken()` manually, not via route-level middleware. GraphQL always returns HTTP 200 — success/failure lives in `response.data.<resolver>.success`. Integration tests POST to `/graphql` with the `Authorization` header directly.
- **E2E `BASE_URL`** — defaults to `http://localhost/api/v1`. Override via `E2E_BASE_URL`.

## Adding tests for a new feature

1. Unit tests in `tests/app/unit/<layer>/` for any new pure/utility functions.
2. REST integration tests in `tests/app/integration/<resource>.spec.ts`.
3. GraphQL integration tests in `tests/app/integration/graphql<Resource>.spec.ts`.
4. Add the happy-path to `tests/app/e2e/e2e.spec.ts` if it involves a new infrastructure dependency (new AWS service, new DB table, etc.).
5. Mock at the service-function boundary, not at the SDK level: `vi.mock("@app/services/<module>.js")`. REST routes and GraphQL resolvers each hold independent imports of the same underlying service function — mock each layer's own import path.

## CI integration

See [[CI-CD-Pipeline]] for how `lint`, `test`, and `e2e` run as parallel jobs on every push and pull request.
