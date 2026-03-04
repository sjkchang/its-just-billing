/**
 * Stripe provider — shared contract test suite.
 *
 * Skipped when STRIPE_SECRET_KEY is not set.
 * Uses real Stripe test-mode API calls.
 */

import Stripe from "stripe";
import { describe, beforeAll, afterAll } from "vitest";
import { createStripeProviders } from "../../providers/stripe/index";
import { resolveRecurringPriceId } from "../../providers/stripe/shared";
import type { ProviderFactory, ProviderTestContext } from "./harness";
import { testLogger } from "./harness";
import { defineProductTests } from "./define-product-tests";
import { defineCustomerTests } from "./define-customer-tests";
import { defineCheckoutTests } from "./define-checkout-tests";
import { defineSubscriptionTests } from "./define-subscription-tests";
import { defineWebhookTests } from "./define-webhook-tests";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

describe.skipIf(!STRIPE_SECRET_KEY)("Stripe Provider", () => {
  let stripe: Stripe;
  let productIds: [string, string];

  // Global cleanup tracking (safety net for afterAll)
  const allCustomerIds: string[] = [];
  const allSubscriptionIds: string[] = [];

  let seedCounter = 0;

  beforeAll(async () => {
    stripe = new Stripe(STRIPE_SECRET_KEY!);
    const prefix = `provider_test_${Date.now()}`;

    // Create two test products with recurring prices
    const prodA = await stripe.products.create({ name: `${prefix}_A` });
    const priceA = await stripe.prices.create({
      product: prodA.id,
      unit_amount: 1000,
      currency: "usd",
      recurring: { interval: "month" },
    });
    await stripe.products.update(prodA.id, { default_price: priceA.id });

    const prodB = await stripe.products.create({ name: `${prefix}_B` });
    const priceB = await stripe.prices.create({
      product: prodB.id,
      unit_amount: 2000,
      currency: "usd",
      recurring: { interval: "month" },
    });
    await stripe.products.update(prodB.id, { default_price: priceB.id });

    productIds = [prodA.id, prodB.id];
  }, 30_000);

  afterAll(async () => {
    // Cancel any remaining subscriptions
    for (const subId of allSubscriptionIds) {
      try {
        await stripe.subscriptions.cancel(subId);
      } catch {
        // already canceled
      }
    }

    // Delete any remaining customers
    for (const custId of allCustomerIds) {
      try {
        await stripe.customers.del(custId);
      } catch {
        // already deleted
      }
    }

    // Archive test products
    if (productIds) {
      for (const prodId of productIds) {
        try {
          await stripe.products.update(prodId, { active: false });
        } catch {
          // ignore
        }
      }
    }
  }, 30_000);

  const stripeFactory: ProviderFactory = async () => {
    const providers = createStripeProviders({
      secretKey: STRIPE_SECRET_KEY!,
      logger: testLogger,
    });

    const trackedCustomers: string[] = [];
    const trackedSubscriptions: string[] = [];

    const ctx: ProviderTestContext = {
      providers,
      productIds,
      sampleRelevantEvent: "customer.subscription.created",
      capabilities: {
        checkoutCreatesSubscription: false,
        eventualConsistencyOnSearch: true,
      },
      cleanup: async () => {
        for (const subId of trackedSubscriptions) {
          try {
            await stripe.subscriptions.cancel(subId);
          } catch {
            // already canceled
          }
        }
        for (const custId of trackedCustomers) {
          try {
            await stripe.customers.del(custId);
          } catch {
            // already deleted
          }
        }
      },
      trackCustomer: (id: string) => {
        trackedCustomers.push(id);
        allCustomerIds.push(id);
      },
      trackSubscription: (id: string) => {
        trackedSubscriptions.push(id);
        allSubscriptionIds.push(id);
      },
      seedSubscription: async (productId: string) => {
        const customer = await stripe.customers.create({
          email: `seed+${Date.now()}_${++seedCounter}@test.com`,
          source: "tok_visa",
          metadata: { externalId: `ext_seed_${Date.now()}_${seedCounter}` },
        });
        trackedCustomers.push(customer.id);
        allCustomerIds.push(customer.id);

        const priceId = await resolveRecurringPriceId(stripe, productId);
        const sub = await stripe.subscriptions.create({
          customer: customer.id,
          items: [{ price: priceId }],
        });
        trackedSubscriptions.push(sub.id);
        allSubscriptionIds.push(sub.id);

        return {
          customerId: customer.id,
          subscriptionId: sub.id,
        };
      },
    };

    return ctx;
  };

  defineProductTests(stripeFactory);
  defineCustomerTests(stripeFactory);
  defineCheckoutTests(stripeFactory);
  defineSubscriptionTests(stripeFactory);
  defineWebhookTests(stripeFactory);
}, 60_000);
