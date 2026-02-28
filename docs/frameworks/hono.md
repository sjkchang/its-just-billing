# Hono

The billing handler is a standard `(Request) => Promise<Response>` function, which maps directly to Hono's handler signature.

## Basic setup

```ts
import { Hono } from "hono";
import { createBilling } from "@kitforge/billing";
import { drizzleRepositories, createBillingSchema } from "@kitforge/billing/repositories/drizzle";

const app = new Hono();

// Set up billing
const billing = await createBilling({
  adapter: drizzleRepositories(db, billingSchema),
  provider: {
    provider: "stripe",
    secretKey: process.env.STRIPE_SECRET_KEY!,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  },
  resolveUser: async (req) => {
    const session = await auth.getSession(req);
    return session?.user ?? null;
  },
});

// Mount billing routes — handles all /api/v1/billing/* endpoints
app.all("/api/v1/billing/*", (c) => billing.handler(c.req.raw));
```

That's it. The handler manages its own routing internally.

## Separate webhook mount

If your webhooks need a different path (common when using a reverse proxy or separate auth):

```ts
const billing = await createBilling({
  // ...
  basePath: "/api/v1/billing",
  webhookPath: "/api/v1/webhooks",
});

// Mount both paths
app.all("/api/v1/billing/*", (c) => billing.handler(c.req.raw));
app.all("/api/v1/webhooks/*", (c) => billing.handler(c.req.raw));
```

Webhook requests arriving at `/api/v1/webhooks/stripe` will be routed correctly.

## Using the server-side API in routes

Use `billing.api` directly in your Hono routes — no HTTP round-trip needed:

```ts
// Entitlement check middleware
app.use("/api/v1/premium/*", async (c, next) => {
  const session = await auth.getSession(c.req.raw);
  if (!session?.user) return c.json({ error: "Unauthorized" }, 401);

  const entitlements = await billing.api.getEntitlements(session.user);
  if (!entitlements.includes("feature:advanced")) {
    return c.json({ error: "Upgrade required" }, 403);
  }

  await next();
});

// Trigger billing sync after account update
app.post("/api/v1/account", async (c) => {
  const user = await getUser(c);
  // ... update account ...
  await billing.api.syncBillingState(user);
  return c.json({ ok: true });
});

// Server-side checkout (e.g. from an admin panel)
app.post("/api/v1/admin/provision", async (c) => {
  const user = await getUserById(c.req.query("userId"));
  const result = await billing.api.createCheckout(user, {
    productId: "prod_enterprise",
    successUrl: "https://example.com/admin",
  });
  return c.json(result);
});
```

## Full example

```ts
import { Hono } from "hono";
import { createBilling } from "@kitforge/billing";
import { drizzleRepositories, createBillingSchema } from "@kitforge/billing/repositories/drizzle";
import { db } from "./db";
import { users } from "./db/schema";

// Create billing schema (pass your users table for the FK)
const billingSchema = createBillingSchema({ usersTable: users });

// Initialize billing
const billing = await createBilling({
  adapter: drizzleRepositories(db, billingSchema),
  provider: {
    provider: "stripe",
    secretKey: process.env.STRIPE_SECRET_KEY!,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  },
  resolveUser: async (req) => {
    const session = await auth.getSession(req);
    return session?.user ?? null;
  },
  config: {
    subscriptions: {
      allowUpgrade: true,
      allowDowngrade: true,
      tierOrder: ["prod_starter", "prod_pro", "prod_enterprise"],
    },
    entitlements: {
      products: {
        "prod_starter": ["plan:paid"],
        "prod_pro": ["plan:paid", "feature:advanced"],
        "prod_enterprise": ["plan:paid", "feature:advanced", "feature:enterprise"],
      },
    },
  },
});

const app = new Hono();

// Mount billing handler
app.all("/api/v1/billing/*", (c) => billing.handler(c.req.raw));

export default app;
```
