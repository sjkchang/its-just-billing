/**
 * Shared Stripe SDK client and helper functions.
 */

import Stripe from "stripe";
import type { SubscriptionStatus } from "../../core/entities";
import type { BillingSubscription } from "../types";
import type { BillingLogger } from "../../core/types";
import { defaultLogger } from "../../core/types";

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
): "day" | "week" | "month" | "year" | "one_time" {
  if (interval === "day") return "day";
  if (interval === "week") return "week";
  if (interval === "month") return "month";
  if (interval === "year") return "year";
  return "one_time";
}

export function mapStripeSubscription(
  sub: Stripe.Subscription,
  pendingProductId?: string | null,
): BillingSubscription {
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
    pendingProductId: pendingProductId ?? null,
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
    const defaultPrice = product.default_price;
    if (typeof defaultPrice !== "string" && defaultPrice.recurring) {
      return defaultPrice.id;
    }
    if (typeof defaultPrice === "string") {
      // Need to fetch the price to verify it's recurring
      const price = await stripe.prices.retrieve(defaultPrice);
      if (price.recurring) {
        return price.id;
      }
    }
    // default_price is not recurring — fall through to search
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

/**
 * Resolve a productId + interval to a recurring priceId.
 * Fetches all active recurring prices for the product and matches by interval.
 */
/**
 * Resolve a productId to a one-time priceId.
 * Uses the product's default_price if it's one-time, or falls back to the first active one-time price.
 */
export async function resolveOneTimePriceId(stripe: Stripe, productId: string): Promise<string> {
  const product = await stripe.products.retrieve(productId);

  if (product.default_price) {
    const defaultPrice = product.default_price;
    if (typeof defaultPrice !== "string" && !defaultPrice.recurring) {
      return defaultPrice.id;
    }
    if (typeof defaultPrice === "string") {
      const price = await stripe.prices.retrieve(defaultPrice);
      if (!price.recurring) {
        return price.id;
      }
    }
  }

  const prices = await stripe.prices.list({
    product: productId,
    active: true,
    type: "one_time",
    limit: 1,
  });

  if (prices.data.length === 0) {
    throw new Error(`No active one-time price found for product ${productId}`);
  }

  return prices.data[0].id;
}

export async function resolveRecurringPriceByInterval(
  stripe: Stripe,
  productId: string,
  interval: "day" | "week" | "month" | "year"
): Promise<string> {
  const prices = await stripe.prices.list({
    product: productId,
    active: true,
    type: "recurring",
    limit: 100,
  });

  const match = prices.data.find((p) => p.recurring?.interval === interval);
  if (!match) {
    throw new Error(
      `No active recurring price found for product ${productId} with interval "${interval}"`
    );
  }

  return match.id;
}
