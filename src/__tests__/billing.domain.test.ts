import { describe, it, expect } from "vitest";
import {
  isActiveStatus,
  isActive,
  isEnding,
  hasEnded,
  getActiveSubscription,
  daysUntilEnd,
  getChangeDirection,
  strategyToProrationBehavior,
  getStatusMessage,
} from "../core/domain";
import type { Subscription, SubscriptionStatus } from "../core/entities";

function createTestSubscription(overrides: Partial<Subscription> = {}): Subscription {
  const now = new Date();
  return {
    id: `test_${Math.random().toString(36).slice(2, 10)}`,
    customerId: `cust_${Math.random().toString(36).slice(2, 10)}`,
    providerSubscriptionId: `provider_sub_test`,
    providerProductId: `provider_prod_test`,
    providerPriceId: `provider_price_test`,
    status: "active" as SubscriptionStatus,
    currentPeriodStart: now,
    currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    pendingCancellation: false,
    canceledAt: null,
    endedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("BillingDomain", () => {
  describe("isActiveStatus", () => {
    it.each<[SubscriptionStatus, boolean]>([
      ["active", true],
      ["trialing", true],
      ["past_due", true],
      ["canceled", false],
      ["unpaid", false],
      ["paused", false],
      ["incomplete", false],
      ["incomplete_expired", false],
    ])("returns %s for status '%s'", (status, expected) => {
      expect(isActiveStatus(status)).toBe(expected);
    });
  });

  describe("isActive", () => {
    it("returns false for null subscription", () => {
      expect(isActive(null)).toBe(false);
    });

    it("returns true for active subscription", () => {
      const sub = createTestSubscription({ status: "active" });
      expect(isActive(sub)).toBe(true);
    });

    it("returns true for trialing subscription", () => {
      const sub = createTestSubscription({ status: "trialing" });
      expect(isActive(sub)).toBe(true);
    });

    it("returns false for canceled subscription", () => {
      const sub = createTestSubscription({ status: "canceled" });
      expect(isActive(sub)).toBe(false);
    });
  });

  describe("isEnding", () => {
    it("returns false for null subscription", () => {
      expect(isEnding(null)).toBe(false);
    });

    it("returns true for active subscription with pendingCancellation", () => {
      const sub = createTestSubscription({
        status: "active",
        pendingCancellation: true,
      });
      expect(isEnding(sub)).toBe(true);
    });

    it("returns false for active subscription without pendingCancellation", () => {
      const sub = createTestSubscription({
        status: "active",
        pendingCancellation: false,
      });
      expect(isEnding(sub)).toBe(false);
    });

    it("returns false for non-active subscription even with pendingCancellation", () => {
      const sub = createTestSubscription({
        status: "canceled",
        pendingCancellation: true,
      });
      expect(isEnding(sub)).toBe(false);
    });
  });

  describe("hasEnded", () => {
    it("returns true for null subscription", () => {
      expect(hasEnded(null)).toBe(true);
    });

    it("returns true for canceled subscription", () => {
      const sub = createTestSubscription({ status: "canceled" });
      expect(hasEnded(sub)).toBe(true);
    });

    it("returns true for unpaid subscription", () => {
      const sub = createTestSubscription({ status: "unpaid" });
      expect(hasEnded(sub)).toBe(true);
    });

    it("returns false for active subscription", () => {
      const sub = createTestSubscription({ status: "active" });
      expect(hasEnded(sub)).toBe(false);
    });

    it("returns false for trialing subscription", () => {
      const sub = createTestSubscription({ status: "trialing" });
      expect(hasEnded(sub)).toBe(false);
    });
  });

  describe("getActiveSubscription", () => {
    it("returns null for empty list", () => {
      expect(getActiveSubscription([])).toBeNull();
    });

    it("returns the single active subscription", () => {
      const sub = createTestSubscription({ status: "active" });
      expect(getActiveSubscription([sub])).toBe(sub);
    });

    it("filters out non-active subscriptions", () => {
      const canceled = createTestSubscription({ status: "canceled" });
      const active = createTestSubscription({ status: "active" });
      expect(getActiveSubscription([canceled, active])).toBe(active);
    });

    it("prefers non-canceling over canceling subscriptions", () => {
      const now = new Date();
      const canceling = createTestSubscription({
        status: "active",
        pendingCancellation: true,
        createdAt: now,
      });
      const notCanceling = createTestSubscription({
        status: "active",
        pendingCancellation: false,
        createdAt: new Date(now.getTime() - 1000), // older
      });
      const result = getActiveSubscription([canceling, notCanceling]);
      expect(result).toBe(notCanceling);
    });

    it("prefers newest subscription when cancel status is the same", () => {
      const older = createTestSubscription({
        status: "active",
        createdAt: new Date("2024-01-01"),
      });
      const newer = createTestSubscription({
        status: "active",
        createdAt: new Date("2024-06-01"),
      });
      const result = getActiveSubscription([older, newer]);
      expect(result).toBe(newer);
    });

    it("returns null when all subscriptions are inactive", () => {
      const subs = [
        createTestSubscription({ status: "canceled" }),
        createTestSubscription({ status: "unpaid" }),
      ];
      expect(getActiveSubscription(subs)).toBeNull();
    });
  });

  describe("daysUntilEnd", () => {
    it("returns null for null subscription", () => {
      expect(daysUntilEnd(null)).toBeNull();
    });

    it("returns null for subscription without currentPeriodEnd", () => {
      const sub = createTestSubscription({
        status: "active",
        pendingCancellation: true,
        currentPeriodEnd: null,
      });
      expect(daysUntilEnd(sub)).toBeNull();
    });

    it("returns null for non-ending subscription", () => {
      const sub = createTestSubscription({
        status: "active",
        pendingCancellation: false,
        currentPeriodEnd: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      });
      expect(daysUntilEnd(sub)).toBeNull();
    });

    it("returns days until end for ending subscription with future date", () => {
      const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
      const sub = createTestSubscription({
        status: "active",
        pendingCancellation: true,
        currentPeriodEnd: futureDate,
      });
      const days = daysUntilEnd(sub);
      expect(days).toBeGreaterThanOrEqual(9);
      expect(days).toBeLessThanOrEqual(11);
    });

    it("returns 0 for ending subscription with past date", () => {
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const sub = createTestSubscription({
        status: "active",
        pendingCancellation: true,
        currentPeriodEnd: pastDate,
      });
      expect(daysUntilEnd(sub)).toBe(0);
    });
  });

  describe("getChangeDirection", () => {
    it("returns 'same' for identical product IDs", () => {
      expect(getChangeDirection("prod_a", "prod_a", {})).toBe("same");
    });

    describe("with tierOrder", () => {
      const tierOrder = ["prod_free", "prod_starter", "prod_pro", "prod_enterprise"];

      it("returns 'upgrade' when new product is higher in tier order", () => {
        expect(getChangeDirection("prod_starter", "prod_pro", { tierOrder })).toBe("upgrade");
      });

      it("returns 'downgrade' when new product is lower in tier order", () => {
        expect(getChangeDirection("prod_pro", "prod_starter", { tierOrder })).toBe("downgrade");
      });

      it("falls back to price when products are not in tierOrder", () => {
        expect(
          getChangeDirection("unknown_a", "unknown_b", {
            tierOrder,
            currentPrice: 10,
            newPrice: 20,
          })
        ).toBe("upgrade");
      });
    });

    describe("with price fallback", () => {
      it("returns 'upgrade' when new price is higher", () => {
        expect(
          getChangeDirection("prod_a", "prod_b", {
            currentPrice: 10,
            newPrice: 20,
          })
        ).toBe("upgrade");
      });

      it("returns 'downgrade' when new price is lower", () => {
        expect(
          getChangeDirection("prod_a", "prod_b", {
            currentPrice: 20,
            newPrice: 10,
          })
        ).toBe("downgrade");
      });

      it("returns 'same' when prices are equal", () => {
        expect(
          getChangeDirection("prod_a", "prod_b", {
            currentPrice: 10,
            newPrice: 10,
          })
        ).toBe("same");
      });
    });

    it("returns 'upgrade' when no way to determine direction", () => {
      expect(getChangeDirection("prod_a", "prod_b", {})).toBe("upgrade");
    });
  });

  describe("strategyToProrationBehavior", () => {
    it("maps immediate_prorate to prorate", () => {
      expect(strategyToProrationBehavior("immediate_prorate")).toBe("prorate");
    });

    it("maps immediate_full to invoice", () => {
      expect(strategyToProrationBehavior("immediate_full")).toBe("invoice");
    });

    it("maps at_period_end to none", () => {
      expect(strategyToProrationBehavior("at_period_end")).toBe("none");
    });
  });

  describe("getStatusMessage", () => {
    it("returns message for null subscription", () => {
      expect(getStatusMessage(null)).toBe("No active subscription");
    });

    it("returns message for active subscription", () => {
      const sub = createTestSubscription({ status: "active", pendingCancellation: false });
      expect(getStatusMessage(sub)).toBe("Active subscription");
    });

    it("returns ending message for active subscription with pendingCancellation", () => {
      const sub = createTestSubscription({
        status: "active",
        pendingCancellation: true,
        currentPeriodEnd: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
      });
      const message = getStatusMessage(sub);
      expect(message).toMatch(/Subscription ending in \d+ days?/);
    });

    it("returns 'ending soon' when no days can be calculated", () => {
      const sub = createTestSubscription({
        status: "active",
        pendingCancellation: true,
        currentPeriodEnd: null,
      });
      expect(getStatusMessage(sub)).toBe("Subscription ending soon");
    });

    it("returns message for trialing", () => {
      const sub = createTestSubscription({ status: "trialing" });
      expect(getStatusMessage(sub)).toBe("Trial period active");
    });

    it("returns message for past_due", () => {
      const sub = createTestSubscription({ status: "past_due" });
      expect(getStatusMessage(sub)).toBe("Payment past due - please update your payment method");
    });

    it("returns message for unpaid", () => {
      const sub = createTestSubscription({ status: "unpaid" });
      expect(getStatusMessage(sub)).toBe("Payment failed - subscription suspended");
    });

    it("returns message for canceled", () => {
      const sub = createTestSubscription({ status: "canceled" });
      expect(getStatusMessage(sub)).toBe("Subscription canceled");
    });

    it("returns message for paused", () => {
      const sub = createTestSubscription({ status: "paused" });
      expect(getStatusMessage(sub)).toBe("Subscription paused");
    });

    it("returns message for incomplete", () => {
      const sub = createTestSubscription({ status: "incomplete" });
      expect(getStatusMessage(sub)).toBe("Awaiting payment confirmation");
    });

    it("returns message for incomplete_expired", () => {
      const sub = createTestSubscription({ status: "incomplete_expired" });
      expect(getStatusMessage(sub)).toBe("Payment confirmation expired");
    });
  });
});
