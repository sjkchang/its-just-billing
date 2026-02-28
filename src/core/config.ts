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
  })
  .default({});

// ============================================================================
// Top-Level Config
// ============================================================================

export const BillingConfigSchema = z
  .object({
    subscriptions: SubscriptionStrategySchema,
    entitlements: z.custom<EntitlementConfig>().optional(),
    hooks: z.custom<BillingHooks>().optional(),
  })
  .default({});

// ============================================================================
// Inferred Types
// ============================================================================

export type CancellationConfig = z.infer<typeof CancellationConfigSchema>;
export type SubscriptionStrategyConfig = z.infer<typeof SubscriptionStrategySchema>;
export type BillingAppConfig = z.infer<typeof BillingConfigSchema>;
