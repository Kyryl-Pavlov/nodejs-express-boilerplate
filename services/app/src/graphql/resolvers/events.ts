import { verifyAccessToken } from "../../lib/auth.js";
import { sendEvent } from "../../services/awsSqsService.js";
import type { AppGraphQLContext } from "../context.js";
import { makeResponse } from "../response.js";
import { eventToPayload } from "../utils.js";

export const eventsResolvers = {
  Query: {
    events: async (_root: unknown, _args: unknown, context: AppGraphQLContext) => {
      const logger = context.app.loggerAdapter;
      try {
        await verifyAccessToken(context.request);
      } catch (err) {
        return makeResponse(logger, {
          success: false,
          message: "Unauthorized",
          exc: err,
        });
      }

      try {
        const rows = await context.app.prisma.event.findMany({
          orderBy: { createdAt: "desc" },
          take: 100,
        });
        return makeResponse(logger, { data: rows.map(eventToPayload) });
      } catch (err) {
        return makeResponse(logger, {
          success: false,
          message: "Failed to fetch events",
          exc: err,
        });
      }
    },
  },

  Mutation: {
    publishEvent: async (
      _root: unknown,
      args: { type: string; payload?: unknown },
      context: AppGraphQLContext,
    ) => {
      const logger = context.app.loggerAdapter;
      try {
        await verifyAccessToken(context.request);
      } catch (err) {
        return makeResponse(logger, {
          success: false,
          message: "Unauthorized",
          exc: err,
        });
      }

      if (!args.type.trim()) {
        return makeResponse(logger, {
          success: false,
          message: "Event type is required",
        });
      }

      try {
        const messageId = await sendEvent(
          context.app.config.aws,
          args.type,
          args.payload ?? {},
        );
        return makeResponse(logger, { data: messageId });
      } catch (err) {
        return makeResponse(logger, {
          success: false,
          message: "Failed to publish event",
          exc: err,
        });
      }
    },
  },
};
