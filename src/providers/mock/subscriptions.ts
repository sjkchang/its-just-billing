/**
 * Mock subscription mutation provider — in-memory for development.
 */

import type { BillingLogger } from "../../core/types";
import { defaultLogger } from "../../core/types";
import type { MockState } from "./shared";
import type {
  BillingSubscriptionProvider,
  BillingSubscription,
  ChangeStrategyHandler,
  CancelStrategyHandler,
  SubscriptionChangeStrategy,
  CancellationTiming,
} from "../types";

export class MockSubscriptionProvider implements BillingSubscriptionProvider {
  readonly changeHandlers: Partial<Record<SubscriptionChangeStrategy, ChangeStrategyHandler>>;
  readonly cancelHandlers: Partial<Record<CancellationTiming, CancelStrategyHandler>>;

  private logger: BillingLogger;

  constructor(
    private state: MockState,
    logger?: BillingLogger
  ) {
    this.logger = logger ?? defaultLogger;

    this.changeHandlers = {
      immediate_prorate: (subId, prodId, interval) => this.change(subId, prodId, interval),
      immediate_full: (subId, prodId, interval) => this.change(subId, prodId, interval),
      at_period_end: (subId, prodId, interval) => this.change(subId, prodId, interval),
    };

    this.cancelHandlers = {
      immediate: (subId) => this.cancel(subId, false),
      at_period_end: (subId) => this.cancel(subId, true),
    };
  }

  async uncancel(subscriptionId: string): Promise<BillingSubscription> {
    const subscription = this.state.subscriptions.get(subscriptionId);
    if (!subscription) {
      throw new Error(`Subscription not found: ${subscriptionId}`);
    }
    const updated: BillingSubscription = {
      ...subscription,
      pendingCancellation: false,
      canceledAt: null,
    };
    this.state.subscriptions.set(subscriptionId, updated);
    this.logger.debug("[Mock Billing] Uncanceled subscription", { subscriptionId });
    return updated;
  }

  private async change(
    subscriptionId: string,
    productId: string,
    interval?: "day" | "week" | "month" | "year"
  ): Promise<BillingSubscription> {
    const subscription = this.state.subscriptions.get(subscriptionId);
    if (!subscription) {
      throw new Error(`Subscription not found: ${subscriptionId}`);
    }
    const updated: BillingSubscription = {
      ...subscription,
      productId,
      priceId: interval
        ? `${productId}_price_${interval}`
        : subscription.priceId,
      pendingCancellation: false,
      canceledAt: null,
    };
    this.state.subscriptions.set(subscriptionId, updated);
    this.logger.debug("[Mock Billing] Updated subscription", {
      subscriptionId,
      newProductId: productId,
      interval,
    });
    return updated;
  }

  private async cancel(
    subscriptionId: string,
    atPeriodEnd: boolean
  ): Promise<BillingSubscription> {
    const subscription = this.state.subscriptions.get(subscriptionId);
    if (!subscription) {
      throw new Error(`Subscription not found: ${subscriptionId}`);
    }
    const updated: BillingSubscription = {
      ...subscription,
      pendingCancellation: atPeriodEnd,
      canceledAt: new Date(),
      status: atPeriodEnd ? subscription.status : "canceled",
    };
    this.state.subscriptions.set(subscriptionId, updated);
    this.logger.debug("[Mock Billing] Canceled subscription", {
      subscriptionId,
      atPeriodEnd,
    });
    return updated;
  }
}
