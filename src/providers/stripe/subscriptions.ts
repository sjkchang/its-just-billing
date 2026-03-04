/**
 * Stripe subscription mutation provider.
 *
 * Each change/cancel strategy is registered as a handler in a map,
 * so the service layer can dispatch by strategy key without if/else.
 */

import type Stripe from "stripe";
import type { BillingLogger } from "../../core/types";
import { defaultLogger } from "../../core/types";
import { mapStripeSubscription, resolveRecurringPriceId, resolveRecurringPriceByInterval } from "./shared";
import type {
  BillingSubscriptionProvider,
  BillingSubscription,
  ChangeStrategyHandler,
  CancelStrategyHandler,
  SubscriptionChangeStrategy,
  CancellationTiming,
} from "../types";

export class StripeSubscriptionProvider implements BillingSubscriptionProvider {
  readonly changeHandlers: Partial<Record<SubscriptionChangeStrategy, ChangeStrategyHandler>>;
  readonly cancelHandlers: Partial<Record<CancellationTiming, CancelStrategyHandler>>;

  private logger: BillingLogger;

  constructor(
    private stripe: Stripe,
    logger?: BillingLogger
  ) {
    this.logger = logger ?? defaultLogger;

    this.changeHandlers = {
      immediate_prorate: (subId, prodId, interval) =>
        this.immediateChange(subId, prodId, "create_prorations", interval),
      immediate_full: (subId, prodId, interval) =>
        this.immediateChange(subId, prodId, "always_invoice", interval),
      at_period_end: (subId, prodId, interval) =>
        this.scheduledChange(subId, prodId, interval),
    };

    this.cancelHandlers = {
      immediate: (subId) => this.cancelImmediate(subId),
      at_period_end: (subId) => this.cancelAtPeriodEnd(subId),
    };
  }

  async uncancel(subscriptionId: string): Promise<BillingSubscription> {
    try {
      const sub = await this.stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: false,
      });

      this.logger.info("Uncanceled subscription", { subscriptionId });

      return mapStripeSubscription(sub, null);
    } catch (error) {
      this.logger.error("Failed to uncancel subscription", {
        subscriptionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Change strategies
  // ---------------------------------------------------------------------------

  private async immediateChange(
    subscriptionId: string,
    productId: string,
    prorationBehavior: Stripe.SubscriptionUpdateParams.ProrationBehavior,
    interval?: "day" | "week" | "month" | "year"
  ): Promise<BillingSubscription> {
    try {
      const existing = await this.stripe.subscriptions.retrieve(subscriptionId);
      const itemId = existing.items.data[0]?.id;
      if (!itemId) {
        throw new Error(`Subscription ${subscriptionId} has no items`);
      }

      // Release any existing schedule before immediate update (e.g. upgrade after pending downgrade)
      if (existing.schedule) {
        const scheduleId =
          typeof existing.schedule === "string" ? existing.schedule : existing.schedule.id;
        await this.stripe.subscriptionSchedules.release(scheduleId);
        this.logger.info("Released existing schedule before immediate update", {
          subscriptionId,
          scheduleId,
        });
      }

      const priceId = interval
        ? await resolveRecurringPriceByInterval(this.stripe, productId, interval)
        : await resolveRecurringPriceId(this.stripe, productId);

      const sub = await this.stripe.subscriptions.update(subscriptionId, {
        items: [{ id: itemId, price: priceId }],
        proration_behavior: prorationBehavior,
      });

      this.logger.info("Updated subscription (immediate)", {
        subscriptionId,
        newProductId: productId,
        prorationBehavior,
      });

      return mapStripeSubscription(sub);
    } catch (error) {
      this.logger.error("Failed to update subscription", {
        subscriptionId,
        productId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Schedule a subscription change at the end of the current billing period.
   * Creates a Stripe subscription schedule with two phases: the current plan
   * until period end, then the new plan going forward.
   */
  private async scheduledChange(
    subscriptionId: string,
    newProductId: string,
    interval?: "day" | "week" | "month" | "year"
  ): Promise<BillingSubscription> {
    const existing = await this.stripe.subscriptions.retrieve(subscriptionId);

    // If there's already a schedule, release it first (handles "change your mind" scenario)
    if (existing.schedule) {
      const scheduleId =
        typeof existing.schedule === "string" ? existing.schedule : existing.schedule.id;
      await this.stripe.subscriptionSchedules.release(scheduleId);
      this.logger.info("Released existing schedule before creating new one", {
        subscriptionId,
        scheduleId,
      });
    }

    // Convert subscription to a schedule (auto-creates one phase matching current state)
    const schedule = await this.stripe.subscriptionSchedules.create({
      from_subscription: subscriptionId,
    });

    // Resolve the new price
    const newPriceId = interval
      ? await resolveRecurringPriceByInterval(this.stripe, newProductId, interval)
      : await resolveRecurringPriceId(this.stripe, newProductId);

    // Get current phase details
    const currentPhase = schedule.phases[0];
    if (!currentPhase) {
      throw new Error(`Schedule ${schedule.id} has no phases`);
    }

    // Update the schedule to add a second phase starting at period end
    await this.stripe.subscriptionSchedules.update(schedule.id, {
      phases: [
        // Keep current phase as-is
        {
          items: currentPhase.items.map((item) => ({
            price: typeof item.price === "string" ? item.price : item.price.id,
            quantity: item.quantity ?? undefined,
          })),
          start_date: currentPhase.start_date,
          end_date: currentPhase.end_date,
        },
        // New phase at period end
        {
          items: [{ price: newPriceId }],
        },
      ],
    });

    this.logger.info("Scheduled subscription change at period end", {
      subscriptionId,
      scheduleId: schedule.id,
      newProductId,
      transitionDate: new Date((currentPhase.end_date ?? 0) * 1000).toISOString(),
    });

    // Return current subscription state with pending product info
    return mapStripeSubscription(existing, newProductId);
  }

  // ---------------------------------------------------------------------------
  // Cancel strategies
  // ---------------------------------------------------------------------------

  private async releaseScheduleIfExists(subscriptionId: string): Promise<void> {
    const existing = await this.stripe.subscriptions.retrieve(subscriptionId);
    if (existing.schedule) {
      const scheduleId =
        typeof existing.schedule === "string" ? existing.schedule : existing.schedule.id;
      await this.stripe.subscriptionSchedules.release(scheduleId);
      this.logger.info("Released existing schedule before cancellation", {
        subscriptionId,
        scheduleId,
      });
    }
  }

  private async cancelImmediate(subscriptionId: string): Promise<BillingSubscription> {
    try {
      await this.releaseScheduleIfExists(subscriptionId);
      const sub = await this.stripe.subscriptions.cancel(subscriptionId);
      return mapStripeSubscription(sub);
    } catch (error) {
      this.logger.error("Failed to cancel subscription immediately", {
        subscriptionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async cancelAtPeriodEnd(subscriptionId: string): Promise<BillingSubscription> {
    try {
      await this.releaseScheduleIfExists(subscriptionId);
      const sub = await this.stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true,
      });
      return mapStripeSubscription(sub);
    } catch (error) {
      this.logger.error("Failed to cancel subscription at period end", {
        subscriptionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async cancelScheduledChange(subscriptionId: string): Promise<BillingSubscription> {
    try {
      const existing = await this.stripe.subscriptions.retrieve(subscriptionId);

      if (!existing.schedule) {
        // No schedule to cancel — return current state
        return mapStripeSubscription(existing, null);
      }

      const scheduleId =
        typeof existing.schedule === "string" ? existing.schedule : existing.schedule.id;
      await this.stripe.subscriptionSchedules.release(scheduleId);

      this.logger.info("Released subscription schedule (canceled pending plan change)", {
        subscriptionId,
        scheduleId,
      });

      // Re-fetch to get clean state after schedule release
      const updated = await this.stripe.subscriptions.retrieve(subscriptionId);
      return mapStripeSubscription(updated, null);
    } catch (error) {
      this.logger.error("Failed to cancel scheduled plan change", {
        subscriptionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
