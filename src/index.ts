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
 * // Any framework that gives you a Request
 * app.all("/api/v1/billing/*", (req) => billing.handler(req));
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
  PurchaseRepository,
  CartItemRepository,
} from "./repositories/types";

// Entities
export {
  Customer,
  BillingProviderType,
  Purchase,
  Subscription,
  SubscriptionStatus,
  BillingEvent,
  CartItem,
  Cart,
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
  getStatusMessage,
  getLowestMonthlyPrice,
  EntitlementResolver,
} from "./core/domain";
export type { Entitlement, EntitlementSet, EntitlementConfig } from "./core/domain";

// Config
export { BillingConfigSchema, isManagedProduct, getProductId, getManagedProducts, getConfiguredProductIds } from "./core/config";
export type {
  BillingAppConfig,
  BillingAppConfigInput,
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
  PurchaseCompletedContext,
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
  CheckoutLineItem,
  PurchaseCheckoutOptions,
  CompletedPurchaseItem,
  WebhookResource,
  SubscriptionChangeStrategy,
  CancellationTiming,
  ChangeSubscriptionOptions,
  ChangeStrategyHandler,
  CancelStrategyHandler,
  BillingProductProvider,
  BillingCheckoutProvider,
  BillingCustomerProvider,
  BillingSubscriptionProvider,
  BillingWebhookProvider,
  BillingProviders,
  BillingProviderConfig,
} from "./providers";

// Service classes + types (for advanced usage / testing)
export { BillingStatusService } from "./services/status";
export type { AccessState, BillingStatusResult, ProductResult } from "./services/status";
export { BillingCheckoutService } from "./services/checkout";
export type {
  CheckoutInput,
  CheckoutResult,
  PurchaseCheckoutInput,
  PortalResult,
  ChangeSubscriptionInput,
} from "./services/checkout";
export { BillingSyncService } from "./services/sync";
export { BillingWebhookService } from "./services/webhook";
export { BillingCartService } from "./services/cart";
