import { Router } from "express";

import { restApiResponse } from "../../api/utils/response.js";
import { requireAccessToken } from "../../lib/auth.js";
import { sendEvent } from "../../services/awsSqsService.js";

interface PublishEventBody {
  type?: string;
  payload?: unknown;
}

export function eventsRoutes(): Router {
  const router = Router();

  router.post("/", requireAccessToken, async (req, res) => {
    if (!req.userId) return;

    const body = req.body as PublishEventBody;
    const eventType = (body?.type ?? "").trim();
    const payload = body?.payload ?? {};

    if (!eventType) {
      return restApiResponse(res, {
        success: false,
        message: "Event type is required",
        statusCode: 400,
      });
    }

    let messageId: string;
    try {
      messageId = await sendEvent(req.app.config.aws, eventType, payload);
    } catch (err) {
      return restApiResponse(res, {
        success: false,
        message: "Failed to publish event",
        statusCode: 500,
        exc: err,
      });
    }

    return restApiResponse(res, {
      data: { message_id: messageId },
      statusCode: 202,
    });
  });

  router.get("/", requireAccessToken, async (req, res) => {
    let rows;
    try {
      rows = await req.app.prisma.event.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
      });
    } catch (err) {
      return restApiResponse(res, {
        success: false,
        message: "Failed to fetch events",
        statusCode: 500,
        exc: err,
      });
    }

    return restApiResponse(res, {
      data: rows.map((r) => ({
        id: r.id,
        sqs_message_id: r.sqsMessageId,
        type: r.type,
        payload: r.payload,
        status: r.status,
        created_at: r.createdAt.toISOString(),
        processed_at: r.processedAt ? r.processedAt.toISOString() : null,
      })),
    });
  });

  return router;
}
