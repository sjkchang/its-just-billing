/**
 * Billing webhook service — handles webhook verification and processing.
 *
 * Deduplication strategy:
 * - When a cache is provided, uses cache-based dedup (no DB writes needed).
 * - Otherwise, falls back to the billing_events table for persistence.
 */

import { nanoid } from "nanoid";
import type { BillingProviders } from "../providers";
import type { BillingProviderType } from "../core/entities";
import type { BillingRepositories } from "../repositories/types";
import { BillingBadRequestError } from "../core/errors";
import type { BillingLogger, KeyValueCache } from "../core/types";
import { defaultLogger } from "../core/types";
import type { BillingSyncService } from "./sync";

/** Cache TTL for webhook dedup keys (24 hours). */
const WEBHOOK_DEDUP_TTL_SECONDS = 86_400;

export class BillingWebhookService {
  constructor(
    private adapter: BillingRepositories,
    private syncService: BillingSyncService,
    private billing: BillingProviders,
    private billingProvider: BillingProviderType,
    private logger: BillingLogger = defaultLogger,
    private cache?: KeyValueCache
  ) {}

  /**
   * Handle webhook from billing provider.
   * Verifies signature, extracts resource ID, and syncs state.
   */
  async handleWebhook(payload: string, headers: Record<string, string>): Promise<void> {
    if (!this.billing.webhooks.verifySignature(payload, headers)) {
      throw new BillingBadRequestError("Invalid webhook signature");
    }

    const resource = this.billing.webhooks.extractResource(payload, headers);

    if (!resource) {
      this.logger.debug("Skipping webhook — irrelevant or unrecognized event");
      return;
    }

    if (!this.billing.webhooks.isRelevantEvent(resource.eventType)) {
      this.logger.debug("Ignoring webhook event type", { eventType: resource.eventType });
      return;
    }

    const claimed = this.cache
      ? await this.claimViaCache(resource.eventId)
      : await this.claimViaDb(resource.eventId, resource.eventType);

    if (!claimed) return;

    await this.syncService.syncCustomerState(resource.customerId, this.billingProvider);

    this.logger.info("Processed webhook", {
      eventId: resource.eventId,
      eventType: resource.eventType,
      customerId: resource.customerId,
    });
  }

  /**
   * Attempt to claim an event via cache (set-if-absent pattern).
   * Returns true if this process should handle the event.
   */
  private async claimViaCache(eventId: string): Promise<boolean> {
    const key = `billing:webhook:dedup:${eventId}`;
    try {
      const existing = await this.cache!.get(key);
      if (existing) {
        this.logger.debug("Webhook event already processed (cache)", { eventId });
        return false;
      }
      await this.cache!.set(key, "1", WEBHOOK_DEDUP_TTL_SECONDS);
      return true;
    } catch {
      // Cache failure — allow processing to avoid dropping events
      this.logger.warn("Webhook dedup cache error, proceeding with event", { eventId });
      return true;
    }
  }

  /**
   * Attempt to claim an event via the billing_events DB table.
   * Falls back to unique constraint for concurrency safety.
   */
  private async claimViaDb(eventId: string, eventType: string): Promise<boolean> {
    const alreadyProcessed = await this.adapter.events.exists(eventId);
    if (alreadyProcessed) {
      this.logger.debug("Webhook event already processed", { eventId });
      return false;
    }

    try {
      await this.adapter.events.create({
        id: nanoid(),
        provider: this.billingProvider,
        providerEventId: eventId,
        eventType,
        payload: null,
      });
      return true;
    } catch {
      // Unique constraint violation — another request already claimed this event
      this.logger.debug("Webhook event already processed (concurrent)", { eventId });
      return false;
    }
  }
}
