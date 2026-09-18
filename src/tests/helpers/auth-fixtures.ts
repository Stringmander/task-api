import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { LoginBody, RegisterBody } from '../../routes/auth.js';
import { randomUUID } from 'node:crypto';

// Fixtures exist to set up state other tests depend on, not to verify
// register/login's own behavior - that's what auth.test.ts's dedicated
// "201s and returns the created user" / "200s with an access/refresh token
// pair" tests are for, and they call app.inject() directly rather than
// going through these functions, specifically so they stay the single
// source of truth for what those endpoints return. What a fixture does need
// is to fail loudly at the point of setup rather than silently return
// unusable data - a bad override, an unexpected 400, whatever the cause -
// so the real problem surfaces here, not as a confusing failure two steps
// later in whatever test called it.
function expectSuccess(response: LightMyRequestResponse, status: number): void {
  if (response.statusCode !== status) {
    throw new Error(
      `Test fixture expected ${status}, got ${response.statusCode}: ${response.body}`,
    );
  }
}

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
  return payload;
}

export async function loginTestUser(app: FastifyInstance, overrides: Partial<LoginBody> = {}) {
  const { email, password } = await registerTestUser(app, overrides);
  const response = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password },
  });
  expectSuccess(response, 200);
  return response.json() as { accessToken: string; refreshToken: string };
}
