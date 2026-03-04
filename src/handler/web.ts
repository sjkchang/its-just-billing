/**
 * Web standard request handler for the billing package.
 *
 * Creates a (request: Request) => Promise<Response> using web standards only.
 * Framework-agnostic — just like Better Auth's handler.
 */

import Trouter from "trouter";
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
// Types
// ============================================================================

type RouteHandler = (
  request: Request,
  params: Record<string, string>
) => Promise<Response>;

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

  const router = new Trouter<RouteHandler>()
    .get("/status", async (request) => {
      const user = await resolveUserOrThrow(instance.resolveUser, request);
      const status = await instance.statusService.getBillingStatus(user);
      return jsonResponse(toBillingStatusResponse(status));
    })
    .post("/checkout", async (request) => {
      const user = await resolveUserOrThrow(instance.resolveUser, request);
      const body = await request.json();
      const data = CheckoutRequestSchema.parse(body);
      validateRedirectUrl(data.successUrl, allowedRedirectOrigins);
      if (data.cancelUrl) validateRedirectUrl(data.cancelUrl, allowedRedirectOrigins);
      const result = await instance.checkoutService.createCheckout(user, data);
      return jsonResponse(result);
    })
    .post("/portal", async (request) => {
      const user = await resolveUserOrThrow(instance.resolveUser, request);
      const body = await request.json();
      const data = PortalRequestSchema.parse(body);
      validateRedirectUrl(data.returnUrl, allowedRedirectOrigins);
      const result = await instance.checkoutService.createPortal(user, data.returnUrl);
      return jsonResponse(result);
    })
    .post("/sync", async (request) => {
      const user = await resolveUserOrThrow(instance.resolveUser, request);
      await instance.syncService.syncBillingState(user);
      const status = await instance.statusService.getBillingStatus(user);
      return jsonResponse(toBillingStatusResponse(status));
    })
    .get("/products", async () => {
      const products = await instance.statusService.listProducts();
      return jsonResponse({ products });
    })
    .delete("/subscriptions/:id", async (request, params) => {
      const user = await resolveUserOrThrow(instance.resolveUser, request);
      await instance.checkoutService.cancelSubscription(user, params.id);
      const status = await instance.statusService.getBillingStatus(user);
      return jsonResponse(toBillingStatusResponse(status));
    })
    .post("/subscriptions/:id/resume", async (request, params) => {
      const user = await resolveUserOrThrow(instance.resolveUser, request);
      await instance.checkoutService.uncancelSubscription(user, params.id);
      const status = await instance.statusService.getBillingStatus(user);
      return jsonResponse(toBillingStatusResponse(status));
    })
    .put("/subscriptions/:id", async (request, params) => {
      const user = await resolveUserOrThrow(instance.resolveUser, request);
      const body = await request.json();
      const data = UpdateSubscriptionBodySchema.parse(body);
      await instance.checkoutService.changeSubscription(user, {
        subscriptionId: params.id,
        productId: data.productId,
        interval: data.interval,
      });
      const status = await instance.statusService.getBillingStatus(user);
      return jsonResponse(toBillingStatusResponse(status));
    })
    .post("/webhooks/stripe", async (request) => {
      const body = await request.text();
      const webhookHeaders = {
        "stripe-signature": request.headers.get("stripe-signature") ?? "",
      };
      await instance.webhookService.handleWebhook(body, webhookHeaders);
      return jsonResponse({ received: true });
    });

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
      const { handlers, params } = router.find(method as Trouter.HTTPMethod, path);

      if (handlers.length === 0) {
        return errorResponse("Not found", 404);
      }

      const paramsRecord: Record<string, string> = {};
      for (const key in params) {
        paramsRecord[key] = params[key];
      }

      return await handlers[0](request, paramsRecord);
    } catch (err) {
      const mapped = mapBillingError(err);
      if (mapped) return errorResponse(mapped.body.error, mapped.status);
      throw err;
    }
  };
}
