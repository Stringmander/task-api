import type { FastifyInstance } from 'fastify';
import type { JWTVerifyResult } from 'jose';
import bcrypt from 'bcryptjs';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { refreshTokens, users } from '../db/schema.js';
import { sendError } from '../lib/http-errors.js';
import { hashToken, signAccessToken, signRefreshToken, verifyPassword } from '../lib/tokens.js';
import { jwtVerify } from 'jose';
import { env } from '../env.js';

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

const loginBodySchema = {
  type: 'object',
  required: ['email', 'password'],
  additionalProperties: false,
  properties: {
    email: { type: 'string', format: 'email', maxLength: 255 },
    password: { type: 'string', minLength: 8, maxLength: 72 },
  },
} as const;

// A refresh token's shape is a jose-signed JWT — three base64url segments
// separated by dots (header.payload.signature). That's checkable with a regex
// pattern — it rejects obviously-garbage input (empty string, random text, a
// truncated copy-paste) with a clean 400 before the request even reaches
// jwtVerify. The maxLength of 2048 is a generous defensive cap, not tied to
// any cryptographic fact like the password field's 72-byte bcrypt limit. A
// real token here (minimal sub/iat/exp payload, HS256) is nowhere near this
// size; it just stops something absurdly oversized from being handed to
// jwtVerify at all. Additionally, minLength is unnecssary — the pattern
// already requires at least one character per segment, so an empty or
// near-empty string can't match it anyway.
const refreshBodySchema = {
  type: 'object',
  required: ['refreshToken'],
  additionalProperties: false,
  properties: {
    refreshToken: {
      type: 'string',
      pattern: '^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$',
      maxLength: 2048,
    },
  },
} as const;

export interface LoginBody {
  email: string;
  password: string;
}

export interface RegisterBody extends LoginBody {
  displayName: string;
}

interface RefreshBody {
  refreshToken: string;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: RegisterBody }>(
    '/auth/register',
    { schema: { body: registerBodySchema }, config: { public: true } },
    async (request, reply) => {
      const { password, displayName } = request.body;
      const email = request.body.email.toLowerCase();

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

  app.post<{ Body: LoginBody }>(
    '/auth/login',
    { schema: { body: loginBodySchema }, config: { public: true } },
    async (request, reply) => {
      const email = request.body.email.toLowerCase();

      const [user] = await db.select().from(users).where(eq(users.email, email));
      // Awaited here, before the guard clause below, not inside it: bcrypt's
      // cost-12 comparison (see verifyPassword in lib/tokens.ts) always takes
      // the same ~300ms whether `user` was found or not. Skipping it when
      // `user` is missing would let that request return faster than a
      // wrong-password one — a timing side channel that leaks which emails
      // are registered even though both cases send an identical 401 below.
      const passwordValid = await verifyPassword(request.body.password, user?.passwordHash);

      if (!user || !passwordValid) {
        return sendError(reply, 401, 'Incorrect email/password');
      }

      const accessToken = await signAccessToken(user.id);
      const refreshToken = await signRefreshToken(user.id);
      const tokenHash = hashToken(refreshToken.token);

      await db.insert(refreshTokens).values({
        userId: user.id,
        tokenHash,
        expiresAt: refreshToken.expiresAt,
      });

      reply.code(200).send({
        accessToken,
        refreshToken: refreshToken.token,
      });
    },
  );

  app.post<{ Body: RefreshBody }>(
    '/auth/refresh',
    { schema: { body: refreshBodySchema }, config: { public: true } },
    async (request, reply) => {
      const requestRefreshToken = request.body.refreshToken;

      let result: JWTVerifyResult;
      try {
        result = await jwtVerify(requestRefreshToken, env.jwtSecretKey);
      } catch {
        return sendError(reply, 401, 'Invalid or expired refresh token');
      }

      const userId = Number(result.payload.sub);
      const requestTokenHash = hashToken(requestRefreshToken);

      // Delete-then-check via .returning(), not a SELECT followed by a
      // separate DELETE: this makes "does the token still exist" and
      // "make sure it can't be used again" one atomic statement instead of
      // two, which is what actually closes the reuse race. If two
      // /auth/refresh requests present the same still-valid-looking token
      // at nearly the same time, Postgres only lets one of the deletes
      // match and return a row — the other gets nothing back, even though
      // both tokens passed jwtVerify. A SELECT to check existence, followed
      // later by a DELETE, would leave a gap between those two steps for
      // both requests to slip through.
      const [deleted] = await db
        .delete(refreshTokens)
        // Filtering by both userId and tokenHash isn't redundant, even though
        // tokenHash alone is already .unique(). Here, userId comes from the
        // JWT's verified sub claim (trustworthy — jwtVerify already confirmed
        // the signature), and requiring the DB row to agree with what the token
        // itself claims is a real consistency check, not decoration. If a hash
        // ever matched a row belonging to a different user than the token
        // claims, this correctly treats that as "not found" rather than trusting
        // the hash match alone.
        .where(and(eq(refreshTokens.userId, userId), eq(refreshTokens.tokenHash, requestTokenHash)))
        .returning();

      if (!deleted) {
        return sendError(reply, 401, 'Invalid or expired refresh token');
      }

      const accessToken = await signAccessToken(userId);
      const refreshToken = await signRefreshToken(userId);
      const tokenHash = hashToken(refreshToken.token);

      await db.insert(refreshTokens).values({
        userId,
        tokenHash,
        expiresAt: refreshToken.expiresAt,
      });

      reply.code(200).send({
        accessToken,
        refreshToken: refreshToken.token,
      });
    },
  );
}
