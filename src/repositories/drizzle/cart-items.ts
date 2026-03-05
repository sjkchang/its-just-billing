import { eq, and } from "drizzle-orm";
import type { CartItemRepository } from "../types";
import type { BillingTables } from "./schema";
import { CartItem } from "../../core/entities";
import type { DrizzleDB } from "./factory";

export class DrizzleCartItemRepository implements CartItemRepository {
  constructor(
    private db: DrizzleDB,
    private tables: BillingTables,
  ) {}

  async findByUserId(userId: string): Promise<CartItem[]> {
    const t = this.tables.billingCartItems;
    const rows = await this.db.select().from(t).where(eq(t.userId, userId));
    return rows.map((row: unknown) => CartItem.parse(row));
  }

  async upsert(data: {
    id: string;
    userId: string;
    productId: string;
    quantity: number;
  }): Promise<CartItem> {
    const t = this.tables.billingCartItems;
    const now = new Date();
    const [row] = await this.db
      .insert(t)
      .values({
        id: data.id,
        userId: data.userId,
        productId: data.productId,
        quantity: data.quantity,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [t.userId, t.productId],
        set: {
          quantity: data.quantity,
          updatedAt: now,
        },
      })
      .returning();
    return CartItem.parse(row);
  }

  async remove(userId: string, productId: string): Promise<void> {
    const t = this.tables.billingCartItems;
    await this.db.delete(t).where(and(eq(t.userId, userId), eq(t.productId, productId)));
  }

  async clear(userId: string): Promise<void> {
    const t = this.tables.billingCartItems;
    await this.db.delete(t).where(eq(t.userId, userId));
  }
}
