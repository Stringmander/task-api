import { defineConfig, defaultExclude } from 'vitest/config';
import { TEST_DATABASE_URL, TEST_JWT_SECRET } from './src/tests/helpers/test-env.js';

export default defineConfig({
  test: {
    environment: 'node',
    // Vitest's own default exclude is only node_modules and .git - nothing
    // for dist. Without this, `npm run build` (tsc compiles src/tests/**
    // into dist/tests/** too, nothing excludes it) leaves compiled test
    // files sitting there, and Vitest happily runs *both* the .ts source
    // and the stale compiled .js as two separate "files" - found this by
    // hand: running build before test silently doubled the suite (16 tests
    // instead of 8), all passing, easy to miss without checking the count.
    exclude: [...defaultExclude, 'dist/**'],
    globalSetup: ['./src/tests/global-setup.ts'],
    setupFiles: ['./src/tests/setup.ts'],
    // Every test file shares one Postgres database, reset once per file
    // (src/tests/setup.ts's beforeAll) rather than once per test. Running
    // files in parallel would mean two files' truncates and inserts racing
    // against the same tables - file-level sequencing is what makes that
    // safe. This matters more as more test files (authorization, projects,
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
