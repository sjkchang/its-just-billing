/**
 * Billing status service — resolves user billing status and entitlements.
 */

import type { BillingProviders } from "../providers";
import type { BillingProviderType, Subscription, SubscriptionStatus } from "../core/entities";
import { getActiveSubscription, getStatusMessage, EntitlementResolver } from "../core/domain";
import type { BillingAppConfig, ProductEntry } from "../core/config";
import { getConfiguredProductIds } from "../core/config";
import type { BillingRepositories } from "../repositories/types";
import type { BillingUser } from "../core/hooks";
import type { BillingLogger, KeyValueCache } from "../core/types";
import { defaultLogger } from "../core/types";

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
    interval: "day" | "week" | "month" | "year" | "one_time";
  }[];
  metadata?: Record<string, string>;
}

export class BillingStatusService {
  private entitlementResolver: EntitlementResolver;
  private configuredProducts: ProductEntry[] | undefined;
  private productDisplay: "configured" | "all";

  constructor(
    private adapter: BillingRepositories,
    private billing: BillingProviders,
    private billingProvider: BillingProviderType,
    config: BillingAppConfig,
    private cache?: KeyValueCache,
    private logger: BillingLogger = defaultLogger
  ) {
    this.entitlementResolver = new EntitlementResolver(config.entitlements);
    this.configuredProducts = config.products;
    this.productDisplay = config.productDisplay;
  }

  /**
   * Get billing status for a user.
   * Reads from local cache only — sync happens via webhooks or manual refresh.
   */
  async getBillingStatus(user: BillingUser): Promise<BillingStatusResult> {
    const cacheKey = `billing:status:${user.id}`;

    // Check cache
    if (this.cache) {
      try {
        const cached = await this.cache.get(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached) as BillingStatusResult;
          // Reconstruct Date from serialized string
          if (parsed.subscription?.currentPeriodEnd) {
            parsed.subscription.currentPeriodEnd = new Date(parsed.subscription.currentPeriodEnd);
          }
          return parsed;
        }
      } catch (err) {
        this.logger.warn("Failed to read billing status from cache", {
          userId: user.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const customer = await this.adapter.customers.findByUserId(user.id, this.billingProvider);
    let activeSubscription: Subscription | null = null;

    if (customer) {
      const subscriptions = await this.adapter.subscriptions.findByCustomerId(customer.id);
      activeSubscription = getActiveSubscription(subscriptions);
    }

    if (!activeSubscription) {
      const result = this.buildFreeStatus();
      await this.cacheSet(cacheKey, result);
      return result;
    }

    const product = await this.billing.products.getProduct(activeSubscription.providerProductId);

    const entitlements = this.entitlementResolver.resolve([activeSubscription.providerProductId]);

    const result: BillingStatusResult = {
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

    await this.cacheSet(cacheKey, result);
    return result;
  }

  /**
   * List available products.
   *
   * Filtering depends on config:
   * - No configured products → return all from provider
   * - `productDisplay: "configured"` (default) → only configured product IDs
   * - `productDisplay: "all"` → configured products first (in config order), then remaining
   */
  async listProducts(): Promise<ProductResult[]> {
    const cacheKey = "billing:products";

    // Check cache
    if (this.cache) {
      try {
        const cached = await this.cache.get(cacheKey);
        if (cached) {
          return JSON.parse(cached) as ProductResult[];
        }
      } catch (err) {
        this.logger.warn("Failed to read products from cache", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const productList = await this.billing.products.listProducts();

    const toResult = (prod: { id: string; name: string; description?: string | null; prices: { id: string; amount: number; currency: string; interval: "day" | "week" | "month" | "year" | "one_time" }[]; metadata?: Record<string, string> }): ProductResult => ({
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
    });

    // No configured products → return all from provider
    if (!this.configuredProducts?.length) {
      const results = productList.map(toResult);
      await this.cacheSet(cacheKey, results, 3600);
      return results;
    }

    const configuredIds = getConfiguredProductIds(this.configuredProducts);
    const productMap = new Map(productList.map((p) => [p.id, p]));

    if (this.productDisplay === "all") {
      // Configured products first (in config order), then remaining
      const results: ProductResult[] = [];
      const includedIds = new Set<string>();

      for (const id of configuredIds) {
        const product = productMap.get(id);
        if (product) {
          results.push(toResult(product));
          includedIds.add(id);
        }
      }

      for (const product of productList) {
        if (!includedIds.has(product.id)) {
          results.push(toResult(product));
        }
      }

      await this.cacheSet(cacheKey, results, 3600);
      return results;
    }

    // Default: "configured" — only configured product IDs, in config order
    const results: ProductResult[] = [];
    for (const id of configuredIds) {
      const product = productMap.get(id);
      if (product) {
        results.push(toResult(product));
      }
    }
    await this.cacheSet(cacheKey, results, 3600);
    return results;
  }

  /**
   * Write a value to the cache. Failures are logged and swallowed.
   */
  private async cacheSet(key: string, value: unknown, ttl = 300): Promise<void> {
    if (!this.cache) return;
    try {
      await this.cache.set(key, JSON.stringify(value), ttl);
    } catch (err) {
      this.logger.warn("Failed to write to cache", {
        key,
        error: err instanceof Error ? err.message : String(err),
      });
    }
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
