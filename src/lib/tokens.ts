import { SignJWT } from 'jose';
import { env } from '../env.js';
import { createHash, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';

// valid cost-12 hash, never a real user's
const DUMMY_HASH = '$2b$12$hsdyJuIc70W5874D1mVK5uKlxhan8hy.u5CXT5aDVg2/BMmvlcaqa';

export async function signAccessToken(userId: number): Promise<string> {
  return await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(env.jwtSecretKey);
}

// Returns expiresAt alongside the token — unlike signAccessToken, which only
// returns a string — because the caller needs that exact expiry for the
// refreshTokens row, not for the response (only `token` ever reaches the
// client). Computing it once here and reusing it for both the signature's
// exp claim and the DB column is what keeps the two from drifting apart.
export async function signRefreshToken(
  userId: number,
): Promise<{ token: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(userId))
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(env.jwtSecretKey);

  return { token, expiresAt };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Falls back to DUMMY_HASH instead of accepting `hash: undefined` as an
// automatic failure, so this always performs a real bcrypt.compare — see the
// call site in auth.ts's login route for why that matters (a skipped
// comparison is what turns response time into a way to enumerate accounts).
export async function verifyPassword(password: string, hash: string | undefined): Promise<boolean> {
  return bcrypt.compare(password, hash ?? DUMMY_HASH);
}
