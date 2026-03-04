/**
 * Shared subscription provider contract tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { ProviderFactory, ProviderTestContext } from "./harness";

export function defineSubscriptionTests(factory: ProviderFactory) {
  describe("SubscriptionProvider", () => {
    let ctx: ProviderTestContext;

    beforeEach(async () => {
      ctx = await factory();
    });

    afterEach(async () => {
      await ctx.cleanup();
    });

    it("has at least one change handler", () => {
      const handlers = ctx.providers.subscriptions.changeHandlers;
      expect(Object.keys(handlers).length).toBeGreaterThan(0);
    });

    it("immediate_prorate changes product ID", async () => {
      const handler = ctx.providers.subscriptions.changeHandlers.immediate_prorate;
      if (!handler) return;

      const { customerId, subscriptionId } = await ctx.seedSubscription(ctx.productIds[0]);
      ctx.trackCustomer(customerId);
      ctx.trackSubscription(subscriptionId);

      const updated = await handler(subscriptionId, ctx.productIds[1]);
      expect(updated.productId).toBe(ctx.productIds[1]);
    });

    it("has at least one cancel handler", () => {
      const handlers = ctx.providers.subscriptions.cancelHandlers;
      expect(Object.keys(handlers).length).toBeGreaterThan(0);
    });

    it("immediate cancel → status canceled", async () => {
      const handler = ctx.providers.subscriptions.cancelHandlers.immediate;
      if (!handler) return;

      const { customerId, subscriptionId } = await ctx.seedSubscription(ctx.productIds[0]);
      ctx.trackCustomer(customerId);
      ctx.trackSubscription(subscriptionId);

      const canceled = await handler(subscriptionId);
      expect(canceled.status).toBe("canceled");
    });

    it("at_period_end cancel → pendingCancellation true, status active", async () => {
      const handler = ctx.providers.subscriptions.cancelHandlers.at_period_end;
      if (!handler) return;

      const { customerId, subscriptionId } = await ctx.seedSubscription(ctx.productIds[0]);
      ctx.trackCustomer(customerId);
      ctx.trackSubscription(subscriptionId);

      const canceled = await handler(subscriptionId);
      expect(canceled.pendingCancellation).toBe(true);
      expect(canceled.status).toBe("active");
    });

    it("uncancel reverses at_period_end cancellation", async () => {
      const handler = ctx.providers.subscriptions.cancelHandlers.at_period_end;
      if (!handler) return;

      const { customerId, subscriptionId } = await ctx.seedSubscription(ctx.productIds[0]);
      ctx.trackCustomer(customerId);
      ctx.trackSubscription(subscriptionId);

      await handler(subscriptionId);
      const restored = await ctx.providers.subscriptions.uncancel(subscriptionId);
      expect(restored.pendingCancellation).toBe(false);
      expect(restored.status).toBe("active");
    });
  });
}
