import { AppLogger, LogLevel } from "../logging/logger.js";

export interface GraphQLResponse<T> {
  success: boolean;
  message: string;
  data: T | null;
}

export interface MakeResponseOptions<T> {
  success?: boolean;
  message?: string;
  data?: T | null;
  exc?: unknown;
}

/**
 * Every response auto-logs on construction. Unlike restApiResponse() (REST), this
 * never passes `data` to the logger, and picks ERROR based on `exc` being set rather
 * than an HTTP status code — both are intentional divergences from the REST envelope.
 */
export function makeResponse<T>(
  logger: AppLogger,
  options: MakeResponseOptions<T> = {},
): GraphQLResponse<T> {
  const { success = true, message = "", data = null, exc = null } = options;

  const hasExc = exc !== null && exc !== undefined;
  const level = success ? LogLevel.INFO : hasExc ? LogLevel.ERROR : LogLevel.WARN;
  logger.log(message, { level, exc });

  return { success, message, data: data ?? null };
}
