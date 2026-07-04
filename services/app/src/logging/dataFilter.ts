const MASK = "***";

// Matches embedded raw-SQL/bound-parameter blocks and common DB connection string
// schemes that can leak into exception messages/tracebacks.
const SQL_BLOCK = /\[SQL:.*?\]/gs;
const PARAMS_BLOCK = /\[parameters:.*?\]/gs;
const DB_CONNSTR = /\b(postgresql|mysql|sqlite|mongodb|redis)(\+\w+)?:\/\/\S+/gis;

const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  "password",
  "passwd",
  "pass",
  "secret",
  "secret_key",
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "auth_token",
  "bearer_token",
  "bearer",
  "jwt",
  "session_token",
  "session",
  "oauth_token",
  "client_secret",
  "client_token",
  "authorization",
  "auth",
  "api_key",
  "apikey",
  "private_key",
  "signing_key",
  "credential",
  "credentials",
  "credit_card",
  "card_number",
  "cvv",
  "cvc",
  "ssn",
  "pin",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type Maskable = Record<string, unknown> | unknown[] | null | undefined;

export function maskSensitive(data: Maskable): Maskable {
  if (data === null || data === undefined) return null;
  if (Array.isArray(data)) return maskList(data);
  return maskDict(data);
}

function maskDict(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      result[key] = MASK;
    } else if (isPlainObject(value)) {
      result[key] = maskDict(value);
    } else if (Array.isArray(value)) {
      result[key] = maskList(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// Only masks dicts found inside a list — a list-of-lists is not recursed further
// (shallow-recursion boundary, intentional).
function maskList(items: unknown[]): unknown[] {
  return items.map((item) => (isPlainObject(item) ? maskDict(item) : item));
}

/** Strips SQL statements, bound parameters, and connection strings from a traceback string. */
export function sanitizeTraceback(trace: string): string {
  return trace
    .replace(SQL_BLOCK, "[SQL redacted]")
    .replace(PARAMS_BLOCK, "[parameters redacted]")
    .replace(DB_CONNSTR, "[connection string redacted]");
}
