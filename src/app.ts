import Fastify, { type FastifyInstance } from 'fastify';
import { registerStubAuth } from './plugins/stub-auth.js';
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

  // Registered before routes so request.user is populated for every
  // handler below it — see src/plugins/stub-auth.ts for why this exists
  // and what replaces it in Phase 3.
  registerStubAuth(app);

  app.get('/health', async () => {
    return { status: 'ok' };
  });

  // /auth/* is public by construction — it's how a user gets credentials in
  // the first place. The stub preHandler above still runs for it (harmless;
  // it only ever sets a fake request.user), but when it's replaced by the
  // real fail-closed Bearer-token hook in Phase 3, that hook must exempt
  // /auth/* explicitly or registration/login become unreachable.
  void app.register(authRoutes);
  void app.register(projectRoutes);
  void app.register(taskRoutes);

  return app;
}
