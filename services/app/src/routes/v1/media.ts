import { Router } from "express";

import { restApiResponse } from "../../api/utils/response.js";
import { requireAccessToken } from "../../lib/auth.js";
import { parseSingleFile } from "../../lib/multipart.js";
import { isValidUuid } from "../../lib/uuid.js";
import { getPresignedUrl, uploadFile } from "../../services/awsS3Service.js";

const ALLOWED_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "pdf",
  "mp4",
  "mov",
]);

function isAllowedFile(filename: string): boolean {
  const idx = filename.lastIndexOf(".");
  if (idx === -1) return false;
  return ALLOWED_EXTENSIONS.has(filename.slice(idx + 1).toLowerCase());
}

export function mediaRoutes(): Router {
  const router = Router();

  router.post("/upload", requireAccessToken, async (req, res) => {
    if (!req.userId) return;

    const file = await parseSingleFile(req, req.app.config.maxContentLength).catch(
      () => undefined,
    );
    if (!file) {
      return restApiResponse(res, {
        success: false,
        message: "No file provided",
        statusCode: 400,
      });
    }
    if (!file.filename) {
      return restApiResponse(res, {
        success: false,
        message: "Empty filename",
        statusCode: 400,
      });
    }
    if (!isAllowedFile(file.filename)) {
      const allowed = [...ALLOWED_EXTENSIONS].sort().join(", ");
      return restApiResponse(res, {
        success: false,
        message: `File type not allowed. Permitted: ${allowed}`,
        statusCode: 415,
      });
    }

    let s3Key: string;
    try {
      s3Key = await uploadFile(
        req.app.config.aws,
        file.file,
        req.userId,
        file.filename,
      );
    } catch (err) {
      return restApiResponse(res, {
        success: false,
        message: "File upload failed",
        statusCode: 500,
        exc: err,
      });
    }

    let record;
    try {
      record = await req.app.prisma.media.create({
        data: { userId: req.userId, contentKey: s3Key },
      });
    } catch (err) {
      return restApiResponse(res, {
        success: false,
        message: "Failed to save file record",
        statusCode: 500,
        exc: err,
      });
    }

    let signedUrl: string;
    try {
      signedUrl = await getPresignedUrl(req.app.config.aws, s3Key);
    } catch (err) {
      return restApiResponse(res, {
        success: false,
        message: "Failed to generate URL",
        statusCode: 500,
        exc: err,
      });
    }

    // expires_in is hardcoded to 3600 here (not PRESIGNED_URL_EXPIRY) — an intentional
    // REST/GraphQL inconsistency; GraphQL's uploadFile does use the configured value.
    return restApiResponse(res, {
      data: { media_id: record.id, url: signedUrl, expires_in: 3600 },
      statusCode: 201,
    });
  });

  router.get("/:mediaId/url", requireAccessToken, async (req, res) => {
    if (!req.userId) return;
    const { mediaId } = req.params;

    if (!isValidUuid(mediaId)) {
      return restApiResponse(res, {
        success: false,
        message: "Invalid media ID",
        statusCode: 400,
      });
    }

    const record = await req.app.prisma.media.findUnique({ where: { id: mediaId } });
    if (!record || record.userId !== req.userId) {
      return restApiResponse(res, {
        success: false,
        message: "Not found",
        statusCode: 404,
      });
    }

    try {
      const url = await getPresignedUrl(req.app.config.aws, record.contentKey);
      return restApiResponse(res, { data: { url } });
    } catch (err) {
      return restApiResponse(res, {
        success: false,
        message: "Failed to generate URL",
        statusCode: 500,
        exc: err,
      });
    }
  });

  return router;
}
