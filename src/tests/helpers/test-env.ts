// Shared by vitest.config.ts (which injects these into process.env for the
// test run) and src/tests/global-setup.ts (which needs the same database URL
// to provision the database before any test file runs). Defined here, not in
// vitest.config.ts, because vitest.config.ts sits outside src/ — importing it
// from anything under src/ would violate tsconfig's rootDir and break
// `npm run build`/`npm run lint`. This file has no such constraint: it's
// valid application-tree TypeScript that vitest.config.ts is free to import.
//
// Same Postgres instance as dev (docker compose up -d db), different
// database name — Postgres hosts multiple databases per instance natively,
// so this avoids standing up a second container just for test isolation.
export const TEST_DATABASE_URL = 'postgres://taskapi:taskapi@localhost:5432/taskapi_test';

// Not a real secret: fixed, committed, and used only to sign tokens against
// a throwaway test database that gets dropped and recreated on every run —
// same reasoning as DUMMY_HASH in src/lib/tokens.ts.
export const TEST_JWT_SECRET = 'iH0lpqjL+ibSTYQhOWnFVouadgR5RUYvD3Y0WgtqY/w=';
