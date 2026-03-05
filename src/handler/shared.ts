/**
 * Shared handler utilities — Zod schemas, response mappers, and error helpers.
 *
 * Used by both the web-standard handler and framework adapters (Hono, etc.).
 */

import { z } from "zod";
import { BillingBadRequestError, BillingUnauthorizedError, BillingNotFoundError } from "../core/errors";
import type { BillingUser } from "../core/hooks";
import type { BillingStatusResult } from "../services/status";
import type { Cart, CartItem } from "../core/entities";

// ============================================================================
// Request Schemas
// ============================================================================

export const CheckoutRequestSchema = z.object({
  productId: z.string().min(1, "Product ID is required"),
  successUrl: z.string().url("Success URL must be a valid URL"),
  cancelUrl: z.string().url("Cancel URL must be a valid URL").optional(),
});

export const PortalRequestSchema = z.object({
  returnUrl: z.string().url("Return URL must be a valid URL"),
});

export const UpdateSubscriptionBodySchema = z.object({
  productId: z.string().min(1, "Product ID is required"),
  interval: z.enum(["day", "week", "month", "year"]).optional(),
});

export const AddCartItemSchema = z.object({
  productId: z.string().min(1, "Product ID is required"),
  quantity: z.number().int().positive().optional(),
});

export const UpdateCartItemSchema = z.object({
  quantity: z.number().int().positive("Quantity must be a positive integer"),
});

export const CartCheckoutSchema = z.object({
  successUrl: z.string().url("Success URL must be a valid URL"),
  cancelUrl: z.string().url("Cancel URL must be a valid URL").optional(),
});

export const PurchaseRequestSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1, "Product ID is required"),
        quantity: z.number().int().positive().optional(),
      }),
    )
    .min(1, "At least one item is required"),
  successUrl: z.string().url("Success URL must be a valid URL"),
  cancelUrl: z.string().url("Cancel URL must be a valid URL").optional(),
});

// ============================================================================
// Response mapper
// ============================================================================

export function toBillingStatusResponse(result: BillingStatusResult) {
  return {
    entitlements: result.entitlements,
    accessState: result.accessState,
    productId: result.productId,
    productName: result.productName,
    productDescription: result.productDescription,
    subscription: result.subscription
      ? {
          id: result.subscription.id,
          status: result.subscription.status,
          currentPeriodEnd: result.subscription.currentPeriodEnd?.toISOString() ?? null,
          pendingCancellation: result.subscription.pendingCancellation,
          pendingProductId: result.subscription.pendingProductId,
        }
      : null,
    purchases: result.purchases.map((p) => ({
      id: p.id,
      providerProductId: p.providerProductId,
      quantity: p.quantity,
      amount: p.amount,
      currency: p.currency,
      purchasedAt: p.purchasedAt instanceof Date ? p.purchasedAt.toISOString() : p.purchasedAt,
    })),
    statusMessage: result.statusMessage,
    metadata: result.metadata,
  };
}

export function toCartItemResponse(item: CartItem) {
  return {
    productId: item.productId,
    quantity: item.quantity,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export function toCartResponse(cart: Cart) {
  return {
    userId: cart.userId,
    items: cart.items.map(toCartItemResponse),
  };
}

// ============================================================================
// Auth helper
// ============================================================================

export async function resolveUserOrThrow(
  resolveUser: (req: Request) => Promise<BillingUser | null>,
  req: Request
): Promise<BillingUser> {
  const user = await resolveUser(req);
  if (!user) {
    throw new BillingUnauthorizedError();
  }
  return user;
}

// ============================================================================
// Redirect URL validation
// ============================================================================

export function validateRedirectUrl(url: string, allowedOrigins?: string[]): void {
  if (!allowedOrigins || allowedOrigins.length === 0) return;
  try {
    const parsed = new URL(url);
    if (!allowedOrigins.includes(parsed.origin)) {
      throw new BillingBadRequestError(
        `Redirect URL origin is not allowed`
      );
    }
  } catch (err) {
    if (err instanceof BillingBadRequestError) throw err;
    throw new BillingBadRequestError("Invalid redirect URL");
  }
}

// ============================================================================
// Error mapper
// ============================================================================

export function mapBillingError(err: unknown): { status: number; body: { error: string } } | null {
  if (err instanceof z.ZodError) {
    const message = err.errors.map((e) => e.message).join(", ");
    return { status: 400, body: { error: message } };
  }
  if (err instanceof BillingBadRequestError) {
    return { status: 400, body: { error: err.message } };
  }
  if (err instanceof BillingUnauthorizedError) {
    return { status: 401, body: { error: err.message } };
  }
  if (err instanceof BillingNotFoundError) {
    return { status: 404, body: { error: err.message } };
  }
  return null;
}
