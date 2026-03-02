/**
 * Stripe product provider.
 */

import type Stripe from "stripe";
import type { BillingLogger } from "../../core/types";
import { defaultLogger } from "../../core/types";
import { mapPriceInterval } from "./shared";
import type { BillingProductProvider, BillingProduct, BillingPrice } from "../types";

function mapStripeProduct(product: Stripe.Product, prices: Stripe.Price[]): BillingProduct {
  const billingPrices: BillingPrice[] = prices.map((price) => ({
    id: price.id,
    productId: product.id,
    amount: price.unit_amount ?? 0,
    currency: price.currency,
    interval: mapPriceInterval(price.recurring?.interval ?? null),
  }));

  return {
    id: product.id,
    name: product.name,
    description: product.description ?? null,
    prices: billingPrices,
    metadata: product.metadata as Record<string, string> | undefined,
  };
}

export class StripeProductProvider implements BillingProductProvider {
  private logger: BillingLogger;

  constructor(
    private stripe: Stripe,
    logger?: BillingLogger
  ) {
    this.logger = logger ?? defaultLogger;
  }

  async listProducts(): Promise<BillingProduct[]> {
    try {
      const products: BillingProduct[] = [];

      for await (const product of this.stripe.products.list({ active: true })) {
        const prices = await this.stripe.prices.list({
          product: product.id,
          active: true,
          limit: 100,
        });
        products.push(mapStripeProduct(product, prices.data));
      }

      return products;
    } catch (error) {
      this.logger.error("Failed to list products", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  async getProduct(productId: string): Promise<BillingProduct | null> {
    try {
      const product = await this.stripe.products.retrieve(productId);
      const prices = await this.stripe.prices.list({
        product: productId,
        active: true,
        limit: 100,
      });
      return mapStripeProduct(product, prices.data);
    } catch (error) {
      this.logger.debug("Product not found", { productId });
      return null;
    }
  }
}
