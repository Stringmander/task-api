import { writeFile } from 'node:fs/promises';
import { dump } from 'js-yaml';
import { buildApp } from '../app.js';
import { pool } from '../db/index.js';

// A one-shot process, not a shared worker like the test suite - nothing
// else will close this pool, so it must happen here or the script hangs
// after writing the file instead of exiting.
async function main(): Promise<void> {
  const app = buildApp();
  await app.ready();

  await writeFile('openapi.yaml', dump(app.swagger()), 'utf-8');
  console.log('Wrote openapi.yaml');

  await app.close();
  await pool.end();
}

await main();
