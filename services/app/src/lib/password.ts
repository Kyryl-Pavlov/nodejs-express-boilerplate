import bcrypt from "bcrypt";

// rounds=13 makes hashing ~600ms (default 12 is ~300ms); tests override via BCRYPT_ROUNDS
// to keep the suite fast.
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS ?? 13);

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function checkPassword(
  password: string,
  passwordHash: string,
): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}
