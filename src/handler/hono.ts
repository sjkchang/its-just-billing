/**
 * Hono framework adapter for its-just-billing.
 *
 * Returns a Hono app with native routes that call billing.api methods.
 *
 * @example
 * ```ts
 * import { createBillingRoutes } from "its-just-billing/hono";
 *
 * app.route("/api/v1/billing", createBillingRoutes(billing));
 * ```
 */

import { Hono } from "hono";
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

export function createBillingRoutes(billing: BillingInstance): Hono {
  const app = new Hono();

  // Global error handler
  app.onError((err, c) => {
    const mapped = mapBillingError(err);
    if (mapped) return c.json(mapped.body, mapped.status as 400);
    throw err;
  });

  // GET /status
  app.get("/status", async (c) => {
    const user = await resolveUserOrThrow(billing.resolveUser, c.req.raw);
    const status = await billing.api.getStatus(user);
    return c.json(toBillingStatusResponse(status));
  });

  // GET /products
  app.get("/products", async (c) => {
    const products = await billing.api.listProducts();
    return c.json({ products });
  });

  // POST /checkout
  app.post("/checkout", async (c) => {
    const user = await resolveUserOrThrow(billing.resolveUser, c.req.raw);
    const body = await c.req.json();
    const data = CheckoutRequestSchema.parse(body);
    validateRedirectUrl(data.successUrl, billing.allowedRedirectOrigins);
    if (data.cancelUrl) validateRedirectUrl(data.cancelUrl, billing.allowedRedirectOrigins);
    const result = await billing.api.createCheckout(user, data);
    return c.json(result);
  });

  // POST /portal
  app.post("/portal", async (c) => {
    const user = await resolveUserOrThrow(billing.resolveUser, c.req.raw);
    const body = await c.req.json();
    const data = PortalRequestSchema.parse(body);
    validateRedirectUrl(data.returnUrl, billing.allowedRedirectOrigins);
    const result = await billing.api.createPortal(user, data.returnUrl);
    return c.json(result);
  });

  // POST /sync
  app.post("/sync", async (c) => {
    const user = await resolveUserOrThrow(billing.resolveUser, c.req.raw);
    await billing.api.syncBillingState(user);
    const status = await billing.api.getStatus(user);
    return c.json(toBillingStatusResponse(status));
  });

  // DELETE /subscriptions/:id
  app.delete("/subscriptions/:id", async (c) => {
    const user = await resolveUserOrThrow(billing.resolveUser, c.req.raw);
    const id = c.req.param("id");
    await billing.api.cancelSubscription(user, id);
    const status = await billing.api.getStatus(user);
    return c.json(toBillingStatusResponse(status));
  });

  // POST /subscriptions/:id/resume
  app.post("/subscriptions/:id/resume", async (c) => {
    const user = await resolveUserOrThrow(billing.resolveUser, c.req.raw);
    const id = c.req.param("id");
    await billing.api.resumeSubscription(user, id);
    const status = await billing.api.getStatus(user);
    return c.json(toBillingStatusResponse(status));
  });

  // PUT /subscriptions/:id
  app.put("/subscriptions/:id", async (c) => {
    const user = await resolveUserOrThrow(billing.resolveUser, c.req.raw);
    const id = c.req.param("id");
    const body = await c.req.json();
    const data = UpdateSubscriptionBodySchema.parse(body);
    await billing.api.changeSubscription(user, {
      subscriptionId: id,
      productId: data.productId,
      interval: data.interval,
    });
    const status = await billing.api.getStatus(user);
    return c.json(toBillingStatusResponse(status));
  });

  // POST /webhooks/stripe
  app.post("/webhooks/stripe", async (c) => {
    const body = await c.req.text();
    const headers = {
      "stripe-signature": c.req.header("stripe-signature") ?? "",
    };
    await billing.api.handleWebhook(body, headers);
    return c.json({ received: true });
  });

  return app;
}
