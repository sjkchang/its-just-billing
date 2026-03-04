/**
 * Global e2e setup — runs once before all test files.
 *
 * Archives any stale e2e products left in Stripe by previous crashed runs.
 */

import { cleanStaleE2EProducts } from "./helpers/cleanup";

export async function setup(): Promise<void> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return;

  await cleanStaleE2EProducts(key);
}
