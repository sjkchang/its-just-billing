/**
 * Stripe webhook provider.
 */

import type Stripe from "stripe";
import type { BillingLogger } from "../../types";
import { defaultLogger } from "../../types";
import type { BillingWebhookProvider, WebhookResource } from "../types";

const RELEVANT_EVENTS = new Set([
  // Checkout
  "checkout.session.completed",
  // Subscription lifecycle
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "customer.subscription.pending_update_applied",
  "customer.subscription.pending_update_expired",
  "customer.subscription.trial_will_end",
  // Invoice
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_action_required",
  "invoice.payment_succeeded",
  "invoice.upcoming",
  "invoice.marked_uncollectible",
  // Payment intent
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "payment_intent.canceled",
  // Subscription schedules
  "subscription_schedule.completed",
  "subscription_schedule.canceled",
  "subscription_schedule.released",
]);

export class StripeWebhookProvider implements BillingWebhookProvider {
  private logger: BillingLogger;

  constructor(
    private stripe: Stripe,
    private webhookSecret?: string,
    logger?: BillingLogger
  ) {
    this.logger = logger ?? defaultLogger;
  }

  verifySignature(payload: string, headers: Record<string, string>): boolean {
    if (!this.webhookSecret) {
      this.logger.error("Webhook secret not configured, rejecting webhook");
      return false;
    }

    const signature = headers["stripe-signature"];
    if (!signature) {
      this.logger.warn("Missing stripe-signature header");
      return false;
    }

    try {
      this.stripe.webhooks.constructEvent(payload, signature, this.webhookSecret);
      return true;
    } catch (error) {
      this.logger.warn("Webhook signature verification failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  extractResource(payload: string, headers: Record<string, string>): WebhookResource | null {
    try {
      let event: Stripe.Event;

      if (this.webhookSecret) {
        const signature = headers["stripe-signature"] ?? "";
        event = this.stripe.webhooks.constructEvent(payload, signature, this.webhookSecret);
      } else {
        event = JSON.parse(payload) as Stripe.Event;
      }

      const eventType = event.type;
      const eventId = event.id;

      if (!RELEVANT_EVENTS.has(eventType)) {
        return null;
      }

      const data = event.data.object as unknown as Record<string, unknown>;

      let resourceType: "subscription" | "customer" | "order" = "subscription";
      if (
        eventType.startsWith("customer.subscription.") ||
        eventType.startsWith("subscription_schedule.")
      ) {
        resourceType = "subscription";
      } else if (
        eventType.startsWith("customer.") &&
        !eventType.startsWith("customer.subscription.")
      ) {
        resourceType = "customer";
      } else if (
        eventType.startsWith("invoice.") ||
        eventType.startsWith("payment_intent.") ||
        eventType.startsWith("checkout.session.")
      ) {
        resourceType = "order";
      }

      // All Stripe event objects carry a `customer` field except
      // top-level customer events where the object itself IS the customer.
      let customerId: string;
      if (resourceType === "customer") {
        customerId = (data.id as string) ?? "";
      } else {
        customerId = (data.customer as string) ?? "";
      }

      if (!customerId) {
        this.logger.warn("Webhook payload missing customer ID", { eventType, resourceType });
        return null;
      }

      return {
        eventId,
        eventType,
        resourceType,
        customerId,
      };
    } catch (error) {
      this.logger.error("Failed to parse webhook payload", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  isRelevantEvent(eventType: string): boolean {
    return RELEVANT_EVENTS.has(eventType);
  }
}
