import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { randomUUID } from 'node:crypto';

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

describe('user lifecycle', () => {
  // One test, not one per step, and no shared fixtures: every step depends
  // on the previous response (the login token, the new project's id, the
  // new task's id), and proving that chain works end to end is the whole
  // point - a fixture would hide those hand-offs inside a helper. Splitting
  // it up would also need mutable state shared between tests. Assertions
  // stay thin on purpose: field-level correctness is already covered in
  // projects.test.ts and tasks.test.ts, so each step only checks its status
  // code, which makes a failure point at the exact step that broke.
  it('registers, logs in, creates a project and task, updates it, and deletes it', async () => {
    const email = `journey-${randomUUID()}@example.com`;
    const password = 'correcthorse';

    const register = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password, displayName: 'Journey' },
    });
    expect(register.statusCode).toBe(201);

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });
    expect(login.statusCode).toBe(200);
    const headers = { authorization: `Bearer ${login.json().accessToken}` };

    const project = await app.inject({
      method: 'POST',
      url: '/projects',
      headers,
      payload: { name: 'Journey Project' },
    });
    expect(project.statusCode).toBe(201);
    const projectId = project.json().id;

    const task = await app.inject({
      method: 'POST',
      url: `/projects/${projectId}/tasks`,
      headers,
      payload: { title: 'Journey Task' },
    });
    expect(task.statusCode).toBe(201);
    const taskId = task.json().id;

    const update = await app.inject({
      method: 'PATCH',
      url: `/tasks/${taskId}`,
      headers,
      payload: { status: 'done' },
    });
    expect(update.statusCode).toBe(200);
    // The one content check in the journey: proves the update actually
    // persisted, not just that the endpoint answered 200.
    expect(update.json().status).toBe('done');

    const del = await app.inject({ method: 'DELETE', url: `/tasks/${taskId}`, headers });
    expect(del.statusCode).toBe(204);

    // 403, not 404: findOwnedTask can't tell a deleted task from one that
    // never existed, by design.
    const gone = await app.inject({ method: 'GET', url: `/tasks/${taskId}`, headers });
    expect(gone.statusCode).toBe(403);
  });
});
