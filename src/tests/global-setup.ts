import { Client, Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { TEST_DATABASE_URL } from './helpers/test-env.js';

// DROP DATABASE can't run against the database you're currently connected
// to, so this connects to the dev database (guaranteed to exist per
// docker-compose.yml) purely to issue the DROP/CREATE for taskapi_test, then
// disconnects before ever touching the test database itself.
const MAINTENANCE_DATABASE_URL = 'postgres://taskapi:taskapi@localhost:5432/taskapi';

/**
 * Runs once before the whole test run (not per file) — dropping and
 * recreating the test database from scratch every time is what guarantees
 * the schema always matches the current migrations exactly, with no risk of
 * drift from a stale test database left over from a previous run or an
 * abandoned migration. Assumes `docker compose up -d db` is already running;
 * this doesn't start Postgres itself, only provisions a database inside it.
 */
export default async function setup(): Promise<() => Promise<void>> {
  const maintenanceClient = new Client({ connectionString: MAINTENANCE_DATABASE_URL });
  await maintenanceClient.connect();

  try {
    // WITH (FORCE) (Postgres 13+) terminates any lingering connections from
    // a previous run that didn't shut down cleanly (e.g. an interrupted test
    // run) — without it, a stale connection left open would make this DROP
    // fail instead of just doing its job.
    await maintenanceClient.query('DROP DATABASE IF EXISTS taskapi_test WITH (FORCE)');
    await maintenanceClient.query('CREATE DATABASE taskapi_test');
  } finally {
    await maintenanceClient.end();
  }

  const pool = new Pool({ connectionString: TEST_DATABASE_URL });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: './drizzle' });
  await pool.end();

  return async () => {
    // Deliberately not dropping taskapi_test here: leaving it in place after
    // the run makes it possible to connect and inspect final state by hand
    // while debugging a failure. The next run's setup drops and recreates it
    // anyway, so nothing accumulates across runs.
  };
}
