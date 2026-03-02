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
  PortalSession,
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

  async createPortalSession(customerId: string, returnUrl: string): Promise<PortalSession> {
    this.logger.debug("[Mock Billing] Created portal session", { customerId, returnUrl });
    return { portalUrl: returnUrl };
  }
}
