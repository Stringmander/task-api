import { SignJWT } from 'jose';
import { env } from '../env.js';
import { createHash } from 'node:crypto';
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

export async function signRefreshToken(
  userId: number,
): Promise<{ token: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(env.jwtSecretKey);

  return { token, expiresAt };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function verifyPassword(password: string, hash: string | undefined): Promise<boolean> {
  return bcrypt.compare(password, hash ?? DUMMY_HASH);
}
