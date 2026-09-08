import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { sendError } from '../lib/http-errors.js';

// additionalProperties: false blocks a client from smuggling in fields like
// passwordHash or id — same reasoning as every other body schema in this
// project (see the comment on createProjectBodySchema in projects.ts).
//
// password maxLength is 72, not an arbitrary round number: bcrypt (and
// bcryptjs) only hashes the first 72 *bytes* of its input and silently
// ignores the rest. Without this cap, two different passwords sharing the
// same first 72 bytes would hash identically, and a user who thinks their
// 100-character password is doing extra work would be wrong. Rejecting the
// input up front is honest; truncating it silently is not.
const registerBodySchema = {
  type: 'object',
  required: ['email', 'password', 'displayName'],
  additionalProperties: false,
  properties: {
    email: { type: 'string', format: 'email', maxLength: 255 },
    password: { type: 'string', minLength: 8, maxLength: 72 },
    displayName: { type: 'string', minLength: 1, maxLength: 100 },
  },
} as const;

interface RegisterBody {
  email: string;
  password: string;
  displayName: string;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: RegisterBody }>(
    '/auth/register',
    { schema: { body: registerBodySchema } },
    async (request, reply) => {
      const { email, password, displayName } = request.body;

      // Cost factor 12 per CLAUDE.md's Auth Contract: this is bcrypt's work
      // factor (each increment roughly doubles the hashing time), not a
      // character count. It's deliberately slow — slow enough to make
      // brute-forcing a stolen hash expensive, fast enough that one login
      // request doesn't feel sluggish.
      const passwordHash = await bcrypt.hash(password, 12);

      try {
        // .returning() with an explicit column list, not a bare returning():
        // passwordHash never leaves the database in the response, because it's
        // never even selected back — not because a field gets stripped after
        // the fact. See CLAUDE.md's rule: never log or return password hashes.
        const [user] = await db
          .insert(users)
          .values({ email, passwordHash, displayName })
          .returning({
            id: users.id,
            email: users.email,
            displayName: users.displayName,
            createdAt: users.createdAt,
          });

        reply.code(201).send(user);
      } catch (err) {
        // users.email has a UNIQUE constraint; Postgres reports a violation
        // as error code 23505. Checking the DB's own constraint here (rather
        // than a SELECT-then-INSERT existence check) is race-safe — two
        // concurrent registrations for the same email can't both slip
        // through, because the constraint is enforced atomically by Postgres
        // itself, not by application logic with a gap in the middle.
        //
        // drizzle-orm wraps driver errors in DrizzleQueryError and puts the
        // original pg error on `.cause` (verified by hand against this
        // version — pg's own error never reaches here directly), so the code
        // has to be read off `cause`, not the caught error itself.
        const cause = err instanceof Error ? err.cause : undefined;
        if (cause && typeof cause === 'object' && 'code' in cause && cause.code === '23505') {
          return sendError(reply, 409, 'Email already registered');
        }

        throw err;
      }
    },
  );
}
