import { Router } from "express";

import { authRoutes } from "./auth.js";
import { cacheTestRoutes } from "./cacheTest.js";
import { eventsRoutes } from "./events.js";
import { healthRoutes } from "./health.js";
import { mediaRoutes } from "./media.js";

export function buildV1Router(): Router {
  const v1 = Router();

  v1.use(healthRoutes());
  v1.use("/auth", authRoutes());
  v1.use("/media", mediaRoutes());
  v1.use(cacheTestRoutes());
  v1.use("/events", eventsRoutes());

  return v1;
}
