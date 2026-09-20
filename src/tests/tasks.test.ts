import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createTestProject } from './helpers/projects-fixtures.js';
import { createTestTask } from './helpers/tasks-fixtures.js';

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

describe('POST /projects/:id/tasks', () => {
  it('201s and returns the created task', async () => {
    const { accessToken, project } = await createTestProject(app);

    const payload = {
      title: 'Write auth middleware',
      description: 'JWT verification preHandler for protected routes',
      status: 'in_progress',
      priority: 'high',
      dueDate: '2026-09-15',
      position: 1,
    };

    const response = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/tasks`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload,
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({
      title: payload.title,
      description: payload.description,
      status: payload.status,
      priority: payload.priority,
      dueDate: payload.dueDate,
      position: payload.position,
    });
    expect(body.id).toEqual(expect.any(Number));
    expect(body.projectId).toEqual(project.id);
    // createdAt and updatedAt should be equal at task creation
    expect(body.createdAt).toBe(body.updatedAt);
    // The 5-second window is deliberately generous — this isn't testing precise
    // timing, just that the value is in the right ballpark (not epoch 0, not a
    // stale fixture value, not garbage). It also quietly covers "is this a valid,
    // parseable date" for free: if createdAt were malformed,
    // new Date(...).getTime() returns NaN, and NaN is never less than anything, so
    // the assertion fails rather than silently passing — no separate "is valid ISO
    // date" check needed on top.
    expect(Date.now() - new Date(body.createdAt).getTime()).toBeLessThan(5000);
  });

  it('201s and returns the task with default properties', async () => {
    const { accessToken, project } = await createTestProject(app);

    const payload = { title: 'Minimal Task' };

    const response = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/tasks`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload,
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({
      title: payload.title,
      description: null,
      status: 'todo',
      priority: 'medium',
      dueDate: null,
      position: 0,
    });
  });

  it('201s at exactly the 100-character title limit', async () => {
    const { accessToken, project } = await createTestProject(app);

    const payload = {
      title:
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    };

    const response = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/tasks`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload,
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().title).toBe(payload.title);
  });

  // Distinct from the empty-title test below: '' fails createTaskBodySchema's
  // minLength, an omitted key fails its separate `required` check. Testing
  // only one of the two couldn't catch the other silently disappearing from
  // the schema.
  it('400s on an omitted title', async () => {
    const { accessToken, project } = await createTestProject(app);

    const response = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/tasks`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { description: 'This task has no title.' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('400s on an empty title', async () => {
    const { accessToken, project } = await createTestProject(app);

    const response = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/tasks`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { title: '' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('400s one character past the title limit', async () => {
    const { accessToken, project } = await createTestProject(app);

    const response = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/tasks`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        title:
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('400s on an invalid title', async () => {
    const { accessToken, project } = await createTestProject(app);

    const response = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/tasks`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { title: 12345 },
    });

    expect(response.statusCode).toBe(400);
  });

  it('400s on an invalid status enum value', async () => {
    const { accessToken, project } = await createTestProject(app);

    const response = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/tasks`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { status: 'archived' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('400s on an invalid priority enum value', async () => {
    const { accessToken, project } = await createTestProject(app);

    const response = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/tasks`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { priority: 'urgent' },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('GET /projects/:id/tasks', () => {
  it("200s and returns a list of the queried project's tasks", async () => {
    const { accessToken, project, task } = await createTestTask(app);

    const response = await app.inject({
      method: 'GET',
      url: `/projects/${project.id}/tasks`,
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    // toHaveLength(1), not just "contains my task": tables only reset
    // once per file (src/tests/setup.ts), so by this point the POST tests
    // above have already created several other projects' tasks. A loose
    // "is mine in there somewhere" check would still pass even if the
    // route's projectId filter were silently dropped entirely - asserting
    // the exact count is what actually proves the list is scoped, not just
    // non-empty.
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      id: task.id,
      projectId: task.projectId,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      dueDate: task.dueDate,
      position: task.position,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    });
  });
});

describe('GET /tasks/:id', () => {
  it('200s and returns the task', async () => {
    const { accessToken, task } = await createTestTask(app);

    const response = await app.inject({
      method: 'GET',
      url: `/tasks/${task.id}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: task.id,
      projectId: task.projectId,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      dueDate: task.dueDate,
      position: task.position,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    });
  });
});

describe('PATCH /tasks/:id', () => {
  // Updates two fields at once rather than one test per field: the route's
  // partial-update logic is a single shared `.set({ title, description,
  // status, priority, dueDate, position })` call with no per-field branching,
  // so a title-only or dueDate-only variant would exercise identical code.
  // This also proves the undefined-skip mechanism more strongly than a
  // single-field test would, by asserting every untouched field survived
  // rather than just one.
  it('200s and returns the task with only the updated fields changed', async () => {
    const { accessToken, task } = await createTestTask(app);

    const payload = { status: 'done', priority: 'low' };

    const response = await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: payload.status,
      priority: payload.priority,
      title: task.title,
      description: task.description,
      dueDate: task.dueDate,
      position: task.position,
    });
  });

  // These five mirror POST's own title/status/priority validation tests
  // almost exactly, and that's deliberate, not copy-paste: updateTaskBodySchema
  // is a second schema object in tasks.ts, hand-maintained separately from
  // createTaskBodySchema. Testing only POST's validation would never catch
  // the two schemas silently drifting apart from each other.
  it('400s on an empty title', async () => {
    const { accessToken, task } = await createTestTask(app);

    const response = await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { title: '' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('400s one character past the title limit', async () => {
    const { accessToken, task } = await createTestTask(app);

    const response = await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        title:
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('400s on an invalid title', async () => {
    const { accessToken, task } = await createTestTask(app);

    const response = await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { title: 12345 },
    });

    expect(response.statusCode).toBe(400);
  });

  it('400s on an invalid status enum value', async () => {
    const { accessToken, task } = await createTestTask(app);

    const response = await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { status: 'archived' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('400s on an invalid priority enum value', async () => {
    const { accessToken, task } = await createTestTask(app);

    const response = await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { priority: 'urgent' },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('DELETE /tasks/:id', () => {
  it('204s and deletes the task', async () => {
    const { accessToken, task } = await createTestTask(app);

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/tasks/${task.id}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(deleteResponse.statusCode).toBe(204);

    // 403, not 404, on the follow-up GET: matches this project's "403,
    // never 404" rule everywhere else - findOwnedTask can't distinguish a
    // deleted task from one that never existed, by design.
    const getResponse = await app.inject({
      method: 'GET',
      url: `/tasks/${task.id}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(getResponse.statusCode).toBe(403);
  });
});
