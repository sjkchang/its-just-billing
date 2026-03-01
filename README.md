# its-just-billing

A self-contained billing engine with Stripe integration, subscription management, entitlements, and lifecycle hooks. Framework-agnostic — works with any server that handles `Request`/`Response`.

## Quick start

```ts
import { createBilling } from "its-just-billing";
import { drizzleRepositories, createBillingSchema } from "its-just-billing/repositories/drizzle";

const billing = await createBilling({
  adapter: drizzleRepositories(db, billingSchema),
  provider: { provider: "stripe", secretKey: process.env.STRIPE_SECRET_KEY! },
  resolveUser: async (req) => {
    // Return { id, email, name } or null if unauthenticated
    const session = await getSession(req);
    return session?.user ?? null;
  },
});

// Mount the handler — works with any framework that gives you a Request
app.all("/api/v1/billing/*", (req) => billing.handler(req));
```

## Documentation

- **[Configuration](./docs/configuration.md)** — all config options, subscription strategies, entitlements, hooks
- **[HTTP API](./docs/http-api.md)** — endpoints exposed by the handler, request/response shapes
- **[Client SDK](./docs/client.md)** — typed frontend client for calling the billing API

### Framework guides

- **[Hono](./docs/frameworks/hono.md)**

### Database guides

- **[Drizzle](./docs/databases/drizzle.md)**

## Architecture

```
┌─────────────────────────────────────────┐
│            Your application              │
│                                          │
│  ┌──────────┐  ┌──────────────────────┐  │
│  │ Frontend │  │  Server-side code    │  │
│  │  Client  │──│  billing.api.*()    │  │
│  └──────────┘  └──────────────────────┘  │
│       │                  │               │
│       ▼                  ▼               │
│  ┌────────────────────────────────────┐  │
│  │     billing.handler (Request →     │  │
│  │     Response, mounted on a route)  │  │
│  └────────────────────────────────────┘  │
└──────────────┬───────────────────────────┘
               │
┌──────────────▼───────────────────────────┐
│          its-just-billing                 │
│                                           │
│  ┌─────────┐  ┌──────────┐  ┌─────────┐  │
│  │Services │  │ Provider │  │  Repos  │  │
│  │ (sync,  │──│ (Stripe, │  │(Drizzle)│  │
│  │checkout,│  │  mock)   │  │         │  │
│  │ status) │  └──────────┘  └─────────┘  │
│  └─────────┘                              │
└───────────────────────────────────────────┘
```

The package has three pluggable layers:

| Layer | What it does | Built-in options |
|-------|-------------|-----------------|
| **Provider** | Talks to Stripe (or a mock) for checkout, subscriptions, webhooks | `stripe`, `mock` |
| **Repository** | Persists customers, subscriptions, events to your database | `drizzle` (Postgres) |
| **Handler** | Exposes HTTP endpoints via `(Request) => Response` | Built-in, framework-agnostic |

## Two ways to use

### 1. HTTP handler (frontend-facing)

Mount `billing.handler` on a catch-all route. The handler exposes REST endpoints that the frontend client calls.

### 2. Server-side API (backend code)

Use `billing.api` directly in your server code — no HTTP round-trip needed.

```ts
// Check entitlements in a middleware
const entitlements = await billing.api.getEntitlements(user);
if (!entitlements.includes("feature:advanced")) {
  return new Response("Upgrade required", { status: 403 });
}

// Trigger a sync after some operation
await billing.api.syncBillingState(user);
```
