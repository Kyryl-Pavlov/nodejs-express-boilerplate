// SDL-first schema, built into an executable schema via makeExecutableSchema() in
// app.ts. GraphQL SDL has no generics, so each response shape gets its own named type:
// StringResponse, AuthResponse, EventListResponse, BooleanResponse, MediaResponse,
// HealthResponse, CacheTestResponse.
export const typeDefs = `
  scalar JSON
  scalar Upload

  type HealthStatus {
    version: String!
  }

  type AuthPayload {
    accessToken: String!
    refreshToken: String
  }

  type MediaPayload {
    mediaId: String!
    url: String!
    expiresIn: Int!
  }

  type CacheTestPayload {
    source: String!
    computedAt: Float!
    payload: String!
    ttl: Int
    remainingTtl: Int
  }

  type EventPayload {
    id: String!
    sqsMessageId: String!
    type: String!
    payload: JSON
    status: String!
    createdAt: String!
    processedAt: String
  }

  type StringResponse {
    success: Boolean!
    message: String!
    data: String
  }

  type BooleanResponse {
    success: Boolean!
    message: String!
    data: Boolean
  }

  type HealthResponse {
    success: Boolean!
    message: String!
    data: HealthStatus
  }

  type AuthResponse {
    success: Boolean!
    message: String!
    data: AuthPayload
  }

  type MediaResponse {
    success: Boolean!
    message: String!
    data: MediaPayload
  }

  type CacheTestResponse {
    success: Boolean!
    message: String!
    data: CacheTestPayload
  }

  type EventListResponse {
    success: Boolean!
    message: String!
    data: [EventPayload!]
  }

  type Query {
    health: HealthResponse!
    cachePing: StringResponse!
    cacheTest: CacheTestResponse!
    events: EventListResponse!
    signedUrl(mediaId: String!): StringResponse!
  }

  type Mutation {
    register(email: String!, password: String!): StringResponse!
    login(email: String!, password: String!): AuthResponse!
    refreshToken: AuthResponse!
    clearCache: BooleanResponse!
    publishEvent(type: String!, payload: JSON): StringResponse!
    uploadFile(file: Upload!): MediaResponse!
  }
`;
