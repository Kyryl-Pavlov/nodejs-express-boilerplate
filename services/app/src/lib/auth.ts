import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

export interface JwtPayload {
  sub: string;
  type: "access" | "refresh";
}

export class UnauthorizedError extends Error {}

function tokenOptions(app: Express.Application, expiresIn: string): jwt.SignOptions {
  return {
    algorithm: app.config.jwtAlgorithm,
    expiresIn: expiresIn as jwt.SignOptions["expiresIn"],
  };
}

export function signAccessToken(app: Express.Application, userId: string): string {
  return jwt.sign(
    { sub: userId, type: "access" } satisfies JwtPayload,
    app.config.jwtSecretKey,
    tokenOptions(app, app.config.jwtAccessTokenExpiresIn),
  );
}

export function signRefreshToken(app: Express.Application, userId: string): string {
  return jwt.sign(
    { sub: userId, type: "refresh" } satisfies JwtPayload,
    app.config.jwtSecretKey,
    tokenOptions(app, app.config.jwtRefreshTokenExpiresIn),
  );
}

function extractBearerToken(req: Request): string {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new UnauthorizedError("Missing Authorization header");
  }
  return header.slice("Bearer ".length);
}

/** Verifies an access token and returns the user id. Throws UnauthorizedError otherwise. */
export async function verifyAccessToken(req: Request): Promise<string> {
  const payload = await verifyToken(req);
  if (payload.type !== "access") throw new UnauthorizedError("Invalid token type");
  return payload.sub;
}

/** Verifies a refresh token and returns the user id. Throws UnauthorizedError otherwise. */
export async function verifyRefreshToken(req: Request): Promise<string> {
  const payload = await verifyToken(req);
  if (payload.type !== "refresh") throw new UnauthorizedError("Invalid token type");
  return payload.sub;
}

async function verifyToken(req: Request): Promise<JwtPayload> {
  const { jwtSecretKey, jwtAlgorithm } = req.app.config;
  const token = extractBearerToken(req);
  try {
    return jwt.verify(token, jwtSecretKey, {
      algorithms: [jwtAlgorithm],
    }) as JwtPayload;
  } catch (err) {
    throw new UnauthorizedError(err instanceof Error ? err.message : "Invalid token");
  }
}

/** REST auth middleware — replies 401 directly, not via restApiResponse. */
export async function requireAccessToken(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    req.userId = await verifyAccessToken(req);
    next();
  } catch {
    res.status(401).json({ msg: "Missing or invalid access token" });
  }
}

/** REST auth middleware — same as requireAccessToken but for refresh tokens. */
export async function requireRefreshToken(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    req.userId = await verifyRefreshToken(req);
    next();
  } catch {
    res.status(401).json({ msg: "Missing or invalid refresh token" });
  }
}
