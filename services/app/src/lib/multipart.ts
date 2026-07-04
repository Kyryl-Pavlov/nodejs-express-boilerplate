import type { Readable } from "node:stream";

import busboy from "busboy";
import type { Request } from "express";

export interface UploadedFile {
  filename: string;
  file: Readable;
}

/**
 * Parses a single `multipart/form-data` file part: resolves with the raw part stream
 * (not buffered) so the caller can pipe it straight through to S3, or `undefined` if
 * the request has no file part.
 */
export function parseSingleFile(
  req: Request,
  maxFileSize: number,
): Promise<UploadedFile | undefined> {
  return new Promise((resolve, reject) => {
    const contentType = req.headers["content-type"];
    if (!contentType?.startsWith("multipart/form-data")) {
      resolve(undefined);
      return;
    }

    const bb = busboy({ headers: req.headers, limits: { fileSize: maxFileSize } });
    let resolved = false;

    bb.on("file", (_fieldname, file, info) => {
      resolved = true;
      resolve({ filename: info.filename, file });
    });
    bb.on("error", (err) => {
      if (!resolved) reject(err instanceof Error ? err : new Error(String(err)));
    });
    bb.on("finish", () => {
      if (!resolved) resolve(undefined);
    });

    req.pipe(bb);
  });
}
