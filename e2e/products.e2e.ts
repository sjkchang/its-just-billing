/**
 * E2E tests — Product sync + listing.
 *
 * Verifies that managed products are synced to Stripe and returned correctly
 * via the HTTP API.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Stripe from "stripe";
import { createBilling } from "../src/index";
import type { BillingInstance } from "../src/billing";
import type { ProductConfig } from "../src/core/config";
import { setupDatabase, teardownDatabase, type E2EContext } from "./helpers/setup";
import { StripeCleanup } from "./helpers/cleanup";
import { createTestApp, resolveTestUser } from "./helpers/test-app";
import type { Hono } from "hono";

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
const describeE2E = STRIPE_KEY ? describe : describe.skip;

describeE2E("Product sync + listing", () => {
  let ctx: E2EContext;
  let cleanup: StripeCleanup;
  let billing: BillingInstance;
  let app: Hono;
  let stripe: Stripe;
  let products: ProductConfig[];

  beforeAll(async () => {
    ctx = await setupDatabase();
    cleanup = new StripeCleanup(STRIPE_KEY!);
    stripe = new Stripe(STRIPE_KEY!);

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
        prices: [
          { amount: 2900, currency: "usd", interval: "month" as const },
          { amount: 29000, currency: "usd", interval: "year" as const },
        ],
      },
    ];

    // Track products for cleanup
    for (const p of products) {
      cleanup.trackProduct(p.id);
    }

    billing = await createBilling({
      adapter: ctx.adapter,
      provider: { provider: "stripe", secretKey: STRIPE_KEY! },
      resolveUser: resolveTestUser,
      config: { products },
    });

    app = createTestApp(billing);
  });

  afterAll(async () => {
    await cleanup.cleanAll();
    await teardownDatabase(ctx);
  });

  it("should create products in Stripe after sync", async () => {
    // Products are synced during createBilling(). Verify they exist in Stripe.
    const starterProduct = await stripe.products.retrieve(`${ctx.runPrefix}_starter`);
    expect(starterProduct.name).toBe("Starter Plan");
    expect(starterProduct.description).toBe("For individuals");
    expect(starterProduct.active).toBe(true);

    const proProduct = await stripe.products.retrieve(`${ctx.runPrefix}_pro`);
    expect(proProduct.name).toBe("Pro Plan");
    expect(proProduct.active).toBe(true);

    // Verify prices
    const starterPrices = await stripe.prices.list({ product: starterProduct.id, active: true });
    expect(starterPrices.data).toHaveLength(1);
    expect(starterPrices.data[0].unit_amount).toBe(900);
    expect(starterPrices.data[0].currency).toBe("usd");
    expect(starterPrices.data[0].recurring?.interval).toBe("month");

    const proPrices = await stripe.prices.list({ product: proProduct.id, active: true });
    expect(proPrices.data).toHaveLength(2);
    const amounts = proPrices.data.map((p) => p.unit_amount).sort();
    expect(amounts).toEqual([2900, 29000]);
  });

  it("should return synced products via GET /products", async () => {
    const res = await app.request("/api/v1/billing/products");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.products).toHaveLength(2);

    const starter = body.products.find((p: any) => p.id === `${ctx.runPrefix}_starter`);
    expect(starter).toBeDefined();
    expect(starter.name).toBe("Starter Plan");
    expect(starter.prices).toHaveLength(1);
    expect(starter.prices[0].amount).toBe(900);
    expect(starter.prices[0].currency).toBe("usd");
    expect(starter.prices[0].interval).toBe("month");

    const pro = body.products.find((p: any) => p.id === `${ctx.runPrefix}_pro`);
    expect(pro).toBeDefined();
    expect(pro.name).toBe("Pro Plan");
    expect(pro.prices).toHaveLength(2);
  });

  it("should be idempotent on re-sync", async () => {
    // Get price count before re-sync
    const beforePrices = await stripe.prices.list({
      product: `${ctx.runPrefix}_starter`,
      active: true,
    });
    const beforeCount = beforePrices.data.length;

    // Create billing again (triggers another product sync)
    await createBilling({
      adapter: ctx.adapter,
      provider: { provider: "stripe", secretKey: STRIPE_KEY! },
      resolveUser: resolveTestUser,
      config: { products },
    });

    // Verify no duplicate prices were created
    const afterPrices = await stripe.prices.list({
      product: `${ctx.runPrefix}_starter`,
      active: true,
    });
    expect(afterPrices.data.length).toBe(beforeCount);
  });
});
