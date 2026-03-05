/**
 * Mock checkout provider — auto-creates subscriptions for development.
 */

import type { BillingLogger } from "../../core/types";
import { defaultLogger } from "../../core/types";
import type { MockState } from "./shared";
import type {
  BillingCheckoutProvider,
  CheckoutOptions,
  CheckoutSession,
  CompletedPurchaseItem,
  PortalSession,
  PurchaseCheckoutOptions,
} from "../types";

export class MockCheckoutProvider implements BillingCheckoutProvider {
  private logger: BillingLogger;

  constructor(
    private state: MockState,
    logger?: BillingLogger
  ) {
    this.logger = logger ?? defaultLogger;
  }

  async createCheckoutSession(options: CheckoutOptions): Promise<CheckoutSession> {
    const subscriptionId = `mock_sub_${++this.state.subscriptionIdCounter}`;
    const isTrial = !!options.trialDays;
    const periodDays = isTrial ? options.trialDays! : 30;
    this.state.subscriptions.set(subscriptionId, {
      id: subscriptionId,
      customerId: options.customerId,
      productId: options.productId,
      priceId: null,
      status: isTrial ? "trialing" : "active",
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + periodDays * 24 * 60 * 60 * 1000),
      pendingCancellation: false,
      canceledAt: null,
      endedAt: null,
    });

    this.logger.debug("[Mock Billing] Created checkout session (auto-activated)", {
      customerId: options.customerId,
      productId: options.productId,
      subscriptionId,
    });

    return {
      checkoutUrl: options.successUrl,
      sessionId: `mock_session_${Date.now()}`,
    };
  }

  async createPurchaseCheckoutSession(options: PurchaseCheckoutOptions): Promise<CheckoutSession> {
    const sessionId = `mock_purchase_session_${++this.state.purchaseSessionIdCounter}`;

    const items: CompletedPurchaseItem[] = options.items.map((item) => ({
      providerProductId: item.productId,
      providerPriceId: `mock_price_${item.productId}`,
      quantity: item.quantity ?? 1,
      amount: 1000 * (item.quantity ?? 1),
      currency: "usd",
    }));

    this.state.purchaseSessions.set(sessionId, {
      sessionId,
      customerId: options.customerId,
      items,
    });

    this.logger.debug("[Mock Billing] Created purchase checkout session", {
      customerId: options.customerId,
      itemCount: options.items.length,
      sessionId,
    });

    return {
      checkoutUrl: options.successUrl,
      sessionId,
    };
  }

  async getCompletedSessionPurchases(sessionId: string): Promise<CompletedPurchaseItem[]> {
    const session = this.state.purchaseSessions.get(sessionId);
    return session?.items ?? [];
  }

  async createPortalSession(customerId: string, returnUrl: string): Promise<PortalSession> {
    this.logger.debug("[Mock Billing] Created portal session", { customerId, returnUrl });
    return { portalUrl: returnUrl };
  }
}
