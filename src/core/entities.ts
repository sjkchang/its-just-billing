/**
 * Billing entities — Zod schemas for customer, subscription, and event.
 */

import { z } from "zod";

// ============================================================================
// Customer
// ============================================================================

export const BillingProviderType = z.enum(["stripe", "mock"]);
export type BillingProviderType = z.infer<typeof BillingProviderType>;

export const Customer = z.object({
  id: z.string(),
  userId: z.string(),
  provider: BillingProviderType,
  providerCustomerId: z.string(),
  email: z.string().email(),
  name: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Customer = z.infer<typeof Customer>;

// ============================================================================
// Subscription
// ============================================================================

/**
 * Subscription status values.
 * Aligned with Polar/Stripe subscription lifecycle.
 */
export const SubscriptionStatus = z.enum([
  "trialing",
  "active",
  "incomplete",
  "incomplete_expired",
  "past_due",
  "unpaid",
  "canceled",
  "paused",
  "provider_missing",
]);

export type SubscriptionStatus = z.infer<typeof SubscriptionStatus>;

export const Subscription = z.object({
  id: z.string(),
  customerId: z.string(),
  providerSubscriptionId: z.string(),
  providerProductId: z.string(),
  providerPriceId: z.string().nullable(),
  status: SubscriptionStatus,
  currentPeriodStart: z.date().nullable(),
  currentPeriodEnd: z.date().nullable(),
  pendingCancellation: z.boolean(),
  pendingProductId: z.string().nullable(),
  canceledAt: z.date().nullable(),
  endedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Subscription = z.infer<typeof Subscription>;

// ============================================================================
// Billing Event
// ============================================================================

export const BillingEvent = z.object({
  id: z.string(),
  provider: BillingProviderType,
  providerEventId: z.string(),
  eventType: z.string(),
  processedAt: z.date(),
  payload: z.string().nullable(),
});

export type BillingEvent = z.infer<typeof BillingEvent>;

// ============================================================================
// Purchase (one-time)
// ============================================================================

export const Purchase = z.object({
  id: z.string(),
  customerId: z.string(),
  providerSessionId: z.string(),
  providerProductId: z.string(),
  providerPriceId: z.string().nullable(),
  quantity: z.number().int().positive(),
  amount: z.number().int().nonnegative(),
  currency: z.string(),
  purchasedAt: z.date(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Purchase = z.infer<typeof Purchase>;

// ============================================================================
// Cart
// ============================================================================

export const CartItem = z.object({
  id: z.string(),
  userId: z.string(),
  productId: z.string(),
  quantity: z.number().int().positive(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type CartItem = z.infer<typeof CartItem>;

export const Cart = z.object({
  userId: z.string(),
  items: z.array(CartItem),
});

export type Cart = z.infer<typeof Cart>;
