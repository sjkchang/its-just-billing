# Code Review

## Security Issues

- [x] **1. Webhook dedup is racy (cache path)** — `src/services/webhook.ts:71-85` — `claimViaCache` does get-then-set, not atomic set-if-absent. Two concurrent webhooks for the same event will both process. `KeyValueCache` needs a `setNx` operation.

- [x] **2. Auth failure returns 404 instead of 401** — `src/handler/shared.ts:63-66` — `BillingNotFoundError("Unauthorized")` relies on a magic string check to return 401. Use a dedicated `BillingUnauthorizedError` class.

- [x] **3. Webhook payload parsed twice** — `src/providers/stripe/webhooks.ts` — `verifySignature` calls `constructEvent`, then `extractResource` calls it again. Combine into single operation or cache the verified event.

- [x] **4. `webhookSecret` is optional with no runtime guard** — `src/providers/types.ts:171` — If omitted, all webhooks are silently rejected. Should be required or warn at startup.

- [x] **5. No rate limiting on public endpoints** — Skipped. Rate limiting is the consumer's responsibility (middleware layer).

## Logic Bugs

- [x] **6. `getOrCreateCustomer` creates orphaned Stripe customers on race** — `src/services/checkout.ts:76-116` — Two concurrent requests both miss DB, both create Stripe customers. Loser's Stripe customer is never cleaned up.

- [x] **7. `past_due` treated as active is risky** — `src/core/domain.ts:14` — Users with failed payments keep full access. Should be configurable.

- [x] **8. `getActiveSubscription` sort is unstable** — `src/core/domain.ts:60-72` — Two identical subs created at the same ms have nondeterministic winner. Add tiebreaker.

- [x] **9. Sync marks missing subs as `provider_missing`** — `src/services/sync.ts:181-182` — Missing provider subs get `canceledAt` but no `endedAt`.

- [x] **10. `fireTransitionHooks` reads post-state outside transaction** — `src/services/sync.ts:227` — Another concurrent sync could modify data between commit and read.

- [ ] **Refactor: Hybrid hook firing** — API actions should fire lifecycle hooks explicitly (not rely on future webhook detection). Webhooks should fire hooks based on event type Stripe provides, not state diffing. Keep detection as safety net for manual sync only. See discussion in review session.

- [x] **11. After hooks are fire-and-forget with no backpressure** — Accepted. Document that hooks should be lightweight (enqueue, don't execute).

## Architecture & Structure

- [x] **12. Services have too many constructor params** — Every service takes 5-6 params. Use a `BillingContext` object.

- [ ] **13. `@internal` services are publicly accessible** — `src/billing.ts:79-85` — Marked `@internal` but are public `readonly` fields.

- [x] **14. Custom route matching is fragile** — Replaced with Trouter.

- [x] **15. Config type uses `Partial<BillingAppConfig>` incorrectly** — Now uses `BillingAppConfigInput` (`z.input<typeof BillingConfigSchema>`).

## DX Issues

- [ ] **16. No way to simulate webhooks in tests** — Mock provider has no `simulateWebhook` for integration testing without Stripe CLI.

- [x] **17. Client doesn't expose error body details** — Client now extracts `body.error` message from server response.

- [ ] **18. No subscription ID in checkout flow** — After checkout, client must poll `/status` or `/sync`. Worth documenting.

- [x] **19. Product listing cache has no invalidation** — Sync now invalidates `billing:products` cache alongside status cache.

- [x] **20. `BillingUser.name` is `string | null` vs Stripe's `string | undefined`** — `BillingUser.name` is now optional (`name?: string | null`).

## Missing Features

- [ ] **21. No usage-based / metered billing support** — Entire model assumes flat-rate subscriptions.

- [ ] **22. No coupon / discount support** — No `couponId` or `promotionCode` in checkout options.

- [ ] **23. No invoice/payment history** — No endpoint to retrieve past invoices.

- [ ] **24. No multi-currency support** — Price comparison in `getLowestMonthlyPrice` ignores currency.

- [ ] **25. No webhook retry / failure tracking** — Failed syncs after dedup claim are lost. No retry mechanism.

- [ ] **26. No subscription quantity support** — Hard-codes `items.data[0]`. No per-seat pricing.

## Minor Nits

- [x] **27. "Subscription ending in 0 days"** — Now says "ending today".

- [x] **28. `syncCustomerState called` logged at `info`** — Downgraded to `debug`.

- [x] **29. `BillingProviderType` duplicated** — `providers/types.ts` now re-exports from `core/entities.ts`.

- [x] **30. `nanoid` scattered across codebase** — Centralized to `createId()` in `core/types.ts`.
