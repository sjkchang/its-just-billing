import { eq, and } from "drizzle-orm";
import type { CustomerRepository } from "../types";
import type { BillingTables } from "./schema";
import { Customer } from "../../core/entities";
import type { BillingProviderType } from "../../core/entities";
import type { DrizzleDB } from "./factory";

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

  async findByProviderCustomerId(providerCustomerId: string, provider: BillingProviderType): Promise<Customer | null> {
    const t = this.tables.billingCustomers;
    const [row] = await this.db
      .select()
      .from(t)
      .where(and(eq(t.providerCustomerId, providerCustomerId), eq(t.provider, provider)))
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
        target: [t.provider, t.providerCustomerId],
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
