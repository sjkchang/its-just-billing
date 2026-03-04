/**
 * Stripe customer provider.
 */

import type Stripe from "stripe";
import type { BillingLogger } from "../../core/types";
import { defaultLogger } from "../../core/types";
import { mapStripeSubscription } from "./shared";
import type {
  BillingCustomerProvider,
  BillingCustomer,
  BillingSubscription,
  CustomerState,
} from "../types";

function mapStripeCustomer(customer: Stripe.Customer): BillingCustomer {
  return {
    id: customer.id,
    email: customer.email ?? "",
    name: customer.name ?? null,
    externalId: (customer.metadata?.externalId as string) ?? null,
    metadata: customer.metadata as Record<string, string> | undefined,
  };
}

export class StripeCustomerProvider implements BillingCustomerProvider {
  private logger: BillingLogger;

  constructor(
    private stripe: Stripe,
    logger?: BillingLogger
  ) {
    this.logger = logger ?? defaultLogger;
  }

  async createCustomer(email: string, externalId: string, name?: string): Promise<BillingCustomer> {
    try {
      const existing = await this.getCustomerByExternalId(externalId);
      if (existing) {
        this.logger.info("Customer already exists, returning existing", { externalId });
        return existing;
      }

      const customer = await this.stripe.customers.create(
        { email, name: name ?? undefined, metadata: { externalId } },
        { idempotencyKey: `billing-create-customer:${externalId}` },
      );

      this.logger.info("Created Stripe customer", { customerId: customer.id, externalId });

      return mapStripeCustomer(customer);
    } catch (error) {
      this.logger.error("Failed to create Stripe customer", {
        email,
        externalId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async getCustomer(customerId: string): Promise<BillingCustomer | null> {
    try {
      const customer = await this.stripe.customers.retrieve(customerId);
      if (customer.deleted) return null;
      return mapStripeCustomer(customer as Stripe.Customer);
    } catch (error) {
      this.logger.debug("Customer not found", { customerId });
      return null;
    }
  }

  async getCustomerByExternalId(externalId: string): Promise<BillingCustomer | null> {
    try {
      const sanitized = externalId.replace(/[\\"]/g, "\\$&");
      const result = await this.stripe.customers.search({
        query: `metadata["externalId"]:"${sanitized}"`,
        limit: 1,
      });

      if (result.data.length === 0) return null;
      return mapStripeCustomer(result.data[0]);
    } catch (error) {
      this.logger.debug("Customer not found by external ID", { externalId });
      return null;
    }
  }

  async getCustomerState(customerId: string): Promise<CustomerState | null> {
    try {
      const customer = await this.stripe.customers.retrieve(customerId);
      if (customer.deleted) return null;

      const relevantStatuses = new Set(["active", "trialing", "past_due", "incomplete", "unpaid", "canceled", "paused"]);
      const relevantSubs: Stripe.Subscription[] = [];

      // Use auto-pagination to fetch all subscriptions, not just the first page
      for await (const sub of this.stripe.subscriptions.list({
        customer: customerId,
        status: "all",
      })) {
        if (relevantStatuses.has(sub.status)) {
          relevantSubs.push(sub);
        }
      }

      return {
        customer: mapStripeCustomer(customer as Stripe.Customer),
        subscriptions: relevantSubs.map(mapStripeSubscription),
      };
    } catch (error) {
      this.logger.error("Failed to fetch customer state", {
        customerId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async getSubscription(subscriptionId: string): Promise<BillingSubscription | null> {
    try {
      const sub = await this.stripe.subscriptions.retrieve(subscriptionId);
      return mapStripeSubscription(sub);
    } catch (error) {
      this.logger.debug("Subscription not found", { subscriptionId });
      return null;
    }
  }

}
