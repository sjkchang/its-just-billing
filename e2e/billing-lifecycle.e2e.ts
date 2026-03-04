/**
 * E2E tests — Full billing lifecycle.
 *
 * checkout → sync → status → cancel → resume → portal
 *
 * Can't complete Stripe Checkout without a browser, so we:
 * 1. Test POST /checkout returns a valid checkout URL
 * 2. Create subscriptions directly via Stripe API (pm_card_visa)
 * 3. Call POST /sync to pull state into local DB
 * 4. Verify via GET /status
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { createBilling } from "../src/index";
import type { BillingInstance } from "../src/billing";
import type { ProductConfig } from "../src/core/config";
import {
  setupDatabase,
  teardownDatabase,
  createTestUser,
  insertTestUser,
  insertBillingCustomer,
  type E2EContext,
} from "./helpers/setup";
import { StripeCleanup } from "./helpers/cleanup";
import { createStripeSubscription } from "./helpers/stripe-helpers";
import {
  createTestApp,
  setTestUser,
  clearTestUsers,
  resolveTestUser,
} from "./helpers/test-app";
import type { Hono } from "hono";

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
const describeE2E = STRIPE_KEY ? describe : describe.skip;

describeE2E("Billing lifecycle", () => {
  let ctx: E2EContext;
  let cleanup: StripeCleanup;
  let billing: BillingInstance;
  let app: Hono;
  let products: ProductConfig[];

  beforeAll(async () => {
    ctx = await setupDatabase();
    cleanup = new StripeCleanup(STRIPE_KEY!);

    products = [
      {
        id: `${ctx.runPrefix}_starter`,
        name: "Starter Plan",
        description: "For individuals",
        prices: [{ amount: 900, currency: "usd", interval: "month" as const }],
      },
      {
        id: `${ctx.runPrefix}_pro`,
        name: "Pro Plan",
        description: "For teams",
        prices: [{ amount: 2900, currency: "usd", interval: "month" as const }],
      },
    ];

    for (const p of products) {
      cleanup.trackProduct(p.id);
    }

    billing = await createBilling({
      adapter: ctx.adapter,
      provider: { provider: "stripe", secretKey: STRIPE_KEY! },
      resolveUser: resolveTestUser,
      config: {
        products,
        entitlements: {
          defaultFree: ["basic"],
          products: {
            [`${ctx.runPrefix}_starter`]: ["basic", "starter"],
            [`${ctx.runPrefix}_pro`]: ["basic", "starter", "pro"],
          },
        },
      },
    });

    app = createTestApp(billing);
  });

  afterAll(async () => {
    clearTestUsers();
    await cleanup.cleanAll();
    await teardownDatabase(ctx);
  });

  beforeEach(async () => {
    await ctx.truncate();
    clearTestUsers();
  });

  // ============================================================================
  // Helpers
  // ============================================================================

  function authedRequest(
    method: string,
    path: string,
    token: string,
    body?: object,
  ): Request {
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    };
    if (body) {
      init.body = JSON.stringify(body);
    }
    return new Request(`http://localhost/api/v1/billing${path}`, init);
  }

  // ============================================================================
  // Tests
  // ============================================================================

  it("should return free tier for a new user", async () => {
    const alice = createTestUser(ctx.runPrefix, "alice");
    await insertTestUser(ctx.sql, alice);
    setTestUser("token-alice", alice);

    const res = await app.request(authedRequest("GET", "/status", "token-alice"));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.productId).toBeNull();
    expect(body.productName).toBe("Free");
    expect(body.subscription).toBeNull();
    expect(body.entitlements).toContain("basic");
    expect(body.statusMessage).toContain("Free");
  });

  it("should return a checkout URL from POST /checkout", async () => {
    const bob = createTestUser(ctx.runPrefix, "bob");
    await insertTestUser(ctx.sql, bob);
    setTestUser("token-bob", bob);

    const res = await app.request(
      authedRequest("POST", "/checkout", "token-bob", {
        productId: `${ctx.runPrefix}_starter`,
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
      }),
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.com\//);
  });

  it("should reflect active subscription after sync", async () => {
    const carol = createTestUser(ctx.runPrefix, "carol");
    await insertTestUser(ctx.sql, carol);
    setTestUser("token-carol", carol);

    // Create subscription directly in Stripe
    const { customer: stripeCarol, subscription } = await createStripeSubscription(
      STRIPE_KEY!,
      {
        productId: `${ctx.runPrefix}_starter`,
        userId: carol.id,
        email: carol.email,
        name: carol.name,
      },
      cleanup,
    );
    expect(subscription.status).toBe("active");

    // Link local billing customer so sync doesn't rely on Stripe Search indexing
    await insertBillingCustomer(ctx.sql, {
      userId: carol.id,
      providerCustomerId: stripeCarol.id,
      email: carol.email,
      name: carol.name,
    });

    // Sync state into local DB
    const syncRes = await app.request(
      authedRequest("POST", "/sync", "token-carol"),
    );
    expect(syncRes.status).toBe(200);

    // Check status
    const statusRes = await app.request(
      authedRequest("GET", "/status", "token-carol"),
    );
    expect(statusRes.status).toBe(200);

    const status = await statusRes.json();
    expect(status.productId).toBe(`${ctx.runPrefix}_starter`);
    expect(status.productName).toBe("Starter Plan");
    expect(status.subscription).not.toBeNull();
    expect(status.subscription.status).toBe("active");
    expect(status.subscription.pendingCancellation).toBe(false);
    expect(status.entitlements).toContain("starter");
    expect(status.entitlements).toContain("basic");
  });

  it("should cancel a subscription via DELETE /subscriptions/:id", async () => {
    const dave = createTestUser(ctx.runPrefix, "dave");
    await insertTestUser(ctx.sql, dave);
    setTestUser("token-dave", dave);

    // Create subscription
    const { customer: stripeDave } = await createStripeSubscription(
      STRIPE_KEY!,
      {
        productId: `${ctx.runPrefix}_starter`,
        userId: dave.id,
        email: dave.email,
        name: dave.name,
      },
      cleanup,
    );

    await insertBillingCustomer(ctx.sql, {
      userId: dave.id,
      providerCustomerId: stripeDave.id,
      email: dave.email,
      name: dave.name,
    });

    // Sync first
    await app.request(authedRequest("POST", "/sync", "token-dave"));

    // Get subscription ID from status
    const statusRes = await app.request(
      authedRequest("GET", "/status", "token-dave"),
    );
    const statusBody = await statusRes.json();
    const subscriptionId = statusBody.subscription.id;

    // Cancel
    const cancelRes = await app.request(
      authedRequest("DELETE", `/subscriptions/${subscriptionId}`, "token-dave"),
    );
    expect(cancelRes.status).toBe(200);

    const cancelBody = await cancelRes.json();
    expect(cancelBody.subscription.pendingCancellation).toBe(true);
    // Default cancel timing is at_period_end, so status stays active
    expect(cancelBody.subscription.status).toBe("active");
  });

  it("should resume a canceled subscription via POST /subscriptions/:id/resume", async () => {
    const eve = createTestUser(ctx.runPrefix, "eve");
    await insertTestUser(ctx.sql, eve);
    setTestUser("token-eve", eve);

    // Create subscription
    const { customer: stripeEve } = await createStripeSubscription(
      STRIPE_KEY!,
      {
        productId: `${ctx.runPrefix}_starter`,
        userId: eve.id,
        email: eve.email,
        name: eve.name,
      },
      cleanup,
    );

    await insertBillingCustomer(ctx.sql, {
      userId: eve.id,
      providerCustomerId: stripeEve.id,
      email: eve.email,
      name: eve.name,
    });

    // Sync
    await app.request(authedRequest("POST", "/sync", "token-eve"));

    // Get subscription ID
    const statusRes = await app.request(
      authedRequest("GET", "/status", "token-eve"),
    );
    const statusBody = await statusRes.json();
    const subscriptionId = statusBody.subscription.id;

    // Cancel
    await app.request(
      authedRequest("DELETE", `/subscriptions/${subscriptionId}`, "token-eve"),
    );

    // Resume
    const resumeRes = await app.request(
      authedRequest("POST", `/subscriptions/${subscriptionId}/resume`, "token-eve"),
    );
    expect(resumeRes.status).toBe(200);

    const resumeBody = await resumeRes.json();
    expect(resumeBody.subscription.pendingCancellation).toBe(false);
    expect(resumeBody.subscription.status).toBe("active");
  });

  it("should return a portal URL from POST /portal", async () => {
    const frank = createTestUser(ctx.runPrefix, "frank");
    await insertTestUser(ctx.sql, frank);
    setTestUser("token-frank", frank);

    const res = await app.request(
      authedRequest("POST", "/portal", "token-frank", {
        returnUrl: "https://example.com/account",
      }),
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.portalUrl).toMatch(/^https:\/\/billing\.stripe\.com\//);
  });
});
