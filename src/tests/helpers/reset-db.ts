import { sql } from 'drizzle-orm';
import { db } from '../../db/index.js';

// TRUNCATE, not DELETE FROM: one statement clears all four tables regardless
// of FK order (CASCADE handles that), and RESTART IDENTITY resets the
// bigserial sequences back to 1 so ids stay small and predictable across
// tests instead of climbing indefinitely across a whole run. Drizzle's own
// migration-bookkeeping table is deliberately not touched here — it's not
// part of the domain schema, and truncating it would make the next
// migrate() think no migrations have ever run.
export async function resetDb(): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE refresh_tokens, tasks, projects, users RESTART IDENTITY CASCADE`);
}
