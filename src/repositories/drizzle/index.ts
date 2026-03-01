/**
 * Drizzle repositories for its-just-billing.
 *
 * Provides the BillingRepositories implementation backed by Drizzle ORM.
 * Also re-exports schema builder and types so consumers import from one place:
 *
 *   import { drizzleRepositories, createBillingSchema } from "its-just-billing/repositories/drizzle";
 */

export { DrizzleCustomerRepository } from "./customers";
export { DrizzleSubscriptionRepository } from "./subscriptions";
export { DrizzleBillingEventRepository } from "./events";
export { drizzleRepositories } from "./factory";
export type { DrizzleDB } from "./factory";

export { createBillingSchema } from "./schema";
export type { BillingSchema, BillingTables, BillingSchemaOptions } from "./schema";
