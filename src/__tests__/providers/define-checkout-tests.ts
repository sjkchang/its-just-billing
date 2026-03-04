/**
 * Shared checkout provider contract tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { ProviderFactory, ProviderTestContext } from "./harness";

let counter = 0;
function uniqueEmail() {
  return `checkout+${Date.now()}_${++counter}@example.com`;
}

export function defineCheckoutTests(factory: ProviderFactory) {
  describe("CheckoutProvider", () => {
    let ctx: ProviderTestContext;

    beforeEach(async () => {
      ctx = await factory();
    });

    afterEach(async () => {
      await ctx.cleanup();
    });

    it("createCheckoutSession returns { checkoutUrl }", async () => {
      const customer = await ctx.providers.customers.createCustomer(
        uniqueEmail(),
        `ext_checkout_${Date.now()}_${++counter}`
      );
      ctx.trackCustomer(customer.id);

      const session = await ctx.providers.checkout.createCheckoutSession({
        customerId: customer.id,
        productId: ctx.productIds[0],
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel",
      });

      expect(typeof session.checkoutUrl).toBe("string");
      expect(session.checkoutUrl.length).toBeGreaterThan(0);
    });

    it("createPortalSession returns { portalUrl }", async () => {
      const customer = await ctx.providers.customers.createCustomer(
        uniqueEmail(),
        `ext_portal_${Date.now()}_${++counter}`
      );
      ctx.trackCustomer(customer.id);

      const portal = await ctx.providers.checkout.createPortalSession(
        customer.id,
        "https://example.com/return"
      );

      expect(typeof portal.portalUrl).toBe("string");
      expect(portal.portalUrl.length).toBeGreaterThan(0);
    });

    it("checkout creates subscription when supported", async () => {
      if (!ctx.capabilities.checkoutCreatesSubscription) return;

      const customer = await ctx.providers.customers.createCustomer(
        uniqueEmail(),
        `ext_autosub_${Date.now()}_${++counter}`
      );
      ctx.trackCustomer(customer.id);

      await ctx.providers.checkout.createCheckoutSession({
        customerId: customer.id,
        productId: ctx.productIds[0],
        successUrl: "https://example.com/success",
      });

      const state = await ctx.providers.customers.getCustomerState(customer.id);
      expect(state).not.toBeNull();
      expect(state!.subscriptions.length).toBeGreaterThan(0);
      expect(state!.subscriptions[0].productId).toBe(ctx.productIds[0]);
    });
  });
}
