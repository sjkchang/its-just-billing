/**
 * Test Hono app factory — wires real billing to an HTTP app for e2e testing.
 */

import { Hono } from "hono";
import type { BillingInstance } from "../../src/billing";
import type { BillingUser } from "../../src/core/hooks";

// ============================================================================
// Simple token-based auth for tests
// ============================================================================

const tokenMap = new Map<string, BillingUser>();

export function setTestUser(token: string, user: BillingUser): void {
  tokenMap.set(token, user);
}

export function clearTestUsers(): void {
  tokenMap.clear();
}

function resolveTestUser(req: Request): Promise<BillingUser | null> {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return Promise.resolve(null);
  const token = auth.slice(7);
  return Promise.resolve(tokenMap.get(token) ?? null);
}

// ============================================================================
// App factory
// ============================================================================

export function createTestApp(billing: BillingInstance): Hono {
  const app = new Hono();

  app.all("/api/v1/billing/*", (c) => billing.handler(c.req.raw));

  return app;
}

export { resolveTestUser };
