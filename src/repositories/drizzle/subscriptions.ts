import { eq } from "drizzle-orm";
import type { SubscriptionRepository } from "../types";
import type { BillingTables } from "./schema";
import { Subscription } from "../../core/entities";
import type { SubscriptionStatus } from "../../core/entities";
import type { DrizzleDB } from "./factory";

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
