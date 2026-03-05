/**
 * Billing webhook service — handles webhook verification and processing.
 *
 * Deduplication strategy:
 * - When a cache is provided, uses cache-based dedup (no DB writes needed).
 * - Otherwise, falls back to the billing_events table for persistence.
 */

import { BillingBadRequestError } from "../core/errors";
import { runAfterHook } from "../core/hooks";
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

    // Handle one-time purchase completion
    if (
      resource.checkoutMode === "payment" &&
      resource.checkoutSessionId &&
      this.ctx.providers.checkout.getCompletedSessionPurchases
    ) {
      await this.processPurchaseCompletion(resource.customerId, resource.checkoutSessionId);
    }

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
   * Process a completed one-time purchase checkout session.
   * Creates Purchase records from session line items and fires lifecycle hook.
   */
  private async processPurchaseCompletion(
    providerCustomerId: string,
    sessionId: string,
  ): Promise<void> {
    const items = await this.ctx.providers.checkout.getCompletedSessionPurchases!(sessionId);
    if (items.length === 0) return;

    const customer = await this.ctx.adapter.customers.findByProviderCustomerId(
      providerCustomerId,
      this.ctx.providerType,
    );
    if (!customer) {
      this.ctx.logger.warn("Cannot record purchases — customer not found locally", {
        providerCustomerId,
        sessionId,
      });
      return;
    }

    const purchases = [];
    for (const item of items) {
      const purchase = await this.ctx.adapter.purchases.create({
        id: createId(),
        customerId: customer.id,
        providerSessionId: sessionId,
        providerProductId: item.providerProductId,
        providerPriceId: item.providerPriceId,
        quantity: item.quantity,
        amount: item.amount,
        currency: item.currency,
      });
      purchases.push(purchase);
    }

    this.ctx.logger.info("Recorded purchases from checkout session", {
      customerId: customer.id,
      sessionId,
      purchaseCount: purchases.length,
    });

    // Invalidate status cache
    if (this.ctx.cache) {
      try {
        await this.ctx.cache.delete(`billing:status:${customer.userId}`);
      } catch {
        // Cache failure — not critical
      }
    }

    runAfterHook(
      this.ctx.config.hooks?.lifecycle?.onPurchaseCompleted,
      { customer, purchases },
      "lifecycle.onPurchaseCompleted",
      this.ctx.logger,
    );
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
