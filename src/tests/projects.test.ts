import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loginTestUser } from './helpers/auth-fixtures.js';
import { createTestProject } from './helpers/projects-fixtures.js';

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

describe('POST /projects', () => {
  it('201s and returns the created project', async () => {
    const { userId, accessToken } = await loginTestUser(app);

    const payload = {
      name: 'Portfolio Project',
      description: 'Node.js task API for the career pivot',
    };

    const response = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: { authorization: `Bearer ${accessToken}` },
      payload,
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({ name: payload.name, description: payload.description });
    expect(body.id).toEqual(expect.any(Number));
    expect(body.userId).toEqual(userId);
    // createdAt and updatedAt should be equal at project creation
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

  it('201s and returns the created project with no description', async () => {
    const { accessToken } = await loginTestUser(app);

    const response = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { name: 'Minimal Project' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.name).toBe('Minimal Project');
    expect(body.description).toBe(null);
  });

  it('201s at exactly the 100-character name limit', async () => {
    const { accessToken } = await loginTestUser(app);

    const payload = {
      name: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    };

    const response = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: { authorization: `Bearer ${accessToken}` },
      payload,
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.name).toBe(payload.name);
  });

  it('400s on an empty name', async () => {
    const { accessToken } = await loginTestUser(app);

    const response = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { name: '' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('400s one character past the name limit', async () => {
    const { accessToken } = await loginTestUser(app);

    const response = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        name: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('400s on an invalid name', async () => {
    const { accessToken } = await loginTestUser(app);

    const response = await app.inject({
      method: 'POST',
      url: '/projects',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { name: 12345 },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('GET /projects', () => {
  it("200s and returns a list of the current user's projects", async () => {
    const { accessToken, project } = await createTestProject(app);

    const response = await app.inject({
      method: 'GET',
      url: '/projects',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      id: project.id,
      name: project.name,
      description: project.description,
    });
  });
});

describe('GET /projects/:id', () => {
  it('200s and returns the project', async () => {
    const { accessToken, project } = await createTestProject(app);

    const response = await app.inject({
      method: 'GET',
      url: `/projects/${project.id}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: project.id,
      name: project.name,
      description: project.description,
    });
  });
});

describe('PATCH /projects/:id', () => {
  it('200s and returns the project with updated name', async () => {
    const { accessToken, project } = await createTestProject(app);

    const payload = { name: 'Renamed Project' };

    const response = await app.inject({
      method: 'PATCH',
      url: `/projects/${project.id}`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.name).toBe(payload.name);
    expect(body.description).toBe(project.description);
  });

  it('200s and returns the project with updated description', async () => {
    const { accessToken, project } = await createTestProject(app);

    const payload = { description: 'Updated description only; name should survive untouched' };

    const response = await app.inject({
      method: 'PATCH',
      url: `/projects/${project.id}`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.name).toBe(project.name);
    expect(body.description).toBe(payload.description);
  });

  it('400s on an empty name', async () => {
    const { accessToken, project } = await createTestProject(app);

    const response = await app.inject({
      method: 'PATCH',
      url: `/projects/${project.id}`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { name: '' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('400s one character past the name limit', async () => {
    const { accessToken, project } = await createTestProject(app);

    const response = await app.inject({
      method: 'PATCH',
      url: `/projects/${project.id}`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        name: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('400s on an invalid name', async () => {
    const { accessToken, project } = await createTestProject(app);

    const response = await app.inject({
      method: 'PATCH',
      url: `/projects/${project.id}`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { name: 12345 },
    });

    expect(response.statusCode).toBe(400);
  });
});

describe('DELETE /projects/:id', () => {
  it("204s and cascades to delete the project's tasks", async () => {
    const { accessToken, project } = await createTestProject(app);

    const taskResponse = await app.inject({
      method: 'POST',
      url: `/projects/${project.id}/tasks`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { title: 'Some Task' },
    });
    const taskId = taskResponse.json().id;

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/projects/${project.id}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(deleteResponse.statusCode).toBe(204);

    const getTaskResponse = await app.inject({
      method: 'GET',
      url: `/tasks/${taskId}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(getTaskResponse.statusCode).toBe(403);
  });
});
