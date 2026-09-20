import type { FastifyInstance } from 'fastify';
import type { LoginBody, RegisterBody } from '../../routes/auth.js';
import { randomUUID } from 'node:crypto';
import { expectSuccess } from './http-assertions.js';

// Both functions take `app` as a parameter rather than importing or closing
// over one: unlike resetDb (one shared implementation, reused as-is
// everywhere), every test file builds its own FastifyInstance via
// buildApp() in its own beforeAll, so this file has no single instance to
// assume.

// Returns the credentials used so a test can log in with them afterward
// without repeating the payload.
export async function registerTestUser(
  app: FastifyInstance,
  overrides: Partial<RegisterBody> = {},
) {
  // A fresh random email per call, not a fixed one, is what keeps tests
  // independent of each other now that tables reset once per file
  // (src/tests/setup.ts), not before every test — two tests both registering
  // "alice@example.com" would collide (the second gets an unintended 409)
  // purely because of file-level test order, not anything either test is
  // actually checking.
  const payload = {
    email: `alice-${randomUUID()}@example.com`,
    password: 'correcthorse',
    displayName: 'Alice',
    ...overrides,
  };
  const response = await app.inject({ method: 'POST', url: '/auth/register', payload });
  expectSuccess(response, 201);

  const { id } = response.json() as { id: number };

  return { ...payload, id };
}

export async function loginTestUser(app: FastifyInstance, overrides: Partial<LoginBody> = {}) {
  const { email, password, id } = await registerTestUser(app, overrides);

  const response = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password },
  });

  expectSuccess(response, 200);

  const body = response.json() as { accessToken: string; refreshToken: string };

  return { userId: id, ...body };
}
