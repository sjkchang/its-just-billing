/**
 * Billing provider interfaces and shared types.
 *
 * These interfaces define a provider-agnostic billing surface. Each provider
 * (Stripe, mock, etc.) implements the interfaces and maps the generic
 * concepts (e.g. ChangeStrategy) to its own API.
 */

import type { SubscriptionStatus } from "../core/entities";
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

export interface ChangeSubscriptionOptions {
  productId: string;
  direction: "upgrade" | "downgrade" | "sidegrade";
  strategy: SubscriptionChangeStrategy;
}

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
