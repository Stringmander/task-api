import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loginTestUser } from './helpers/auth-fixtures.js';

let app: FastifyInstance;

// app.inject() (Fastify's own testing API, per CLAUDE.md's stack) dispatches
// a request straight into the route pipeline in-process - real JSON Schema
// validation, real handlers, real Postgres queries - without binding a port
// or making an actual network round trip. That's what makes this an
// integration test rather than a unit test: everything except the TCP
// socket itself is real, matching BUILD_PLAN.md's "integration credibility
// over mocked units."
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

describe('GET /users/me', () => {
  it('200s and returns the current user', async () => {
    const { email, accessToken } = await loginTestUser(app);

    const response = await app.inject({
      method: 'GET',
      url: '/users/me',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    // email only, not the full object: this test's job is "the happy path
    // basically works." Proving the response is specifically THIS caller's
    // row, not someone else's, is authorization.test.ts's more rigorous
    // multi-user check - duplicating that here wouldn't add coverage.
    expect(response.json().email).toBe(email);
  });
});
