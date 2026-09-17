import { beforeEach } from 'vitest';
import { resetDb } from './helpers/reset-db.js';

// A setupFiles entry (vitest.config.ts) runs once per test file, but a
// beforeEach registered *inside* one applies globally, to every test in
// every file — so every test in this suite (and every suite added later:
// authorization, projects, tasks, integration) starts from empty tables
// without each file needing to remember to call resetDb() itself. One place
// to get isolation right, not one per file.
beforeEach(resetDb);
