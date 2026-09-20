import type { LightMyRequestResponse } from 'fastify';

// Fixtures exist to set up state other tests depend on, not to verify
// register/login's own behavior - that's what auth.test.ts's dedicated
// "201s and returns the created user" / "200s with an access/refresh token
// pair" tests are for, and they call app.inject() directly rather than
// going through these functions, specifically so they stay the single
// source of truth for what those endpoints return. What a fixture does need
// is to fail loudly at the point of setup rather than silently return
// unusable data - a bad override, an unexpected 400, whatever the cause -
// so the real problem surfaces here, not as a confusing failure two steps
// later in whatever test called it.
export function expectSuccess(response: LightMyRequestResponse, status: number): void {
  if (response.statusCode !== status) {
    throw new Error(
      `Test fixture expected ${status}, got ${response.statusCode}: ${response.body}`,
    );
  }
}
