import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL, TEST_JWT_SECRET } from './src/tests/helpers/test-env.js';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./src/tests/global-setup.ts'],
    setupFiles: ['./src/tests/setup.ts'],
    // Every test file shares one Postgres database and resets it by
    // truncating between tests (src/tests/setup.ts) rather than each file
    // getting its own isolated schema. Running files in parallel would mean
    // two files' truncates and inserts racing against the same tables -
    // file-level sequencing is what makes that safe, not the truncate logic
    // itself. This matters more as more test files (authorization, projects,
    // tasks, integration) get added later, all sharing this same database.
    fileParallelism: false,
    // PORT isn't set here deliberately: tests exercise the app via
    // app.inject() (see docs/ROUTE_PATTERN.md), never a real .listen() call,
    // so there's no port to configure.
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      JWT_SECRET: TEST_JWT_SECRET,
    },
  },
});
