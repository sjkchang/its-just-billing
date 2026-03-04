/**
 * Stripe helpers — create customers/subscriptions directly in Stripe for testing.
 *
 * Creates a test PaymentMethod via the Stripe token API, then uses it
 * to create subscriptions without going through the Checkout flow.
 */

import Stripe from "stripe";
import type { StripeCleanup } from "./cleanup";

export interface CreateSubscriptionResult {
  customer: Stripe.Customer;
  subscription: Stripe.Subscription;
}

export async function createStripeSubscription(
  secretKey: string,
  opts: {
    productId: string;
    userId: string;
    email: string;
    name?: string;
  },
  cleanup: StripeCleanup,
): Promise<CreateSubscriptionResult> {
  const stripe = new Stripe(secretKey);

  // Create a test payment method from the tok_visa token
  const pm = await stripe.paymentMethods.create({
    type: "card",
    card: { token: "tok_visa" },
  });

  // Create customer with externalId metadata (matching what billing package sets)
  const customer = await stripe.customers.create({
    email: opts.email,
    name: opts.name,
    metadata: { externalId: opts.userId },
    payment_method: pm.id,
    invoice_settings: { default_payment_method: pm.id },
  });
  cleanup.trackCustomer(customer.id);

  // Find the default price for the product
  const product = await stripe.products.retrieve(opts.productId);
  const priceId = typeof product.default_price === "string"
    ? product.default_price
    : product.default_price?.id;

  let resolvedPriceId: string;
  if (!priceId) {
    // Fallback: list prices
    const prices = await stripe.prices.list({ product: opts.productId, active: true, limit: 1 });
    if (prices.data.length === 0) {
      throw new Error(`No active price found for product ${opts.productId}`);
    }
    resolvedPriceId = prices.data[0].id;
  } else {
    resolvedPriceId = priceId;
  }

  // Create subscription with test card
  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: resolvedPriceId }],
    default_payment_method: pm.id,
  });
  cleanup.trackSubscription(subscription.id);

  return { customer, subscription };
}
