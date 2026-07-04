import { execFileSync } from "node:child_process";
import path from "node:path";

import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";

// Unit tests are fully isolated and never touch a DB — skip the (slow) container
// entirely when only running that tier. Integration and e2e both need it.
function needsDatabase(): boolean {
  const argv = process.argv.join(" ");
  if (argv.includes("tests/app/integration") || argv.includes("tests/app/e2e"))
    return true;
  if (argv.includes("tests/app/unit")) return false;
  return true; // no path filter passed — running everything
}

let container: StartedPostgreSqlContainer | undefined;

export async function setup(): Promise<void> {
  if (!needsDatabase()) return;

  container = await new PostgreSqlContainer("postgres:16-alpine").start();
  const databaseUrl = container.getConnectionUri();
  process.env.DATABASE_URL = databaseUrl;

  const schemaPath = path.resolve(process.cwd(), "services/app/prisma/schema.prisma");
  execFileSync(
    "npx",
    [
      "prisma",
      "db",
      "push",
      "--schema",
      schemaPath,
      "--skip-generate",
      "--accept-data-loss",
    ],
    {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "inherit",
      shell: true,
    },
  );
}

export async function teardown(): Promise<void> {
  await container?.stop();
}
