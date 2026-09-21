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
    expect(update.json().status).toBe('done');

    const del = await app.inject({ method: 'DELETE', url: `/tasks/${taskId}`, headers });
    expect(del.statusCode).toBe(204);

    const gone = await app.inject({ method: 'GET', url: `/tasks/${taskId}`, headers });
    expect(gone.statusCode).toBe(403);
  });
});
