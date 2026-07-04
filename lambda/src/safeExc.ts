// Inline duplicate of the app's dataFilter sanitizer — intentionally only covers
// 3 DB schemes (not 5 like the app's version), an accepted divergence.
const SQL_BLOCK = /\[SQL:.*?\]/gs;
const PARAMS_BLOCK = /\[parameters:.*?\]/gs;
const DB_CONNSTR = /\b(postgresql|mysql|sqlite)(\+\w+)?:\/\/\S+/gis;

export function safeExc(err: unknown): string {
  const name = err instanceof Error ? err.constructor.name : "Error";
  const message = (err instanceof Error ? err.message : String(err))
    .replace(SQL_BLOCK, "[SQL redacted]")
    .replace(PARAMS_BLOCK, "[parameters redacted]")
    .replace(DB_CONNSTR, "[connection string redacted]");
  return `${name}: ${message}`;
}
