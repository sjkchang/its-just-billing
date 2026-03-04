/**
 * Shared customer provider contract tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { ProviderFactory, ProviderTestContext } from "./harness";

let customerCounter = 0;
function uniqueEmail() {
  return `test+${Date.now()}_${++customerCounter}@example.com`;
}

function uniqueExternalId() {
  return `ext_${Date.now()}_${++customerCounter}`;
}

export function defineCustomerTests(factory: ProviderFactory) {
  describe("CustomerProvider", () => {
    let ctx: ProviderTestContext;

    beforeEach(async () => {
      ctx = await factory();
    });

    afterEach(async () => {
      await ctx.cleanup();
    });

    it("createCustomer returns customer with email + externalId", async () => {
      const email = uniqueEmail();
      const externalId = uniqueExternalId();
      const customer = await ctx.providers.customers.createCustomer(email, externalId);
      ctx.trackCustomer(customer.id);

      expect(customer.id).toBeTruthy();
      expect(customer.email).toBe(email);
      expect(customer.externalId).toBe(externalId);
    });

    it("getCustomer retrieves created customer", async () => {
      const email = uniqueEmail();
      const externalId = uniqueExternalId();
      const created = await ctx.providers.customers.createCustomer(email, externalId);
      ctx.trackCustomer(created.id);

      const fetched = await ctx.providers.customers.getCustomer(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.email).toBe(email);
    });

    it("getCustomer returns null for unknown", async () => {
      const fetched = await ctx.providers.customers.getCustomer("nonexistent_cust_xyz");
      expect(fetched).toBeNull();
    });

    it("getCustomerByExternalId finds customer", async () => {
      if (ctx.capabilities.eventualConsistencyOnSearch) return;

      const email = uniqueEmail();
      const externalId = uniqueExternalId();
      const created = await ctx.providers.customers.createCustomer(email, externalId);
      ctx.trackCustomer(created.id);

      const fetched = await ctx.providers.customers.getCustomerByExternalId(externalId);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.externalId).toBe(externalId);
    });

    it("getCustomerByExternalId returns null for unknown", async () => {
      const fetched = await ctx.providers.customers.getCustomerByExternalId(
        "nonexistent_ext_xyz"
      );
      expect(fetched).toBeNull();
    });

    it("getCustomerState returns customer + empty subscriptions for new customer", async () => {
      const email = uniqueEmail();
      const externalId = uniqueExternalId();
      const created = await ctx.providers.customers.createCustomer(email, externalId);
      ctx.trackCustomer(created.id);

      const state = await ctx.providers.customers.getCustomerState(created.id);
      expect(state).not.toBeNull();
      expect(state!.customer.id).toBe(created.id);
      expect(Array.isArray(state!.subscriptions)).toBe(true);
      expect(state!.subscriptions.length).toBe(0);
    });

    it("getCustomerState returns null for unknown", async () => {
      const state = await ctx.providers.customers.getCustomerState("nonexistent_cust_xyz");
      expect(state).toBeNull();
    });

    it("getSubscription returns null for unknown", async () => {
      const sub = await ctx.providers.customers.getSubscription("nonexistent_sub_xyz");
      expect(sub).toBeNull();
    });
  });
}
