/**
 * Mock provider — shared contract test suite.
 */

import { describe } from "vitest";
import { createMockProviders } from "../../providers/mock/index";
import type { ProviderFactory, ProviderTestContext } from "./harness";
import { testLogger, TEST_PRODUCTS } from "./harness";
import { defineProductTests } from "./define-product-tests";
import { defineCustomerTests } from "./define-customer-tests";
import { defineCheckoutTests } from "./define-checkout-tests";
import { defineSubscriptionTests } from "./define-subscription-tests";
import { defineWebhookTests } from "./define-webhook-tests";

let seedCounter = 0;

const mockFactory: ProviderFactory = async () => {
  const providers = createMockProviders(testLogger, TEST_PRODUCTS);

  const ctx: ProviderTestContext = {
    providers,
    productIds: ["test_prod_a", "test_prod_b"],
    sampleRelevantEvent: "subscription.created",
    capabilities: {
      checkoutCreatesSubscription: true,
      eventualConsistencyOnSearch: false,
    },
    cleanup: async () => {},
    trackCustomer: () => {},
    trackSubscription: () => {},
    seedSubscription: async (productId: string) => {
      const email = `seed+${Date.now()}_${++seedCounter}@example.com`;
      const externalId = `ext_seed_${Date.now()}_${seedCounter}`;
      const customer = await providers.customers.createCustomer(email, externalId);

      // Mock checkout auto-creates a subscription
      await providers.checkout.createCheckoutSession({
        customerId: customer.id,
        productId,
        successUrl: "https://example.com/success",
      });

      const state = await providers.customers.getCustomerState(customer.id);
      const sub = state!.subscriptions[0];

      return { customerId: customer.id, subscriptionId: sub.id };
    },
  };

  return ctx;
};

describe("Mock Provider", () => {
  defineProductTests(mockFactory);
  defineCustomerTests(mockFactory);
  defineCheckoutTests(mockFactory);
  defineSubscriptionTests(mockFactory);
  defineWebhookTests(mockFactory);
});
