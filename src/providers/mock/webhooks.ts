/**
 * Mock webhook provider — always-accept stub for development.
 */

import type { BillingLogger } from "../../core/types";
import { defaultLogger } from "../../core/types";
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

  verifySignature(payload: string, _headers: Record<string, string>): unknown | null {
    this.logger.debug("[Mock Billing] Verify webhook signature (always true in mock mode)");
    try {
      return JSON.parse(payload);
    } catch {
      return null;
    }
  }

  extractResource(verifiedPayload: unknown): WebhookResource | null {
    try {
      const event = verifiedPayload as Record<string, Record<string, string>>;
      this.logger.debug("[Mock Billing] Extract webhook resource", { eventType: event.type });
      const data = event.data ?? {};
      return {
        eventId: (event.id as unknown as string) || `mock_evt_${Date.now()}`,
        eventType: (event.type as unknown as string) || "unknown",
        resourceType: "subscription",
        customerId: data.customer_id || data.customerId || "",
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
