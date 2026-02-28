/**
 * Billing webhook service — handles webhook verification and processing.
 */

import { nanoid } from "nanoid";
import type { BillingProviders } from "../providers";
import type { BillingProviderType } from "../core/entities";
import type { BillingRepositories } from "../repositories/types";
import { BillingBadRequestError } from "../core/errors";
import type { BillingLogger } from "../core/types";
import { defaultLogger } from "../core/types";
import type { BillingSyncService } from "./sync";

export class BillingWebhookService {
  constructor(
    private adapter: BillingRepositories,
    private syncService: BillingSyncService,
    private billing: BillingProviders,
    private billingProvider: BillingProviderType,
    private logger: BillingLogger = defaultLogger
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

    const alreadyProcessed = await this.adapter.events.exists(resource.eventId);
    if (alreadyProcessed) {
      this.logger.debug("Webhook event already processed", { eventId: resource.eventId });
      return;
    }

    try {
      await this.adapter.events.create({
        id: nanoid(),
        provider: this.billingProvider,
        providerEventId: resource.eventId,
        eventType: resource.eventType,
        payload,
      });
    } catch {
      // Unique constraint violation — another request already claimed this event
      this.logger.debug("Webhook event already processed (concurrent)", {
        eventId: resource.eventId,
      });
      return;
    }

    await this.syncService.syncCustomerState(resource.customerId, this.billingProvider);

    this.logger.info("Processed webhook", {
      eventId: resource.eventId,
      eventType: resource.eventType,
      customerId: resource.customerId,
    });
  }
}
