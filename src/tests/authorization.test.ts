import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { SignJWT } from 'jose';
import { env } from '../env.js';
import { createTestProject } from './helpers/projects-fixtures.js';
import { loginTestUser } from './helpers/auth-fixtures.js';
import { createTestTask } from './helpers/tasks-fixtures.js';

async function signExpiredAccessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('1')
    .setIssuedAt(now - 120)
    .setExpirationTime(now - 60)
    .sign(env.jwtSecretKey);
}

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

describe('GET /projects', () => {
  it('401s without authorization header', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/projects',
    });

    expect(response.statusCode).toBe(401);
  });

  it('401s on a garbage token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/projects',
      headers: { authorization: 'Bearer garbage.not.valid' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('401s on an expired token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/projects',
      headers: { authorization: `Bearer ${await signExpiredAccessToken()}` },
    });

    expect(response.statusCode).toBe(401);
  });

  it("200s and excludes other users' projects from the list", async () => {
    const { accessToken, project: myProject } = await createTestProject(app);
    await createTestProject(app);

    const response = await app.inject({
      method: 'GET',
      url: '/projects',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    // Both assertions together, not just one: toHaveLength(1) alone
    // couldn't tell my project apart from the other user's if the route
    // ever returned the wrong one, and matching myProject.id alone
    // couldn't catch a route that returned both. Only combined do they
    // prove the other user's project - created explicitly above - is
    // excluded, not just that a project came back.
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe(myProject.id);
  });
});

describe('GET /projects/:id', () => {
  it("403s when a different user requests someone else's project", async () => {
    const { project } = await createTestProject(app);
    const { accessToken } = await loginTestUser(app);

    const response = await app.inject({
      method: 'GET',
      url: `/projects/${project.id}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(403);
  });
});

describe('PATCH /projects/:id', () => {
  it("403s when a different user tries to update someone else's project", async () => {
    const { project } = await createTestProject(app);
    const { accessToken } = await loginTestUser(app);

    const response = await app.inject({
      method: 'PATCH',
      url: `/projects/${project.id}`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { name: 'Unauthorized Project Update' },
    });

    expect(response.statusCode).toBe(403);
  });
});

describe('DELETE /projects/:id', () => {
  it("403s when a different user tries to delete someone else's project", async () => {
    const { project } = await createTestProject(app);
    const { accessToken } = await loginTestUser(app);

    const response = await app.inject({
      method: 'DELETE',
      url: `/projects/${project.id}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(403);
  });
});

describe('GET /tasks/:id', () => {
  it("403s when a different user requests someone else's task", async () => {
    const { task } = await createTestTask(app);
    const { accessToken } = await loginTestUser(app);

    const response = await app.inject({
      method: 'GET',
      url: `/tasks/${task.id}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(403);
  });
});

describe('PATCH /tasks/:id', () => {
  it("403s when a different user tries to update someone else's task", async () => {
    const { task } = await createTestTask(app);
    const { accessToken } = await loginTestUser(app);

    const response = await app.inject({
      method: 'PATCH',
      url: `/tasks/${task.id}`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { title: 'Unauthorized Task Update' },
    });

    expect(response.statusCode).toBe(403);
  });
});

describe('DELETE /tasks/:id', () => {
  it("403s when a different user tries to delete someone else's task", async () => {
    const { task } = await createTestTask(app);
    const { accessToken } = await loginTestUser(app);

    const response = await app.inject({
      method: 'DELETE',
      url: `/tasks/${task.id}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(403);
  });
});

describe('GET /projects/:id/tasks', () => {
  it("403s when a different user requests someone else's project tasks", async () => {
    const { project } = await createTestProject(app);
    const { accessToken } = await loginTestUser(app);

    const response = await app.inject({
      method: 'GET',
      url: `/projects/${project.id}/tasks`,
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(403);
  });
});
