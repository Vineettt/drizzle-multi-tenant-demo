import { pgTable, uuid, text, timestamp, pgPolicy, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Master table - NO RLS
export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow(),
});

// organizationId IS the tenantId (organizations.id represents tenants)
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  email: text('email').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  pgPolicy('users_tenant_policy', {
    for: 'all',
    using: sql`organization_id = current_setting('app.tenant_id')::uuid`,
    withCheck: sql`organization_id = current_setting('app.tenant_id')::uuid`,
  }),
  // Indexes for performance
  index('users_organization_id_idx').on(table.organizationId), // Critical for RLS policy performance
  index('users_email_idx').on(table.email), // For email lookups
]).enableRLS();

// organizationId IS the tenantId (direct column for optimal RLS performance)
export const stacks = pgTable('stacks', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  pgPolicy('stacks_tenant_policy', {
    for: 'all',
    using: sql`organization_id = current_setting('app.tenant_id')::uuid`,
    withCheck: sql`organization_id = current_setting('app.tenant_id')::uuid`,
  }),
  // Indexes for performance
  index('stacks_organization_id_idx').on(table.organizationId), // Critical for RLS policy performance
  index('stacks_user_id_idx').on(table.userId), // For foreign key lookups
  index('stacks_org_user_idx').on(table.organizationId, table.userId), // Composite for common join patterns
]).enableRLS();
