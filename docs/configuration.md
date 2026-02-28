# Configuration

All configuration is passed to `createBilling()`. Every field in `config` has sensible defaults — you can pass `{}` or omit it entirely.

## createBilling options

```ts
import { createBilling } from "@kitforge/billing";

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
  name: string | null;
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

## Subscription strategy

Controls how plan changes and cancellations behave.

```ts
config: {
  subscriptions: {
    // Allow users to upgrade their plan (default: true)
    allowUpgrade: true,

    // Allow users to downgrade their plan (default: false)
    allowDowngrade: false,

    // How to handle upgrade billing (default: "immediate_prorate")
    //   "immediate_prorate" — change now, prorate the difference
    //   "immediate_full" — change now, invoice the full new price
    upgradeStrategy: "immediate_prorate",

    // How to handle downgrade billing (default: "at_period_end")
    //   "immediate_prorate" — change now, credit the difference
    //   "at_period_end" — schedule the change for next billing cycle
    downgradeStrategy: "at_period_end",

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
        before: async ({ user, fromProductId, toProductId, direction, strategy }) => {
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
    subscriptions: {
      allowUpgrade: true,
      allowDowngrade: true,
      upgradeStrategy: "immediate_prorate",
      downgradeStrategy: "at_period_end",
      cancellation: { timing: "at_period_end", allowUncancel: true },
      tierOrder: ["prod_starter", "prod_pro", "prod_enterprise"],
    },
    entitlements: {
      products: {
        "prod_starter": ["plan:paid", "feature:basic"],
        "prod_pro": ["plan:paid", "feature:basic", "feature:advanced"],
        "prod_enterprise": ["plan:paid", "feature:basic", "feature:advanced", "feature:enterprise"],
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
