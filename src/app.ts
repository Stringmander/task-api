import Fastify, { type FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
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
    instance.get('/health', { config: { public: true } }, async () => {
      return { status: 'ok' };
    });

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
