/**
 * Product sync — pushes config-defined products to Stripe on startup.
 *
 * Uses Stripe's custom product ID feature so `config.id` IS the Stripe product ID,
 * enabling O(1) lookup via `stripe.products.retrieve(id)`.
 *
 * Prices are matched by `(amount, currency, interval)` tuple. Since Stripe prices
 * are immutable, changed prices get archived and recreated.
 *
 * Sync is non-blocking — failures are logged as warnings and the app continues.
 */

import type { ProductConfig } from "../core/config";
import type { BillingLogger } from "../core/types";

export async function syncProducts(
  products: ProductConfig[],
  secretKey: string,
  logger: BillingLogger,
): Promise<void> {
  const Stripe = (await import("stripe")).default;
  const stripe = new Stripe(secretKey);

  logger.info("Starting product sync", { count: products.length });

  for (const product of products) {
    try {
      await syncOneProduct(stripe, product, logger);
    } catch (err) {
      logger.warn(`Product sync failed for "${product.id}" — skipping`, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info("Product sync complete");
}

async function syncOneProduct(
  stripe: import("stripe").default,
  product: ProductConfig,
  logger: BillingLogger,
): Promise<void> {
  // 1. Try to retrieve the product by custom ID
  let stripeProduct: import("stripe").Stripe.Product | null = null;
  try {
    stripeProduct = await stripe.products.retrieve(product.id);
  } catch (err: unknown) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode !== 404) throw err;
    // Product doesn't exist yet
  }

  const productFields = {
    name: product.name,
    ...(product.description !== undefined && { description: product.description }),
    ...(product.metadata && { metadata: product.metadata }),
  };

  if (!stripeProduct) {
    // 2. Not found → create with custom ID
    logger.info(`Creating product "${product.id}"`);
    stripeProduct = await stripe.products.create({ id: product.id, ...productFields });
  } else if (!stripeProduct.active) {
    // 3. Found but archived → reactivate and update
    logger.info(`Reactivating archived product "${product.id}"`);
    stripeProduct = await stripe.products.update(product.id, { active: true, ...productFields });
  } else {
    // 4. Found and active → update if different
    const needsUpdate =
      stripeProduct.name !== product.name ||
      stripeProduct.description !== (product.description ?? "") ||
      !metadataMatches(stripeProduct.metadata, product.metadata);

    if (needsUpdate) {
      logger.info(`Updating product "${product.id}"`);
      stripeProduct = await stripe.products.update(product.id, productFields);
    }
  }

  // 5. Sync prices (limit 100 covers all realistic cases)
  const existingPrices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });

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
      // 6. No match → create price
      logger.info(`Creating price for "${product.id}": ${configPrice.amount} ${configPrice.currency}/${configPrice.interval}`);
      const newPrice = await stripe.prices.create({
        product: product.id,
        unit_amount: configPrice.amount,
        currency: configPrice.currency,
        recurring: { interval: configPrice.interval },
      });
      matchedStripePriceIds.add(newPrice.id);
      if (!firstPriceId) firstPriceId = newPrice.id;
    }
  }

  // 7. Update default_price to the first config price BEFORE archiving.
  //    Always set it unconditionally — the stripeProduct.default_price field
  //    can be stale after earlier updates, and archiving a default price fails.
  if (firstPriceId) {
    await stripe.products.update(product.id, { default_price: firstPriceId });
  }

  // 8. Archive Stripe prices that have no config match (safe now — default was set above)
  for (const sp of existingPrices.data) {
    if (!matchedStripePriceIds.has(sp.id)) {
      logger.info(`Archiving price "${sp.id}" for product "${product.id}"`);
      await stripe.prices.update(sp.id, { active: false });
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
