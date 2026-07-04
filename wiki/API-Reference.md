# API Reference

All REST responses follow the same envelope:

```json
{ "success": true, "message": "", "data": {} }
```

GraphQL always returns HTTP 200 — success/failure lives in `response.data.<resolver>.success`.

## REST endpoints

### Health

| Method | Path             | Auth | Description                                                     |
| ------ | ---------------- | ---- | --------------------------------------------------------------- |
| GET    | `/api/v1/health` | None | Returns status and API version (bypasses the response envelope) |

### Auth

| Method | Path                    | Auth          | Description                                   |
| ------ | ----------------------- | ------------- | --------------------------------------------- |
| POST   | `/api/v1/auth/register` | None          | Create a new user account                     |
| POST   | `/api/v1/auth/login`    | None          | Log in, receive access + refresh tokens       |
| POST   | `/api/v1/auth/refresh`  | Refresh token | Exchange refresh token for a new access token |

### Media

| Method | Path                           | Auth         | Description                                    |
| ------ | ------------------------------ | ------------ | ---------------------------------------------- |
| POST   | `/api/v1/media/upload`         | Access token | Upload a file to S3, returns a presigned URL   |
| GET    | `/api/v1/media/<media_id>/url` | Access token | Get a fresh presigned URL for an existing file |

### Events

| Method | Path             | Auth         | Description                                         |
| ------ | ---------------- | ------------ | --------------------------------------------------- |
| POST   | `/api/v1/events` | Access token | Publish an event to SQS; returns `message_id` (202) |
| GET    | `/api/v1/events` | Access token | List the last 100 processed events                  |

### Cache (dev / diagnostics)

| Method | Path                 | Auth | Description                                       |
| ------ | -------------------- | ---- | ------------------------------------------------- |
| GET    | `/api/v1/cache/ping` | None | Check Redis connectivity                          |
| GET    | `/api/v1/cache/test` | None | Read a cached value (miss computes and stores it) |
| DELETE | `/api/v1/cache/test` | None | Invalidate the cached value                       |

## Authentication model

- `access_token` — 15 minutes, sent as `Authorization: Bearer <token>` on every protected request
- `refresh_token` — 30 days, used only to obtain a new `access_token`
- JWT algorithm is pinned to HS256 with an explicit `type: "access" | "refresh"` claim, checked on every verify, so a refresh token can't be used where an access token is required (and vice versa)

## End-to-end example (curl)

**1. Register**

```bash
curl -X POST http://localhost/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "alice@example.com", "password": "secret123"}'
```

**2. Login**

```bash
curl -X POST http://localhost/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "alice@example.com", "password": "secret123"}'
```

```json
{
  "success": true,
  "message": "",
  "data": { "access_token": "eyJ...", "refresh_token": "eyJ..." }
}
```

**3. Upload a file**

```bash
curl -X POST http://localhost/api/v1/media/upload \
  -H "Authorization: Bearer <access_token>" \
  -F "file=@/path/to/photo.jpg"
```

```json
{
  "success": true,
  "message": "",
  "data": {
    "media_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "url": "http://localhost:4566/media-bucket/media/...?X-Amz-Signature=...",
    "expires_in": 3600
  }
}
```

The database only ever stores the S3 key (`contentKey`), never the URL — presigned URLs are generated on demand. Note the REST upload endpoint returns a hardcoded 1-hour `expires_in`, while GraphQL's default is 24 hours (`PRESIGNED_URL_EXPIRY`) — an intentional inconsistency carried over from the original boilerplate.

**4. Get a fresh presigned URL**

```bash
curl http://localhost/api/v1/media/<media_id>/url -H "Authorization: Bearer <access_token>"
```

**5. Refresh an expired access token**

```bash
curl -X POST http://localhost/api/v1/auth/refresh -H "Authorization: Bearer <refresh_token>"
```

## GraphQL API

An interactive GraphQL explorer (Ruru, served via `ruruHTML()`) is available at `GET` http://localhost/graphql, but only when `graphqlIntrospection` is enabled — development only, see [[Security]]. Every environment accepts `POST` http://localhost/graphql for actual queries and mutations, handled by `graphql-http`. For authenticated requests (in the explorer or any other client), add an HTTP header: `{"Authorization": "Bearer <access_token>"}`.

GraphQL field names use **camelCase** (`accessToken`, `mediaId`, `expiresIn`) even though REST uses snake_case — the SDL is hand-written camelCase directly, since `graphql-http` doesn't auto-convert field casing the way Strawberry did for the Python original.

```graphql
mutation {
  register(email: "alice@example.com", password: "secret123") {
    success
    message
  }
}
```

```graphql
mutation {
  login(email: "alice@example.com", password: "secret123") {
    success
    message
    data {
      accessToken
      refreshToken
    }
  }
}
```

File uploads use the [multipart request spec](https://github.com/jaydenseric/graphql-multipart-request-spec) — use a client that supports it (Postman, or Apollo Client with the upload link):

```graphql
mutation UploadFile($file: Upload!) {
  uploadFile(file: $file) {
    success
    message
    data {
      mediaId
      url
      expiresIn
    }
  }
}
```

```graphql
query {
  signedUrl(mediaId: "3fa85f64-5717-4562-b3fc-2c963f66afa6") {
    success
    data
  }
}
```

## Async events

```bash
curl -X POST http://localhost/api/v1/events \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"type": "user.action", "payload": {"detail": "example"}}'
```

```bash
curl http://localhost/api/v1/events -H "Authorization: Bearer <access_token>"
```

See [[Architecture]] for how the SQS → Lambda → Postgres pipeline processes these under the hood.

## Redis cache

`/api/v1/cache/ping` → `{"redis": "ok"}` or `{"redis": "unavailable"}`. `/api/v1/cache/test` demonstrates a read-through cache: the first call computes and stores a value for 60 seconds, subsequent calls return it from Redis with the remaining TTL.

```ts
const cache = req.app.cache;
if (cache) {
  const cached = await cache.get<MyType>("my:key");
  if (cached === null) {
    const result = await expensiveComputation();
    await cache.set("my:key", result, 300);
  }
}
```

If `REDIS_URL` is unset, `app.cache` is `null` and all cache calls are skipped — the app degrades gracefully.

## Keeping this page in sync

`postman_collection.json` at the repo root must be kept in sync with any endpoint addition, removal, rename, or shape change — it has test scripts on Login/Upload that auto-capture tokens/IDs for chained requests.
