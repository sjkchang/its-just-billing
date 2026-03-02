import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProductConfig } from "../core/config";
import type { BillingLogger } from "../core/types";
import { StripeProductProvider } from "../providers/stripe/products";

// Mock Stripe SDK
const mockStripe = {
  products: {
    retrieve: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    list: vi.fn(),
  },
  prices: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
};

const logger: BillingLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const baseProduct: ProductConfig = {
  id: "starter",
  name: "Starter",
  description: "For small teams",
  prices: [{ amount: 1900, currency: "usd", interval: "month" }],
};

describe("StripeProductProvider.syncProducts", () => {
  let provider: StripeProductProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    provider = new StripeProductProvider(mockStripe as any, logger);
  });

  async function runSync(products: ProductConfig[]) {
    return provider.syncProducts(products);
  }

  describe("product creation", () => {
    it("creates a new product when not found in Stripe", async () => {
      mockStripe.products.retrieve.mockRejectedValueOnce({ statusCode: 404 });
      mockStripe.products.create.mockResolvedValueOnce({
        id: "starter",
        name: "Starter",
        default_price: null,
      });
      mockStripe.prices.list.mockResolvedValueOnce({ data: [] });
      mockStripe.prices.create.mockResolvedValueOnce({ id: "price_new_1" });
      mockStripe.products.update.mockResolvedValueOnce({});

      await runSync([baseProduct]);

      expect(mockStripe.products.create).toHaveBeenCalledWith({
        id: "starter",
        name: "Starter",
        description: "For small teams",
      });
      expect(mockStripe.prices.create).toHaveBeenCalledWith({
        product: "starter",
        unit_amount: 1900,
        currency: "usd",
        recurring: { interval: "month" },
      });
    });
  });

  describe("product reactivation", () => {
    it("reactivates an archived product", async () => {
      mockStripe.products.retrieve.mockResolvedValueOnce({
        id: "starter",
        name: "Old Name",
        active: false,
        description: "",
        metadata: {},
        default_price: null,
      });
      mockStripe.products.update
        .mockResolvedValueOnce({
          id: "starter",
          name: "Starter",
          active: true,
          default_price: null,
        })
        // second call sets default_price
        .mockResolvedValueOnce({});
      mockStripe.prices.list.mockResolvedValueOnce({ data: [] });
      mockStripe.prices.create.mockResolvedValueOnce({ id: "price_new_1" });

      await runSync([baseProduct]);

      expect(mockStripe.products.update).toHaveBeenCalledWith("starter", {
        active: true,
        name: "Starter",
        description: "For small teams",
      });
    });
  });

  describe("product updates", () => {
    it("updates product when name differs", async () => {
      mockStripe.products.retrieve.mockResolvedValueOnce({
        id: "starter",
        name: "Old Name",
        description: "For small teams",
        active: true,
        metadata: {},
        default_price: null,
      });
      mockStripe.products.update
        .mockResolvedValueOnce({
          id: "starter",
          name: "Starter",
          default_price: null,
        })
        .mockResolvedValueOnce({});
      mockStripe.prices.list.mockResolvedValueOnce({ data: [] });
      mockStripe.prices.create.mockResolvedValueOnce({ id: "price_new_1" });

      await runSync([baseProduct]);

      expect(mockStripe.products.update).toHaveBeenCalledWith("starter", {
        name: "Starter",
        description: "For small teams",
      });
    });

    it("skips field update when product matches", async () => {
      mockStripe.products.retrieve.mockResolvedValueOnce({
        id: "starter",
        name: "Starter",
        description: "For small teams",
        active: true,
        metadata: {},
        default_price: "price_existing",
      });
      mockStripe.prices.list.mockResolvedValueOnce({
        data: [
          {
            id: "price_existing",
            unit_amount: 1900,
            currency: "usd",
            recurring: { interval: "month" },
          },
        ],
      });
      mockStripe.products.update.mockResolvedValueOnce({});

      await runSync([baseProduct]);

      // Only the default_price update should have happened, no field update
      expect(mockStripe.products.update).toHaveBeenCalledTimes(1);
      expect(mockStripe.products.update).toHaveBeenCalledWith("starter", {
        default_price: "price_existing",
      });
    });
  });

  describe("price sync", () => {
    it("creates missing prices", async () => {
      mockStripe.products.retrieve.mockResolvedValueOnce({
        id: "starter",
        name: "Starter",
        description: "For small teams",
        active: true,
        metadata: {},
        default_price: null,
      });
      mockStripe.prices.list.mockResolvedValueOnce({ data: [] });
      mockStripe.prices.create.mockResolvedValueOnce({ id: "price_new_1" });
      mockStripe.products.update.mockResolvedValueOnce({});

      await runSync([baseProduct]);

      expect(mockStripe.prices.create).toHaveBeenCalledWith({
        product: "starter",
        unit_amount: 1900,
        currency: "usd",
        recurring: { interval: "month" },
      });
    });

    it("archives unmatched Stripe prices", async () => {
      mockStripe.products.retrieve.mockResolvedValueOnce({
        id: "starter",
        name: "Starter",
        description: "For small teams",
        active: true,
        metadata: {},
        default_price: "price_old",
      });
      mockStripe.prices.list.mockResolvedValueOnce({
        data: [
          {
            id: "price_old",
            unit_amount: 999,
            currency: "usd",
            recurring: { interval: "month" },
          },
          {
            id: "price_match",
            unit_amount: 1900,
            currency: "usd",
            recurring: { interval: "month" },
          },
        ],
      });
      // Set default_price to the matched price
      mockStripe.products.update.mockResolvedValueOnce({});

      await runSync([baseProduct]);

      // price_old should be archived
      expect(mockStripe.prices.update).toHaveBeenCalledWith("price_old", { active: false });
    });

    it("sets default_price before archiving old default", async () => {
      const callOrder: string[] = [];
      mockStripe.products.retrieve.mockResolvedValueOnce({
        id: "starter",
        name: "Starter",
        description: "For small teams",
        active: true,
        metadata: {},
        default_price: "price_old",
      });
      mockStripe.prices.list.mockResolvedValueOnce({
        data: [
          {
            id: "price_old",
            unit_amount: 999,
            currency: "usd",
            recurring: { interval: "month" },
          },
        ],
      });
      mockStripe.prices.create.mockImplementation(async () => {
        callOrder.push("prices.create");
        return { id: "price_new" };
      });
      mockStripe.products.update.mockImplementation(async () => {
        callOrder.push("products.update:default_price");
        return {};
      });
      mockStripe.prices.update.mockImplementation(async () => {
        callOrder.push("prices.update:archive");
        return {};
      });

      await runSync([baseProduct]);

      // default_price must be set before archiving the old default price
      expect(callOrder).toEqual([
        "prices.create",
        "products.update:default_price",
        "prices.update:archive",
      ]);
      expect(mockStripe.products.update).toHaveBeenCalledWith("starter", {
        default_price: "price_new",
      });
      expect(mockStripe.prices.update).toHaveBeenCalledWith("price_old", { active: false });
    });

    it("keeps matching prices", async () => {
      mockStripe.products.retrieve.mockResolvedValueOnce({
        id: "starter",
        name: "Starter",
        description: "For small teams",
        active: true,
        metadata: {},
        default_price: "price_existing",
      });
      mockStripe.prices.list.mockResolvedValueOnce({
        data: [
          {
            id: "price_existing",
            unit_amount: 1900,
            currency: "usd",
            recurring: { interval: "month" },
          },
        ],
      });

      await runSync([baseProduct]);

      expect(mockStripe.prices.create).not.toHaveBeenCalled();
      expect(mockStripe.prices.update).not.toHaveBeenCalled();
    });

    it("sets default_price to first config price", async () => {
      const product: ProductConfig = {
        id: "starter",
        name: "Starter",
        prices: [
          { amount: 1900, currency: "usd", interval: "month" },
          { amount: 18240, currency: "usd", interval: "year" },
        ],
      };

      mockStripe.products.retrieve.mockResolvedValueOnce({
        id: "starter",
        name: "Starter",
        description: "",
        active: true,
        metadata: {},
        default_price: null,
      });
      mockStripe.prices.list.mockResolvedValueOnce({ data: [] });
      mockStripe.prices.create
        .mockResolvedValueOnce({ id: "price_monthly" })
        .mockResolvedValueOnce({ id: "price_yearly" });
      mockStripe.products.update.mockResolvedValueOnce({});

      await runSync([product]);

      // default_price should be set to the first price (monthly)
      expect(mockStripe.products.update).toHaveBeenCalledWith("starter", {
        default_price: "price_monthly",
      });
    });
  });

  describe("error isolation", () => {
    it("continues syncing other products when one fails", async () => {
      // First product fails
      mockStripe.products.retrieve
        .mockRejectedValueOnce(new Error("Network error"))
        // Second product succeeds
        .mockResolvedValueOnce({
          id: "pro",
          name: "Pro",
          description: "For growing teams",
          active: true,
          metadata: {},
          default_price: "price_pro",
        });
      mockStripe.prices.list.mockResolvedValueOnce({
        data: [
          {
            id: "price_pro",
            unit_amount: 4900,
            currency: "usd",
            recurring: { interval: "month" },
          },
        ],
      });

      await runSync([
        baseProduct,
        { id: "pro", name: "Pro", description: "For growing teams", prices: [{ amount: 4900, currency: "usd", interval: "month" }] },
      ]);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("starter"),
        expect.objectContaining({ error: "Network error" }),
      );
      // Second product should still have been processed
      expect(mockStripe.products.retrieve).toHaveBeenCalledTimes(2);
    });
  });

  describe("metadata sync", () => {
    it("updates product when metadata differs", async () => {
      const productWithMeta: ProductConfig = {
        ...baseProduct,
        metadata: { popular: "true" },
      };

      mockStripe.products.retrieve.mockResolvedValueOnce({
        id: "starter",
        name: "Starter",
        description: "For small teams",
        active: true,
        metadata: { popular: "false" },
        default_price: "price_existing",
      });
      mockStripe.products.update.mockResolvedValueOnce({
        id: "starter",
        default_price: "price_existing",
      });
      mockStripe.prices.list.mockResolvedValueOnce({
        data: [
          {
            id: "price_existing",
            unit_amount: 1900,
            currency: "usd",
            recurring: { interval: "month" },
          },
        ],
      });

      await runSync([productWithMeta]);

      expect(mockStripe.products.update).toHaveBeenCalledWith("starter", {
        name: "Starter",
        description: "For small teams",
        metadata: { popular: "true" },
      });
    });
  });
});
