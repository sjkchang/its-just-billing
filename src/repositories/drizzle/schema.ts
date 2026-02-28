/**
 * Drizzle schema builder for billing tables.
 *
 * The app calls createBillingSchema({ usersTable }) to get table definitions
 * with the FK to its own users table. The returned tables are passed to
 * createBilling() and used by Drizzle Kit for migrations.
 */

import { text, timestamp, boolean, pgTable, pgEnum, unique } from "drizzle-orm/pg-core";
import type { PgTableWithColumns } from "drizzle-orm/pg-core";

export const billingProviderEnum = pgEnum("billing_provider", ["stripe", "mock"]);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "trialing",
  "active",
  "incomplete",
  "incomplete_expired",
  "past_due",
  "unpaid",
  "canceled",
  "paused",
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyUsersTable = PgTableWithColumns<any>;

export interface BillingSchemaOptions {
  usersTable: AnyUsersTable;
}

export function createBillingSchema({ usersTable }: BillingSchemaOptions) {
  const billingCustomers = pgTable(
    "billing_customers",
    {
      id: text("id").primaryKey(),
      userId: text("user_id")
        .notNull()
        .references(() => usersTable.id, { onDelete: "cascade" }),
      provider: billingProviderEnum("provider").notNull(),
      providerCustomerId: text("provider_customer_id").notNull().unique(),
      email: text("email").notNull(),
      name: text("name"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [unique("billing_customers_user_provider").on(t.userId, t.provider)]
  );

  const billingSubscriptions = pgTable("billing_subscriptions", {
    id: text("id").primaryKey(),
    customerId: text("customer_id")
      .notNull()
      .references(() => billingCustomers.id, { onDelete: "cascade" }),
    providerSubscriptionId: text("provider_subscription_id").notNull().unique(),
    providerProductId: text("provider_product_id").notNull(),
    providerPriceId: text("provider_price_id"),
    status: subscriptionStatusEnum("status").notNull(),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    pendingCancellation: boolean("pending_cancellation").notNull().default(false),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  });

  const billingEvents = pgTable("billing_events", {
    id: text("id").primaryKey(),
    provider: billingProviderEnum("provider").notNull(),
    providerEventId: text("provider_event_id").notNull().unique(),
    eventType: text("event_type").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
    payload: text("payload"),
  });

  return {
    billingCustomers,
    billingSubscriptions,
    billingEvents,
    billingProviderEnum,
    subscriptionStatusEnum,
  };
}

export type BillingSchema = ReturnType<typeof createBillingSchema>;

export type BillingTables = Pick<
  BillingSchema,
  "billingCustomers" | "billingSubscriptions" | "billingEvents"
>;
