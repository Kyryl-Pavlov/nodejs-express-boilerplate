import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../../lib/auth.js";
import { checkPassword, hashPassword } from "../../lib/password.js";
import type { AppGraphQLContext } from "../context.js";
import { makeResponse } from "../response.js";

export const authResolvers = {
  Mutation: {
    register: async (
      _root: unknown,
      args: { email: string; password: string },
      context: AppGraphQLContext,
    ) => {
      const logger = context.app.loggerAdapter;
      const email = args.email.trim().toLowerCase();
      const { password } = args;

      if (!email || !password) {
        return makeResponse(logger, {
          success: false,
          message: "Email and password are required",
        });
      }

      const existing = await context.app.prisma.user.findUnique({ where: { email } });
      if (existing) {
        return makeResponse(logger, {
          success: false,
          message: "Email already registered",
        });
      }

      try {
        const passwordHash = await hashPassword(password);
        await context.app.prisma.user.create({ data: { email, passwordHash } });
      } catch (err) {
        return makeResponse(logger, {
          success: false,
          message: "Registration failed",
          exc: err,
        });
      }

      return makeResponse(logger, {});
    },

    // Unlike REST's login, there is deliberately no empty-field pre-check here — the
    // source's GraphQL login goes straight to the DB lookup. Preserved on purpose.
    login: async (
      _root: unknown,
      args: { email: string; password: string },
      context: AppGraphQLContext,
    ) => {
      const logger = context.app.loggerAdapter;
      try {
        const user = await context.app.prisma.user.findUnique({
          where: { email: args.email.trim().toLowerCase() },
        });
        if (!user || !(await checkPassword(args.password, user.passwordHash))) {
          return makeResponse(logger, {
            success: false,
            message: "Invalid credentials",
          });
        }
        return makeResponse(logger, {
          data: {
            accessToken: signAccessToken(context.app, user.id),
            refreshToken: signRefreshToken(context.app, user.id),
          },
        });
      } catch (err) {
        return makeResponse(logger, {
          success: false,
          message: "Login failed",
          exc: err,
        });
      }
    },

    refreshToken: async (
      _root: unknown,
      _args: unknown,
      context: AppGraphQLContext,
    ) => {
      const logger = context.app.loggerAdapter;
      let userId: string;
      try {
        userId = await verifyRefreshToken(context.request);
      } catch (err) {
        return makeResponse(logger, {
          success: false,
          message: "Invalid or expired refresh token",
          exc: err,
        });
      }
      try {
        return makeResponse(logger, {
          data: { accessToken: signAccessToken(context.app, userId) },
        });
      } catch (err) {
        return makeResponse(logger, {
          success: false,
          message: "Token refresh failed",
          exc: err,
        });
      }
    },
  },
};
