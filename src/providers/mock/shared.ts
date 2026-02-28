/**
 * Mock billing shared state.
 *
 * Holds in-memory Maps shared across all mock sub-providers,
 * so checkout can create subscriptions that customer queries can find.
 */

import type { BillingCustomer, BillingSubscription } from "../types";

export class MockState {
  readonly customers = new Map<string, BillingCustomer>();
  readonly subscriptions = new Map<string, BillingSubscription>();
  customerIdCounter = 0;
  subscriptionIdCounter = 0;
}
