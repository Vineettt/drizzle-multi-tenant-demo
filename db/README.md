# Tenant Schema Migration Guide - search_path Approach

## Overview

This document explains the search_path approach for managing dynamic tenant schemas with Drizzle ORM. This method allows schema-agnostic migrations that can be applied to multiple tenant schemas without modification.

## Why Split Schemas and search_path?

This implementation uses a **split schema approach** combined with `search_path` for maximum flexibility:

### Split Schema Approach

**Separate schema files:**
- `schema-public.ts`: Tables that exist only in the public schema (e.g., `schema_tracker`)
- `schema-tenant.ts`: Tables that exist in each tenant schema (e.g., `dummy_table`)

**Benefits:**
- Independent migration generation for public vs tenant schemas
- Prevents accidentally creating tenant tables in public schema
- Allows different migration paths (`migrations/public/` vs `migrations/tenant/`)

### search_path Approach

The `search_path` approach creates schema-agnostic tenant migrations:

1. Set `search_path` to the target tenant schema before running migrations
2. Generate migrations without schema prefixes
3. Apply the same migration files to all tenant schemas

## Architecture

### Schema Structure

```
public schema:
├── schema_tracker (tracks all tenant schemas)

tenant_001 schema:
├── dummy_table
└── (other tenant-specific tables)

tenant_002 schema:
├── dummy_table
└── (other tenant-specific tables)
```

### Migration Structure

```
migrations/
├── public/
│   ├── 0000_*.sql          # Public schema migrations
│   └── meta/
│       ├── _journal.json
│       └── 0000_snapshot.json
└── tenant/
    ├── 0000_*.sql          # Tenant schema migrations (schema-agnostic)
    └── meta/
        ├── _journal.json
        └── 0000_snapshot.json
```

## How search_path Works

### 1. Schema-Agnostic Migration Generation

When generating tenant migrations, Drizzle Kit creates SQL without schema prefixes:

```sql
-- Generated migration (no schema prefix)
CREATE TABLE "dummy_table" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "value" text,
  "description" text,
  "created_at" timestamp DEFAULT now()
);
```

### 2. Applying Migrations with search_path

Before applying migrations, set `search_path` to the target schema:

```typescript
// Set search_path to tenant schema
await client.execute(sql`SET search_path TO ${sql.identifier(schemaName)}`);

// Apply migrations (they now target the tenant schema)
await migrate(db, { migrationsFolder: './migrations/tenant' });
```

### 3. Result: Same Migration, Multiple Schemas

The same migration file works for all tenant schemas:

```bash
# Apply to tenant_001
SET search_path TO tenant_001;
-- Run migration

# Apply to tenant_002
SET search_path TO tenant_002;
-- Run same migration file
```

## Implementation Details

### Schema Definition

**`schema-public.ts`:**
```typescript
import { pgTable, uuid, text } from 'drizzle-orm/pg-core';

export const schemaTracker = pgTable('schema_tracker', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
});
```

**`schema-tenant.ts`:**
```typescript
import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';

export const dummyTable = pgTable('dummy_table', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  value: text('value'),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow(),
});
```

### Migration Generation

**Public schema:**
```bash
pnpm db:generate:public
# Generates: migrations/public/0000_*.sql
```

**Tenant schema:**
```bash
pnpm db:generate:tenant
# Generates: migrations/tenant/0000_*.sql (schema-agnostic)
```

### Migration Application

**Public schema:**
```typescript
// No search_path needed - targets public schema
await migrate(db, { migrationsFolder: './migrations/public' });
```

**Tenant schema:**
```typescript
// Set search_path before applying migrations
await client.execute(sql`SET search_path TO ${sql.identifier(schemaName)}`);
await migrate(db, { migrationsFolder: './migrations/tenant' });
```

## Key Benefits

### 1. **Schema-Agnostic Migrations**
- Same migration files work for all tenant schemas
- No need to modify migrations for each tenant
- Consistent schema structure across tenants

### 2. **Independent Migration Paths**
- Public and tenant migrations are separate
- Can update tenant schemas without affecting public schema
- Can add new tenant tables without touching public schema

### 3. **Flexible Tenant Management**
- Create new tenants by applying existing migrations
- Migrate individual tenants independently
- Rollback migrations per tenant if needed

### 4. **Type Safety**
- Drizzle ORM maintains type safety across schemas
- Same TypeScript types work for all tenants
- Compile-time checks prevent schema mismatches

## Common Workflows

### Creating a New Tenant

```bash
# 1. Create tenant schema
pnpm db:create:tenant acme_corp

# This internally:
# - Creates schema 'acme_corp'
# - Sets search_path to 'acme_corp'
# - Applies migrations from migrations/tenant/
# - Registers in schema_tracker
```

### Adding a New Column to Tenant Tables

```bash
# 1. Edit schema-tenant.ts
# Add new column to dummyTable

# 2. Generate tenant migration
pnpm db:generate:tenant

# 3. Apply to all tenant schemas
pnpm db:migrate:tenants

# This applies the same migration to all tenants using search_path
```

### Migrating a Single Tenant

```bash
# Apply pending migrations to one tenant
pnpm db:migrate:tenant acme_corp

# Useful for:
# - Testing migrations on one tenant first
# - Fixing migration issues for specific tenant
# - Applying migrations to tenant created before new migrations
```

### Database Cleanup

#### Complete Reset (Drop All Schemas and Tables)

```bash
pnpm db:cleanup:drop
```

- Drops all tenant schemas completely
- Drops public schema tables (`schema_tracker`, `__drizzle_migrations`)
- Removes schemas from `schema_tracker`
- Requires running migrations again:
  - `pnpm db:migrate` (for public schema)
  - `pnpm db:migrate:tenants` (for tenant schemas)

**Use cases:**
- Complete teardown for testing/development
- Resetting the entire multi-tenant database
- Starting fresh after schema changes

**Warning:** This operation is irreversible. All tenant data and schemas will be permanently deleted.

#### Dropping Individual Tenant Schemas

```bash
# Drop a specific tenant schema
pnpm db:drop:tenant <schema_name>
```

- Drops a single tenant schema
- Removes the schema from `schema_tracker`
- Does not affect other tenant schemas or public schema tables

## Troubleshooting

### Migration Applies to Wrong Schema

**Problem:** Migrations are applied to `public` schema instead of tenant schema.

**Solution:** Ensure `search_path` is set before applying migrations:

```typescript
// ✅ Correct
await client.execute(sql`SET search_path TO ${sql.identifier(schemaName)}`);
await migrate(db, { migrationsFolder: './migrations/tenant' });

// ❌ Wrong - applies to public schema
await migrate(db, { migrationsFolder: './migrations/tenant' });
```

### Schema Already Exists Error

**Problem:** `CREATE SCHEMA` fails because schema already exists.

**Solution:** Check if schema exists before creating:

```typescript
const schemaExists = await checkSchemaExists(schemaName);
if (!schemaExists) {
  await client.execute(sql`CREATE SCHEMA ${sql.identifier(schemaName)}`);
}
```

### Migration Files Have Schema Prefixes

**Problem:** Generated migrations include schema prefixes (e.g., `CREATE TABLE tenant_001.dummy_table`).

**Solution:** Ensure Drizzle config doesn't specify schema in `schema` option:

```typescript
// ✅ Correct - no schema prefix
export default {
  schema: schemaTenant, // Just the schema object
  // ...
};

// ❌ Wrong - includes schema prefix
export default {
  schema: schemaTenant,
  schemaFilter: ['tenant_001'], // This adds schema prefix
  // ...
};
```

### Tables Created in Public Schema

**Problem:** Tenant tables appear in `public` schema instead of tenant schema.

**Solution:** 
1. Verify `search_path` is set correctly
2. Check that migrations are applied with correct `search_path`
3. Ensure `schema-public.ts` and `schema-tenant.ts` are separate

## Advanced Patterns

### Conditional Migrations

You can apply different migrations to different tenants:

```typescript
// Apply migration A to tenant_001
await applyMigrationToTenant('tenant_001', './migrations/tenant/migration_a');

// Apply migration B to tenant_002
await applyMigrationToTenant('tenant_002', './migrations/tenant/migration_b');
```

### Schema Versioning

Track schema versions per tenant:

```typescript
// Add version tracking table to tenant schema
export const schemaVersion = pgTable('schema_version', {
  version: text('version').notNull(),
  appliedAt: timestamp('applied_at').defaultNow(),
});

// Check version before applying migrations
const currentVersion = await getTenantSchemaVersion(schemaName);
if (currentVersion < targetVersion) {
  await applyMigrations(schemaName);
}
```

### Rollback Support

Implement rollback for tenant schemas:

```typescript
// Rollback last migration for specific tenant
await rollbackTenantMigration('tenant_001', 1);

// Rollback all migrations (drop schema)
await dropTenantSchema('tenant_001');
```

## Best Practices

### 1. **Always Use search_path**
- Never hardcode schema names in migrations
- Always set `search_path` before applying tenant migrations
- Use `sql.identifier()` for schema names to prevent SQL injection

### 2. **Separate Public and Tenant Migrations**
- Keep `migrations/public/` and `migrations/tenant/` separate
- Use separate Drizzle configs for each
- Generate migrations independently

### 3. **Test Migrations on Single Tenant First**
- Apply migrations to one tenant before applying to all
- Use `pnpm db:migrate:tenant <name>` for testing
- Verify schema structure before bulk migration

### 4. **Track Tenant Schemas**
- Always register new schemas in `schema_tracker`
- Use health checks to verify schema consistency
- Monitor for orphaned schemas

### 5. **Version Control**
- Commit migration files to version control
- Never modify applied migrations
- Create new migrations for schema changes

## Comparison with Other Approaches

### vs. Schema Prefixes in Migrations

**Schema Prefixes:**
```sql
CREATE TABLE tenant_001.dummy_table (...);
CREATE TABLE tenant_002.dummy_table (...);
```
- ❌ Requires separate migration files per tenant
- ❌ Harder to maintain
- ❌ More complex migration generation

**search_path:**
```sql
CREATE TABLE dummy_table (...);
```
- ✅ Single migration file for all tenants
- ✅ Easier to maintain
- ✅ Simpler migration generation

### vs. Dynamic Schema Names

**Dynamic Schema Names:**
```typescript
const table = pgTable(`${tenantId}_dummy_table`, {...});
```
- ❌ Type safety issues
- ❌ Harder to query
- ❌ Schema name conflicts

**search_path:**
```typescript
const table = pgTable('dummy_table', {...});
```
- ✅ Type safety maintained
- ✅ Easier to query
- ✅ No name conflicts

## References

- [PostgreSQL search_path Documentation](https://www.postgresql.org/docs/current/ddl-schemas.html#DDL-SCHEMAS-PATH)
- [Drizzle ORM Documentation](https://orm.drizzle.team/docs/overview)
- [Drizzle Kit Migrations](https://orm.drizzle.team/docs/migrations)
