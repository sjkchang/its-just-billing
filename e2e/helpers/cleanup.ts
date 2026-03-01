/**
 * Stripe resource cleanup — tracks and removes all resources created during e2e tests.
 */

import Stripe from "stripe";

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

    // Archive products (can't delete products with prices)
    for (const id of this.productIds) {
      try {
        // Archive all prices first
        const prices = await this.stripe.prices.list({ product: id, active: true });
        for (const price of prices.data) {
          await this.stripe.prices.update(price.id, { active: false });
        }
        await this.stripe.products.update(id, { active: false });
      } catch {
        // Already archived or doesn't exist
      }
    }
  }
}
