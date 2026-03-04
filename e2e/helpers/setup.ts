/**
 * E2E test setup — PostgreSQL container + DB schema + billing context.
 */

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { nanoid } from "nanoid";
import { createBillingSchema } from "../../src/repositories/drizzle/schema";
import { drizzleRepositories } from "../../src/repositories/drizzle/factory";
import { pgTable, text } from "drizzle-orm/pg-core";

// ============================================================================
// Minimal users table (FK target for billing_customers)
// ============================================================================

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name"),
});

export const billingSchema = createBillingSchema({ usersTable: users });

// ============================================================================
// DDL — must match the Drizzle schema exactly
// ============================================================================

const DDL = `
  -- Enums
  DO $$ BEGIN
    CREATE TYPE billing_provider AS ENUM ('stripe', 'mock');
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  DO $$ BEGIN
    CREATE TYPE subscription_status AS ENUM (
      'trialing', 'active', 'incomplete', 'incomplete_expired',
      'past_due', 'unpaid', 'canceled', 'paused'
    );
  EXCEPTION WHEN duplicate_object THEN NULL;
  END $$;

  -- Users table (minimal, just for FK)
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    name TEXT
  );

  -- Billing tables
  CREATE TABLE IF NOT EXISTS billing_customers (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider billing_provider NOT NULL,
    provider_customer_id TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT billing_customers_user_provider UNIQUE (user_id, provider)
  );

  CREATE TABLE IF NOT EXISTS billing_subscriptions (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES billing_customers(id) ON DELETE CASCADE,
    provider_subscription_id TEXT NOT NULL UNIQUE,
    provider_product_id TEXT NOT NULL,
    provider_price_id TEXT,
    status subscription_status NOT NULL,
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    pending_cancellation BOOLEAN NOT NULL DEFAULT FALSE,
    canceled_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS billing_events (
    id TEXT PRIMARY KEY,
    provider billing_provider NOT NULL,
    provider_event_id TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payload TEXT
  );
`;

const TRUNCATE = `
  TRUNCATE billing_events, billing_subscriptions, billing_customers, users CASCADE;
`;

// ============================================================================
// Test context
// ============================================================================

export interface E2EContext {
  container: StartedPostgreSqlContainer;
  sql: postgres.Sql;
  db: ReturnType<typeof drizzle>;
  adapter: ReturnType<typeof drizzleRepositories>;
  runPrefix: string;
  truncate: () => Promise<void>;
}

export async function setupDatabase(): Promise<E2EContext> {
  const container = await new PostgreSqlContainer("postgres:16-alpine").start();

  const connectionString = container.getConnectionUri();
  const sql = postgres(connectionString);
  const db = drizzle(sql);

  // Create schema
  await sql.unsafe(DDL);

  const adapter = drizzleRepositories(db as any, {
    billingCustomers: billingSchema.billingCustomers,
    billingSubscriptions: billingSchema.billingSubscriptions,
    billingEvents: billingSchema.billingEvents,
  });

  const runPrefix = `e2e_${nanoid(8)}`;

  return {
    container,
    sql,
    db,
    adapter,
    runPrefix,
    truncate: async () => {
      await sql.unsafe(TRUNCATE);
    },
  };
}

export async function teardownDatabase(ctx: E2EContext): Promise<void> {
  await ctx.sql.end();
  await ctx.container.stop();
}

// ============================================================================
// Test user helpers
// ============================================================================

export interface TestUser {
  id: string;
  email: string;
  name: string;
}

export function createTestUser(prefix: string, label: string): TestUser {
  return {
    id: `${prefix}_${label}`,
    email: `${label}@e2e-test.local`,
    name: label.charAt(0).toUpperCase() + label.slice(1),
  };
}

export async function insertTestUser(sql: postgres.Sql, user: TestUser): Promise<void> {
  await sql`INSERT INTO users (id, email, name) VALUES (${user.id}, ${user.email}, ${user.name}) ON CONFLICT DO NOTHING`;
}

/**
 * Insert a billing_customers row linking a user to a Stripe customer.
 * This avoids relying on Stripe's Search API (which has indexing delay)
 * when sync needs to find the provider customer.
 */
export async function insertBillingCustomer(
  sql: postgres.Sql,
  opts: { userId: string; providerCustomerId: string; email: string; name?: string },
): Promise<void> {
  const id = nanoid();
  await sql`
    INSERT INTO billing_customers (id, user_id, provider, provider_customer_id, email, name)
    VALUES (${id}, ${opts.userId}, 'stripe', ${opts.providerCustomerId}, ${opts.email}, ${opts.name ?? null})
    ON CONFLICT DO NOTHING
  `;
}
