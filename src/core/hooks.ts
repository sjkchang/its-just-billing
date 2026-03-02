/**
 * Billing lifecycle hook type definitions and runners.
 *
 * Defines the hook interfaces, context types, and runners used by the billing system.
 *
 * BillingUser is a minimal user type for hook contexts. The API's User entity
 * (which includes `roles`) structurally satisfies BillingUser, so passing a
 * User where BillingUser is expected works without casts.
 */

import type { Customer, Subscription } from "./entities";
import { BillingBadRequestError } from "./errors";
import type { BillingLogger } from "./types";
import { defaultLogger } from "./types";

// ============================================================================
// BillingUser — minimal user type for hook contexts
// ============================================================================

export interface BillingUser {
  id: string;
  email: string;
  name: string | null;
}

// ============================================================================
// Hook Contexts
// ============================================================================

export interface CheckoutHookContext {
  user: BillingUser;
  productId: string;
}

export interface CancelHookContext {
  user: BillingUser;
  customer: Customer;
  subscription: Subscription;
}

export interface PlanChangeHookContext {
  user: BillingUser;
  customer: Customer;
  subscription: Subscription;
  fromProductId: string;
  toProductId: string;
  direction: "upgrade" | "downgrade" | "sidegrade";
  strategy: "immediate_prorate" | "immediate_full" | "at_period_end";
}

export interface SubscriptionActivatedContext {
  customer: Customer;
  subscription: Subscription;
}

export interface SubscriptionCanceledContext {
  customer: Customer;
  subscription: Subscription;
}

export interface SubscriptionChangedContext {
  customer: Customer;
  subscription: Subscription;
  previousProductId: string;
  newProductId: string;
}

export interface SubscriptionExpiredContext {
  customer: Customer;
  subscription: Subscription;
}

export interface CustomerCreatedContext {
  user: BillingUser;
  customer: Customer;
}

// ============================================================================
// Hook Interface
// ============================================================================

export interface BillingHooks {
  /**
   * Fire when a user acts through the billing API (SDK or HTTP).
   * "before" hooks can reject by throwing. "after" hooks are fire-and-forget.
   * Do NOT fire for external changes (Stripe dashboard, webhooks).
   */
  api?: {
    checkout?: {
      before?: (ctx: CheckoutHookContext) => Promise<void>;
      after?: (ctx: CheckoutHookContext) => Promise<void>;
    };
    cancel?: {
      before?: (ctx: CancelHookContext) => Promise<void>;
      after?: (ctx: CancelHookContext) => Promise<void>;
    };
    planChange?: {
      before?: (ctx: PlanChangeHookContext) => Promise<void>;
      after?: (ctx: PlanChangeHookContext) => Promise<void>;
    };
  };

  /**
   * Fire when state transitions are detected during sync (webhooks, manual sync).
   * Always fire-and-forget. Fire regardless of how the change originated.
   * Use for reliable reactions to state changes.
   */
  lifecycle?: {
    onSubscriptionActivated?: (
      ctx: SubscriptionActivatedContext,
    ) => Promise<void>;
    onSubscriptionCanceled?: (
      ctx: SubscriptionCanceledContext,
    ) => Promise<void>;
    onSubscriptionChanged?: (ctx: SubscriptionChangedContext) => Promise<void>;
    onSubscriptionExpired?: (ctx: SubscriptionExpiredContext) => Promise<void>;
    onCustomerCreated?: (ctx: CustomerCreatedContext) => Promise<void>;
  };
}

// ============================================================================
// Hook Runners
// ============================================================================

/**
 * Run a "before" hook. Awaited — errors propagate as BillingBadRequestError to abort the operation.
 */
export async function runBeforeHook<T>(
  fn: ((ctx: T) => Promise<void>) | undefined,
  ctx: T,
  name: string,
  logger: BillingLogger = defaultLogger,
): Promise<void> {
  if (!fn) return;
  try {
    await fn(ctx);
  } catch (error) {
    logger.warn(`Before hook "${name}" threw`, { error });
    if (error instanceof BillingBadRequestError) throw error;
    throw new BillingBadRequestError(
      error instanceof Error
        ? error.message
        : `Hook "${name}" rejected the operation`,
    );
  }
}

/**
 * Run an "after" hook. Fire-and-forget — errors are logged but swallowed.
 */
export function runAfterHook<T>(
  fn: ((ctx: T) => Promise<void>) | undefined,
  ctx: T,
  name: string,
  logger: BillingLogger = defaultLogger,
): void {
  if (!fn) return;
  fn(ctx).catch((error) => {
    logger.error(`After hook "${name}" threw (swallowed)`, { error });
  });
}
