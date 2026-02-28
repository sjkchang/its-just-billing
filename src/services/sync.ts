/**
 * Billing sync service — synchronizes customer/subscription state from the provider.
 *
 * The provider is the source of truth; this service maintains the local cache.
 * syncCustomerState is the core method — all other sync paths resolve to it.
 */

import { nanoid } from "nanoid";
import type { BillingProviders } from "../providers";
import type { BillingProviderType, Customer, Subscription } from "../core/entities";
import { isActive, hasEnded } from "../core/domain";
import type { BillingRepositories } from "../repositories/types";
import type { BillingAppConfig } from "../core/config";
import { runAfterHook } from "../core/hooks";
import type { BillingUser } from "../core/hooks";
import type { BillingLogger } from "../core/types";
import { defaultLogger } from "../core/types";

export class BillingSyncService {
  constructor(
    private adapter: BillingRepositories,
    private billing: BillingProviders,
    private billingProvider: BillingProviderType,
    private config: BillingAppConfig,
    private logger: BillingLogger = defaultLogger
  ) {}

  /**
   * Sync billing state for a user.
   * Resolves the provider customer ID from local DB or provider lookup,
   * then delegates to syncCustomerState.
   */
  async syncBillingState(user: BillingUser): Promise<void> {
    const provider = this.billingProvider;
    const customer = await this.adapter.customers.findByUserId(user.id, provider);

    if (customer) {
      await this.syncCustomerState(customer.providerCustomerId, provider);
      return;
    }

    // No local customer — check if one exists in the provider
    const providerCustomer = await this.billing.customers.getCustomerByExternalId(user.id);

    if (!providerCustomer) {
      this.logger.debug("No billing customer found for user", { userId: user.id });
      return;
    }

    await this.syncCustomerState(providerCustomer.id, provider);
  }

  /**
   * Sync customer state from provider to local cache.
   * This is the core function called by status, webhooks, and checkout success.
   */
  async syncCustomerState(
    providerCustomerId: string,
    provider: BillingProviderType
  ): Promise<void> {
    this.logger.info("syncCustomerState called", { providerCustomerId });

    const state = await this.billing.customers.getCustomerState(providerCustomerId);

    this.logger.info("Got customer state from provider", {
      providerCustomerId,
      hasState: !!state,
      subscriptionCount: state?.subscriptions?.length ?? 0,
    });

    if (!state) {
      this.logger.warn("Could not fetch customer state from provider", { providerCustomerId });
      return;
    }

    if (!state.customer.externalId) {
      const hasLocal = await this.adapter.customers.findByProviderCustomerId(providerCustomerId);
      if (!hasLocal) {
        this.logger.error("Cannot create customer without externalId", { providerCustomerId });
        return;
      }
    }

    // Snapshot local subscriptions before transaction (for transition detection)
    const preCustomer = await this.adapter.customers.findByProviderCustomerId(providerCustomerId);
    const preSubs: Subscription[] = preCustomer
      ? await this.adapter.subscriptions.findByCustomerId(preCustomer.id)
      : [];

    let syncedCustomer: Customer | null = null;

    await this.adapter.transaction(async (txAdapter) => {
      let customer = await txAdapter.customers.findByProviderCustomerId(providerCustomerId);

      if (!customer) {
        if (!state.customer.externalId) {
          this.logger.error("Cannot create customer without externalId (inside transaction)", {
            providerCustomerId,
          });
          return;
        }

        this.logger.warn("Customer not found locally, creating from provider state", {
          providerCustomerId,
        });

        customer = await txAdapter.customers.create({
          id: nanoid(),
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
          id: nanoid(),
          customerId: customer.id,
          providerSubscriptionId: sub.id,
          providerProductId: sub.productId,
          providerPriceId: sub.priceId,
          status: sub.status,
          currentPeriodStart: sub.currentPeriodStart,
          currentPeriodEnd: sub.currentPeriodEnd,
          pendingCancellation: sub.pendingCancellation,
          canceledAt: sub.canceledAt,
          endedAt: sub.endedAt,
        });
      }

      // Mark local subscriptions not in provider response as canceled.
      const localSubscriptions = await txAdapter.subscriptions.findByCustomerId(customer.id);
      for (const local of localSubscriptions) {
        if (!activeProviderIds.has(local.providerSubscriptionId) && isActive(local)) {
          await txAdapter.subscriptions.update(local.id, {
            status: "canceled",
            canceledAt: local.canceledAt ?? new Date(),
          });
          this.logger.info("Marked subscription as canceled (missing from provider)", {
            subscriptionId: local.id,
            providerSubscriptionId: local.providerSubscriptionId,
          });
        }
      }

      syncedCustomer = customer;

      this.logger.info("Synced customer state", {
        customerId: customer.id,
        subscriptionCount: state.subscriptions.length,
      });
    });

    // Fire subscription lifecycle hooks outside the transaction
    if (syncedCustomer) {
      this.fireTransitionHooks(syncedCustomer, preSubs);
    }
  }

  /**
   * Compare pre-sync and post-sync subscription state to fire lifecycle hooks.
   */
  private async fireTransitionHooks(customer: Customer, preSubs: Subscription[]): Promise<void> {
    const hooks = this.config.hooks?.lifecycle;
    if (!hooks) return;

    const postSubs = await this.adapter.subscriptions.findByCustomerId(customer.id);
    const preMap = new Map(preSubs.map((s) => [s.providerSubscriptionId, s]));

    for (const post of postSubs) {
      const pre = preMap.get(post.providerSubscriptionId);

      // onSubscriptionActivated: was not active (or didn't exist) -> now active
      if (isActive(post) && (!pre || !isActive(pre))) {
        runAfterHook(
          hooks.onSubscriptionActivated,
          { customer, subscription: post },
          "lifecycle.onSubscriptionActivated",
          this.logger
        );
      }

      // onSubscriptionCanceled: was active -> now pendingCancellation or canceled
      if (pre && isActive(pre) && !pre.pendingCancellation) {
        if (post.pendingCancellation || post.status === "canceled") {
          runAfterHook(
            hooks.onSubscriptionCanceled,
            { customer, subscription: post },
            "lifecycle.onSubscriptionCanceled",
            this.logger
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
          this.logger
        );
      }

      // onSubscriptionExpired: was active -> now ended (canceled, unpaid)
      if (pre && isActive(pre) && hasEnded(post)) {
        runAfterHook(
          hooks.onSubscriptionExpired,
          { customer, subscription: post },
          "lifecycle.onSubscriptionExpired",
          this.logger
        );
      }
    }
  }
}
