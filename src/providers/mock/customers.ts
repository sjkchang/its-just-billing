/**
 * Mock customer provider — in-memory customer CRUD for development.
 */

import type { BillingLogger } from "../../core/types";
import { defaultLogger } from "../../core/types";
import type { MockState } from "./shared";
import type {
  BillingCustomerProvider,
  BillingCustomer,
  BillingSubscription,
  CustomerState,
} from "../types";

export class MockCustomerProvider implements BillingCustomerProvider {
  private logger: BillingLogger;

  constructor(
    private state: MockState,
    logger?: BillingLogger
  ) {
    this.logger = logger ?? defaultLogger;
  }

  async createCustomer(email: string, externalId: string, name?: string): Promise<BillingCustomer> {
    const id = `mock_cust_${++this.state.customerIdCounter}`;
    const customer: BillingCustomer = {
      id,
      email,
      name: name ?? null,
      externalId,
    };
    this.state.customers.set(id, customer);
    this.logger.debug("[Mock Billing] Created customer", { id, email, externalId });
    return customer;
  }

  async getCustomer(customerId: string): Promise<BillingCustomer | null> {
    const customer = this.state.customers.get(customerId) ?? null;
    this.logger.debug("[Mock Billing] Get customer", { customerId, found: !!customer });
    return customer;
  }

  async getCustomerByExternalId(externalId: string): Promise<BillingCustomer | null> {
    const customer =
      Array.from(this.state.customers.values()).find((c) => c.externalId === externalId) ?? null;
    this.logger.debug("[Mock Billing] Get customer by external ID", {
      externalId,
      found: !!customer,
    });
    return customer;
  }

  async getCustomerState(customerId: string): Promise<CustomerState | null> {
    const customer = this.state.customers.get(customerId);
    if (!customer) {
      this.logger.debug("[Mock Billing] Get customer state - not found", { customerId });
      return null;
    }
    const subscriptions = Array.from(this.state.subscriptions.values()).filter(
      (s) => s.customerId === customerId
    );
    this.logger.debug("[Mock Billing] Get customer state", {
      customerId,
      subscriptionCount: subscriptions.length,
    });
    return { customer, subscriptions };
  }

  async getSubscription(subscriptionId: string): Promise<BillingSubscription | null> {
    const subscription = this.state.subscriptions.get(subscriptionId) ?? null;
    this.logger.debug("[Mock Billing] Get subscription", {
      subscriptionId,
      found: !!subscription,
    });
    return subscription;
  }

}
