import { describe, it, expect } from "vitest";
import { BillingConfigSchema } from "../core/config";

describe("BillingConfigSchema", () => {
  describe("defaults", () => {
    it("produces full defaults from undefined", () => {
      const config = BillingConfigSchema.parse(undefined);
      expect(config.subscriptions.allowUpgrade).toBe(true);
      expect(config.subscriptions.allowDowngrade).toBe(false);
      expect(config.subscriptions.upgradeStrategy).toBe("immediate_prorate");
      expect(config.subscriptions.downgradeStrategy).toBe("at_period_end");
      expect(config.subscriptions.cancellation.timing).toBe("at_period_end");
      expect(config.subscriptions.cancellation.allowUncancel).toBe(true);
      expect(config.subscriptions.tierOrder).toBeUndefined();
      expect(config.entitlements).toBeUndefined();
      expect(config.hooks).toBeUndefined();
    });

    it("produces full defaults from empty object", () => {
      const config = BillingConfigSchema.parse({});
      expect(config.subscriptions.allowUpgrade).toBe(true);
      expect(config.subscriptions.allowDowngrade).toBe(false);
    });
  });

  describe("partial configs", () => {
    it("merges partial subscriptions with defaults", () => {
      const config = BillingConfigSchema.parse({
        subscriptions: { allowDowngrade: true },
      });
      expect(config.subscriptions.allowDowngrade).toBe(true);
      expect(config.subscriptions.allowUpgrade).toBe(true); // default preserved
      expect(config.subscriptions.upgradeStrategy).toBe("immediate_prorate");
    });

    it("merges partial cancellation with defaults", () => {
      const config = BillingConfigSchema.parse({
        subscriptions: { cancellation: { timing: "immediate" } },
      });
      expect(config.subscriptions.cancellation.timing).toBe("immediate");
      expect(config.subscriptions.cancellation.allowUncancel).toBe(true); // default preserved
    });

    it("accepts tierOrder", () => {
      const config = BillingConfigSchema.parse({
        subscriptions: { tierOrder: ["prod_a", "prod_b", "prod_c"] },
      });
      expect(config.subscriptions.tierOrder).toEqual(["prod_a", "prod_b", "prod_c"]);
    });

    it("accepts entitlements config", () => {
      const config = BillingConfigSchema.parse({
        entitlements: {
          products: { prod_a: ["plan:paid"] },
          defaultPaid: ["plan:paid"],
          defaultFree: ["plan:free"],
        },
      });
      expect(config.entitlements?.products).toEqual({ prod_a: ["plan:paid"] });
    });
  });

  describe("invalid values", () => {
    it("rejects invalid upgrade strategy", () => {
      expect(() =>
        BillingConfigSchema.parse({
          subscriptions: { upgradeStrategy: "invalid" },
        })
      ).toThrow();
    });

    it("rejects invalid downgrade strategy", () => {
      expect(() =>
        BillingConfigSchema.parse({
          subscriptions: { downgradeStrategy: "invalid" },
        })
      ).toThrow();
    });

    it("rejects invalid cancellation timing", () => {
      expect(() =>
        BillingConfigSchema.parse({
          subscriptions: { cancellation: { timing: "invalid" } },
        })
      ).toThrow();
    });
  });
});
