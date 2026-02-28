/**
 * Mock product provider — hardcoded products for development.
 */

import type { BillingLogger } from "../../types";
import { defaultLogger } from "../../types";
import type { BillingProductProvider, BillingProduct } from "../types";

const MOCK_PRODUCTS: BillingProduct[] = [
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

export class MockProductProvider implements BillingProductProvider {
  private logger: BillingLogger;

  constructor(logger?: BillingLogger) {
    this.logger = logger ?? defaultLogger;
  }

  async listProducts(): Promise<BillingProduct[]> {
    this.logger.debug("[Mock Billing] Listed products", { count: MOCK_PRODUCTS.length });
    return MOCK_PRODUCTS;
  }

  async getProduct(productId: string): Promise<BillingProduct | null> {
    const product = MOCK_PRODUCTS.find((p) => p.id === productId) ?? null;
    this.logger.debug("[Mock Billing] Get product", { productId, found: !!product });
    return product;
  }
}
