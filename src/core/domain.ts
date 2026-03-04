/**
 * Billing domain — pure business logic for subscriptions + entitlement resolution.
 */

import type { Subscription, SubscriptionStatus } from "./entities";

// ============================================================================
// Subscription Status Logic
// ============================================================================

/**
 * Statuses that count as "active" (user has access to paid features).
 */
const ACTIVE_STATUSES: SubscriptionStatus[] = ["active", "trialing", "past_due"];

/**
 * Statuses that indicate the subscription is ending.
 */
const ENDING_STATUSES: SubscriptionStatus[] = ["canceled", "unpaid"];

// ============================================================================
// Domain Functions
// ============================================================================

/**
 * Check if a subscription status grants active access.
 */
export function isActiveStatus(status: SubscriptionStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

/**
 * Check if a subscription is currently active.
 */
export function isActive(subscription: Subscription | null): boolean {
  if (!subscription) return false;
  return isActiveStatus(subscription.status);
}

/**
 * Check if a subscription is ending (canceled but still accessible).
 */
export function isEnding(subscription: Subscription | null): boolean {
  if (!subscription) return false;
  return subscription.pendingCancellation && isActive(subscription);
}

/**
 * Check if a subscription has ended (no access).
 */
export function hasEnded(subscription: Subscription | null): boolean {
  if (!subscription) return true;
  return ENDING_STATUSES.includes(subscription.status);
}

/**
 * Get the best active subscription.
 * Prefers non-canceling over cancel-at-period-end, then newest first.
 */
export function getActiveSubscription(subscriptions: Subscription[]): Subscription | null {
  const active = subscriptions
    .filter((sub) => isActive(sub))
    .sort((a, b) => {
      // Non-canceling subscriptions first
      if (a.pendingCancellation !== b.pendingCancellation) {
        return a.pendingCancellation ? 1 : -1;
      }
      // Then newest first, with ID as tiebreaker for determinism
      const byDate = b.createdAt.getTime() - a.createdAt.getTime();
      return byDate !== 0 ? byDate : a.id.localeCompare(b.id);
    });
  return active[0] ?? null;
}

/**
 * Calculate days until subscription ends.
 * Returns null if no end date or subscription is not ending.
 */
export function daysUntilEnd(subscription: Subscription | null): number | null {
  if (!subscription?.currentPeriodEnd) return null;
  if (!isEnding(subscription)) return null;

  const now = new Date();
  const end = new Date(subscription.currentPeriodEnd);
  const diffMs = end.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

/**
 * Determine the direction of a plan change.
 * Uses tierOrder index if available, falls back to price comparison.
 * Returns "sidegrade" when products differ but have equal tier/price.
 */
export function getChangeDirection(
  currentProductId: string,
  newProductId: string,
  options: {
    tierOrder?: string[];
    currentPrice?: number;
    newPrice?: number;
  }
): "upgrade" | "downgrade" | "sidegrade" {
  if (currentProductId === newProductId) return "sidegrade";

  if (options.tierOrder && options.tierOrder.length > 0) {
    const currentIndex = options.tierOrder.indexOf(currentProductId);
    const newIndex = options.tierOrder.indexOf(newProductId);
    // Both must be in tierOrder for index comparison
    if (currentIndex !== -1 && newIndex !== -1) {
      if (newIndex > currentIndex) return "upgrade";
      if (newIndex < currentIndex) return "downgrade";
      return "sidegrade";
    }
  }

  // Fall back to price comparison
  if (options.currentPrice !== undefined && options.newPrice !== undefined) {
    if (options.newPrice > options.currentPrice) return "upgrade";
    if (options.newPrice < options.currentPrice) return "downgrade";
    return "sidegrade";
  }

  // No way to determine — treat as upgrade (allow change, provider handles billing)
  return "upgrade";
}

/**
 * Get a human-readable subscription status message.
 */
export function getStatusMessage(subscription: Subscription | null): string {
  if (!subscription) return "No active subscription";

  switch (subscription.status) {
    case "active":
      if (subscription.pendingCancellation) {
        const days = daysUntilEnd(subscription);
        if (days === null) return "Subscription ending soon";
        if (days === 0) return "Subscription ending today";
        return `Subscription ending in ${days} day${days === 1 ? "" : "s"}`;
      }
      return "Active subscription";
    case "trialing":
      return "Trial period active";
    case "past_due":
      return "Payment past due - please update your payment method";
    case "unpaid":
      return "Payment failed - subscription suspended";
    case "canceled":
      return "Subscription canceled";
    case "paused":
      return "Subscription paused";
    case "incomplete":
      return "Awaiting payment confirmation";
    case "incomplete_expired":
      return "Payment confirmation expired";
    case "provider_missing":
      return "Subscription not found in billing provider";
    default:
      return "Unknown status";
  }
}

// ============================================================================
// Price Helpers
// ============================================================================

/**
 * Get the lowest monthly-equivalent price from a product's price list.
 * Normalizes day/week/year intervals to monthly for comparison.
 * Skips one_time prices since they aren't comparable to recurring.
 */
export function getLowestMonthlyPrice(product: {
  prices: { amount: number; interval: string }[];
}): number {
  let lowest = Infinity;
  for (const price of product.prices) {
    let monthly: number;
    switch (price.interval) {
      case "day":
        monthly = price.amount * 30;
        break;
      case "week":
        monthly = price.amount * 4;
        break;
      case "year":
        monthly = price.amount / 12;
        break;
      case "month":
        monthly = price.amount;
        break;
      default:
        // Skip one_time or unknown intervals
        continue;
    }
    if (monthly < lowest) lowest = monthly;
  }
  return lowest === Infinity ? 0 : lowest;
}

// ============================================================================
// Entitlement Resolver
// ============================================================================

export type Entitlement = string;
export type EntitlementSet = ReadonlySet<Entitlement>;

export interface EntitlementConfig {
  /** Map product ID → entitlements granted. */
  products?: Record<string, Entitlement[]>;
  /** Fallback entitlements for unmapped paid products. */
  defaultPaid?: Entitlement[];
  /** Entitlements for users with no active subscription. */
  defaultFree?: Entitlement[];
}

const DEFAULT_PAID: Entitlement[] = ["plan:paid"];
const DEFAULT_FREE: Entitlement[] = ["plan:free"];

export class EntitlementResolver {
  private productMap: Record<string, Entitlement[]>;
  private defaultPaid: Entitlement[];
  private defaultFree: Entitlement[];

  constructor(config?: EntitlementConfig) {
    this.productMap = config?.products ?? {};
    this.defaultPaid = config?.defaultPaid ?? DEFAULT_PAID;
    this.defaultFree = config?.defaultFree ?? DEFAULT_FREE;
  }

  /**
   * Resolve entitlements from a list of active product IDs.
   * Returns the union of all entitlements from all active products.
   */
  resolve(activeProductIds: string[]): EntitlementSet {
    if (activeProductIds.length === 0) {
      return new Set(this.defaultFree);
    }

    const entitlements = new Set<Entitlement>();

    for (const productId of activeProductIds) {
      const mapped = this.productMap[productId];
      if (mapped) {
        for (const e of mapped) entitlements.add(e);
      } else {
        for (const e of this.defaultPaid) entitlements.add(e);
      }
    }

    return entitlements;
  }

  static has(set: EntitlementSet, entitlement: Entitlement): boolean {
    return set.has(entitlement);
  }

  static hasAll(set: EntitlementSet, required: Entitlement[]): boolean {
    return required.every((e) => set.has(e));
  }

  static hasAny(set: EntitlementSet, required: Entitlement[]): boolean {
    return required.some((e) => set.has(e));
  }
}
