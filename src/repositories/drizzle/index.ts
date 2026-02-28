/**
 * Drizzle repositories for @kitforge/billing.
 *
 * Provides the BillingRepositories implementation backed by Drizzle ORM.
 * Also re-exports schema builder and types so consumers import from one place:
 *
 *   import { drizzleRepositories, createBillingSchema } from "@kitforge/billing/repositories/drizzle";
 */

import { eq, and, sql } from "drizzle-orm";
import type {
  BillingRepositories,
  CustomerRepository,
  SubscriptionRepository,
  BillingEventRepository,
} from "../../repository";
import type { BillingTables } from "./schema";
import { Customer } from "../../entities";
import type { BillingProviderType } from "../../entities";
import { Subscription, SubscriptionStatus } from "../../entities";
import { BillingEvent } from "../../entities";

// ============================================================================
// DrizzleDB Type
// ============================================================================

/**
 * Minimal Drizzle DB type for the billing package.
 *
 * This avoids depending on the app's full schema type.
 * Any Drizzle database instance (PostgresJsDatabase, PgliteDatabase, etc.)
 * satisfies this interface.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DrizzleDB = {
  select: (...args: any[]) => any;
  insert: (table: any) => any;
  update: (table: any) => any;
  delete: (table: any) => any;
  transaction: (fn: (tx: DrizzleDB) => Promise<void>) => Promise<void>;
  execute: (query: any) => Promise<any>;
};

// ============================================================================
// Drizzle Repository Implementations
// ============================================================================

export class DrizzleCustomerRepository implements CustomerRepository {
  constructor(
    private db: DrizzleDB,
    private tables: BillingTables
  ) {}

  async findById(id: string): Promise<Customer | null> {
    const t = this.tables.billingCustomers;
    const [row] = await this.db.select().from(t).where(eq(t.id, id)).limit(1);
    return row ? Customer.parse(row) : null;
  }

  async findByUserId(userId: string, provider: BillingProviderType): Promise<Customer | null> {
    const t = this.tables.billingCustomers;
    const [row] = await this.db
      .select()
      .from(t)
      .where(and(eq(t.userId, userId), eq(t.provider, provider)))
      .limit(1);
    return row ? Customer.parse(row) : null;
  }

  async findByProviderCustomerId(providerCustomerId: string): Promise<Customer | null> {
    const t = this.tables.billingCustomers;
    const [row] = await this.db
      .select()
      .from(t)
      .where(eq(t.providerCustomerId, providerCustomerId))
      .limit(1);
    return row ? Customer.parse(row) : null;
  }

  async create(data: {
    id: string;
    userId: string;
    provider: BillingProviderType;
    providerCustomerId: string;
    email: string;
    name?: string | null;
  }): Promise<Customer> {
    const t = this.tables.billingCustomers;
    const [row] = await this.db
      .insert(t)
      .values({
        id: data.id,
        userId: data.userId,
        provider: data.provider,
        providerCustomerId: data.providerCustomerId,
        email: data.email,
        name: data.name ?? null,
      })
      .returning();
    return Customer.parse(row);
  }

  async update(
    id: string,
    data: Partial<Pick<Customer, "email" | "name">>
  ): Promise<Customer | null> {
    const t = this.tables.billingCustomers;
    const [row] = await this.db
      .update(t)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(t.id, id))
      .returning();
    return row ? Customer.parse(row) : null;
  }

  async upsertByProviderCustomerId(data: {
    id: string;
    userId: string;
    provider: BillingProviderType;
    providerCustomerId: string;
    email: string;
    name?: string | null;
  }): Promise<Customer> {
    const t = this.tables.billingCustomers;
    const [row] = await this.db
      .insert(t)
      .values({
        id: data.id,
        userId: data.userId,
        provider: data.provider,
        providerCustomerId: data.providerCustomerId,
        email: data.email,
        name: data.name ?? null,
      })
      .onConflictDoUpdate({
        target: t.providerCustomerId,
        set: {
          email: data.email,
          name: data.name ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return Customer.parse(row);
  }
}

export class DrizzleSubscriptionRepository implements SubscriptionRepository {
  constructor(
    private db: DrizzleDB,
    private tables: BillingTables
  ) {}

  async findById(id: string): Promise<Subscription | null> {
    const t = this.tables.billingSubscriptions;
    const [row] = await this.db.select().from(t).where(eq(t.id, id)).limit(1);
    return row ? Subscription.parse(row) : null;
  }

  async findByCustomerId(customerId: string): Promise<Subscription[]> {
    const t = this.tables.billingSubscriptions;
    const rows = await this.db.select().from(t).where(eq(t.customerId, customerId));
    return rows.map((row: unknown) => Subscription.parse(row));
  }

  async findByProviderSubscriptionId(providerSubscriptionId: string): Promise<Subscription | null> {
    const t = this.tables.billingSubscriptions;
    const [row] = await this.db
      .select()
      .from(t)
      .where(eq(t.providerSubscriptionId, providerSubscriptionId))
      .limit(1);
    return row ? Subscription.parse(row) : null;
  }

  async create(data: {
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
  }): Promise<Subscription> {
    const t = this.tables.billingSubscriptions;
    const [row] = await this.db
      .insert(t)
      .values({
        id: data.id,
        customerId: data.customerId,
        providerSubscriptionId: data.providerSubscriptionId,
        providerProductId: data.providerProductId,
        providerPriceId: data.providerPriceId ?? null,
        status: data.status,
        currentPeriodStart: data.currentPeriodStart ?? null,
        currentPeriodEnd: data.currentPeriodEnd ?? null,
        pendingCancellation: data.pendingCancellation ?? false,
        canceledAt: data.canceledAt ?? null,
        endedAt: data.endedAt ?? null,
      })
      .returning();
    return Subscription.parse(row);
  }

  async update(
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
  ): Promise<Subscription | null> {
    const t = this.tables.billingSubscriptions;
    const [row] = await this.db
      .update(t)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(t.id, id))
      .returning();
    return row ? Subscription.parse(row) : null;
  }

  async upsertByProviderSubscriptionId(data: {
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
  }): Promise<Subscription> {
    const t = this.tables.billingSubscriptions;
    const [row] = await this.db
      .insert(t)
      .values({
        id: data.id,
        customerId: data.customerId,
        providerSubscriptionId: data.providerSubscriptionId,
        providerProductId: data.providerProductId,
        providerPriceId: data.providerPriceId ?? null,
        status: data.status,
        currentPeriodStart: data.currentPeriodStart ?? null,
        currentPeriodEnd: data.currentPeriodEnd ?? null,
        pendingCancellation: data.pendingCancellation ?? false,
        canceledAt: data.canceledAt ?? null,
        endedAt: data.endedAt ?? null,
      })
      .onConflictDoUpdate({
        target: t.providerSubscriptionId,
        set: {
          providerProductId: data.providerProductId,
          providerPriceId: data.providerPriceId ?? null,
          status: data.status,
          currentPeriodStart: data.currentPeriodStart ?? null,
          currentPeriodEnd: data.currentPeriodEnd ?? null,
          pendingCancellation: data.pendingCancellation ?? false,
          canceledAt: data.canceledAt ?? null,
          endedAt: data.endedAt ?? null,
          updatedAt: new Date(),
        },
      })
      .returning();
    return Subscription.parse(row);
  }
}

export class DrizzleBillingEventRepository implements BillingEventRepository {
  constructor(
    private db: DrizzleDB,
    private tables: BillingTables
  ) {}

  async findByProviderEventId(providerEventId: string): Promise<BillingEvent | null> {
    const t = this.tables.billingEvents;
    const [row] = await this.db
      .select()
      .from(t)
      .where(eq(t.providerEventId, providerEventId))
      .limit(1);
    return row ? BillingEvent.parse(row) : null;
  }

  async create(data: {
    id: string;
    provider: BillingProviderType;
    providerEventId: string;
    eventType: string;
    payload?: string | null;
  }): Promise<BillingEvent> {
    const t = this.tables.billingEvents;
    const [row] = await this.db
      .insert(t)
      .values({
        id: data.id,
        provider: data.provider,
        providerEventId: data.providerEventId,
        eventType: data.eventType,
        payload: data.payload ?? null,
      })
      .returning();
    return BillingEvent.parse(row);
  }

  async exists(providerEventId: string): Promise<boolean> {
    const t = this.tables.billingEvents;
    const [row] = await this.db
      .select({ _: sql`1` })
      .from(t)
      .where(eq(t.providerEventId, providerEventId))
      .limit(1);
    return row !== undefined;
  }
}

// ============================================================================
// Repository Factory
// ============================================================================

export function drizzleRepositories(db: DrizzleDB, tables: BillingTables): BillingRepositories {
  return {
    customers: new DrizzleCustomerRepository(db, tables),
    subscriptions: new DrizzleSubscriptionRepository(db, tables),
    events: new DrizzleBillingEventRepository(db, tables),
    async transaction<T>(fn: (repos: BillingRepositories) => Promise<T>): Promise<T> {
      let result: T;
      await db.transaction(async (tx) => {
        const txRepos: BillingRepositories = {
          customers: new DrizzleCustomerRepository(tx, tables),
          subscriptions: new DrizzleSubscriptionRepository(tx, tables),
          events: new DrizzleBillingEventRepository(tx, tables),
          transaction: () => {
            throw new Error("Nested transactions are not supported");
          },
        };
        result = await fn(txRepos);
      });
      return result!;
    },
  };
}

// Re-export Drizzle-specific types so consumers get everything from one import
export { createBillingSchema } from "./schema";
export type { BillingSchema, BillingTables, BillingSchemaOptions } from "./schema";
