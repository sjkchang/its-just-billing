/**
 * Billing provider interfaces and shared types.
 *
 * These interfaces define a provider-agnostic billing surface. Each provider
 * (Stripe, mock, etc.) implements the interfaces and maps the generic
 * concepts (e.g. ChangeStrategy) to its own API.
 */

import type { SubscriptionStatus, BillingProviderType } from "../core/entities";
import type { ProductConfig } from "../core/config";

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

/**
 * High-level strategy for subscription plan changes.
 * Each provider maps these to its own API (e.g. Stripe prorations / schedules).
 */
export type SubscriptionChangeStrategy = "immediate_prorate" | "immediate_full" | "at_period_end";

/** Whether a cancellation takes effect immediately or at the end of the billing period. */
export type CancellationTiming = "immediate" | "at_period_end";

export interface ChangeSubscriptionOptions {
  productId: string;
  direction: "upgrade" | "downgrade" | "sidegrade";
  strategy: SubscriptionChangeStrategy;
  interval?: "day" | "week" | "month" | "year";
}

// ============================================================================
// Strategy Handlers
// ============================================================================

/** Handler for a single subscription-change strategy. */
export type ChangeStrategyHandler = (
  subscriptionId: string,
  productId: string,
  interval?: "day" | "week" | "month" | "year"
) => Promise<BillingSubscription>;

/** Handler for a single cancellation timing. */
export type CancelStrategyHandler = (
  subscriptionId: string
) => Promise<BillingSubscription>;

// ============================================================================
// Sub-Provider Interfaces
// ============================================================================

export interface BillingProductProvider {
  listProducts(): Promise<BillingProduct[]>;
  getProduct(productId: string): Promise<BillingProduct | null>;
  /** Sync managed product definitions to the provider. Not all providers support this. */
  syncProducts?(products: ProductConfig[]): Promise<void>;
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
}

export interface BillingSubscriptionProvider {
  changeHandlers: Partial<Record<SubscriptionChangeStrategy, ChangeStrategyHandler>>;
  cancelHandlers: Partial<Record<CancellationTiming, CancelStrategyHandler>>;
  uncancel(subscriptionId: string): Promise<BillingSubscription>;
}

export interface BillingWebhookProvider {
  /** Verify the webhook signature. Returns the verified payload for use with extractResource, or null if invalid. */
  verifySignature(payload: string, headers: Record<string, string>): unknown | null;
  /** Extract the resource from a verified payload returned by verifySignature. */
  extractResource(verifiedPayload: unknown): WebhookResource | null;
  isRelevantEvent(eventType: string): boolean;
}

// ============================================================================
// Composite Interface
// ============================================================================

export interface BillingProviders {
  products: BillingProductProvider;
  checkout: BillingCheckoutProvider;
  customers: BillingCustomerProvider;
  subscriptions: BillingSubscriptionProvider;
  webhooks: BillingWebhookProvider;
}

// ============================================================================
// Config
// ============================================================================

export type { BillingProviderType };

export type BillingProviderConfig =
  | { provider: "stripe"; secretKey: string; webhookSecret?: string }
  | { provider: "mock" };
