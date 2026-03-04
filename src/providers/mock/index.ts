/**
 * Mock billing provider factory.
 */

export { MockProductProvider } from "./products";
export { MockCheckoutProvider } from "./checkout";
export { MockCustomerProvider } from "./customers";
export { MockSubscriptionProvider } from "./subscriptions";
export { MockWebhookProvider } from "./webhooks";

import { MockState } from "./shared";
import { MockProductProvider } from "./products";
import { MockCheckoutProvider } from "./checkout";
import { MockCustomerProvider } from "./customers";
import { MockSubscriptionProvider } from "./subscriptions";
import { MockWebhookProvider } from "./webhooks";
import type { BillingProviders } from "../types";
import type { ProductEntry } from "../../core/config";
import type { BillingLogger } from "../../core/types";
import { defaultLogger } from "../../core/types";

export function createMockProviders(logger?: BillingLogger, products?: ProductEntry[]): BillingProviders {
  const log = logger ?? defaultLogger;
  const state = new MockState();

  log.info("Mock billing providers initialized");

  return {
    products: new MockProductProvider(log, products),
    checkout: new MockCheckoutProvider(state, log),
    customers: new MockCustomerProvider(state, log),
    subscriptions: new MockSubscriptionProvider(state, log),
    webhooks: new MockWebhookProvider(log),
  };
}
