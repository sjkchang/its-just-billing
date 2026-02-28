/**
 * Mock webhook provider — always-accept stub for development.
 */

import type { BillingLogger } from "../../types";
import { defaultLogger } from "../../types";
import type { BillingWebhookProvider, WebhookResource } from "../types";

const RELEVANT_EVENTS = new Set([
  "subscription.created",
  "subscription.updated",
  "subscription.canceled",
  "customer.updated",
]);

export class MockWebhookProvider implements BillingWebhookProvider {
  private logger: BillingLogger;

  constructor(logger?: BillingLogger) {
    this.logger = logger ?? defaultLogger;
  }

  verifySignature(_payload: string, _headers: Record<string, string>): boolean {
    this.logger.debug("[Mock Billing] Verify webhook signature (always true in mock mode)");
    return true;
  }

  extractResource(payload: string, _headers: Record<string, string>): WebhookResource | null {
    try {
      const event = JSON.parse(payload);
      this.logger.debug("[Mock Billing] Extract webhook resource", { eventType: event.type });
      return {
        eventId: event.id || `mock_evt_${Date.now()}`,
        eventType: event.type || "unknown",
        resourceType: "subscription",
        customerId: event.data?.customer_id || event.data?.customerId || "",
      };
    } catch {
      this.logger.debug("[Mock Billing] Failed to parse webhook payload");
      return null;
    }
  }

  isRelevantEvent(eventType: string): boolean {
    return RELEVANT_EVENTS.has(eventType);
  }
}
