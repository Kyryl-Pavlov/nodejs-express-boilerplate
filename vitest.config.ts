import { fileURLToPath } from "node:url";

import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// graphql's package.json declares both "main" (CJS, index.js) and "module" (ESM,
// index.mjs) with no "exports" map. Vite's resolver prefers "module" for our own
// `import ... from "graphql"`, while graphql-http's internal ESM build resolves its
// own copy — two different files, each defining its own GraphQLNonNull class, so
// graphql-js's instanceof checks reject types built by "the other" one ("from another
// module or realm"). Aliasing to one explicit file eliminates the ambiguity.
const graphqlCjsEntry = fileURLToPath(
  new URL("./node_modules/graphql/index.js", import.meta.url),
);

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: [{ find: /^graphql$/, replacement: graphqlCjsEntry }],
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/app/**/*.spec.ts"],
    setupFiles: ["tests/setup.ts"],
    globalSetup: ["tests/globalSetup.ts"],
    // Integration/e2e tests share one Postgres testcontainer across files; running
    // files in parallel would let them race on the same tables. Unit tests are
    // isolated and would benefit from parallelism, but keeping one policy for the
    // whole suite is simpler and the total suite is still fast.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      include: ["services/app/src/**/*.ts"],
      exclude: [
        "services/app/src/services/awsS3Service.ts",
        "services/app/src/services/awsSqsService.ts",
        "services/app/src/logging/lokiLogger.ts",
        "services/app/src/logging/sentryLogger.ts",
        "services/app/src/server.ts",
      ],
    },
  },
});
