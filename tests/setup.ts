// config.ts throws at import time if SECRET_KEY is unset, so it must be in the
// environment before any @app/* module is imported anywhere in the test run.
process.env.SECRET_KEY ??= "test-secret-key-not-for-production";
process.env.JWT_SECRET_KEY ??= "test-jwt-secret-key-not-for-production";

// rounds=4 instead of 13 keeps hashing fast across the suite.
// Must be set before lib/password.ts is first imported.
process.env.BCRYPT_ROUNDS ??= "4";
