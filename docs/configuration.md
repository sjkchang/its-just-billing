# Configuration

All configuration is passed to `createBilling()`. Every field in `config` has sensible defaults — you can pass `{}` or omit it entirely.

## createBilling options

```ts
import { createBilling } from "its-just-billing";

const billing = await createBilling({
  // Required: database adapter
  adapter: drizzleRepositories(db, billingSchema),

  // Required: billing provider
  provider: { provider: "stripe", secretKey: "sk_..." },

  // Required: resolve the current user from a Request
  resolveUser: async (req) => {
    // Return { id, email, name } or null
  },

  // Optional: base path for HTTP routes (default: "/api/v1/billing")
  basePath: "/api/v1/billing",

  // Optional: separate mount point for webhooks
  webhookPath: "/api/v1/webhooks",

  // Optional: billing behavior config
  config: { /* see below */ },

  // Optional: custom logger
  logger: myLogger,

  // Optional: key-value cache (e.g. Redis) for status and product lookups
  cache: myCache,
});
```

### Provider config

```ts
// Stripe
provider: {
  provider: "stripe",
  secretKey: process.env.STRIPE_SECRET_KEY!,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,  // recommended for production
}

// Mock (for development/testing — in-memory, instant checkout)
provider: {
  provider: "mock",
}
```

### resolveUser

A function that extracts the current user from a web `Request`. Return `null` for unauthenticated requests — the handler will respond with 401.

```ts
resolveUser: async (req) => {
  const session = await auth.getSession(req);
  if (!session?.user) return null;
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  };
}
```

The return type is `BillingUser`:

```ts
interface BillingUser {
  id: string;
  email: string;
  name?: string | null;
}
```

### Custom logger

Pass any object that satisfies `BillingLogger`:

```ts
interface BillingLogger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}
```

The default logger writes to `console` with a `[billing]` prefix.

### Cache

Pass any object that satisfies `KeyValueCache` to enable caching of billing status and product lookups:

```ts
interface KeyValueCache {
  get(key: string): Promise<string | null | undefined>;
  set(key: string, value: string, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
  /** Atomic set-if-not-exists. Returns true if the key was set. */
  setIfAbsent?(key: string, value: string, ttl?: number): Promise<boolean>;
}
```

Status results are cached for 5 minutes and product lists for 1 hour. Cache is automatically invalidated on mutations (sync, webhook processing).

## Products

Products can be configured in several ways depending on how much control you need.

### Product management modes

#### 1. Fully managed (synced to Stripe)

Define products with full config and they'll be synced to Stripe on startup. Product `id` values become Stripe product IDs directly.

```ts
config: {
  products: [
    {
      id: "starter",
      name: "Starter",
      description: "For small teams",
      prices: [
        { amount: 1900, currency: "usd", interval: "month" },
        { amount: 18240, currency: "usd", interval: "year" },
      ],
    },
    {
      id: "pro",
      name: "Pro",
      description: "For growing teams",
      prices: [
        { amount: 4900, currency: "usd", interval: "month" },
      ],
      metadata: { popular: "true" },
    },
  ],
}
```

#### 2. Reference by ID (no sync)

If you already have products in Stripe (or prefer managing them via the dashboard), pass their IDs as strings. These products are fetched from the provider but never synced or modified.

```ts
config: {
  products: ["prod_starter", "prod_pro", "prod_enterprise"],
}
```

#### 3. Display all from provider

Omit `products` entirely to return all active products from the provider. No sync, no filtering.

```ts
config: {
  // products omitted — all provider products are returned
}
```

#### 4. Mixed (managed + referenced)

Combine full product configs with string references. Only fully managed products are synced to Stripe; string references are fetched as-is.

```ts
config: {
  products: [
    { id: "starter", name: "Starter", prices: [{ amount: 1900, currency: "usd", interval: "month" }] },
    "prod_enterprise",  // existing Stripe product, not managed
  ],
}
```

### Product display mode

By default, `listProducts()` only returns products listed in your config. Set `productDisplay: "all"` to also include any other active products from the provider (configured products are listed first, in config order).

```ts
config: {
  products: ["prod_starter"],
  productDisplay: "all",  // returns prod_starter first, then all other active products
}
```

| `productDisplay` | Behavior |
| --- | --- |
| `"configured"` (default) | Only return products listed in `products`, in config order |
| `"all"` | Configured products first (in config order), then remaining provider products |

When `products` is omitted, all provider products are always returned regardless of `productDisplay`.

### Sync behavior (Stripe)

Only fully managed products (full config objects, not string IDs) are synced. On startup, each product is synced independently:

1. **Product not found** — created with the config `id` as the Stripe product ID
2. **Product archived** — reactivated and updated
3. **Product exists** — name/description/metadata updated if different
4. **Prices** — matched by `(amount, currency, interval)`. Missing prices are created, unmatched Stripe prices are archived. The first config price becomes `default_price`.

Sync is **non-blocking** — if it fails, a warning is logged and the app continues with whatever state Stripe already has. Each product syncs independently so one failure doesn't block others.

### Using with entitlements

Products and entitlements are separate configs. Use the product `id` (or Stripe product ID for references) in your entitlements map:

```ts
config: {
  products: [
    { id: "starter", name: "Starter", prices: [{ amount: 1900, currency: "usd", interval: "month" }] },
    "prod_pro",  // referenced by Stripe ID
  ],
  entitlements: {
    products: {
      starter: ["plan:paid", "feature:basic"],
      prod_pro: ["plan:paid", "feature:basic", "feature:advanced"],
    },
  },
}
```

## Subscription strategy

Controls how plan changes and cancellations behave.

```ts
config: {
  subscriptions: {
    // Allow users to upgrade their plan (default: true)
    allowUpgrade: true,

    // Allow users to downgrade their plan (default: false)
    allowDowngrade: false,

    // Allow users to sidegrade (switch between same-tier plans) (default: false)
    allowSidegrade: false,

    // How to handle upgrade billing (default: "immediate_prorate")
    //   "immediate_prorate" — change now, prorate the difference
    //   "immediate_full" — change now, invoice the full new price
    upgradeStrategy: "immediate_prorate",

    // How to handle downgrade billing (default: "at_period_end")
    //   "immediate_prorate" — change now, credit the difference
    //   "at_period_end" — schedule the change for next billing cycle
    downgradeStrategy: "at_period_end",

    // How to handle sidegrade billing (default: "immediate_prorate")
    //   "immediate_prorate" — change now, prorate the difference
    //   "immediate_full" — change now, invoice the full new price
    //   "at_period_end" — schedule the change for next billing cycle
    sidegradeStrategy: "immediate_prorate",

    // Cancellation behavior
    cancellation: {
      // "at_period_end" — access continues until period ends (default)
      // "immediate" — cancel and revoke access immediately
      timing: "at_period_end",

      // Allow users to undo a pending cancellation (default: true)
      allowUncancel: true,
    },

    // Explicit tier ordering for determining upgrade vs downgrade direction.
    // Lower index = lower tier. If omitted, price comparison is used instead.
    tierOrder: ["prod_free", "prod_starter", "prod_pro", "prod_enterprise"],

    // Trial period in days for new subscriptions (optional)
    trialDays: 14,

    // Only allow one active subscription per customer (default: true)
    singleSubscription: true,

    // Days after going past_due before entitlements are revoked.
    // Omit to keep entitlements forever during past_due.
    // Set to 0 for immediate suspension.
    pastDueGracePeriodDays: 7,
  },
}
```

## Entitlements

Map Stripe product IDs to feature flags. The entitlement resolver returns a `Set<string>` of granted entitlements based on the user's active subscriptions.

```ts
config: {
  entitlements: {
    // Map product ID → entitlements granted
    products: {
      "prod_starter": ["plan:paid", "feature:basic"],
      "prod_pro": ["plan:paid", "feature:basic", "feature:advanced"],
      "prod_enterprise": ["plan:paid", "feature:basic", "feature:advanced", "feature:enterprise"],
    },

    // Fallback for paid products not listed above (default: ["plan:paid"])
    defaultPaid: ["plan:paid"],

    // Entitlements for free-tier users (default: ["plan:free"])
    defaultFree: ["plan:free"],
  },
}
```

Use entitlements in your app:

```ts
const status = await billing.api.getStatus(user);

if (status.entitlements.includes("feature:advanced")) {
  // User has access
}
```

## Allowed redirect origins

Restrict checkout and portal redirect URLs to specific origins. When set, any `successUrl`, `cancelUrl`, or `returnUrl` must match one of the allowed origins.

```ts
config: {
  allowedRedirectOrigins: ["https://example.com", "https://app.example.com"],
}
```

If omitted, any URL is accepted.

## Hooks

Hooks let you run custom logic when billing events occur. There are two categories:

### API hooks

Fire when a user acts through the billing API. `before` hooks can reject an operation by throwing. `after` hooks are fire-and-forget.

These do **not** fire for changes made outside the API (e.g. from the Stripe dashboard). Use lifecycle hooks for that.

```ts
config: {
  hooks: {
    api: {
      checkout: {
        before: async ({ user, productId }) => {
          // Reject if user is on a waitlist
          if (await isOnWaitlist(user.id)) {
            throw new Error("You're on the waitlist");
          }
        },
        after: async ({ user, productId }) => {
          await analytics.track("checkout_started", { userId: user.id, productId });
        },
      },

      cancel: {
        before: async ({ user, customer, subscription }) => {
          // Could show a retention offer, etc.
        },
        after: async ({ user, customer, subscription }) => {
          await sendCancellationEmail(user.email);
        },
      },

      planChange: {
        before: async ({ user, customer, subscription, fromProductId, toProductId, direction, strategy }) => {
          // direction is "upgrade" | "downgrade" | "sidegrade"
          console.log(`${direction}: ${fromProductId} → ${toProductId} (${strategy})`);
        },
      },
    },
  },
}
```

### Lifecycle hooks

Fire when state transitions are detected during sync (webhooks or manual sync). Always fire-and-forget. Fire regardless of how the change originated — Stripe dashboard, API, or webhooks.

```ts
config: {
  hooks: {
    lifecycle: {
      onSubscriptionActivated: async ({ customer, subscription }) => {
        await sendWelcomeEmail(customer);
      },

      onSubscriptionCanceled: async ({ customer, subscription }) => {
        await sendCancellationEmail(customer);
      },

      onSubscriptionChanged: async ({ customer, subscription, previousProductId, newProductId }) => {
        await notifyTeam(`Plan changed: ${previousProductId} → ${newProductId}`);
      },

      onSubscriptionExpired: async ({ customer, subscription }) => {
        await revokeAccess(customer);
      },

      onCustomerCreated: async ({ user, customer }) => {
        await analytics.identify(user.id, { billingCustomerId: customer.id });
      },
    },
  },
}
```

## Full example

```ts
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
  basePath: "/api/v1/billing",
  webhookPath: "/api/v1/webhooks",
  config: {
    products: [
      { id: "starter", name: "Starter", prices: [{ amount: 1900, currency: "usd", interval: "month" }] },
      { id: "pro", name: "Pro", prices: [{ amount: 4900, currency: "usd", interval: "month" }] },
      { id: "enterprise", name: "Enterprise", prices: [{ amount: 19900, currency: "usd", interval: "month" }] },
    ],
    subscriptions: {
      allowUpgrade: true,
      allowDowngrade: true,
      upgradeStrategy: "immediate_prorate",
      downgradeStrategy: "at_period_end",
      cancellation: { timing: "at_period_end", allowUncancel: true },
      tierOrder: ["starter", "pro", "enterprise"],
    },
    entitlements: {
      products: {
        starter: ["plan:paid", "feature:basic"],
        pro: ["plan:paid", "feature:basic", "feature:advanced"],
        enterprise: ["plan:paid", "feature:basic", "feature:advanced", "feature:enterprise"],
      },
    },
    hooks: {
      lifecycle: {
        onSubscriptionActivated: async ({ customer }) => {
          console.log("New subscriber:", customer.id);
        },
      },
    },
  },
});
```
