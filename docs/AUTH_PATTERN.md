# Auth Pattern

Supplements `docs/ROUTE_PATTERN.md`, which covers the CRUD route shape.
Auth routes don't fit that shape — no ownership `WHERE` clause, no
`idParamSchema`, and (for login/refresh) they issue credentials instead of
consuming them. This doc covers that different shape, extracted from
`POST /auth/register` (`src/routes/auth.ts`) as far as it goes, plus the
token-issuing pattern `login` and `refresh` should follow when they're
written next.

## Password hashing (established)

See `src/routes/auth.ts` for the implemented, verified pattern: bcryptjs
cost 12, a `maxLength: 72` schema cap (bcrypt only hashes the first 72
bytes — see the comment there), and a response built from an explicit
`.returning({...})` column list so `passwordHash` is never selected back,
not merely stripped after the fact. Don't re-derive this — reuse it.

## Token issuance — jose

Per CLAUDE.md's Auth Contract and BUILD_PLAN's "jose token pair," both
access and refresh tokens are jose-signed JWTs with the same minimal
payload shape: `sub` (the user id, as a string), `iat`, `exp` — nothing
else. No email, displayName, or role in the payload.

**Why minimal claims:** the token is already unable to lie about identity
(the signature guarantees that) — anything beyond identity that a handler
needs should come from a fresh DB lookup keyed by `sub`, not from a claim
baked into a token that might be days old. Minimal claims also means the
payload shape never has to version; there's nothing in it that could go
stale.

Signing shape:

```ts
import { SignJWT } from 'jose';

const token = await new SignJWT({})
  .setProtectedHeader({ alg: 'HS256' })
  .setSubject(String(user.id))
  .setIssuedAt()
  .setExpirationTime('15m') // '7d' for the refresh token
  .sign(secretKey);
```

`secretKey` is a `Uint8Array` (`new TextEncoder().encode(rawSecret)`) —
`rawSecret` comes from a new required env var (e.g. `JWT_SECRET`), added to
`src/env.ts` alongside `databaseUrl`/`port` when login is written. Verifying
is `jwtVerify(token, secretKey)`, which throws on a bad signature or an
expired token — catch that and respond 401.

## Refresh token storage & rotation

The refresh token is also a signed jose JWT (7-day expiry), but unlike the
access token it's additionally tracked server-side in `refresh_tokens`
(schema added this phase — see `src/db/schema.ts`), because a signed JWT on
its own can't be revoked before it expires, and rotation requires exactly
that.

**Why SHA-256, not bcrypt, for the stored hash** (per BUILD_PLAN): bcrypt
salts each hash randomly, so hashing the same input twice produces two
different outputs — that's the point for passwords, but it makes an exact
`WHERE token_hash = ?` lookup impossible. SHA-256 is deterministic: hash the
presented token the same way it was hashed at issuance and the row either
matches or it doesn't. Bcrypt's slowness is also wasted here — refresh
tokens are already high-entropy signed JWTs, not human-guessable secrets,
so there's nothing for a slow hash to protect against that a fast one
doesn't.

Rotation flow, on `POST /auth/refresh`:

1. `jwtVerify` the presented token — rejects garbage or expired tokens
   without touching the database.
2. Hash it (SHA-256) and look up `refresh_tokens` by `tokenHash`.
3. **Not found → 401.** This is the "reuse-rejected" case from BUILD_PLAN's
   test plan: a token that was already rotated away (or never existed)
   fails the same way. There's no way to distinguish "revoked and reused"
   from "never issued," and there doesn't need to be — both mean "don't
   trust this."
4. **Found → delete that row**, issue a brand-new access+refresh pair,
   insert the new refresh row. Deleting rather than flagging is enough:
   a legitimate client always presents its most recent token, so a missing
   row already means "not the latest" regardless of why.

## Shape login and refresh should follow

- **`POST /auth/login`** — body `{ email, password }`. Look up the user by
  email, `bcrypt.compare` against `passwordHash`. Unknown email and wrong
  password must return the *same* 401 with the *same* message (CLAUDE.md:
  no user enumeration) — one `sendError` call on both paths, not two
  branches that happen to produce similar-looking output. Success: issue
  the token pair, insert the refresh row, respond 200 with
  `{ accessToken, refreshToken }`.
- **`POST /auth/refresh`** — body `{ refreshToken }`. Runs the rotation
  flow above, responds 200 with a fresh `{ accessToken, refreshToken }`.
- Neither route reads or writes `request.user` — they're what *produces*
  credentials, not something that runs after credentials already exist.

## Not covered here

The fail-closed preHandler that reads `Authorization: Bearer <token>`,
verifies it via `jwtVerify`, and populates `request.user` — this replaces
`src/plugins/stub-auth.ts` wholesale, not incrementally. It isn't written
yet. Once login/refresh/the preHandler exist, review happens via
`/review-route` rather than further guided drafting.
