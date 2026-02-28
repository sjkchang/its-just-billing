/**
 * Billing provider interface and factory.
 *
 * Re-exports sub-provider interfaces from types.ts and provides
 * the factory function for creating billing providers.
 */

export type {
  BillingCustomer,
  BillingSubscription,
  CustomerState,
  BillingProduct,
  BillingPrice,
  CheckoutSession,
  PortalSession,
  CheckoutOptions,
  WebhookResource,
  ProrationBehavior,
  ChangeSubscriptionOptions,
  BillingProductProvider,
  BillingCheckoutProvider,
  BillingCustomerProvider,
  BillingWebhookProvider,
  BillingProviders,
  BillingProviderType,
  BillingProviderConfig,
} from "./types";

import type { BillingProviderConfig, BillingProviders } from "./types";
import type { BillingLogger } from "../core/types";
import { defaultLogger } from "../core/types";

export async function createBillingProviders(
  config: BillingProviderConfig,
  logger: BillingLogger = defaultLogger
): Promise<BillingProviders> {
  switch (config.provider) {
    case "stripe": {
      const { createStripeProviders } = await import("./stripe");
      return createStripeProviders({
        secretKey: config.secretKey,
        webhookSecret: config.webhookSecret,
        logger,
      });
    }
    case "mock":
    default: {
      const { createMockProviders } = await import("./mock");
      return createMockProviders(logger);
    }
  }
}
