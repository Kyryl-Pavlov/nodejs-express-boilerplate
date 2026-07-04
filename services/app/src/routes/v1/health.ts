import { Router } from "express";

// Deliberately bypasses restApiResponse()'s {success,message,data} envelope —
// an existing inconsistency, preserved on purpose.
export function healthRoutes(): Router {
  const router = Router();

  router.get("/health", (req, res) => {
    res.json({ status: "ok", version: req.app.config.restApiVersionNumber });
  });

  return router;
}
