import type { BillingRepositories } from "../types";
import type { BillingTables } from "./schema";
import { DrizzleCustomerRepository } from "./customers";
import { DrizzleSubscriptionRepository } from "./subscriptions";
import { DrizzleBillingEventRepository } from "./events";

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
