/**
 * Billing status service — resolves user billing status and entitlements.
 */

import type { BillingProviders } from "../providers";
import type { BillingProviderType, Subscription, SubscriptionStatus } from "../core/entities";
import { getActiveSubscription, getStatusMessage, EntitlementResolver } from "../core/domain";
import type { BillingAppConfig } from "../core/config";
import type { BillingRepositories } from "../repositories/types";
import type { BillingUser } from "../core/hooks";

export interface BillingStatusResult {
  entitlements: string[];
  productId: string | null;
  productName: string | null;
  productDescription: string | null;
  subscription: {
    id: string;
    status: SubscriptionStatus;
    currentPeriodEnd: Date | null;
    pendingCancellation: boolean;
  } | null;
  statusMessage: string;
  metadata: Record<string, string> | null;
}

export interface ProductResult {
  id: string;
  name: string;
  description: string | null | undefined;
  prices: {
    id: string;
    amount: number;
    currency: string;
    interval: "month" | "year" | "one_time";
  }[];
  metadata?: Record<string, string>;
}

export class BillingStatusService {
  private entitlementResolver: EntitlementResolver;

  constructor(
    private adapter: BillingRepositories,
    private billing: BillingProviders,
    private billingProvider: BillingProviderType,
    config: BillingAppConfig
  ) {
    this.entitlementResolver = new EntitlementResolver(config.entitlements);
  }

  /**
   * Get billing status for a user.
   * Reads from local cache only — sync happens via webhooks or manual refresh.
   */
  async getBillingStatus(user: BillingUser): Promise<BillingStatusResult> {
    const customer = await this.adapter.customers.findByUserId(user.id, this.billingProvider);
    let activeSubscription: Subscription | null = null;

    if (customer) {
      const subscriptions = await this.adapter.subscriptions.findByCustomerId(customer.id);
      activeSubscription = getActiveSubscription(subscriptions);
    }

    if (!activeSubscription) {
      return this.buildFreeStatus();
    }

    const product = await this.billing.products.getProduct(activeSubscription.providerProductId);

    const entitlements = this.entitlementResolver.resolve([activeSubscription.providerProductId]);

    return {
      entitlements: Array.from(entitlements),
      productId: activeSubscription.providerProductId,
      productName: product?.name ?? null,
      productDescription: product?.description ?? null,
      subscription: {
        id: activeSubscription.id,
        status: activeSubscription.status,
        currentPeriodEnd: activeSubscription.currentPeriodEnd,
        pendingCancellation: activeSubscription.pendingCancellation,
      },
      statusMessage: getStatusMessage(activeSubscription),
      metadata: product?.metadata ?? null,
    };
  }

  /**
   * List available products.
   */
  async listProducts(): Promise<ProductResult[]> {
    const productList = await this.billing.products.listProducts();

    return productList.map((prod) => ({
      id: prod.id,
      name: prod.name,
      description: prod.description,
      prices: prod.prices.map((price) => ({
        id: price.id,
        amount: price.amount,
        currency: price.currency,
        interval: price.interval,
      })),
      metadata: prod.metadata,
    }));
  }

  /**
   * Build a free tier status result.
   */
  private buildFreeStatus(): BillingStatusResult {
    const entitlements = this.entitlementResolver.resolve([]);
    return {
      entitlements: Array.from(entitlements),
      productId: null,
      productName: "Free",
      productDescription: null,
      subscription: null,
      statusMessage: "Free tier - no active subscription",
      metadata: null,
    };
  }
}
