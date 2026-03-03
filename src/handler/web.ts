/**
 * Web standard request handler for the billing package.
 *
 * Creates a (request: Request) => Promise<Response> using web standards only.
 * Framework-agnostic — just like Better Auth's handler.
 */

import type { BillingInstance } from "../billing";
import {
  CheckoutRequestSchema,
  PortalRequestSchema,
  UpdateSubscriptionBodySchema,
  toBillingStatusResponse,
  resolveUserOrThrow,
  validateRedirectUrl,
  mapBillingError,
} from "./shared";

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
  webhookPath?: string,
  allowedRedirectOrigins?: string[]
): (request: Request) => Promise<Response> {
  const normalizedBase = basePath.replace(/\/$/, "");
  const normalizedWebhookBase = webhookPath?.replace(/\/$/, "");

  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      const fullPath = url.pathname;

      let path: string;
      if (fullPath.startsWith(normalizedBase)) {
        path = fullPath.slice(normalizedBase.length) || "/";
      } else if (normalizedWebhookBase && fullPath.startsWith(normalizedWebhookBase)) {
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
        const data = CheckoutRequestSchema.parse(body);
        validateRedirectUrl(data.successUrl, allowedRedirectOrigins);
        if (data.cancelUrl) validateRedirectUrl(data.cancelUrl, allowedRedirectOrigins);
        const result = await instance.checkoutService.createCheckout(user, data);
        return jsonResponse(result);
      }

      // POST /portal
      if (matchRoute(method, path, "POST", "/portal")) {
        const user = await resolveUserOrThrow(instance.resolveUser, request);
        const body = await request.json();
        const data = PortalRequestSchema.parse(body);
        validateRedirectUrl(data.returnUrl, allowedRedirectOrigins);
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
        const data = UpdateSubscriptionBodySchema.parse(body);
        await instance.checkoutService.changeSubscription(user, {
          subscriptionId: match.params.id,
          productId: data.productId,
          interval: data.interval,
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
      const mapped = mapBillingError(err);
      if (mapped) return errorResponse(mapped.body.error, mapped.status);
      throw err;
    }
  };
}
