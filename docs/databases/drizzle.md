# Drizzle

The Drizzle adapter provides a `BillingRepositories` implementation backed by Drizzle ORM with PostgreSQL.

## Install peer dependency

```sh
pnpm add drizzle-orm
```

## 1. Create the billing schema

The schema builder creates three tables (`billing_customers`, `billing_subscriptions`, `billing_events`) with a foreign key to your existing users table.

```ts
// db/schema.ts
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createBillingSchema } from "its-just-billing/repositories/drizzle";

// Your existing users table
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Create billing tables — FK references users.id
export const billingSchema = createBillingSchema({ usersTable: users });

// Destructure if needed for Drizzle Kit or queries
export const {
  billingCustomers,
  billingSubscriptions,
  billingEvents,
  billingProviderEnum,
  subscriptionStatusEnum,
} = billingSchema;
```

### Generated tables

| Table | Purpose |
|-------|---------|
| `billing_customers` | Links your user to a Stripe customer ID. One per user per provider. |
| `billing_subscriptions` | Tracks subscription state (status, period, cancellation). |
| `billing_events` | Deduplicates webhook events by `provider_event_id`. |

### Run migrations

Include the billing tables in your Drizzle Kit config so migrations are generated:

```ts
// drizzle.config.ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./db/schema.ts",  // must include the billing tables
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

```sh
pnpm drizzle-kit generate
pnpm drizzle-kit migrate
```

## 2. Create the adapter

Pass your Drizzle `db` instance and the billing tables to `drizzleRepositories()`:

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { drizzleRepositories } from "its-just-billing/repositories/drizzle";
import { billingSchema } from "./db/schema";

const client = postgres(process.env.DATABASE_URL!);
const db = drizzle(client);

const adapter = drizzleRepositories(db, billingSchema);
```

The adapter works with any Drizzle PostgreSQL driver — `postgres-js`, `node-postgres`, `pglite`, `neon`, etc.

## 3. Pass to createBilling

```ts
import { createBilling } from "its-just-billing";

const billing = await createBilling({
  adapter: drizzleRepositories(db, billingSchema),
  provider: { provider: "stripe", secretKey: process.env.STRIPE_SECRET_KEY! },
  resolveUser: async (req) => { /* ... */ },
});
```

## Full example

```ts
// db/index.ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const client = postgres(process.env.DATABASE_URL!);
export const db = drizzle(client, { schema });
```

```ts
// db/schema.ts
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { createBillingSchema } from "its-just-billing/repositories/drizzle";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const billingSchema = createBillingSchema({ usersTable: users });
export const { billingCustomers, billingSubscriptions, billingEvents } = billingSchema;
```

```ts
// billing.ts
import { createBilling } from "its-just-billing";
import { drizzleRepositories } from "its-just-billing/repositories/drizzle";
import { db } from "./db";
import { billingSchema } from "./db/schema";

export const billing = await createBilling({
  adapter: drizzleRepositories(db, billingSchema),
  provider: {
    provider: "stripe",
    secretKey: process.env.STRIPE_SECRET_KEY!,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  },
  resolveUser: async (req) => {
    const session = await auth.getSession(req);
    return session?.user ?? null;
  },
});
```

