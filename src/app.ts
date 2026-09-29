import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import { env } from './env.js';
import { registerBearerAuth } from './plugins/bearer-auth.js';
import { authRoutes } from './routes/auth.js';
import { projectRoutes } from './routes/projects.js';
import { taskRoutes } from './routes/tasks.js';

export function buildApp(): FastifyInstance {
  const app = Fastify({
    ajv: {
      customOptions: { coerceTypes: false },
    },
    logger: true,
  });

  // Registered before registerBearerAuth, but this ordering isn't what
  // actually matters (verified by hand - swapping it made no difference):
  // @fastify/cors's default hook type is onRequest, and Fastify always runs
  // onRequest before preHandler (where the Bearer check lives) regardless
  // of registration order, since hook *type* determines lifecycle position,
  // not registration sequence. That's what lets a CORS preflight OPTIONS
  // request - sent by the browser with no Authorization header - get
  // answered and short-circuited here, before it would otherwise hit the
  // auth hook and 401. An actual cross-origin request still goes through
  // the full pipeline afterward and is still rejected without a valid
  // token; only the credential-less preflight is exempt, which is correct
  // CORS semantics, not a hole in auth.
  void app.register(cors, { origin: env.corsOrigin });

  // Registered before any route, per @fastify/swagger's own README: it
  // hooks into route registration to collect each one's schema, so
  // anything registered before this plugin is invisible to it.
  void app.register(swagger, {
    openapi: {
      openapi: '3.0.0',
      info: {
        title: 'task-api',
        description:
          'Task management REST API. Users own projects; projects contain tasks; access is scoped to the authenticated user at every layer.',
        version: '0.1.0',
      },
    },
  });

  registerBearerAuth(app);

  // Wrapped in register(), not added directly on `app`: swagger's onRoute
  // hook (above) only attaches once that plugin's own body actually runs,
  // which register() defers - a route added directly here, synchronously,
  // would be added to the router before the hook exists to see it, and
  // silently never appear in the generated spec. register()'s callback
  // queues this after swagger in the same way authRoutes/projectRoutes/
  // taskRoutes below already do, which is why those show up correctly.
  void app.register(async (instance) => {
    instance.get(
      '/health',
      {
        config: { public: true },
        schema: {
          response: {
            200: {
              description: 'Liveness status',
              type: 'object',
              properties: {
                status: { type: 'string' },
              },
            },
          },
        },
      },
      async () => {
        return { status: 'ok' };
      },
    );

    // Raw spec only, no Swagger UI: the interactive UI plugin
    // (@fastify/swagger-ui) auto-registers its own routes with no way to
    // mark them config.public, and this project's preHandler is a global
    // hook with no other exemption mechanism (see bearer-auth.ts) - adding
    // one just for a docs page isn't worth the risk to a reviewed security
    // file. JSON, not YAML: it's what tooling that would consume this
    // route (Swagger Editor, Postman import) expects; the committed
    // openapi.yaml (see src/scripts/generate-openapi.ts) covers the
    // human-readable form.
    instance.get('/openapi.json', { config: { public: true }, schema: { hide: true } }, async () => {
      return app.swagger();
    });
  });

  void app.register(authRoutes);
  void app.register(projectRoutes);
  void app.register(taskRoutes);

  return app;
}
