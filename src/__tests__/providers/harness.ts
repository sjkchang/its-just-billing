/**
 * Shared provider test harness — types, test logger, and test products.
 *
 * Each provider test file supplies a factory that returns a ProviderTestContext.
 * Shared define*Tests functions accept the factory and run describe/it blocks.
 */

import type { BillingProviders } from "../../providers/types";
import type { BillingLogger } from "../../core/types";
import type { ProductEntry } from "../../core/config";

// ============================================================================
// Capability Flags
// ============================================================================

export interface ProviderCapabilities {
  /** Whether createCheckoutSession immediately creates a subscription (mock does, Stripe doesn't). */
  checkoutCreatesSubscription: boolean;
  /** Whether search-by-externalId is eventually consistent (Stripe search can lag). */
  eventualConsistencyOnSearch: boolean;
}

// ============================================================================
// Test Context
// ============================================================================

export interface ProviderTestContext {
  providers: BillingProviders;
  /** At least 2 product IDs available for change/sidegrade tests. */
  productIds: [string, string];
  /** A sample event type that isRelevantEvent should return true for. */
  sampleRelevantEvent: string;
  /** Cleanup resources created during the test. */
  cleanup: () => Promise<void>;
  /** Track a customer ID for cleanup. */
  trackCustomer: (id: string) => void;
  /** Track a subscription ID for cleanup. */
  trackSubscription: (id: string) => void;
  /**
   * Seed a subscription for the given product.
   * Abstracts away provider differences (mock uses checkout, Stripe uses direct API).
   */
  seedSubscription: (productId: string) => Promise<{
    customerId: string;
    subscriptionId: string;
  }>;
  capabilities: ProviderCapabilities;
}

export type ProviderFactory = () => Promise<ProviderTestContext>;

// ============================================================================
// Test Logger (silent)
// ============================================================================

export const testLogger: BillingLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

// ============================================================================
// Test Products
// ============================================================================

export const TEST_PRODUCTS: ProductEntry[] = [
  {
    id: "test_prod_a",
    name: "Test Product A",
    prices: [{ amount: 1000, currency: "usd", interval: "month" as const }],
  },
  {
    id: "test_prod_b",
    name: "Test Product B",
    prices: [{ amount: 2000, currency: "usd", interval: "month" as const }],
  },
];
