/**
 * Billing checkout service — handles checkout, portal, and subscription management.
 */

import { nanoid } from "nanoid";
import type { BillingSubscription } from "../providers";
import {
  isActive,
  getActiveSubscription,
  getChangeDirection,
  getLowestMonthlyPrice,
} from "../core/domain";
import { runBeforeHook, runAfterHook } from "../core/hooks";
import type { BillingUser } from "../core/hooks";
import { BillingBadRequestError, BillingNotFoundError } from "../core/errors";
import type { BillingContext } from "../core/types";

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
  constructor(private ctx: BillingContext) {}

  /**
   * Invalidate cached billing status for a user. Failures are logged and swallowed.
   */
  private async invalidateStatusCache(userId: string): Promise<void> {
    if (!this.ctx.cache) return;
    try {
      await this.ctx.cache.delete(`billing:status:${userId}`);
    } catch (err) {
      this.ctx.logger.warn("Failed to invalidate status cache", {
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
    const provider = this.ctx.providerType;
    const existing = await this.ctx.adapter.customers.findByUserId(user.id, provider);
    if (existing) return existing;

    const providerCustomer = await this.ctx.providers.customers.createCustomer(
      user.email,
      user.id,
      user.name ?? undefined
    );

    try {
      const customer = await this.ctx.adapter.customers.create({
        id: nanoid(),
        userId: user.id,
        provider,
        providerCustomerId: providerCustomer.id,
        email: user.email,
        name: user.name,
      });

      this.ctx.logger.info("Created billing customer", {
        userId: user.id,
        customerId: customer.id,
        providerCustomerId: providerCustomer.id,
      });

      runAfterHook(
        this.ctx.config.hooks?.lifecycle?.onCustomerCreated,
        { user, customer },
        "lifecycle.onCustomerCreated",
        this.ctx.logger
      );

      return customer;
    } catch (err) {
      // Race condition: another request created the customer concurrently
      const created = await this.ctx.adapter.customers.findByUserId(user.id, provider);
      if (created) return created;
      this.ctx.logger.error("Failed to create billing customer", {
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
    const hooks = this.ctx.config.hooks;

    const product = await this.ctx.providers.products.getProduct(input.productId);
    if (!product) {
      throw new BillingBadRequestError("Invalid product ID");
    }

    const hookCtx = { user, productId: input.productId };
    await runBeforeHook(hooks?.api?.checkout?.before, hookCtx, "checkout.before", this.ctx.logger);

    if (this.ctx.config.subscriptions.singleSubscription) {
      const existing = await this.ctx.adapter.customers.findByUserId(user.id, this.ctx.providerType);
      if (existing) {
        const subs = await this.ctx.adapter.subscriptions.findByCustomerId(existing.id);
        if (getActiveSubscription(subs)) {
          throw new BillingBadRequestError("You already have an active subscription");
        }
      }
    }

    const customer = await this.getOrCreateCustomer(user);

    const session = await this.ctx.providers.checkout.createCheckoutSession({
      customerId: customer.providerCustomerId,
      productId: input.productId,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
      trialDays: this.ctx.config.subscriptions.trialDays,
    });

    this.ctx.logger.info("Created checkout session", {
      userId: user.id,
      productId: input.productId,
    });

    await this.invalidateStatusCache(user.id);

    runAfterHook(hooks?.api?.checkout?.after, hookCtx, "checkout.after", this.ctx.logger);

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

    const session = await this.ctx.providers.checkout.createPortalSession(
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
    await this.ctx.adapter.subscriptions.update(subscriptionId, {
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
    const hooks = this.ctx.config.hooks;

    const customer = await this.ctx.adapter.customers.findByUserId(user.id, this.ctx.providerType);

    if (!customer) {
      throw new BillingNotFoundError("No billing account found");
    }

    const subscription = await this.ctx.adapter.subscriptions.findById(subscriptionId);

    if (!subscription || subscription.customerId !== customer.id) {
      throw new BillingNotFoundError("Subscription not found");
    }

    if (!isActive(subscription)) {
      throw new BillingBadRequestError("Subscription is not active");
    }

    const cancelHookCtx = { user, customer, subscription };
    await runBeforeHook(hooks?.api?.cancel?.before, cancelHookCtx, "cancel.before", this.ctx.logger);

    const { timing } = this.ctx.config.subscriptions.cancellation;

    const handler = this.ctx.providers.subscriptions.cancelHandlers[timing];
    if (!handler) {
      throw new BillingBadRequestError(`Cancellation timing "${timing}" is not supported`);
    }

    const result = await handler(subscription.providerSubscriptionId);

    await this.applyMutationResult(subscriptionId, result);

    this.ctx.logger.info("Canceled subscription", {
      userId: user.id,
      subscriptionId,
      timing,
    });

    await this.invalidateStatusCache(user.id);

    runAfterHook(hooks?.api?.cancel?.after, cancelHookCtx, "cancel.after", this.ctx.logger);
  }

  /**
   * Uncancel a subscription that's scheduled for cancellation.
   * Guarded by config's allowUncancel setting.
   */
  async uncancelSubscription(user: BillingUser, subscriptionId: string): Promise<void> {
    if (!this.ctx.config.subscriptions.cancellation.allowUncancel) {
      throw new BillingBadRequestError("Resuming canceled subscriptions is not allowed");
    }

    const customer = await this.ctx.adapter.customers.findByUserId(user.id, this.ctx.providerType);

    if (!customer) {
      throw new BillingNotFoundError("No billing account found");
    }

    const subscription = await this.ctx.adapter.subscriptions.findById(subscriptionId);

    if (!subscription || subscription.customerId !== customer.id) {
      throw new BillingNotFoundError("Subscription not found");
    }

    if (!subscription.pendingCancellation) {
      throw new BillingBadRequestError("Subscription is not scheduled for cancellation");
    }

    const result = await this.ctx.providers.subscriptions.uncancel(
      subscription.providerSubscriptionId
    );

    await this.applyMutationResult(subscriptionId, result);

    this.ctx.logger.info("Uncanceled subscription", {
      userId: user.id,
      subscriptionId,
    });

    await this.invalidateStatusCache(user.id);
  }

  /**
   * Change a user's subscription to a different product.
   */
  async changeSubscription(user: BillingUser, input: ChangeSubscriptionInput): Promise<void> {
    const subsConfig = this.ctx.config.subscriptions;
    const hooks = this.ctx.config.hooks;

    // 1. Validate product exists
    const newProduct = await this.ctx.providers.products.getProduct(input.productId);
    if (!newProduct) {
      throw new BillingBadRequestError("Invalid product ID");
    }

    // 2. Load subscription + ownership check
    const customer = await this.ctx.adapter.customers.findByUserId(user.id, this.ctx.providerType);

    if (!customer) {
      throw new BillingNotFoundError("No billing account found");
    }

    const subscription = await this.ctx.adapter.subscriptions.findById(input.subscriptionId);

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
      const currentProduct = await this.ctx.providers.products.getProduct(subscription.providerProductId);
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
      const currentProduct = await this.ctx.providers.products.getProduct(
        subscription.providerProductId
      );
      const currentPrice = currentProduct
        ? getLowestMonthlyPrice(currentProduct)
        : undefined;
      const newPrice = getLowestMonthlyPrice(newProduct);

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
      this.ctx.logger
    );

    // 7. Call provider
    const handler = this.ctx.providers.subscriptions.changeHandlers[strategy];
    if (!handler) {
      throw new BillingBadRequestError(`Change strategy "${strategy}" is not supported`);
    }

    const result = await handler(
      subscription.providerSubscriptionId,
      input.productId,
      input.interval
    );

    // 8. Apply mutation result
    await this.applyMutationResult(input.subscriptionId, result);

    this.ctx.logger.info("Changed subscription", {
      userId: user.id,
      subscriptionId: input.subscriptionId,
      newProductId: input.productId,
      direction,
      strategy,
    });

    await this.invalidateStatusCache(user.id);

    runAfterHook(hooks?.api?.planChange?.after, planChangeCtx, "planChange.after", this.ctx.logger);
  }

}
