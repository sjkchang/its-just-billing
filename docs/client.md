# Client SDK

A lightweight, typed `fetch`-based client for calling the billing HTTP API from the frontend.

## Setup

```ts
import { createBillingClient } from "@kitforge/billing/client";

const billing = createBillingClient({
  basePath: "/api/v1/billing",  // default
});
```

## Methods

### getStatus

```ts
const status = await billing.getStatus();
// status.entitlements: string[]
// status.subscription: { id, status, currentPeriodEnd, pendingCancellation } | null
// status.productId: string | null
// status.statusMessage: string
```

### getProducts

```ts
const { products } = await billing.getProducts();
// products[0].id, .name, .description, .prices[], .metadata
```

### checkout

Redirects the user to a Stripe checkout page.

```ts
const { checkoutUrl } = await billing.checkout({
  productId: "prod_starter",
  successUrl: `${window.location.origin}/billing?success=true`,
  cancelUrl: `${window.location.origin}/billing`,
});

window.location.href = checkoutUrl;
```

### createPortal

Open the Stripe customer portal for self-service management.

```ts
const { portalUrl } = await billing.createPortal(
  `${window.location.origin}/billing`
);

window.location.href = portalUrl;
```

### sync

Force a sync of billing state from Stripe.

```ts
const status = await billing.sync();
```

### cancelSubscription

```ts
const status = await billing.cancelSubscription(subscriptionId);
```

### resumeSubscription

Undo a pending cancellation.

```ts
const status = await billing.resumeSubscription(subscriptionId);
```

### changeSubscription

Switch to a different plan.

```ts
const status = await billing.changeSubscription(subscriptionId, "prod_pro");
```

## Error handling

All methods throw `BillingClientError` on non-2xx responses:

```ts
import { BillingClientError } from "@kitforge/billing/client";

try {
  await billing.checkout({ productId: "invalid", successUrl: "..." });
} catch (err) {
  if (err instanceof BillingClientError) {
    console.log(err.status); // 400
    console.log(err.body);   // { error: "Invalid product ID" }
  }
}
```
