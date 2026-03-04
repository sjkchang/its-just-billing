/**
 * Shared product provider contract tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { ProviderFactory, ProviderTestContext } from "./harness";

export function defineProductTests(factory: ProviderFactory) {
  describe("ProductProvider", () => {
    let ctx: ProviderTestContext;

    beforeEach(async () => {
      ctx = await factory();
    });

    afterEach(async () => {
      await ctx.cleanup();
    });

    it("listProducts returns array with correct shape", async () => {
      const products = await ctx.providers.products.listProducts();
      expect(Array.isArray(products)).toBe(true);
      expect(products.length).toBeGreaterThan(0);
      for (const p of products) {
        expect(p).toHaveProperty("id");
        expect(p).toHaveProperty("name");
        expect(Array.isArray(p.prices)).toBe(true);
        for (const price of p.prices) {
          expect(price).toHaveProperty("id");
          expect(price).toHaveProperty("productId");
          expect(typeof price.amount).toBe("number");
          expect(typeof price.currency).toBe("string");
          expect(price.interval).toBeDefined();
        }
      }
    });

    it("getProduct retrieves by ID", async () => {
      const product = await ctx.providers.products.getProduct(ctx.productIds[0]);
      expect(product).not.toBeNull();
      expect(product!.id).toBe(ctx.productIds[0]);
      expect(typeof product!.name).toBe("string");
      expect(Array.isArray(product!.prices)).toBe(true);
    });

    it("getProduct returns null for unknown ID", async () => {
      const product = await ctx.providers.products.getProduct("nonexistent_product_xyz");
      expect(product).toBeNull();
    });
  });
}
