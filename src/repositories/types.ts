/**
 * BillingRepositories — abstracts storage access for the billing package.
 *
 * Bundles the three repository interfaces + transaction support.
 * Consumers provide a concrete implementation (e.g. drizzleRepositories) to createBilling().
 */

import type { Customer, BillingProviderType } from "../core/entities";
import type { Subscription, SubscriptionStatus } from "../core/entities";
import type { BillingEvent } from "../core/entities";

// ============================================================================
// Repository Interfaces
// ============================================================================

export interface CustomerRepository {
  findById(id: string): Promise<Customer | null>;
  findByUserId(userId: string, provider: BillingProviderType): Promise<Customer | null>;
  findByProviderCustomerId(providerCustomerId: string, provider: BillingProviderType): Promise<Customer | null>;
  create(data: {
    id: string;
    userId: string;
    provider: BillingProviderType;
    providerCustomerId: string;
    email: string;
    name?: string | null;
  }): Promise<Customer>;
  update(id: string, data: Partial<Pick<Customer, "email" | "name">>): Promise<Customer | null>;
  upsertByProviderCustomerId(data: {
    id: string;
    userId: string;
    provider: BillingProviderType;
    providerCustomerId: string;
    email: string;
    name?: string | null;
  }): Promise<Customer>;
}

export interface SubscriptionRepository {
  findById(id: string): Promise<Subscription | null>;
  findByCustomerId(customerId: string): Promise<Subscription[]>;
  findByProviderSubscriptionId(providerSubscriptionId: string): Promise<Subscription | null>;
  create(data: {
    id: string;
    customerId: string;
    providerSubscriptionId: string;
    providerProductId: string;
    providerPriceId?: string | null;
    status: SubscriptionStatus;
    currentPeriodStart?: Date | null;
    currentPeriodEnd?: Date | null;
    pendingCancellation?: boolean;
    canceledAt?: Date | null;
    endedAt?: Date | null;
  }): Promise<Subscription>;
  update(
    id: string,
    data: Partial<
      Pick<
        Subscription,
        | "status"
        | "providerProductId"
        | "providerPriceId"
        | "currentPeriodStart"
        | "currentPeriodEnd"
        | "pendingCancellation"
        | "canceledAt"
        | "endedAt"
      >
    >
  ): Promise<Subscription | null>;
  upsertByProviderSubscriptionId(data: {
    id: string;
    customerId: string;
    providerSubscriptionId: string;
    providerProductId: string;
    providerPriceId?: string | null;
    status: SubscriptionStatus;
    currentPeriodStart?: Date | null;
    currentPeriodEnd?: Date | null;
    pendingCancellation?: boolean;
    canceledAt?: Date | null;
    endedAt?: Date | null;
  }): Promise<Subscription>;
}

export interface BillingEventRepository {
  findByProviderEventId(providerEventId: string): Promise<BillingEvent | null>;
  create(data: {
    id: string;
    provider: BillingProviderType;
    providerEventId: string;
    eventType: string;
    payload?: string | null;
  }): Promise<BillingEvent>;
  exists(providerEventId: string): Promise<boolean>;
}

// ============================================================================
// Composite Repository Interface
// ============================================================================

export interface BillingRepositories {
  customers: CustomerRepository;
  subscriptions: SubscriptionRepository;
  events: BillingEventRepository;
  transaction<T>(fn: (repos: BillingRepositories) => Promise<T>): Promise<T>;
}
