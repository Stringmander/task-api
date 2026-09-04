import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { projects, tasks } from '../db/schema.js';

export async function findOwnedProject(userId: number, projectId: number) {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));

  return project;
}

export async function findOwnedTask(userId: number, taskId: number) {
  // The select({ task: tasks }) (instead of a bare .select()) matters here:
  // once you join two tables, an unqualified .select() would return every
  // column from both tasks and projects flattened together — including
  // projects.id/projects.name colliding conceptually with tasks.id. Naming
  // the selected table task keeps the result shaped as { task: {...} }, so
  // row?.task gives you back a clean task row, same shape findOwnedProject
  // returns for a project.
  const [row] = await db
    .select({ task: tasks })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(and(eq(tasks.id, taskId), eq(projects.userId, userId)));

  return row?.task;
}
