/**
 * Billing provider interfaces and shared types.
 *
 * These interfaces are modeled on Stripe's billing API surface. The mock
 * provider implements them for testing (instant checkout, in-memory state)
 * but doesn't simulate Stripe-specific behaviors like schedules or prorations.
 *
 * If you add a non-Stripe provider, expect to reshape these interfaces —
 * fields like scheduleAtPeriodEnd and prorationBehavior are Stripe concepts.
 */

import type { SubscriptionStatus } from "../core/entities";

// ============================================================================
// Shared Types
// ============================================================================

export interface BillingCustomer {
  id: string;
  email: string;
  name?: string | null;
  externalId?: string | null;
  metadata?: Record<string, string>;
}

export interface BillingSubscription {
  id: string;
  customerId: string;
  productId: string;
  priceId?: string | null;
  status: SubscriptionStatus;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  pendingCancellation: boolean;
  canceledAt?: Date | null;
  endedAt?: Date | null;
}

export interface CustomerState {
  customer: BillingCustomer;
  subscriptions: BillingSubscription[];
}

export interface BillingProduct {
  id: string;
  name: string;
  description?: string | null;
  prices: BillingPrice[];
  metadata?: Record<string, string>;
}

export interface BillingPrice {
  id: string;
  productId: string;
  amount: number;
  currency: string;
  interval: "day" | "week" | "month" | "year" | "one_time";
}

export interface CheckoutSession {
  checkoutUrl: string;
  sessionId?: string;
}

export interface PortalSession {
  portalUrl: string;
}

export interface CheckoutOptions {
  customerId: string;
  productId: string;
  successUrl: string;
  cancelUrl?: string;
  metadata?: Record<string, string>;
  trialDays?: number;
}

export interface WebhookResource {
  eventId: string;
  eventType: string;
  resourceType: "subscription" | "customer" | "order";
  customerId: string;
}

export type ProrationBehavior = "prorate" | "invoice" | "none";

export interface ChangeSubscriptionOptions {
  productId: string;
  /** Stripe-specific: how to handle mid-cycle billing adjustments. */
  prorationBehavior?: ProrationBehavior;
  /** Stripe-specific: defer the change to the next billing period via a subscription schedule. */
  scheduleAtPeriodEnd?: boolean;
}

// ============================================================================
// Sub-Provider Interfaces
// ============================================================================

export interface BillingProductProvider {
  listProducts(): Promise<BillingProduct[]>;
  getProduct(productId: string): Promise<BillingProduct | null>;
}

export interface BillingCheckoutProvider {
  createCheckoutSession(options: CheckoutOptions): Promise<CheckoutSession>;
  createPortalSession(customerId: string, returnUrl: string): Promise<PortalSession>;
}

export interface BillingCustomerProvider {
  createCustomer(email: string, externalId: string, name?: string): Promise<BillingCustomer>;
  getCustomer(customerId: string): Promise<BillingCustomer | null>;
  getCustomerByExternalId(externalId: string): Promise<BillingCustomer | null>;
  getCustomerState(customerId: string): Promise<CustomerState | null>;
  getSubscription(subscriptionId: string): Promise<BillingSubscription | null>;
  cancelSubscription(
    subscriptionId: string,
    cancelAtPeriodEnd?: boolean
  ): Promise<BillingSubscription>;
  uncancelSubscription(subscriptionId: string): Promise<BillingSubscription>;
  changeSubscription(
    subscriptionId: string,
    options: ChangeSubscriptionOptions
  ): Promise<BillingSubscription>;
}

export interface BillingWebhookProvider {
  verifySignature(payload: string, headers: Record<string, string>): boolean;
  extractResource(payload: string, headers: Record<string, string>): WebhookResource | null;
  isRelevantEvent(eventType: string): boolean;
}

// ============================================================================
// Composite Interface
// ============================================================================

export interface BillingProviders {
  products: BillingProductProvider;
  checkout: BillingCheckoutProvider;
  customers: BillingCustomerProvider;
  webhooks: BillingWebhookProvider;
}

// ============================================================================
// Config
// ============================================================================

export type BillingProviderType = "stripe" | "mock";

export type BillingProviderConfig =
  | { provider: "stripe"; secretKey: string; webhookSecret?: string }
  | { provider: "mock" };
