import { GraphQLScalarType } from "graphql";

import { GraphQLJSON } from "../jsonScalar.js";

import { authResolvers } from "./auth.js";
import { cacheTestResolvers } from "./cacheTest.js";
import { eventsResolvers } from "./events.js";
import { healthResolvers } from "./health.js";
import { mediaResolvers } from "./media.js";

// The Upload scalar is only ever used as an input type. The value is already
// resolved to a ResolvedUpload ({filename, content}) by the preValidation hook in
// multipartUpload.ts before GraphQL execution starts, so parsing is a no-op.
const UploadScalar = new GraphQLScalarType({
  name: "Upload",
  description: "A file part from a multipart GraphQL request.",
  parseValue: (value) => value,
  serialize: () => {
    throw new Error("Upload scalar is input-only and cannot be serialized");
  },
});

export const resolvers = {
  JSON: GraphQLJSON,
  Upload: UploadScalar,
  Query: {
    ...healthResolvers.Query,
    ...cacheTestResolvers.Query,
    ...eventsResolvers.Query,
    ...mediaResolvers.Query,
  },
  Mutation: {
    ...authResolvers.Mutation,
    ...cacheTestResolvers.Mutation,
    ...eventsResolvers.Mutation,
    ...mediaResolvers.Mutation,
  },
};
