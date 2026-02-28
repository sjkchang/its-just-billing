/**
 * @kitforge/billing — self-contained billing engine.
 *
 * Create an instance with createBilling(), mount with app.all(),
 * and use billing.api for server-side access.
 *
 * @example
 * ```ts
 * import { createBilling } from "@kitforge/billing";
 * import { drizzleRepositories } from "@kitforge/billing/repositories/drizzle";
 *
 * const billing = await createBilling({
 *   adapter: drizzleRepositories(db, { billingCustomers, billingSubscriptions, billingEvents }),
 *   provider: { provider: "stripe", secretKey: "sk_..." },
 *   resolveUser: async (req) => { ... },
 * });
 *
 * // Hono
 * app.all("/api/v1/billing/*", (c) => billing.handler(c.req.raw));
 * ```
 */

// Core API
export { BillingInstance } from "./billing";
export type { CreateBillingConfig, BillingAPI } from "./billing";

export async function createBilling(
  config: import("./billing").CreateBillingConfig
): Promise<import("./billing").BillingInstance> {
  const { BillingInstance } = await import("./billing");
  return BillingInstance.create(config);
}

// Repository interfaces
export type {
  BillingRepositories,
  CustomerRepository,
  SubscriptionRepository,
  BillingEventRepository,
} from "./repository";

// Entities
export {
  Customer,
  BillingProviderType,
  Subscription,
  SubscriptionStatus,
  BillingEvent,
} from "./entities";

// Domain
export {
  isActiveStatus,
  isActive,
  isEnding,
  hasEnded,
  getActiveSubscription,
  daysUntilEnd,
  getChangeDirection,
  strategyToProrationBehavior,
  getStatusMessage,
  EntitlementResolver,
} from "./domain";
export type { Entitlement, EntitlementSet, EntitlementConfig } from "./domain";

// Config
export { BillingConfigSchema } from "./config";
export type { BillingAppConfig, CancellationConfig, SubscriptionStrategyConfig } from "./config";

// Hook types + runners
export { runBeforeHook, runAfterHook } from "./hooks";
export type {
  BillingUser,
  BillingHooks,
  CheckoutHookContext,
  CancelHookContext,
  PlanChangeHookContext,
  SubscriptionActivatedContext,
  SubscriptionCanceledContext,
  SubscriptionChangedContext,
  SubscriptionExpiredContext,
  CustomerCreatedContext,
} from "./hooks";

// Errors
export { BillingError, BillingBadRequestError, BillingNotFoundError } from "./errors";

// Logger
export type { BillingLogger } from "./types";
export { defaultLogger } from "./types";

// Provider factory + types
export { createBillingProviders } from "./providers";

export type {
  BillingCustomer,
  BillingSubscription,
  CustomerState,
  BillingProduct,
  BillingPrice,
  CheckoutSession,
  PortalSession,
  CheckoutOptions,
  WebhookResource,
  ProrationBehavior,
  ChangeSubscriptionOptions,
  BillingProductProvider,
  BillingCheckoutProvider,
  BillingCustomerProvider,
  BillingWebhookProvider,
  BillingProviders,
  BillingProviderConfig,
} from "./providers";

// Service classes + types (for advanced usage / testing)
export { BillingStatusService } from "./services/status";
export type { BillingStatusResult, ProductResult } from "./services/status";
export { BillingCheckoutService } from "./services/checkout";
export type {
  CheckoutInput,
  CheckoutResult,
  PortalResult,
  ChangeSubscriptionInput,
} from "./services/checkout";
export { BillingSyncService } from "./services/sync";
export { BillingWebhookService } from "./services/webhook";
