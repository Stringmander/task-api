import { beforeAll } from 'vitest';
import { resetDb } from './helpers/reset-db.js';

// A setupFiles entry (vitest.config.ts) re-runs once per test file, so a
// beforeAll registered *inside* one fires once at the start of each file,
// not once for the whole run — every file (this one and every suite added
// later: authorization, projects, tasks, integration) starts from empty
// tables without needing to call resetDb() itself.
//
// Deliberately beforeAll, not beforeEach (docs/BUILD_PLAN.md: "truncate
// tables before each test file"): tests within a file share whatever a
// file's own beforeAll sets up (e.g. one registered/logged-in user reused
// across many tests) instead of paying a fresh bcrypt cost per test. Tests
// that need to stay independent of each other within a file are the file's
// own responsibility — e.g. using a unique email per test rather than
// relying on a table wipe between them.
beforeAll(resetDb);
