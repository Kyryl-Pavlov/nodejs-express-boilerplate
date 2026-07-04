import type { AppGraphQLContext } from "../context.js";
import { makeResponse } from "../response.js";

export const healthResolvers = {
  Query: {
    health: (_root: unknown, _args: unknown, context: AppGraphQLContext) => {
      return makeResponse(context.app.loggerAdapter, {
        message: "The server is up and running",
        data: { version: context.app.config.graphqlApiVersionNumber },
      });
    },
  },
};
