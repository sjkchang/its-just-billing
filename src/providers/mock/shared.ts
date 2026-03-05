/**
 * Mock billing shared state.
 *
 * Holds in-memory Maps shared across all mock sub-providers,
 * so checkout can create subscriptions that customer queries can find.
 */

import type { BillingCustomer, BillingSubscription, CompletedPurchaseItem } from "../types";

export interface MockPurchaseSession {
  sessionId: string;
  customerId: string;
  items: CompletedPurchaseItem[];
}

export class MockState {
  readonly customers = new Map<string, BillingCustomer>();
  readonly subscriptions = new Map<string, BillingSubscription>();
  readonly purchaseSessions = new Map<string, MockPurchaseSession>();
  customerIdCounter = 0;
  subscriptionIdCounter = 0;
  purchaseSessionIdCounter = 0;
}
