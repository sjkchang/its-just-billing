/**
 * Billing config Zod schema — validates billing.config.ts at module load.
 *
 * All fields have defaults so `BillingConfigSchema.parse(undefined)` produces
 * the current behavior exactly (upgrade-only, cancel-at-period-end, no hooks).
 */

import { z } from "zod";
import type { EntitlementConfig } from "./domain";
import type { BillingHooks } from "./hooks";

// ============================================================================
// Subscription Strategy
// ============================================================================

const CancellationConfigSchema = z
  .object({
    timing: z.enum(["at_period_end", "immediate"]).default("at_period_end"),
    allowUncancel: z.boolean().default(true),
  })
  .default({});

const SubscriptionStrategySchema = z
  .object({
    allowUpgrade: z.boolean().default(true),
    allowDowngrade: z.boolean().default(false),
    upgradeStrategy: z.enum(["immediate_prorate", "immediate_full"]).default("immediate_prorate"),
    downgradeStrategy: z.enum(["immediate_prorate", "at_period_end"]).default("at_period_end"),
    cancellation: CancellationConfigSchema,
    tierOrder: z.array(z.string()).optional(),
    trialDays: z.number().int().positive().optional(),
    singleSubscription: z.boolean().default(true),
  })
  .default({});

// ============================================================================
// Product Config
// ============================================================================

const ProductPriceConfigSchema = z.object({
  amount: z.number().int().positive(),
  currency: z.string().default("usd"),
  interval: z.enum(["month", "year"]),
});

const ProductConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  prices: z.array(ProductPriceConfigSchema).min(1),
  metadata: z.record(z.string()).optional(),
});

/** A product entry is either a full managed config or a string ID reference. */
const ProductEntrySchema = z.union([ProductConfigSchema, z.string().min(1)]);

// ============================================================================
// Top-Level Config
// ============================================================================

export const BillingConfigSchema = z
  .object({
    products: z.array(ProductEntrySchema).optional(),
    productDisplay: z.enum(["configured", "all"]).default("configured"),
    subscriptions: SubscriptionStrategySchema,
    entitlements: z.custom<EntitlementConfig>().optional(),
    hooks: z.custom<BillingHooks>().optional(),
  })
  .default({});

// ============================================================================
// Inferred Types
// ============================================================================

export type ProductPriceConfig = z.infer<typeof ProductPriceConfigSchema>;
export type ProductConfig = z.infer<typeof ProductConfigSchema>;
export type ProductEntry = z.infer<typeof ProductEntrySchema>;
export type CancellationConfig = z.infer<typeof CancellationConfigSchema>;
export type SubscriptionStrategyConfig = z.infer<typeof SubscriptionStrategySchema>;
export type BillingAppConfig = z.infer<typeof BillingConfigSchema>;

// ============================================================================
// Product Entry Helpers
// ============================================================================

/** Check if a product entry is a fully managed config (not a string reference). */
export function isManagedProduct(entry: ProductEntry): entry is ProductConfig {
  return typeof entry !== "string";
}

/** Extract the product ID from either a managed config or a string reference. */
export function getProductId(entry: ProductEntry): string {
  return typeof entry === "string" ? entry : entry.id;
}

/** Filter product entries to only fully managed configs. */
export function getManagedProducts(entries: ProductEntry[]): ProductConfig[] {
  return entries.filter(isManagedProduct);
}

/** Extract all product IDs from a mixed array of entries. */
export function getConfiguredProductIds(entries: ProductEntry[]): string[] {
  return entries.map(getProductId);
}
