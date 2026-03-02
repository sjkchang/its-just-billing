/**
 * Stripe checkout provider.
 */

import type Stripe from "stripe";
import type { BillingLogger } from "../../core/types";
import { defaultLogger } from "../../core/types";
import { resolveRecurringPriceId } from "./shared";
import type {
  BillingCheckoutProvider,
  CheckoutOptions,
  CheckoutSession,
  PortalSession,
} from "../types";

export class StripeCheckoutProvider implements BillingCheckoutProvider {
  private logger: BillingLogger;

  constructor(
    private stripe: Stripe,
    logger?: BillingLogger
  ) {
    this.logger = logger ?? defaultLogger;
  }

  async createCheckoutSession(options: CheckoutOptions): Promise<CheckoutSession> {
    try {
      const priceId = await resolveRecurringPriceId(this.stripe, options.productId);

      const session = await this.stripe.checkout.sessions.create({
        customer: options.customerId,
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: options.successUrl,
        cancel_url: options.cancelUrl,
        metadata: options.metadata,
        ...(options.trialDays && {
          subscription_data: {
            trial_period_days: options.trialDays,
          },
        }),
      });

      if (!session.url) {
        throw new Error("Stripe checkout session did not return a URL");
      }

      return {
        checkoutUrl: session.url,
        sessionId: session.id,
      };
    } catch (error) {
      this.logger.error("Failed to create checkout session", {
        customerId: options.customerId,
        productId: options.productId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async createPortalSession(customerId: string, returnUrl: string): Promise<PortalSession> {
    try {
      const session = await this.stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      });

      return {
        portalUrl: session.url,
      };
    } catch (error) {
      this.logger.error("Failed to create portal session", {
        customerId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
