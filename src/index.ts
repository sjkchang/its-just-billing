/**
 * its-just-billing — self-contained billing engine.
 *
 * Create an instance with createBilling(), mount with app.all(),
 * and use billing.api for server-side access.
 *
 * @example
 * ```ts
 * import { createBilling } from "its-just-billing";
 * import { drizzleRepositories } from "its-just-billing/repositories/drizzle";
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
} from "./repositories/types";

// Entities
export {
  Customer,
  BillingProviderType,
  Subscription,
  SubscriptionStatus,
  BillingEvent,
} from "./core/entities";

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
} from "./core/domain";
export type { Entitlement, EntitlementSet, EntitlementConfig } from "./core/domain";

// Config
export { BillingConfigSchema, isManagedProduct, getProductId, getManagedProducts, getConfiguredProductIds } from "./core/config";
export type {
  BillingAppConfig,
  CancellationConfig,
  SubscriptionStrategyConfig,
  ProductConfig,
  ProductEntry,
  ProductPriceConfig,
} from "./core/config";

// Hook types + runners
export { runBeforeHook, runAfterHook } from "./core/hooks";
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
} from "./core/hooks";

// Errors
export { BillingError, BillingBadRequestError, BillingNotFoundError } from "./core/errors";

// Logger & infrastructure
export type { BillingLogger, KeyValueCache } from "./core/types";
export { defaultLogger } from "./core/types";

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
