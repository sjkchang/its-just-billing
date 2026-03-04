/**
 * Billing webhook service — handles webhook verification and processing.
 *
 * Deduplication strategy:
 * - When a cache is provided, uses cache-based dedup (no DB writes needed).
 * - Otherwise, falls back to the billing_events table for persistence.
 */

import { BillingBadRequestError } from "../core/errors";
import type { BillingContext } from "../core/types";
import { createId } from "../core/types";
import type { BillingSyncService } from "./sync";

/** Cache TTL for webhook dedup keys (24 hours). */
const WEBHOOK_DEDUP_TTL_SECONDS = 86_400;

export class BillingWebhookService {
  constructor(
    private ctx: BillingContext,
    private syncService: BillingSyncService,
  ) {}

  /**
   * Handle webhook from billing provider.
   * Verifies signature, extracts resource ID, and syncs state.
   */
  async handleWebhook(payload: string, headers: Record<string, string>): Promise<void> {
    const verified = this.ctx.providers.webhooks.verifySignature(payload, headers);
    if (!verified) {
      throw new BillingBadRequestError("Invalid webhook signature");
    }

    const resource = this.ctx.providers.webhooks.extractResource(verified);

    if (!resource) {
      this.ctx.logger.debug("Skipping webhook — irrelevant or unrecognized event");
      return;
    }

    if (!this.ctx.providers.webhooks.isRelevantEvent(resource.eventType)) {
      this.ctx.logger.debug("Ignoring webhook event type", { eventType: resource.eventType });
      return;
    }

    const claimed = this.ctx.cache
      ? await this.claimViaCache(resource.eventId)
      : await this.claimViaDb(resource.eventId, resource.eventType);

    if (!claimed) return;

    await this.syncService.syncCustomerState(resource.customerId, this.ctx.providerType);

    this.ctx.logger.info("Processed webhook", {
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
      // Prefer atomic setIfAbsent to avoid TOCTOU race between concurrent webhooks
      if (this.ctx.cache!.setIfAbsent) {
        const claimed = await this.ctx.cache!.setIfAbsent(key, "1", WEBHOOK_DEDUP_TTL_SECONDS);
        if (!claimed) {
          this.ctx.logger.debug("Webhook event already processed (cache)", { eventId });
        }
        return claimed;
      }

      // Fallback: non-atomic get-then-set — may cause a duplicate run under concurrency
      const existing = await this.ctx.cache!.get(key);
      if (existing) {
        this.ctx.logger.debug("Webhook event already processed (cache)", { eventId });
        return false;
      }
      await this.ctx.cache!.set(key, "1", WEBHOOK_DEDUP_TTL_SECONDS);
      return true;
    } catch {
      // Cache failure — allow processing to avoid dropping events
      this.ctx.logger.warn("Webhook dedup cache error, proceeding with event", { eventId });
      return true;
    }
  }

  /**
   * Attempt to claim an event via the billing_events DB table.
   * Falls back to unique constraint for concurrency safety.
   */
  private async claimViaDb(eventId: string, eventType: string): Promise<boolean> {
    const alreadyProcessed = await this.ctx.adapter.events.exists(eventId);
    if (alreadyProcessed) {
      this.ctx.logger.debug("Webhook event already processed", { eventId });
      return false;
    }

    try {
      await this.ctx.adapter.events.create({
        id: createId(),
        provider: this.ctx.providerType,
        providerEventId: eventId,
        eventType,
        payload: null,
      });
      return true;
    } catch {
      // Unique constraint violation — another request already claimed this event
      this.ctx.logger.debug("Webhook event already processed (concurrent)", { eventId });
      return false;
    }
  }
}
