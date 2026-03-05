/**
 * Stripe checkout provider.
 */

import type Stripe from "stripe";
import type { BillingLogger } from "../../core/types";
import { defaultLogger } from "../../core/types";
import { resolveRecurringPriceId, resolveOneTimePriceId } from "./shared";
import type {
  BillingCheckoutProvider,
  CheckoutOptions,
  CheckoutSession,
  CompletedPurchaseItem,
  PortalSession,
  PurchaseCheckoutOptions,
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

  async createPurchaseCheckoutSession(options: PurchaseCheckoutOptions): Promise<CheckoutSession> {
    try {
      const lineItems = await Promise.all(
        options.items.map(async (item) => {
          const priceId = await resolveOneTimePriceId(this.stripe, item.productId);
          return { price: priceId, quantity: item.quantity ?? 1 };
        })
      );

      const session = await this.stripe.checkout.sessions.create({
        customer: options.customerId,
        mode: "payment",
        line_items: lineItems,
        success_url: options.successUrl,
        cancel_url: options.cancelUrl,
        metadata: options.metadata,
      });

      if (!session.url) {
        throw new Error("Stripe checkout session did not return a URL");
      }

      return {
        checkoutUrl: session.url,
        sessionId: session.id,
      };
    } catch (error) {
      this.logger.error("Failed to create purchase checkout session", {
        customerId: options.customerId,
        itemCount: options.items.length,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async getCompletedSessionPurchases(sessionId: string): Promise<CompletedPurchaseItem[]> {
    const lineItems = await this.stripe.checkout.sessions.listLineItems(sessionId, {
      limit: 100,
    });

    return lineItems.data.map((item) => ({
      providerProductId:
        typeof item.price?.product === "string"
          ? item.price.product
          : item.price?.product?.id ?? "",
      providerPriceId: item.price?.id ?? null,
      quantity: item.quantity ?? 1,
      amount: item.amount_total ?? 0,
      currency: item.currency ?? "usd",
    }));
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
