/**
 * Mock product provider — uses config-defined products when available,
 * falls back to hardcoded defaults for development.
 */

import type { ProductConfig, ProductEntry } from "../../core/config";
import { isManagedProduct } from "../../core/config";
import type { BillingLogger } from "../../core/types";
import { defaultLogger } from "../../core/types";
import type { BillingProductProvider, BillingProduct } from "../types";

const DEFAULT_MOCK_PRODUCTS: BillingProduct[] = [
  {
    id: "mock_prod_free",
    name: "Free",
    description: "Get started for free",
    prices: [
      {
        id: "mock_price_free",
        productId: "mock_prod_free",
        amount: 0,
        currency: "usd",
        interval: "month",
      },
    ],
  },
  {
    id: "mock_prod_starter",
    name: "Starter",
    description: "For small teams getting started",
    prices: [
      {
        id: "mock_price_starter_monthly",
        productId: "mock_prod_starter",
        amount: 1900,
        currency: "usd",
        interval: "month",
      },
      {
        id: "mock_price_starter_yearly",
        productId: "mock_prod_starter",
        amount: 18240,
        currency: "usd",
        interval: "year",
      },
    ],
  },
  {
    id: "mock_prod_pro",
    name: "Pro",
    description: "For growing teams",
    prices: [
      {
        id: "mock_price_pro_monthly",
        productId: "mock_prod_pro",
        amount: 4900,
        currency: "usd",
        interval: "month",
      },
      {
        id: "mock_price_pro_yearly",
        productId: "mock_prod_pro",
        amount: 47040,
        currency: "usd",
        interval: "year",
      },
    ],
    metadata: { popular: "true" },
  },
  {
    id: "mock_prod_enterprise",
    name: "Enterprise",
    description: "For large organizations",
    prices: [
      {
        id: "mock_price_enterprise_monthly",
        productId: "mock_prod_enterprise",
        amount: 19900,
        currency: "usd",
        interval: "month",
      },
      {
        id: "mock_price_enterprise_yearly",
        productId: "mock_prod_enterprise",
        amount: 191040,
        currency: "usd",
        interval: "year",
      },
    ],
  },
];

function configToProduct(config: ProductConfig): BillingProduct {
  return {
    id: config.id,
    name: config.name,
    description: config.description,
    metadata: config.metadata,
    prices: config.prices.map((price, index) => ({
      id: `${config.id}_price_${index}`,
      productId: config.id,
      amount: price.amount,
      currency: price.currency,
      interval: price.interval,
    })),
  };
}

function referenceToProduct(id: string): BillingProduct {
  return {
    id,
    name: id,
    prices: [
      {
        id: `${id}_price_0`,
        productId: id,
        amount: 0,
        currency: "usd",
        interval: "month",
      },
    ],
  };
}

function entriesToProducts(entries: ProductEntry[]): BillingProduct[] {
  return entries.map((entry) =>
    isManagedProduct(entry) ? configToProduct(entry) : referenceToProduct(entry)
  );
}

export class MockProductProvider implements BillingProductProvider {
  private logger: BillingLogger;
  private products: BillingProduct[];

  constructor(logger?: BillingLogger, productEntries?: ProductEntry[]) {
    this.logger = logger ?? defaultLogger;
    this.products = productEntries?.length
      ? entriesToProducts(productEntries)
      : DEFAULT_MOCK_PRODUCTS;
  }

  async listProducts(): Promise<BillingProduct[]> {
    this.logger.debug("[Mock Billing] Listed products", { count: this.products.length });
    return this.products;
  }

  async getProduct(productId: string): Promise<BillingProduct | null> {
    const product = this.products.find((p) => p.id === productId) ?? null;
    this.logger.debug("[Mock Billing] Get product", { productId, found: !!product });
    return product;
  }
}
