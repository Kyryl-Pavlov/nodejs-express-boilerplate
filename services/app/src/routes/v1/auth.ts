import { Router } from "express";

import { restApiResponse } from "../../api/utils/response.js";
import {
  requireRefreshToken,
  signAccessToken,
  signRefreshToken,
} from "../../lib/auth.js";
import { checkPassword, hashPassword } from "../../lib/password.js";

interface AuthBody {
  email?: string;
  password?: string;
}

export function authRoutes(): Router {
  const router = Router();

  router.post("/register", async (req, res) => {
    const body = req.body as AuthBody;
    const email = (body?.email ?? "").trim().toLowerCase();
    const password = body?.password ?? "";

    if (!email || !password) {
      return restApiResponse(res, {
        success: false,
        message: "Email and password are required",
        statusCode: 400,
      });
    }

    const existing = await req.app.prisma.user.findUnique({ where: { email } });
    if (existing) {
      return restApiResponse(res, {
        success: false,
        message: "Email already registered",
        statusCode: 409,
      });
    }

    try {
      const passwordHash = await hashPassword(password);
      await req.app.prisma.user.create({ data: { email, passwordHash } });
    } catch (err) {
      return restApiResponse(res, {
        success: false,
        message: "Registration failed",
        statusCode: 500,
        exc: err,
      });
    }

    return restApiResponse(res, { statusCode: 201 });
  });

  router.post("/login", async (req, res) => {
    const body = req.body as AuthBody;
    const email = (body?.email ?? "").trim().toLowerCase();
    const password = body?.password ?? "";

    if (!email || !password) {
      return restApiResponse(res, {
        success: false,
        message: "Email and password are required",
        statusCode: 400,
      });
    }

    try {
      const user = await req.app.prisma.user.findUnique({ where: { email } });
      if (!user || !(await checkPassword(password, user.passwordHash))) {
        return restApiResponse(res, {
          success: false,
          message: "Invalid credentials",
          statusCode: 401,
        });
      }

      return restApiResponse(res, {
        data: {
          access_token: signAccessToken(req.app, user.id),
          refresh_token: signRefreshToken(req.app, user.id),
        },
      });
    } catch (err) {
      return restApiResponse(res, {
        success: false,
        message: "Login failed",
        statusCode: 500,
        exc: err,
      });
    }
  });

  router.post("/refresh", requireRefreshToken, async (req, res) => {
    if (!req.userId) return; // requireRefreshToken already sent a 401

    try {
      return restApiResponse(res, {
        data: { access_token: signAccessToken(req.app, req.userId) },
      });
    } catch (err) {
      return restApiResponse(res, {
        success: false,
        message: "Token refresh failed",
        statusCode: 500,
        exc: err,
      });
    }
  });

  return router;
}
