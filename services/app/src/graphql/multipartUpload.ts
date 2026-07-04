import busboy from "busboy";
import type { Request } from "express";

// REST media upload uses busboy directly (lib/multipart.ts) for a single streamed file.
// GraphQL file uploads are handled separately here by hand-rolling the jaydenseric
// graphql-multipart-request-spec (operations/map/file parts) on top of a second busboy
// parser scoped to /graphql requests, since graphql-http has no first-party upload support.

export interface ResolvedUpload {
  filename: string;
  content: Buffer;
}

function setByPath(
  target: Record<string, unknown>,
  path: string[],
  value: unknown,
): void {
  let node: Record<string, unknown> = target;
  for (let i = 0; i < path.length - 1; i++) {
    const next = node[path[i]];
    if (typeof next !== "object" || next === null) return;
    node = next as Record<string, unknown>;
  }
  node[path[path.length - 1]] = value;
}

export const GRAPHQL_PATH = "/graphql";

export function isGraphqlMultipartRequest(req: Request): boolean {
  const contentType = req.headers["content-type"] ?? "";
  // originalUrl (not path/url), since this runs inside a middleware mounted at
  // GRAPHQL_PATH — Express strips the mount prefix from req.path/req.url there.
  return (
    req.originalUrl.startsWith(GRAPHQL_PATH) &&
    contentType.startsWith("multipart/form-data")
  );
}

/** Parses a GraphQL multipart request into a normal { query, variables } body,
 * replacing each file placeholder in `variables` with a ResolvedUpload. Each file part is
 * buffered fully into memory (mirroring the original's part.toBuffer() behaviour) rather
 * than kept as a live stream, since the resolved value must be a plain object the GraphQL
 * executor can pass straight to a resolver argument. */
export function parseGraphqlMultipart(req: Request): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let operations: { query?: string; variables?: Record<string, unknown> } = {};
    let fileMap: Record<string, string[]> = {};
    const files: Record<string, ResolvedUpload> = {};
    const fileBuffers: Promise<void>[] = [];

    const bb = busboy({ headers: req.headers });

    bb.on("file", (fieldname, file, info) => {
      const chunks: Buffer[] = [];
      fileBuffers.push(
        new Promise((res, rej) => {
          file.on("data", (chunk: Buffer) => chunks.push(chunk));
          file.on("end", () => {
            files[fieldname] = {
              filename: info.filename,
              content: Buffer.concat(chunks),
            };
            res();
          });
          file.on("error", rej);
        }),
      );
    });

    bb.on("field", (fieldname, value) => {
      if (fieldname === "operations") {
        operations = JSON.parse(value) as typeof operations;
      } else if (fieldname === "map") {
        fileMap = JSON.parse(value) as typeof fileMap;
      }
    });

    bb.on("error", reject);

    bb.on("finish", () => {
      Promise.all(fileBuffers)
        .then(() => {
          operations.variables ??= {};
          for (const [fileKey, paths] of Object.entries(fileMap)) {
            const resolved = files[fileKey];
            if (!resolved) continue;
            // Each path is like "variables.file" — navigate from `operations` itself, not
            // from `operations.variables`, since the path already includes that segment.
            for (const path of paths) {
              setByPath(
                operations as Record<string, unknown>,
                path.split("."),
                resolved,
              );
            }
          }
          resolve({ query: operations.query, variables: operations.variables });
        })
        .catch(reject);
    });

    req.pipe(bb);
  });
}
