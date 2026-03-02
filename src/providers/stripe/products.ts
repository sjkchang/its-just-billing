/**
 * Stripe product provider.
 */

import type Stripe from "stripe";
import type { BillingLogger } from "../../core/types";
import { defaultLogger } from "../../core/types";
import { mapPriceInterval } from "./shared";
import type { ProductConfig } from "../../core/config";
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

  /**
   * Sync managed product definitions to Stripe.
   *
   * Uses Stripe's custom product ID feature so `config.id` IS the Stripe product ID.
   * Prices are matched by `(amount, currency, interval)` tuple. Since Stripe prices
   * are immutable, changed prices get archived and recreated.
   */
  async syncProducts(products: ProductConfig[]): Promise<void> {
    this.logger.info("Starting product sync", { count: products.length });

    for (const product of products) {
      try {
        await this.syncOneProduct(product);
      } catch (err) {
        this.logger.warn(`Product sync failed for "${product.id}" — skipping`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    this.logger.info("Product sync complete");
  }

  private async syncOneProduct(product: ProductConfig): Promise<void> {
    let stripeProduct: Stripe.Product | null = null;
    try {
      stripeProduct = await this.stripe.products.retrieve(product.id);
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode !== 404) throw err;
    }

    const productFields = {
      name: product.name,
      ...(product.description !== undefined && { description: product.description }),
      ...(product.metadata && { metadata: product.metadata }),
    };

    if (!stripeProduct) {
      this.logger.info(`Creating product "${product.id}"`);
      stripeProduct = await this.stripe.products.create({ id: product.id, ...productFields });
    } else if (!stripeProduct.active) {
      this.logger.info(`Reactivating archived product "${product.id}"`);
      stripeProduct = await this.stripe.products.update(product.id, { active: true, ...productFields });
    } else {
      const needsUpdate =
        stripeProduct.name !== product.name ||
        stripeProduct.description !== (product.description ?? "") ||
        !metadataMatches(stripeProduct.metadata, product.metadata);

      if (needsUpdate) {
        this.logger.info(`Updating product "${product.id}"`);
        stripeProduct = await this.stripe.products.update(product.id, productFields);
      }
    }

    // Sync prices
    const existingPrices = await this.stripe.prices.list({ product: product.id, active: true, limit: 100 });

    const matchedStripePriceIds = new Set<string>();
    let firstPriceId: string | null = null;

    for (const configPrice of product.prices) {
      const match = existingPrices.data.find(
        (sp) =>
          sp.unit_amount === configPrice.amount &&
          sp.currency === configPrice.currency &&
          sp.recurring?.interval === configPrice.interval &&
          !matchedStripePriceIds.has(sp.id),
      );

      if (match) {
        matchedStripePriceIds.add(match.id);
        if (!firstPriceId) firstPriceId = match.id;
      } else {
        this.logger.info(`Creating price for "${product.id}": ${configPrice.amount} ${configPrice.currency}/${configPrice.interval}`);
        const newPrice = await this.stripe.prices.create({
          product: product.id,
          unit_amount: configPrice.amount,
          currency: configPrice.currency,
          recurring: { interval: configPrice.interval },
        });
        matchedStripePriceIds.add(newPrice.id);
        if (!firstPriceId) firstPriceId = newPrice.id;
      }
    }

    // Update default_price before archiving
    if (firstPriceId) {
      await this.stripe.products.update(product.id, { default_price: firstPriceId });
    }

    // Archive unmatched prices
    for (const sp of existingPrices.data) {
      if (!matchedStripePriceIds.has(sp.id)) {
        this.logger.info(`Archiving price "${sp.id}" for product "${product.id}"`);
        await this.stripe.prices.update(sp.id, { active: false });
      }
    }
  }
}

function metadataMatches(
  stripeMetadata: Record<string, string>,
  configMetadata: Record<string, string> | undefined,
): boolean {
  const config = configMetadata ?? {};
  const stripeKeys = Object.keys(stripeMetadata);
  const configKeys = Object.keys(config);
  if (stripeKeys.length !== configKeys.length) return false;
  return configKeys.every((key) => stripeMetadata[key] === config[key]);
}
