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
PostgreSQL Database
├── public schema
│   └── schema_tracker (tracks all tenant schemas)
└── tenant schemas (one per tenant)
    ├── dummy_table
    └── __drizzle_migrations (Drizzle migration tracking)
```

### Key Components

1. **Public Schema**: Contains `schema_tracker` table that tracks all tenant schemas
2. **Tenant Schemas**: Each tenant has its own schema with identical table structure
3. **Split Migrations**: 
   - Public migrations: `db/migrations/public/` (for `schema_tracker` table)
   - Tenant migrations: `db/migrations/tenant/` (for `dummy_table` and other tenant tables)
4. **Split Schema Files**:
   - `db/schema-public.ts`: Defines tables for public schema
   - `db/schema-tenant.ts`: Defines tables for tenant schemas
5. **Split Drizzle Configs**:
   - `db/drizzle.config.public.ts`: Config for generating public schema migrations
   - `db/drizzle.config.tenant.ts`: Config for generating tenant schema migrations

## Implementation

### Core Functions

Located in `db/tenant-schema.ts`:

#### `validateSchemaName(schemaName: string)`
Validates schema name format according to PostgreSQL rules:
- Maximum 63 characters
- Must start with letter or underscore
- Can contain letters, digits, and underscores
- Cannot be a reserved PostgreSQL keyword

#### `createTenantSchemaWithMigrations(schemaName: string)`
Creates a new tenant schema and applies migrations:
1. Validates schema name
2. Creates schema: `CREATE SCHEMA IF NOT EXISTS "schema_name"`
3. Sets search_path: `SET search_path TO "schema_name", public`
4. Applies Drizzle migrations
5. Handles errors with cleanup

#### `migrateAllTenantSchemas()`
Migrates all tenant schemas listed in `schema_tracker`:
1. Queries `schema_tracker` for all schema names
2. Applies migrations to each schema sequentially
3. Continues on individual failures (logs errors)
4. Returns summary with success/failure counts

## Usage

### Creating a Tenant Schema

```bash
pnpm db:create:tenant demo_tenant_001
```

### Migrating All Tenant Schemas

```bash
pnpm db:migrate:tenants
```

### Running Demo

```bash
pnpm db:demo:tenant
```

## Migration Workflow

### 1. Update Schema Definition

**For tenant schema changes**, edit `db/schema-tenant.ts`:
```typescript
export const dummyTable = pgTable('dummy_table', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  value: text('value'),
  description: text('description'), // New column
  createdAt: timestamp('created_at').defaultNow(),
});
```

**For public schema changes**, edit `db/schema-public.ts`:
```typescript
export const schemaTracker = pgTable('schema_tracker', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
  // Add new columns here
});
```

### 2. Generate Migrations

```bash
# Generate both public and tenant migrations
pnpm db:generate

# Or generate separately:
pnpm db:generate:public   # Only public schema migrations
pnpm db:generate:tenant   # Only tenant schema migrations
```

### 3. Apply to Public Schema

```bash
pnpm db:migrate
```

### 4. Apply to All Tenant Schemas

```bash
pnpm db:migrate:tenants
```

## How search_path Works

When we set `search_path TO "tenant_schema", public`:

1. PostgreSQL looks for tables in `tenant_schema` first
2. Falls back to `public` if not found
3. Migration SQL like `CREATE TABLE dummy_table (...)` creates the table in the current search_path (tenant_schema)
4. No schema qualification needed in migrations

### Example Migration SQL

**Without search_path (schema-qualified):**
```sql
CREATE TABLE "tenant_001"."dummy_table" (...);
CREATE TABLE "tenant_002"."dummy_table" (...);
-- Need separate migrations per tenant
```

**With search_path (schema-agnostic):**
```sql
SET search_path TO "tenant_001", public;
CREATE TABLE dummy_table (...);
-- Same migration works for all tenants
```

## Troubleshooting

### Schema Already Exists

**Error**: `Schema 'tenant_name' already exists`

**Solution**: Check `schema_tracker` table. If schema exists but not tracked, add it manually:
```sql
INSERT INTO schema_tracker (name) VALUES ('tenant_name');
```

### Migration Fails on One Tenant

**Error**: Migration fails for specific tenant schema

**Solution**: The `migrateAllTenantSchemas()` function continues processing other schemas. Check logs for the specific error and fix the problematic schema manually.

### Invalid Schema Name

**Error**: `Schema name must start with a letter or underscore`

**Solution**: Use valid PostgreSQL identifier:
- Start with letter or underscore
- Max 63 characters
- Only letters, digits, underscores
- Not a reserved keyword

### Connection Issues

**Error**: `DATABASE_URL environment variable is required`

**Solution**: Ensure `.env` file exists with:
```
DATABASE_URL=postgresql://user:password@localhost:5432/database_name
```

## Error Recovery

### Failed Schema Creation

If schema creation fails, the function automatically:
1. Attempts to drop the partially created schema
2. Logs the cleanup error if drop fails
3. Throws the original error

### Manual Cleanup

To manually clean up a failed tenant schema:

```sql
-- Drop the schema
DROP SCHEMA IF EXISTS "tenant_name" CASCADE;

-- Remove from tracker
DELETE FROM schema_tracker WHERE name = 'tenant_name';
```

## Best Practices

1. **Always validate schema names** before creation
2. **Use transactions** when creating schema + tracking (handled automatically)
3. **Test migrations** on a single tenant before applying to all
4. **Backup database** before bulk migrations
5. **Monitor migration logs** for failures
6. **Keep migrations idempotent** (use `IF NOT EXISTS` where possible)

## File Structure

```
db/
├── schema-public.ts       # Public schema table definitions (schema_tracker)
├── schema-tenant.ts      # Tenant schema table definitions (dummy_table)
├── schema.ts             # Combined schema exports
├── tenant-schema.ts      # Core tenant functions
├── db.ts                 # Database connection
├── index.ts              # Exports
├── drizzle.config.public.ts  # Drizzle config for public schema
├── drizzle.config.tenant.ts  # Drizzle config for tenant schemas
├── migrations/           # Migration files
│   ├── public/           # Public schema migrations
│   │   └── *.sql        # Generated migrations for schema_tracker
│   └── tenant/           # Tenant schema migrations
│       └── *.sql        # Generated migrations for tenant tables
└── scripts/
    ├── migrate-public.ts     # Migrate public schema
    ├── migrate-tenants.ts    # Migrate all tenants
    ├── create-tenant.ts      # Create new tenant
    ├── demo-tenant-schema.ts # Demo script
    ├── list-tenants.ts       # List all tenant schemas
    ├── drop-tenant.ts        # Drop tenant schema
    └── health-check.ts       # Health check script
```

## Commands Reference

```bash
# Generate migrations (both public and tenant)
pnpm db:generate
# Or generate separately:
pnpm db:generate:public   # Only public schema migrations
pnpm db:generate:tenant    # Only tenant schema migrations

# Apply to public schema
pnpm db:migrate

# Apply to all tenant schemas
pnpm db:migrate:tenants

# Create new tenant schema
pnpm db:create:tenant <schema_name>

# List all tenant schemas
pnpm db:list:tenants

# Drop a tenant schema
pnpm db:drop:tenant <schema_name>

# Health check all tenant schemas
pnpm db:health:check

# Run demo
pnpm db:demo:tenant

# Type check
pnpm typecheck
```

## Example Workflow

1. **Create tenant schema:**
   ```bash
   pnpm db:create:tenant acme_corp
   ```

2. **Add new column to tenant schema:**
   Edit `db/schema-tenant.ts` → Add column to `dummyTable` definition

3. **Generate tenant migration:**
   ```bash
   pnpm db:generate:tenant
   # Or generate both:
   pnpm db:generate
   ```

4. **Apply to all tenants:**
   ```bash
   pnpm db:migrate:tenants
   ```

5. **Verify:**
   ```bash
   pnpm db:health:check
   # Or run demo:
   pnpm db:demo:tenant
   ```

## Security Considerations

- Schema names are validated to prevent SQL injection
- Uses PostgreSQL identifier quoting (`"schema_name"`)
- Validates against reserved keywords
- Each operation uses dedicated connection
- Connections are properly closed

## Performance Notes

- Migrations are applied sequentially (one tenant at a time)
- Each migration creates a new connection (by design for isolation)

