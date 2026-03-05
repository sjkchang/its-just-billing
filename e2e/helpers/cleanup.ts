/**
 * Stripe resource cleanup — tracks and removes all resources created during e2e tests.
 */

import Stripe from "stripe";

/**
 * Archive any stale e2e products left behind by crashed/interrupted test runs.
 * Products created by e2e tests use IDs starting with "e2e_".
 */
export async function cleanStaleE2EProducts(secretKey: string): Promise<void> {
  const stripe = new Stripe(secretKey);

  for await (const product of stripe.products.list({ active: true })) {
    if (!product.id.startsWith("e2e_")) continue;
    await archiveProduct(stripe, product.id);
  }
}

/**
 * Delete any e2e customers left behind by crashed/interrupted test runs.
 * Customers created by e2e tests have metadata.externalId starting with "e2e_".
 */
export async function cleanStaleE2ECustomers(secretKey: string): Promise<void> {
  const stripe = new Stripe(secretKey);

  for await (const customer of stripe.customers.list({ limit: 100 })) {
    const externalId = customer.metadata?.externalId;
    if (!externalId?.startsWith("e2e_")) continue;

    try {
      await stripe.customers.del(customer.id);
    } catch {
      // Best-effort
    }
  }
}

async function archiveProduct(stripe: Stripe, productId: string): Promise<void> {
  // Clear default_price first — Stripe won't let you archive a product's default price
  await stripe.products.update(productId, { default_price: "" });
  // Deactivate ALL prices (paginated — default page size is 10)
  for await (const price of stripe.prices.list({ product: productId, active: true })) {
    await stripe.prices.update(price.id, { active: false });
  }
  await stripe.products.update(productId, { active: false });
}

export class StripeCleanup {
  private stripe: Stripe;
  private customerIds: Set<string> = new Set();
  private productIds: Set<string> = new Set();
  private subscriptionIds: Set<string> = new Set();

  constructor(secretKey: string) {
    this.stripe = new Stripe(secretKey);
  }

  trackCustomer(id: string): void {
    this.customerIds.add(id);
  }

  trackProduct(id: string): void {
    this.productIds.add(id);
  }

  trackSubscription(id: string): void {
    this.subscriptionIds.add(id);
  }

  async cleanAll(): Promise<void> {
    // Cancel subscriptions first (before deleting customers)
    for (const id of this.subscriptionIds) {
      try {
        await this.stripe.subscriptions.cancel(id);
      } catch {
        // Already canceled or doesn't exist
      }
    }

    // Delete customers (cascades their subscriptions/invoices in Stripe)
    for (const id of this.customerIds) {
      try {
        await this.stripe.customers.del(id);
      } catch {
        // Already deleted
      }
    }

    // Archive products (can't delete products that have prices)
    for (const id of this.productIds) {
      await archiveProduct(this.stripe, id);
    }
  }
}
