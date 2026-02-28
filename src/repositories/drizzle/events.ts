import { eq, sql } from "drizzle-orm";
import type { BillingEventRepository } from "../types";
import type { BillingTables } from "./schema";
import { BillingEvent } from "../../core/entities";
import type { BillingProviderType } from "../../core/entities";
import type { DrizzleDB } from "./factory";

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
