import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { decodeJwt, SignJWT } from 'jose';
import { eq } from 'drizzle-orm';
import { buildApp } from '../app.js';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { env } from '../env.js';
import { loginTestUser, registerTestUser } from './helpers/auth-fixtures.js';

// Signs a token exactly like signRefreshToken (src/lib/tokens.ts) would,
// except with exp already in the past - the one thing that can't be tested
// from the http/ collection (see refresh-garbage-token.yml there for the
// client-testable half of this), since forging a *validly signed* expired
// token needs the real JWT_SECRET, which a client-side artifact shouldn't
// hold. A Vitest test runs in the same process as the server, so importing
// env.jwtSecretKey here is legitimate, not a leaked secret. The subject
// doesn't need to belong to a real user - jwtVerify rejects this for being
// expired before the route ever reaches a database lookup.
async function signExpiredRefreshToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('1')
    .setJti(randomUUID())
    .setIssuedAt(now - 120)
    .setExpirationTime(now - 60)
    .sign(env.jwtSecretKey);
}

// app.inject() (Fastify's own testing API, per CLAUDE.md's stack) dispatches
// a request straight into the route pipeline in-process - real JSON Schema
// validation, real handlers, real Postgres queries - without binding a port
// or making an actual network round trip. That's what makes this an
// integration test rather than a unit test: everything except the TCP
// socket itself is real, matching BUILD_PLAN.md's "integration credibility
// over mocked units."
let app: FastifyInstance;

beforeAll(() => {
  app = buildApp();
});

afterAll(async () => {
  await app.close();
  // Deliberately not closing the `pool` from src/db/index.ts here: it's a
  // module-level singleton that later test files (authorization, projects,
  // tasks, integration) will import too, and fileParallelism: false means
  // they all run in this same worker process. Closing it after this file
  // would break every file that runs after it. Vitest tears down the whole
  // worker process once the run finishes, which reclaims the connection -
  // there's no single "last file" hook to hang a pool.end() on instead.
});

describe('POST /auth/register', () => {
  it('201s and returns the created user with no password fields', async () => {
    const payload = {
      email: `alice-${randomUUID()}@example.com`,
      password: 'correcthorse',
      displayName: 'Alice',
    };

    const response = await app.inject({ method: 'POST', url: '/auth/register', payload });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({ email: payload.email, displayName: payload.displayName });
    expect(body.id).toEqual(expect.any(Number));
    expect(body).not.toHaveProperty('password');
    expect(body).not.toHaveProperty('passwordHash');
  });

  it('stores the password hashed, never in plaintext', async () => {
    const { email } = await registerTestUser(app);

    const [row] = await db.select().from(users).where(eq(users.email, email));

    expect(row?.passwordHash).toBeDefined();
    expect(row?.passwordHash).not.toBe('correcthorse');
    // Not just "isn't the plaintext" - proof it's actually a bcrypt hash via
    // bcrypt's own format marker ($2a$/$2b$/$2y$, cost factor, salt+hash).
    expect(row?.passwordHash).toMatch(/^\$2[aby]\$\d{2}\$/);
  });

  it('400s on an invalid email format', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'not-an-email', password: 'correcthorse', displayName: 'Alice' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('409s on a duplicate email', async () => {
    const { email, password, displayName } = await registerTestUser(app);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password, displayName },
    });

    expect(response.statusCode).toBe(409);
  });
});

describe('POST /auth/login', () => {
  it('200s with an access/refresh token pair on correct credentials', async () => {
    const { email, password } = await registerTestUser(app);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(typeof body.accessToken).toBe('string');
    expect(typeof body.refreshToken).toBe('string');
  });

  it('401s identically on an unknown email and a wrong password', async () => {
    const { email } = await registerTestUser(app);

    const unknownEmail = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'nobody@example.com', password: 'whatever1' },
    });
    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: 'wrongpassword' },
    });

    expect(unknownEmail.statusCode).toBe(401);
    expect(wrongPassword.statusCode).toBe(401);
    // Not just "both 401" - the bodies must be indistinguishable, or an
    // attacker could tell which case occurred from the message alone
    // (CLAUDE.md: no user enumeration).
    expect(unknownEmail.json()).toEqual(wrongPassword.json());
  });
});

describe('POST /auth/refresh', () => {
  it('200s and rotates to a new token pair', async () => {
    const { refreshToken } = await loginTestUser(app);

    const response = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(typeof body.accessToken).toBe('string');
    expect(typeof body.refreshToken).toBe('string');
    expect(body.refreshToken).not.toBe(refreshToken);
  });

  it('rejects reuse of an already-consumed token, even presented again within the same second', async () => {
    const { refreshToken } = await loginTestUser(app);

    const first = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(401);

    // This is the jti regression guard - docs/BUILD_PLAN.md's Phase 3 bug
    // note, fixed in dbd59e8. The bug only manifested when two refresh
    // tokens for the same user were issued within the same wall-clock
    // second: iat/exp are second-granularity and HS256 signing is
    // deterministic, so without a jti claim, two same-second tokens for the
    // same user were byte-identical, and rotation silently stopped
    // invalidating anything. app.inject() runs in-process in single-digit
    // milliseconds with no real network round trip, so two sequential calls
    // like this reliably land in the same second - confirmed directly here
    // rather than assumed, by checking the original token and the token
    // that replaced it share the same iat.
    const firstIssuedAt = decodeJwt(refreshToken).iat;
    const replacementIssuedAt = decodeJwt(
      (first.json() as { refreshToken: string }).refreshToken,
    ).iat;
    expect(replacementIssuedAt).toBe(firstIssuedAt);
  });

  it('401s on a garbage token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: 'garbage.not.valid' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('401s on an expired token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: await signExpiredRefreshToken() },
    });

    expect(response.statusCode).toBe(401);
  });
});
