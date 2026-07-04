import type { Request } from "express";

export type AppGraphQLContext = {
  request: Request;
  app: Express.Application;
} & Record<PropertyKey, unknown>;

export function buildContext(request: Request): AppGraphQLContext {
  return { request, app: request.app };
}
