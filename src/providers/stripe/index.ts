/**
 * Stripe billing provider factory.
 */

export { StripeProductProvider } from "./products";
export { StripeCheckoutProvider } from "./checkout";
export { StripeCustomerProvider } from "./customers";
export { StripeWebhookProvider } from "./webhooks";
export {
  createStripeClient,
  mapStripeSubscription,
  mapSubscriptionStatus,
  mapPriceInterval,
  resolveRecurringPriceId,
} from "./shared";

import { createStripeClient } from "./shared";
import { StripeProductProvider } from "./products";
import { StripeCheckoutProvider } from "./checkout";
import { StripeCustomerProvider } from "./customers";
import { StripeWebhookProvider } from "./webhooks";
import type { BillingProviders } from "../types";
import type { BillingLogger } from "../../core/types";
import { defaultLogger } from "../../core/types";

export function createStripeProviders(config: {
  secretKey: string;
  webhookSecret?: string;
  logger?: BillingLogger;
}): BillingProviders {
  const logger = config.logger ?? defaultLogger;
  const stripe = createStripeClient(config.secretKey, logger);

  logger.info("Stripe billing providers initialized");

  return {
    products: new StripeProductProvider(stripe, logger),
    checkout: new StripeCheckoutProvider(stripe, logger),
    customers: new StripeCustomerProvider(stripe, logger),
    webhooks: new StripeWebhookProvider(stripe, config.webhookSecret, logger),
  };
}
