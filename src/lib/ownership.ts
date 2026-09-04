import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { projects } from '../db/schema.js';

export async function findOwnedProject(userId: number, projectId: number) {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));

  return project;
}
