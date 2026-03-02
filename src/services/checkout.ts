/**
 * Billing checkout service — handles checkout, portal, and subscription management.
 */

import { nanoid } from "nanoid";
import type { BillingProviders, BillingSubscription } from "../providers";
import type { BillingProviderType } from "../core/entities";
import {
  isActive,
  getActiveSubscription,
  getChangeDirection,
} from "../core/domain";
import type { BillingRepositories } from "../repositories/types";
import type { BillingAppConfig } from "../core/config";
import { runBeforeHook, runAfterHook } from "../core/hooks";
import type { BillingUser } from "../core/hooks";
import { BillingBadRequestError, BillingNotFoundError } from "../core/errors";
import type { BillingLogger, KeyValueCache } from "../core/types";
import { defaultLogger } from "../core/types";

export interface CheckoutInput {
  productId: string;
  successUrl: string;
  cancelUrl?: string;
}

export interface CheckoutResult {
  checkoutUrl: string;
}

export interface PortalResult {
  portalUrl: string;
}

export interface ChangeSubscriptionInput {
  subscriptionId: string;
  productId: string;
  interval?: "day" | "week" | "month" | "year";
}

export class BillingCheckoutService {
  constructor(
    private adapter: BillingRepositories,
    private billing: BillingProviders,
    private billingProvider: BillingProviderType,
    private config: BillingAppConfig,
    private logger: BillingLogger = defaultLogger,
    private cache?: KeyValueCache
  ) {}

  /**
   * Invalidate cached billing status for a user. Failures are logged and swallowed.
   */
  private async invalidateStatusCache(userId: string): Promise<void> {
    if (!this.cache) return;
    try {
      await this.cache.delete(`billing:status:${userId}`);
    } catch (err) {
      this.logger.warn("Failed to invalidate status cache", {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Get or create a billing customer for the user.
   * Checks local DB first, then creates in provider + local if needed.
   */
  private async getOrCreateCustomer(user: BillingUser) {
    const provider = this.billingProvider;
    const existing = await this.adapter.customers.findByUserId(user.id, provider);
    if (existing) return existing;

    const providerCustomer = await this.billing.customers.createCustomer(
      user.email,
      user.id,
      user.name ?? undefined
    );

    try {
      const customer = await this.adapter.customers.create({
        id: nanoid(),
        userId: user.id,
        provider,
        providerCustomerId: providerCustomer.id,
        email: user.email,
        name: user.name,
      });

      this.logger.info("Created billing customer", {
        userId: user.id,
        customerId: customer.id,
        providerCustomerId: providerCustomer.id,
      });

      runAfterHook(
        this.config.hooks?.lifecycle?.onCustomerCreated,
        { user, customer },
        "lifecycle.onCustomerCreated",
        this.logger
      );

      return customer;
    } catch (err) {
      // Race condition: another request created the customer concurrently
      const created = await this.adapter.customers.findByUserId(user.id, provider);
      if (created) return created;
      this.logger.error("Failed to create billing customer", {
        userId: user.id,
        providerCustomerId: providerCustomer.id,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Create a checkout session for a user.
   * Creates a billing customer if one doesn't exist.
   */
  async createCheckout(user: BillingUser, input: CheckoutInput): Promise<CheckoutResult> {
    const hooks = this.config.hooks;

    const product = await this.billing.products.getProduct(input.productId);
    if (!product) {
      throw new BillingBadRequestError("Invalid product ID");
    }

    const hookCtx = { user, productId: input.productId };
    await runBeforeHook(hooks?.api?.checkout?.before, hookCtx, "checkout.before", this.logger);

    if (this.config.subscriptions.singleSubscription) {
      const existing = await this.adapter.customers.findByUserId(user.id, this.billingProvider);
      if (existing) {
        const subs = await this.adapter.subscriptions.findByCustomerId(existing.id);
        if (getActiveSubscription(subs)) {
          throw new BillingBadRequestError("You already have an active subscription");
        }
      }
    }

    const customer = await this.getOrCreateCustomer(user);

    const session = await this.billing.checkout.createCheckoutSession({
      customerId: customer.providerCustomerId,
      productId: input.productId,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      trialDays: this.config.subscriptions.trialDays,
    });

    this.logger.info("Created checkout session", {
      userId: user.id,
      productId: input.productId,
    });

    await this.invalidateStatusCache(user.id);

    runAfterHook(hooks?.api?.checkout?.after, hookCtx, "checkout.after", this.logger);

    return {
      checkoutUrl: session.checkoutUrl,
    };
  }

  /**
   * Create a portal session for managing billing.
   * Creates a billing customer if one doesn't exist.
   */
  async createPortal(user: BillingUser, returnUrl: string): Promise<PortalResult> {
    const customer = await this.getOrCreateCustomer(user);

    const session = await this.billing.checkout.createPortalSession(
      customer.providerCustomerId,
      returnUrl
    );

    return {
      portalUrl: session.portalUrl,
    };
  }

  /**
   * Apply a provider mutation response directly to the local DB.
   */
  private async applyMutationResult(
    subscriptionId: string,
    result: BillingSubscription
  ): Promise<void> {
    await this.adapter.subscriptions.update(subscriptionId, {
      status: result.status,
      providerProductId: result.productId,
      providerPriceId: result.priceId,
      currentPeriodStart: result.currentPeriodStart,
      currentPeriodEnd: result.currentPeriodEnd,
      pendingCancellation: result.pendingCancellation,
      canceledAt: result.canceledAt,
      endedAt: result.endedAt,
    });
  }

  /**
   * Cancel a user's subscription.
   * Uses config to determine cancel-at-period-end vs immediate.
   */
  async cancelSubscription(user: BillingUser, subscriptionId: string): Promise<void> {
    const hooks = this.config.hooks;

    const customer = await this.adapter.customers.findByUserId(user.id, this.billingProvider);

    if (!customer) {
      throw new BillingNotFoundError("No billing account found");
    }

    const subscription = await this.adapter.subscriptions.findById(subscriptionId);

    if (!subscription || subscription.customerId !== customer.id) {
      throw new BillingNotFoundError("Subscription not found");
    }

    if (!isActive(subscription)) {
      throw new BillingBadRequestError("Subscription is not active");
    }

    const cancelHookCtx = { user, customer, subscription };
    await runBeforeHook(hooks?.api?.cancel?.before, cancelHookCtx, "cancel.before", this.logger);

    const { timing } = this.config.subscriptions.cancellation;
    const cancelAtPeriodEnd = timing === "at_period_end";

    const result = await this.billing.customers.cancelSubscription(
      subscription.providerSubscriptionId,
      cancelAtPeriodEnd
    );

    await this.applyMutationResult(subscriptionId, result);

    this.logger.info("Canceled subscription", {
      userId: user.id,
      subscriptionId,
      timing,
    });

    await this.invalidateStatusCache(user.id);

    runAfterHook(hooks?.api?.cancel?.after, cancelHookCtx, "cancel.after", this.logger);
  }

  /**
   * Uncancel a subscription that's scheduled for cancellation.
   * Guarded by config's allowUncancel setting.
   */
  async uncancelSubscription(user: BillingUser, subscriptionId: string): Promise<void> {
    if (!this.config.subscriptions.cancellation.allowUncancel) {
      throw new BillingBadRequestError("Resuming canceled subscriptions is not allowed");
    }

    const customer = await this.adapter.customers.findByUserId(user.id, this.billingProvider);

    if (!customer) {
      throw new BillingNotFoundError("No billing account found");
    }

    const subscription = await this.adapter.subscriptions.findById(subscriptionId);

    if (!subscription || subscription.customerId !== customer.id) {
      throw new BillingNotFoundError("Subscription not found");
    }

    if (!subscription.pendingCancellation) {
      throw new BillingBadRequestError("Subscription is not scheduled for cancellation");
    }

    const result = await this.billing.customers.uncancelSubscription(
      subscription.providerSubscriptionId
    );

    await this.applyMutationResult(subscriptionId, result);

    this.logger.info("Uncanceled subscription", {
      userId: user.id,
      subscriptionId,
    });

    await this.invalidateStatusCache(user.id);
  }

  /**
   * Change a user's subscription to a different product.
   */
  async changeSubscription(user: BillingUser, input: ChangeSubscriptionInput): Promise<void> {
    const subsConfig = this.config.subscriptions;
    const hooks = this.config.hooks;

    // 1. Validate product exists
    const newProduct = await this.billing.products.getProduct(input.productId);
    if (!newProduct) {
      throw new BillingBadRequestError("Invalid product ID");
    }

    // 2. Load subscription + ownership check
    const customer = await this.adapter.customers.findByUserId(user.id, this.billingProvider);

    if (!customer) {
      throw new BillingNotFoundError("No billing account found");
    }

    const subscription = await this.adapter.subscriptions.findById(input.subscriptionId);

    if (!subscription || subscription.customerId !== customer.id) {
      throw new BillingNotFoundError("Subscription not found");
    }

    if (!isActive(subscription)) {
      throw new BillingBadRequestError("Subscription is not active");
    }

    // 3. Determine direction
    let direction: "upgrade" | "downgrade" | "sidegrade";

    if (subscription.providerProductId === input.productId) {
      // Same product — only valid if changing interval
      if (!input.interval) {
        throw new BillingBadRequestError("Already subscribed to this product");
      }

      // Check if interval actually differs from current subscription's price
      const currentProduct = await this.billing.products.getProduct(subscription.providerProductId);
      if (currentProduct && subscription.providerPriceId) {
        const currentPriceObj = currentProduct.prices.find(
          (p) => p.id === subscription.providerPriceId
        );
        if (currentPriceObj && currentPriceObj.interval === input.interval) {
          throw new BillingBadRequestError("Already subscribed at this interval");
        }
      }

      direction = "sidegrade";
    } else {
      // Different product — use existing tier/price direction logic
      const currentProduct = await this.billing.products.getProduct(
        subscription.providerProductId
      );
      const currentPrice = currentProduct
        ? this.getLowestMonthlyPrice(currentProduct)
        : undefined;
      const newPrice = this.getLowestMonthlyPrice(newProduct);

      direction = getChangeDirection(subscription.providerProductId, input.productId, {
        tierOrder: subsConfig.tierOrder,
        currentPrice,
        newPrice,
      });
    }

    // 4. Enforce allowUpgrade / allowDowngrade / allowSidegrade
    if (direction === "upgrade" && !subsConfig.allowUpgrade) {
      throw new BillingBadRequestError("Upgrades are not allowed");
    }
    if (direction === "downgrade" && !subsConfig.allowDowngrade) {
      throw new BillingBadRequestError("Downgrades are not allowed");
    }
    if (direction === "sidegrade" && !subsConfig.allowSidegrade) {
      throw new BillingBadRequestError("Sidegrades are not allowed");
    }

    // 5. Resolve strategy based on direction
    const strategy =
      direction === "sidegrade"
        ? subsConfig.sidegradeStrategy
        : direction === "downgrade"
          ? subsConfig.downgradeStrategy
          : subsConfig.upgradeStrategy;

    // 6. Before hook
    const planChangeCtx = {
      user,
      customer,
      subscription,
      fromProductId: subscription.providerProductId,
      toProductId: input.productId,
      direction,
      strategy,
    };
    await runBeforeHook(
      hooks?.api?.planChange?.before,
      planChangeCtx,
      "planChange.before",
      this.logger
    );

    // 7. Call provider
    const result = await this.billing.customers.changeSubscription(
      subscription.providerSubscriptionId,
      {
        productId: input.productId,
        direction,
        strategy,
        interval: input.interval,
      }
    );

    // 8. Apply mutation result
    await this.applyMutationResult(input.subscriptionId, result);

    this.logger.info("Changed subscription", {
      userId: user.id,
      subscriptionId: input.subscriptionId,
      newProductId: input.productId,
      direction,
      strategy,
    });

    await this.invalidateStatusCache(user.id);

    runAfterHook(hooks?.api?.planChange?.after, planChangeCtx, "planChange.after", this.logger);
  }

  /**
   * Get the lowest monthly-equivalent price from a product's price list.
   * Normalizes day/week/year intervals to monthly for comparison.
   * Skips one_time prices since they aren't comparable to recurring.
   */
  private getLowestMonthlyPrice(product: {
    prices: { amount: number; interval: string }[];
  }): number {
    let lowest = Infinity;
    for (const price of product.prices) {
      let monthly: number;
      switch (price.interval) {
        case "day":
          monthly = price.amount * 30;
          break;
        case "week":
          monthly = price.amount * 4;
          break;
        case "year":
          monthly = price.amount / 12;
          break;
        case "month":
          monthly = price.amount;
          break;
        default:
          // Skip one_time or unknown intervals
          continue;
      }
      if (monthly < lowest) lowest = monthly;
    }
    return lowest === Infinity ? 0 : lowest;
  }
}
