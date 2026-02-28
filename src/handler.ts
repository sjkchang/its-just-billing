/**
 * Web standard request handler for the billing package.
 *
 * Creates a (request: Request) => Promise<Response> using web standards only.
 * Replaces the Hono routes — framework-agnostic, just like Better Auth's handler.
 */

import { z } from "zod";
import { BillingBadRequestError, BillingNotFoundError } from "./core/errors";
import type { BillingInstance } from "./billing";
import type { BillingUser } from "./core/hooks";
import type { BillingStatusResult } from "./services/status";

// ============================================================================
// Request Schemas (Zod validation)
// ============================================================================

const CheckoutRequest = z.object({
  productId: z.string().min(1, "Product ID is required"),
  successUrl: z.string().url("Success URL must be a valid URL"),
  cancelUrl: z.string().url("Cancel URL must be a valid URL").optional(),
});

const PortalRequest = z.object({
  returnUrl: z.string().url("Return URL must be a valid URL"),
});

const UpdateSubscriptionBody = z.object({
  productId: z.string().min(1, "Product ID is required"),
});

// ============================================================================
// Response helpers
// ============================================================================

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  }) as Response;
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse({ error: message }, status);
}

// ============================================================================
// Mapper
// ============================================================================

function toBillingStatusResponse(result: BillingStatusResult) {
  return {
    entitlements: result.entitlements,
    productId: result.productId,
    productName: result.productName,
    productDescription: result.productDescription,
    subscription: result.subscription
      ? {
          id: result.subscription.id,
          status: result.subscription.status,
          currentPeriodEnd: result.subscription.currentPeriodEnd?.toISOString() ?? null,
          pendingCancellation: result.subscription.pendingCancellation,
        }
      : null,
    statusMessage: result.statusMessage,
    metadata: result.metadata,
  };
}

// ============================================================================
// Auth helper
// ============================================================================

async function resolveUserOrThrow(
  resolveUser: (req: Request) => Promise<BillingUser | null>,
  req: Request
): Promise<BillingUser> {
  const user = await resolveUser(req);
  if (!user) {
    throw new BillingNotFoundError("Unauthorized");
  }
  return user;
}

// ============================================================================
// Route matching
// ============================================================================

interface RouteMatch {
  params: Record<string, string>;
}

function matchRoute(
  method: string,
  path: string,
  expectedMethod: string,
  pattern: string
): RouteMatch | null {
  if (method !== expectedMethod) return null;

  // Convert pattern like "/subscriptions/:id/resume" to regex
  const paramNames: string[] = [];
  const regexStr = pattern.replace(/:([^/]+)/g, (_match, name) => {
    paramNames.push(name);
    return "([^/]+)";
  });

  const regex = new RegExp(`^${regexStr}$`);
  const match = path.match(regex);
  if (!match) return null;

  const params: Record<string, string> = {};
  paramNames.forEach((name, i) => {
    params[name] = match[i + 1];
  });

  return { params };
}

// ============================================================================
// Handler factory
// ============================================================================

export function createBillingHandler(
  instance: BillingInstance,
  basePath: string,
  webhookPath?: string
): (request: Request) => Promise<Response> {
  // Normalize paths: remove trailing slashes
  const normalizedBase = basePath.replace(/\/$/, "");
  const normalizedWebhookBase = webhookPath?.replace(/\/$/, "");

  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      const fullPath = url.pathname;

      // Strip basePath (or webhookPath) to get the billing-relative path
      let path: string;
      if (fullPath.startsWith(normalizedBase)) {
        path = fullPath.slice(normalizedBase.length) || "/";
      } else if (normalizedWebhookBase && fullPath.startsWith(normalizedWebhookBase)) {
        // Webhook requests may arrive at a separate mount point (e.g. /api/v1/webhooks)
        path = "/webhooks" + fullPath.slice(normalizedWebhookBase.length);
      } else {
        return errorResponse("Not found", 404);
      }
      const method = request.method.toUpperCase();

      // GET /status
      if (matchRoute(method, path, "GET", "/status")) {
        const user = await resolveUserOrThrow(instance.resolveUser, request);
        const status = await instance.statusService.getBillingStatus(user);
        return jsonResponse(toBillingStatusResponse(status));
      }

      // POST /checkout
      if (matchRoute(method, path, "POST", "/checkout")) {
        const user = await resolveUserOrThrow(instance.resolveUser, request);
        const body = await request.json();
        const data = CheckoutRequest.parse(body);
        const result = await instance.checkoutService.createCheckout(user, data);
        return jsonResponse(result);
      }

      // POST /portal
      if (matchRoute(method, path, "POST", "/portal")) {
        const user = await resolveUserOrThrow(instance.resolveUser, request);
        const body = await request.json();
        const data = PortalRequest.parse(body);
        const result = await instance.checkoutService.createPortal(user, data.returnUrl);
        return jsonResponse(result);
      }

      // POST /sync
      if (matchRoute(method, path, "POST", "/sync")) {
        const user = await resolveUserOrThrow(instance.resolveUser, request);
        await instance.syncService.syncBillingState(user);
        const status = await instance.statusService.getBillingStatus(user);
        return jsonResponse(toBillingStatusResponse(status));
      }

      // GET /products
      if (matchRoute(method, path, "GET", "/products")) {
        const products = await instance.statusService.listProducts();
        return jsonResponse({ products });
      }

      // DELETE /subscriptions/:id
      let match = matchRoute(method, path, "DELETE", "/subscriptions/:id");
      if (match) {
        const user = await resolveUserOrThrow(instance.resolveUser, request);
        await instance.checkoutService.cancelSubscription(user, match.params.id);
        const status = await instance.statusService.getBillingStatus(user);
        return jsonResponse(toBillingStatusResponse(status));
      }

      // POST /subscriptions/:id/resume
      match = matchRoute(method, path, "POST", "/subscriptions/:id/resume");
      if (match) {
        const user = await resolveUserOrThrow(instance.resolveUser, request);
        await instance.checkoutService.uncancelSubscription(user, match.params.id);
        const status = await instance.statusService.getBillingStatus(user);
        return jsonResponse(toBillingStatusResponse(status));
      }

      // PUT /subscriptions/:id
      match = matchRoute(method, path, "PUT", "/subscriptions/:id");
      if (match) {
        const user = await resolveUserOrThrow(instance.resolveUser, request);
        const body = await request.json();
        const data = UpdateSubscriptionBody.parse(body);
        await instance.checkoutService.changeSubscription(user, {
          subscriptionId: match.params.id,
          productId: data.productId,
        });
        const status = await instance.statusService.getBillingStatus(user);
        return jsonResponse(toBillingStatusResponse(status));
      }

      // POST /webhooks/stripe
      if (matchRoute(method, path, "POST", "/webhooks/stripe")) {
        const body = await request.text();
        const webhookHeaders = {
          "stripe-signature": request.headers.get("stripe-signature") ?? "",
        };
        await instance.webhookService.handleWebhook(body, webhookHeaders);
        return jsonResponse({ received: true });
      }

      return errorResponse("Not found", 404);
    } catch (err) {
      if (err instanceof z.ZodError) {
        const message = err.errors.map((e) => e.message).join(", ");
        return errorResponse(message, 400);
      }
      if (err instanceof BillingBadRequestError) {
        return errorResponse(err.message, 400);
      }
      if (err instanceof BillingNotFoundError) {
        if (err.message === "Unauthorized") {
          return errorResponse("Unauthorized", 401);
        }
        return errorResponse(err.message, 404);
      }
      throw err;
    }
  };
}
