/**
 * Stripe customer provider.
 */

import type Stripe from "stripe";
import type { BillingLogger } from "../../core/types";
import { defaultLogger } from "../../core/types";
import { mapStripeSubscription, mapProrationBehavior, resolveRecurringPriceId } from "./shared";
import type {
  BillingCustomerProvider,
  BillingCustomer,
  BillingSubscription,
  CustomerState,
  ChangeSubscriptionOptions,
} from "../types";

function mapStripeCustomer(customer: Stripe.Customer): BillingCustomer {
  return {
    id: customer.id,
    email: customer.email ?? "",
    name: customer.name ?? null,
    externalId: (customer.metadata?.externalId as string) ?? null,
    metadata: customer.metadata as Record<string, string> | undefined,
  };
}

export class StripeCustomerProvider implements BillingCustomerProvider {
  private logger: BillingLogger;

  constructor(
    private stripe: Stripe,
    logger?: BillingLogger
  ) {
    this.logger = logger ?? defaultLogger;
  }

  async createCustomer(email: string, externalId: string, name?: string): Promise<BillingCustomer> {
    try {
      const existing = await this.getCustomerByExternalId(externalId);
      if (existing) {
        this.logger.info("Customer already exists, returning existing", { externalId });
        return existing;
      }

      const customer = await this.stripe.customers.create({
        email,
        name: name ?? undefined,
        metadata: { externalId },
      });

      this.logger.info("Created Stripe customer", { customerId: customer.id, externalId });

      return mapStripeCustomer(customer);
    } catch (error) {
      this.logger.error("Failed to create Stripe customer", {
        email,
        externalId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async getCustomer(customerId: string): Promise<BillingCustomer | null> {
    try {
      const customer = await this.stripe.customers.retrieve(customerId);
      if (customer.deleted) return null;
      return mapStripeCustomer(customer as Stripe.Customer);
    } catch (error) {
      this.logger.debug("Customer not found", { customerId });
      return null;
    }
  }

  async getCustomerByExternalId(externalId: string): Promise<BillingCustomer | null> {
    try {
      const sanitized = externalId.replace(/[\\"]/g, "\\$&");
      const result = await this.stripe.customers.search({
        query: `metadata["externalId"]:"${sanitized}"`,
        limit: 1,
      });

      if (result.data.length === 0) return null;
      return mapStripeCustomer(result.data[0]);
    } catch (error) {
      this.logger.debug("Customer not found by external ID", { externalId });
      return null;
    }
  }

  async getCustomerState(customerId: string): Promise<CustomerState | null> {
    try {
      const customer = await this.stripe.customers.retrieve(customerId);
      if (customer.deleted) return null;

      const relevantStatuses = new Set(["active", "trialing", "past_due", "incomplete", "unpaid", "canceled", "paused"]);
      const relevantSubs: Stripe.Subscription[] = [];

      // Use auto-pagination to fetch all subscriptions, not just the first page
      for await (const sub of this.stripe.subscriptions.list({
        customer: customerId,
        status: "all",
      })) {
        if (relevantStatuses.has(sub.status)) {
          relevantSubs.push(sub);
        }
      }

      return {
        customer: mapStripeCustomer(customer as Stripe.Customer),
        subscriptions: relevantSubs.map(mapStripeSubscription),
      };
    } catch (error) {
      this.logger.error("Failed to fetch customer state", {
        customerId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async getSubscription(subscriptionId: string): Promise<BillingSubscription | null> {
    try {
      const sub = await this.stripe.subscriptions.retrieve(subscriptionId);
      return mapStripeSubscription(sub);
    } catch (error) {
      this.logger.debug("Subscription not found", { subscriptionId });
      return null;
    }
  }

  async cancelSubscription(
    subscriptionId: string,
    cancelAtPeriodEnd = true
  ): Promise<BillingSubscription> {
    try {
      const sub = cancelAtPeriodEnd
        ? await this.stripe.subscriptions.update(subscriptionId, {
            cancel_at_period_end: true,
          })
        : await this.stripe.subscriptions.cancel(subscriptionId);

      return mapStripeSubscription(sub);
    } catch (error) {
      this.logger.error("Failed to cancel subscription", {
        subscriptionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async uncancelSubscription(subscriptionId: string): Promise<BillingSubscription> {
    try {
      const sub = await this.stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: false,
      });

      this.logger.info("Uncanceled subscription", { subscriptionId });

      return mapStripeSubscription(sub);
    } catch (error) {
      this.logger.error("Failed to uncancel subscription", {
        subscriptionId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async changeSubscription(
    subscriptionId: string,
    options: ChangeSubscriptionOptions
  ): Promise<BillingSubscription> {
    try {
      if (options.scheduleAtPeriodEnd) {
        return await this.scheduleChangeAtPeriodEnd(subscriptionId, options.productId);
      }

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

      const priceId = await resolveRecurringPriceId(this.stripe, options.productId);

      const sub = await this.stripe.subscriptions.update(subscriptionId, {
        items: [{ id: itemId, price: priceId }],
        proration_behavior: mapProrationBehavior(options.prorationBehavior),
      });

      this.logger.info("Updated subscription", {
        subscriptionId,
        newProductId: options.productId,
        prorationBehavior: options.prorationBehavior,
      });

      return mapStripeSubscription(sub);
    } catch (error) {
      this.logger.error("Failed to update subscription", {
        subscriptionId,
        options,
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
  private async scheduleChangeAtPeriodEnd(
    subscriptionId: string,
    newProductId: string
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
    const newPriceId = await resolveRecurringPriceId(this.stripe, newProductId);

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

    // Return current subscription state (still on old product)
    return mapStripeSubscription(existing);
  }
}
