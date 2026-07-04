import { verifyAccessToken } from "../../lib/auth.js";
import { isValidUuid } from "../../lib/uuid.js";
import { getPresignedUrl, uploadFile } from "../../services/awsS3Service.js";
import type { AppGraphQLContext } from "../context.js";
import type { ResolvedUpload } from "../multipartUpload.js";
import { makeResponse } from "../response.js";

export const mediaResolvers = {
  Query: {
    signedUrl: async (
      _root: unknown,
      args: { mediaId: string },
      context: AppGraphQLContext,
    ) => {
      const logger = context.app.loggerAdapter;
      let userId: string;
      try {
        userId = await verifyAccessToken(context.request);
      } catch (err) {
        return makeResponse(logger, {
          success: false,
          message: "Unauthorized",
          exc: err,
        });
      }

      if (!isValidUuid(args.mediaId)) {
        return makeResponse(logger, { success: false, message: "Invalid media ID" });
      }

      const record = await context.app.prisma.media.findUnique({
        where: { id: args.mediaId },
      });
      // Generic "Not found" for both nonexistent IDs and wrong-owner IDs — deliberately non-leaking.
      if (!record || record.userId !== userId) {
        return makeResponse(logger, { success: false, message: "Not found" });
      }

      try {
        const url = await getPresignedUrl(context.app.config.aws, record.contentKey);
        return makeResponse(logger, { success: true, message: "ok", data: url });
      } catch (err) {
        return makeResponse(logger, {
          success: false,
          message: "Failed to generate URL",
          exc: err,
        });
      }
    },
  },

  Mutation: {
    uploadFile: async (
      _root: unknown,
      args: { file: ResolvedUpload },
      context: AppGraphQLContext,
    ) => {
      const logger = context.app.loggerAdapter;
      let userId: string;
      try {
        userId = await verifyAccessToken(context.request);
      } catch (err) {
        return makeResponse(logger, {
          success: false,
          message: "Unauthorized",
          exc: err,
        });
      }

      let s3Key: string;
      try {
        s3Key = await uploadFile(
          context.app.config.aws,
          args.file.content,
          userId,
          args.file.filename,
        );
      } catch (err) {
        return makeResponse(logger, {
          success: false,
          message: "File upload failed",
          exc: err,
        });
      }

      let record;
      try {
        record = await context.app.prisma.media.create({
          data: { userId, contentKey: s3Key },
        });
      } catch (err) {
        return makeResponse(logger, {
          success: false,
          message: "Failed to save file record",
          exc: err,
        });
      }

      try {
        const url = await getPresignedUrl(context.app.config.aws, s3Key);
        return makeResponse(logger, {
          data: {
            mediaId: record.id,
            url,
            expiresIn: context.app.config.aws.presignedUrlExpiry,
          },
        });
      } catch (err) {
        return makeResponse(logger, {
          success: false,
          message: "Failed to generate URL",
          exc: err,
        });
      }
    },
  },
};
