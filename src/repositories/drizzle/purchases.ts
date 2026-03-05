import { eq } from "drizzle-orm";
import type { PurchaseRepository } from "../types";
import type { BillingTables } from "./schema";
import { Purchase } from "../../core/entities";
import type { DrizzleDB } from "./factory";

export class DrizzlePurchaseRepository implements PurchaseRepository {
  constructor(
    private db: DrizzleDB,
    private tables: BillingTables,
  ) {}

  async findById(id: string): Promise<Purchase | null> {
    const t = this.tables.billingPurchases;
    const [row] = await this.db.select().from(t).where(eq(t.id, id)).limit(1);
    return row ? Purchase.parse(row) : null;
  }

  async findByCustomerId(customerId: string): Promise<Purchase[]> {
    const t = this.tables.billingPurchases;
    const rows = await this.db.select().from(t).where(eq(t.customerId, customerId));
    return rows.map((row: unknown) => Purchase.parse(row));
  }

  async create(data: {
    id: string;
    customerId: string;
    providerSessionId: string;
    providerProductId: string;
    providerPriceId?: string | null;
    quantity: number;
    amount: number;
    currency: string;
    purchasedAt?: Date;
  }): Promise<Purchase> {
    const t = this.tables.billingPurchases;
    const now = new Date();
    const [row] = await this.db
      .insert(t)
      .values({
        id: data.id,
        customerId: data.customerId,
        providerSessionId: data.providerSessionId,
        providerProductId: data.providerProductId,
        providerPriceId: data.providerPriceId ?? null,
        quantity: data.quantity,
        amount: data.amount,
        currency: data.currency,
        purchasedAt: data.purchasedAt ?? now,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return Purchase.parse(row);
  }
}
