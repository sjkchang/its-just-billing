/**
 * Billing status service — resolves user billing status and entitlements.
 */

import type { Subscription, SubscriptionStatus } from "../core/entities";
import { getActiveSubscription, getStatusMessage, EntitlementResolver } from "../core/domain";
import type { ProductEntry } from "../core/config";
import { getConfiguredProductIds } from "../core/config";
import type { BillingUser } from "../core/hooks";
import type { BillingContext } from "../core/types";

/** Describes whether the user currently has access to paid features. */
export type AccessState =
  | "active"           // Normal paid access
  | "trialing"         // Trial period
  | "grace_period"     // Payment past due, still within grace period
  | "suspended"        // Payment past due, grace period expired — entitlements revoked
  | "canceled"         // Subscription canceled
  | "provider_missing" // Subscription exists locally but not found in provider
  | "free";            // No subscription

export interface BillingStatusResult {
  entitlements: string[];
  accessState: AccessState;
  productId: string | null;
  productName: string | null;
  productDescription: string | null;
  subscription: {
    id: string;
    status: SubscriptionStatus;
    currentPeriodEnd: Date | null;
    pendingCancellation: boolean;
    pendingProductId: string | null;
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
  private pastDueGracePeriodDays: number | undefined;

  constructor(private ctx: BillingContext) {
    this.entitlementResolver = new EntitlementResolver(ctx.config.entitlements);
    this.configuredProducts = ctx.config.products;
    this.productDisplay = ctx.config.productDisplay;
    this.pastDueGracePeriodDays = ctx.config.subscriptions.pastDueGracePeriodDays;
  }

  /**
   * Get billing status for a user.
   * Reads from local cache only — sync happens via webhooks or manual refresh.
   */
  async getBillingStatus(user: BillingUser): Promise<BillingStatusResult> {
    const cacheKey = `billing:status:${user.id}`;

    // Check cache
    if (this.ctx.cache) {
      try {
        const cached = await this.ctx.cache.get(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached) as BillingStatusResult;
          // Reconstruct Date from serialized string
          if (parsed.subscription?.currentPeriodEnd) {
            parsed.subscription.currentPeriodEnd = new Date(parsed.subscription.currentPeriodEnd);
          }
          return parsed;
        }
      } catch (err) {
        this.ctx.logger.warn("Failed to read billing status from cache", {
          userId: user.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const customer = await this.ctx.adapter.customers.findByUserId(user.id, this.ctx.providerType);
    let activeSubscription: Subscription | null = null;

    let providerMissingSub: Subscription | null = null;

    if (customer) {
      const subscriptions = await this.ctx.adapter.subscriptions.findByCustomerId(customer.id);
      activeSubscription = getActiveSubscription(subscriptions);
      if (!activeSubscription) {
        providerMissingSub = subscriptions.find((s) => s.status === "provider_missing") ?? null;
      }
    }

    if (!activeSubscription && !providerMissingSub) {
      const result = this.buildFreeStatus();
      await this.cacheSet(cacheKey, result);
      return result;
    }

    if (!activeSubscription && providerMissingSub) {
      const result: BillingStatusResult = {
        entitlements: Array.from(this.entitlementResolver.resolve([])),
        accessState: "provider_missing",
        productId: providerMissingSub.providerProductId,
        productName: null,
        productDescription: null,
        subscription: {
          id: providerMissingSub.id,
          status: providerMissingSub.status,
          currentPeriodEnd: providerMissingSub.currentPeriodEnd,
          pendingCancellation: false,
          pendingProductId: null,
        },
        statusMessage: "Subscription not found in billing provider",
        metadata: null,
      };
      await this.cacheSet(cacheKey, result);
      return result;
    }

    // Both early returns above handle the null cases
    const sub = activeSubscription!;
    const product = await this.ctx.providers.products.getProduct(sub.providerProductId);
    const accessState = this.resolveAccessState(sub);
    const grantPaidEntitlements = accessState !== "suspended" && accessState !== "canceled";

    const entitlements = grantPaidEntitlements
      ? this.entitlementResolver.resolve([sub.providerProductId])
      : this.entitlementResolver.resolve([]);

    const result: BillingStatusResult = {
      entitlements: Array.from(entitlements),
      accessState,
      productId: sub.providerProductId,
      productName: product?.name ?? null,
      productDescription: product?.description ?? null,
      subscription: {
        id: sub.id,
        status: sub.status,
        currentPeriodEnd: sub.currentPeriodEnd,
        pendingCancellation: sub.pendingCancellation,
        pendingProductId: sub.pendingProductId ?? null,
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
    if (this.ctx.cache) {
      try {
        const cached = await this.ctx.cache.get(cacheKey);
        if (cached) {
          return JSON.parse(cached) as ProductResult[];
        }
      } catch (err) {
        this.ctx.logger.warn("Failed to read products from cache", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const productList = await this.ctx.providers.products.listProducts();

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
    if (!this.ctx.cache) return;
    try {
      await this.ctx.cache.set(key, JSON.stringify(value), ttl);
    } catch (err) {
      this.ctx.logger.warn("Failed to write to cache", {
        key,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Build a free tier status result.
   */
  private resolveAccessState(subscription: Subscription): AccessState {
    if (subscription.status === "trialing") return "trialing";
    if (subscription.status === "canceled") return "canceled";

    if (subscription.status === "past_due") {
      if (this.pastDueGracePeriodDays == null) return "grace_period"; // undefined = keep forever
      if (this.pastDueGracePeriodDays === 0) return "suspended"; // 0 = immediate suspension
      const pastDueSince = subscription.currentPeriodEnd ?? subscription.updatedAt;
      if (pastDueSince) {
        const elapsed = Date.now() - new Date(pastDueSince).getTime();
        const gracePeriodMs = this.pastDueGracePeriodDays * 24 * 60 * 60 * 1000;
        return elapsed > gracePeriodMs ? "suspended" : "grace_period";
      }
      return "grace_period";
    }

    return "active";
  }

  private buildFreeStatus(): BillingStatusResult {
    const entitlements = this.entitlementResolver.resolve([]);
    return {
      entitlements: Array.from(entitlements),
      accessState: "free",
      productId: null,
      productName: "Free",
      productDescription: null,
      subscription: null,
      statusMessage: "Free tier - no active subscription",
      metadata: null,
    };
  }
}
