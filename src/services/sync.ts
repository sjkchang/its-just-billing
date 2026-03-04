/**
 * Billing sync service — synchronizes customer/subscription state from the provider.
 *
 * The provider is the source of truth; this service maintains the local cache.
 * syncCustomerState is the core method — all other sync paths resolve to it.
 */

import type { BillingProviderType, Customer, Subscription } from "../core/entities";
import { isActive, hasEnded } from "../core/domain";
import { runAfterHook } from "../core/hooks";
import type { BillingUser } from "../core/hooks";
import type { BillingContext } from "../core/types";
import { createId } from "../core/types";

export class BillingSyncService {
  constructor(private ctx: BillingContext) {}

  /** Per-user sync cooldown in seconds. */
  private static readonly SYNC_COOLDOWN_SECONDS = 10;

  /**
   * Sync billing state for a user.
   * Resolves the provider customer ID from local DB or provider lookup,
   * then delegates to syncCustomerState.
   *
   * Enforces a per-user cooldown (when cache is available) to prevent
   * abuse that could exhaust the provider's API rate limit.
   */
  async syncBillingState(user: BillingUser): Promise<void> {
    if (this.ctx.cache) {
      const cooldownKey = `billing:sync:cooldown:${user.id}`;
      try {
        const active = await this.ctx.cache.get(cooldownKey);
        if (active) {
          this.ctx.logger.debug("Skipping sync — cooldown active", { userId: user.id });
          return;
        }
      } catch {
        // Cache read failure — proceed with sync
      }
    }

    const provider = this.ctx.providerType;
    const customer = await this.ctx.adapter.customers.findByUserId(user.id, provider);

    if (customer) {
      await this.syncCustomerState(customer.providerCustomerId, provider);
      await this.setSyncCooldown(user.id);
      return;
    }

    // No local customer — check if one exists in the provider
    const providerCustomer = await this.ctx.providers.customers.getCustomerByExternalId(user.id);

    if (!providerCustomer) {
      this.ctx.logger.debug("No billing customer found for user", { userId: user.id });
      await this.setSyncCooldown(user.id);
      return;
    }

    await this.syncCustomerState(providerCustomer.id, provider);
    await this.setSyncCooldown(user.id);
  }

  private async setSyncCooldown(userId: string): Promise<void> {
    if (!this.ctx.cache) return;
    try {
      await this.ctx.cache.set(
        `billing:sync:cooldown:${userId}`,
        "1",
        BillingSyncService.SYNC_COOLDOWN_SECONDS
      );
    } catch {
      // Cooldown set failure — not critical
    }
  }

  /**
   * Sync customer state from provider to local cache.
   * This is the core function called by status, webhooks, and checkout success.
   */
  async syncCustomerState(
    providerCustomerId: string,
    provider: BillingProviderType
  ): Promise<void> {
    this.ctx.logger.debug("syncCustomerState called", { providerCustomerId });

    const state = await this.ctx.providers.customers.getCustomerState(providerCustomerId);

    this.ctx.logger.debug("Got customer state from provider", {
      providerCustomerId,
      hasState: !!state,
      subscriptionCount: state?.subscriptions?.length ?? 0,
    });

    if (!state) {
      this.ctx.logger.warn("Could not fetch customer state from provider", { providerCustomerId });
      return;
    }

    if (!state.customer.externalId) {
      const hasLocal = await this.ctx.adapter.customers.findByProviderCustomerId(providerCustomerId, provider);
      if (!hasLocal) {
        this.ctx.logger.error("Cannot create customer without externalId", { providerCustomerId });
        return;
      }
    }

    // Snapshot local subscriptions before transaction (for transition detection)
    const preCustomer = await this.ctx.adapter.customers.findByProviderCustomerId(providerCustomerId, provider);
    const preSubs: Subscription[] = preCustomer
      ? await this.ctx.adapter.subscriptions.findByCustomerId(preCustomer.id)
      : [];

    let syncedCustomer: Customer | null = null;
    let postSubs: Subscription[] = [];

    await this.ctx.adapter.transaction(async (txAdapter) => {
      let customer = await txAdapter.customers.findByProviderCustomerId(providerCustomerId, provider);

      if (!customer) {
        if (!state.customer.externalId) {
          this.ctx.logger.error("Cannot create customer without externalId (inside transaction)", {
            providerCustomerId,
          });
          return;
        }

        this.ctx.logger.warn("Customer not found locally, creating from provider state", {
          providerCustomerId,
        });

        customer = await txAdapter.customers.create({
          id: createId(),
          userId: state.customer.externalId,
          provider,
          providerCustomerId: state.customer.id,
          email: state.customer.email,
          name: state.customer.name,
        });
      } else {
        await txAdapter.customers.update(customer.id, {
          email: state.customer.email,
          name: state.customer.name,
        });
      }

      // Upsert subscriptions returned by the provider
      const activeProviderIds = new Set<string>();
      for (const sub of state.subscriptions) {
        activeProviderIds.add(sub.id);
        await txAdapter.subscriptions.upsertByProviderSubscriptionId({
          id: createId(),
          customerId: customer.id,
          providerSubscriptionId: sub.id,
          providerProductId: sub.productId,
          providerPriceId: sub.priceId,
          status: sub.status,
          currentPeriodStart: sub.currentPeriodStart,
          currentPeriodEnd: sub.currentPeriodEnd,
          pendingCancellation: sub.pendingCancellation,
          pendingProductId: sub.pendingProductId ?? null,
          canceledAt: sub.canceledAt,
          endedAt: sub.endedAt,
        });
      }

      // Flag local subscriptions not returned by the provider.
      // Uses `provider_missing` rather than `canceled` to preserve the distinction
      // between user-initiated cancellations and provider sync gaps.
      const localSubscriptions = await txAdapter.subscriptions.findByCustomerId(customer.id);
      for (const local of localSubscriptions) {
        if (!activeProviderIds.has(local.providerSubscriptionId) && isActive(local)) {
          await txAdapter.subscriptions.update(local.id, {
            status: "provider_missing",
          });
          this.ctx.logger.warn("Subscription missing from provider", {
            subscriptionId: local.id,
            providerSubscriptionId: local.providerSubscriptionId,
          });
        }
      }

      syncedCustomer = customer;
      postSubs = await txAdapter.subscriptions.findByCustomerId(customer.id);

      this.ctx.logger.info("Synced customer state", {
        customerId: customer.id,
        subscriptionCount: state.subscriptions.length,
      });
    });

    const resolvedCustomer = syncedCustomer as Customer | null;

    // Invalidate caches after sync
    if (resolvedCustomer && this.ctx.cache) {
      try {
        await Promise.all([
          this.ctx.cache.delete(`billing:status:${resolvedCustomer.userId}`),
          this.ctx.cache.delete("billing:products"),
        ]);
      } catch (err) {
        this.ctx.logger.warn("Failed to invalidate cache after sync", {
          userId: resolvedCustomer.userId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Fire subscription lifecycle hooks outside the transaction
    if (resolvedCustomer) {
      this.fireTransitionHooks(resolvedCustomer, preSubs, postSubs);
    }
  }

  /**
   * Compare pre-sync and post-sync subscription state to fire lifecycle hooks.
   */
  private fireTransitionHooks(customer: Customer, preSubs: Subscription[], postSubs: Subscription[]): void {
    const hooks = this.ctx.config.hooks?.lifecycle;
    if (!hooks) return;

    const preMap = new Map(preSubs.map((s) => [s.providerSubscriptionId, s]));

    for (const post of postSubs) {
      const pre = preMap.get(post.providerSubscriptionId);

      // onSubscriptionActivated: was not active (or didn't exist) -> now active
      if (isActive(post) && (!pre || !isActive(pre))) {
        runAfterHook(
          hooks.onSubscriptionActivated,
          { customer, subscription: post },
          "lifecycle.onSubscriptionActivated",
          this.ctx.logger
        );
      }

      // onSubscriptionCanceled: was active -> now pendingCancellation or canceled
      if (pre && isActive(pre) && !pre.pendingCancellation) {
        if (post.pendingCancellation || post.status === "canceled") {
          runAfterHook(
            hooks.onSubscriptionCanceled,
            { customer, subscription: post },
            "lifecycle.onSubscriptionCanceled",
            this.ctx.logger
          );
        }
      }

      // onSubscriptionChanged: productId changed (and still active)
      if (pre && pre.providerProductId !== post.providerProductId && isActive(post)) {
        runAfterHook(
          hooks.onSubscriptionChanged,
          {
            customer,
            subscription: post,
            previousProductId: pre.providerProductId,
            newProductId: post.providerProductId,
          },
          "lifecycle.onSubscriptionChanged",
          this.ctx.logger
        );
      }

      // onSubscriptionExpired: was active -> now ended (canceled, unpaid)
      if (pre && isActive(pre) && hasEnded(post)) {
        runAfterHook(
          hooks.onSubscriptionExpired,
          { customer, subscription: post },
          "lifecycle.onSubscriptionExpired",
          this.ctx.logger
        );
      }
    }
  }
}
