import type { FastifyInstance } from 'fastify';
import type { JWTVerifyResult } from 'jose';
import { jwtVerify } from 'jose';
import { env } from '../env.js';
import { sendError } from '../lib/http-errors.js';

declare module 'fastify' {
  // This exact shape (`{ id: number }`) is inherited from
  // src/plugins/stub-auth.ts, which this file replaces wholesale. Every
  // Phase 2 route was already written against `request.user.id` and needed
  // zero changes when the stub was swapped out for real verification below —
  // that was the whole point of building ownership scoping before auth
  // existed.
  interface FastifyRequest {
    user: { id: number };
  }

  // Optional, not required: most routes (projects.ts, tasks.ts) never
  // declare a `config` at all, so `request.routeOptions.config.public` is
  // genuinely `undefined` for them at runtime, not `false`. Marking this
  // required would claim a guarantee that doesn't hold — `undefined` and
  // `false` both read as falsy in the check below, so the distinction
  // doesn't change behavior, but the type should still describe what's
  // actually possible rather than what happens to work out today.
  interface FastifyContextConfig {
    public?: boolean;
  }
}

export function registerBearerAuth(app: FastifyInstance): void {
  app.decorateRequest('user');

  app.addHook('preHandler', async (request, reply) => {
    // Route-level opt-in, checked first, before any header parsing: a route
    // that forgets to set config.public stays protected by default — the
    // fail-closed direction to err in. A hardcoded list of public paths
    // checked against request.url was considered and rejected: a forgotten
    // update to that list can fail in either direction (silently exposes a
    // route, or silently locks one down) depending on which way the mistake
    // goes, whereas a forgotten tag here only ever fails closed.
    //
    // A bare `return` here, not a sendError call, is what lets the request
    // continue to the route handler: a preHandler either sends a reply (or
    // throws), which short-circuits, or returns normally, which means
    // "proceed as normal."
    if (request.routeOptions.config.public) return;

    const authHeader = request.headers.authorization;

    // authorization is typed `string | undefined` by Node itself, never
    // `string[]` — unlike stub-auth.ts's x-stub-user-id, which needed an
    // Array.isArray check because generic headers can be duplicated.
    // startsWith('Bearer ') is checked explicitly, rather than assumed via
    // something like authHeader.split(' ')[1], which would silently return
    // a value even for a header that never had "Bearer" in it at all.
    if (!authHeader?.startsWith('Bearer ')) {
      return sendError(reply, 401, 'Missing or malformed Authorization header');
    }

    const token = authHeader.slice('Bearer '.length);

    // jwtVerify checks the signature AND expiry in one call — there's no
    // separate manual comparison against payload.exp anywhere here, because
    // an expired token never resolves past this line; it throws, same as a
    // tampered signature would. Every distinct failure (expired, wrong
    // signature, garbage input) collapses into the same message: nothing is
    // gained by telling a caller which check specifically failed.
    let result: JWTVerifyResult;
    try {
      result = await jwtVerify(token, env.jwtSecretKey);
    } catch {
      return sendError(reply, 401, 'Invalid or expired token');
    }

    request.user = { id: Number(result.payload.sub) };
  });
}
