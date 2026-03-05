/**
 * Global e2e setup/teardown — runs once before/after all test files.
 *
 * Cleans up any stale e2e resources left in Stripe by previous crashed runs.
 */

import { cleanStaleE2EProducts, cleanStaleE2ECustomers } from "./helpers/cleanup";

export async function setup(): Promise<void> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return;

  await cleanStaleE2EProducts(key);
  await cleanStaleE2ECustomers(key);
}

export async function teardown(): Promise<void> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return;

  await cleanStaleE2ECustomers(key);
  await cleanStaleE2EProducts(key);
}
