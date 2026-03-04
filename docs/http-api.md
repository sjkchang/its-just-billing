# HTTP API

The billing handler exposes these endpoints under the configured `basePath` (default: `/api/v1/billing`). All authenticated endpoints call `resolveUser(req)` — if it returns `null`, the response is `401 Unauthorized`.

## Endpoints

### GET /status

Get the current user's billing status, active subscription, and entitlements.

**Response:**

```json
{
  "entitlements": ["plan:paid", "feature:basic"],
  "accessState": "active",
  "productId": "prod_starter",
  "productName": "Starter",
  "productDescription": "For small teams",
  "subscription": {
    "id": "sub_abc123",
    "status": "active",
    "currentPeriodEnd": "2025-02-01T00:00:00.000Z",
    "pendingCancellation": false
  },
  "statusMessage": "Active subscription",
  "metadata": { "popular": "true" }
}
```

`accessState` indicates the user's current access level:

| Value | Meaning |
| --- | --- |
| `"active"` | Normal paid access |
| `"trialing"` | Trial period |
| `"grace_period"` | Payment past due, still within grace period |
| `"suspended"` | Payment past due, grace period expired — entitlements revoked |
| `"canceled"` | Subscription canceled |
| `"provider_missing"` | Subscription exists locally but not found in provider |
| `"free"` | No subscription |

If the user has no subscription, `subscription` is `null` and entitlements reflect the free tier.

### GET /products

List available products and their prices. No authentication required.

**Response:**

```json
{
  "products": [
    {
      "id": "prod_starter",
      "name": "Starter",
      "description": "For small teams",
      "prices": [
        { "id": "price_monthly", "amount": 1900, "currency": "usd", "interval": "month" },
        { "id": "price_yearly", "amount": 18240, "currency": "usd", "interval": "year" }
      ],
      "metadata": {}
    }
  ]
}
```

### POST /checkout

Create a checkout session and get a redirect URL.

**Request body:**

```json
{
  "productId": "prod_starter",
  "successUrl": "https://example.com/billing?success=true",
  "cancelUrl": "https://example.com/billing"
}
```

**Response:**

```json
{
  "checkoutUrl": "https://checkout.stripe.com/c/pay/..."
}
```

### POST /portal

Create a Stripe customer portal session.

**Request body:**

```json
{
  "returnUrl": "https://example.com/billing"
}
```

**Response:**

```json
{
  "portalUrl": "https://billing.stripe.com/p/session/..."
}
```

### POST /sync

Sync the user's billing state from the provider (Stripe) to the local database. Returns the updated status.

**Response:** Same shape as `GET /status`.

### DELETE /subscriptions/:id

Cancel a subscription. Behavior depends on the configured `cancellation.timing`.

**Response:** Updated billing status (same shape as `GET /status`).

### POST /subscriptions/:id/resume

Resume a subscription that has a pending cancellation. Only works if `cancellation.allowUncancel` is `true`.

**Response:** Updated billing status.

### PUT /subscriptions/:id

Change a subscription to a different product.

**Request body:**

```json
{
  "productId": "prod_pro",
  "interval": "month"
}
```

`interval` is optional (`"day"`, `"week"`, `"month"`, or `"year"`). When provided, the subscription switches to a price matching the given interval.

**Response:** Updated billing status.

### POST /webhooks/stripe

Stripe webhook endpoint. Verifies the signature, deduplicates events, and syncs customer state.

Set this as your Stripe webhook URL: `https://yourapp.com/api/v1/billing/webhooks/stripe`

If you configured a separate `webhookPath`, the webhook is at: `{webhookPath}/stripe`

## Error responses

All errors return JSON:

```json
{
  "error": "Error message here"
}
```

| Status | When |
|--------|------|
| 400 | Validation error, bad request, or a `before` hook rejected the operation |
| 401 | `resolveUser` returned `null` |
| 404 | Resource not found |
