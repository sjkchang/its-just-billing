/**
 * Shared Stripe SDK client and helper functions.
 */

import Stripe from "stripe";
import type { SubscriptionStatus } from "../../entities";
import type { BillingSubscription, ProrationBehavior } from "../types";
import type { BillingLogger } from "../../types";
import { defaultLogger } from "../../types";

export function createStripeClient(secretKey: string, logger?: BillingLogger): Stripe {
  const log = logger ?? defaultLogger;
  const stripe = new Stripe(secretKey);
  log.info("Stripe SDK client initialized");
  return stripe;
}

export function mapSubscriptionStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  const statusMap: Record<string, SubscriptionStatus> = {
    active: "active",
    trialing: "trialing",
    incomplete: "incomplete",
    incomplete_expired: "incomplete_expired",
    past_due: "past_due",
    unpaid: "unpaid",
    canceled: "canceled",
    paused: "paused",
  };
  const mapped = statusMap[status];
  if (!mapped) {
    throw new Error(`Unknown subscription status from Stripe: "${status}"`);
  }
  return mapped;
}

export function mapPriceInterval(
  interval: string | null | undefined
): "month" | "year" | "one_time" {
  if (interval === "month") return "month";
  if (interval === "year") return "year";
  return "one_time";
}

export function mapProrationBehavior(
  behavior?: ProrationBehavior
): Stripe.SubscriptionUpdateParams.ProrationBehavior | undefined {
  if (!behavior) return undefined;
  if (behavior === "prorate") return "create_prorations";
  if (behavior === "invoice") return "always_invoice";
  if (behavior === "none") return "none";
  return undefined;
}

export function mapStripeSubscription(sub: Stripe.Subscription): BillingSubscription {
  const item = sub.items.data[0];
  return {
    id: sub.id,
    customerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    productId:
      typeof item?.price.product === "string"
        ? item.price.product
        : (item?.price.product?.id ?? ""),
    priceId: item?.price.id ?? null,
    status: mapSubscriptionStatus(sub.status),
    currentPeriodStart: item ? new Date(item.current_period_start * 1000) : null,
    currentPeriodEnd: item ? new Date(item.current_period_end * 1000) : null,
    pendingCancellation: sub.cancel_at !== null,
    canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
    endedAt: sub.ended_at ? new Date(sub.ended_at * 1000) : null,
  };
}

/**
 * Resolve a productId to a recurring priceId.
 * Uses the product's default_price, or falls back to the first active recurring price.
 */
export async function resolveRecurringPriceId(stripe: Stripe, productId: string): Promise<string> {
  const product = await stripe.products.retrieve(productId);

  if (product.default_price) {
    const defaultPriceId =
      typeof product.default_price === "string" ? product.default_price : product.default_price.id;
    return defaultPriceId;
  }

  const prices = await stripe.prices.list({
    product: productId,
    active: true,
    type: "recurring",
    limit: 1,
  });

  if (prices.data.length === 0) {
    throw new Error(`No active recurring price found for product ${productId}`);
  }

  return prices.data[0].id;
}
