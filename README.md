# Drizzle Tenant Schema Demo

A demonstration project for managing multi-tenant PostgreSQL schemas using Drizzle ORM with the `search_path` approach.

## Overview

This project implements a tenant schema management system where:
- Each tenant has its own PostgreSQL schema
- Migrations are schema-agnostic and applied via `search_path`
- Public schema contains `schema_tracker` table to track all tenant schemas
- Tenant schemas contain tenant-specific tables (e.g., `dummy_table`)

## Prerequisites

- Node.js (v18+ recommended)
- PostgreSQL database running and accessible
- pnpm installed globally (`npm install -g pnpm`)

## Installation

```bash
# Install dependencies
pnpm install

# Set up environment variables
cp .env.example .env
# Edit .env and set DATABASE_URL
```

## Environment Variables

Create a `.env` file in the project root:

```
DATABASE_URL=postgresql://user:password@localhost:5432/database_name
```

## Scripts Reference

### Migration Generation

#### `pnpm db:generate`
Generate migration files for both public and tenant schemas.

```bash
pnpm db:generate
```

#### `pnpm db:generate:public`
Generate migration files for public schema only (`schema_tracker` table).

```bash
pnpm db:generate:public
```

#### `pnpm db:generate:tenant`
Generate migration files for tenant schemas only (`dummy_table` and other tenant tables).

```bash
pnpm db:generate:tenant
```

### Migration Execution

#### `pnpm db:migrate`
Apply migrations to the public schema.

```bash
pnpm db:migrate
```

#### `pnpm db:migrate:tenants`
Apply pending migrations to all tenant schemas listed in `schema_tracker`.

```bash
pnpm db:migrate:tenants
```

### Tenant Management

#### `pnpm db:create:tenant <schema_name>`
Create a new tenant schema, apply migrations, and register it in `schema_tracker`.

```bash
pnpm db:create:tenant demo_tenant_001
```

**Requirements:**
- Schema name must be a valid PostgreSQL identifier
- Must start with letter or underscore
- Maximum 63 characters
- Only letters, digits, and underscores
- Cannot be a reserved PostgreSQL keyword

#### `pnpm db:list:tenants`
List all tenant schemas registered in `schema_tracker`.

```bash
pnpm db:list:tenants
```

#### `pnpm db:drop:tenant <schema_name>`
Drop a tenant schema and remove it from `schema_tracker`.

```bash
pnpm db:drop:tenant demo_tenant_001
```

#### `pnpm db:health:check`
Verify all tenant schemas are healthy and up-to-date.

```bash
pnpm db:health:check
```

Checks:
- Schema exists in database
- Required tables exist in schema
- Migrations are up-to-date
- Orphaned schemas (exist in DB but not tracked)

### Development Tools

#### `pnpm db:demo:tenant`
Run a demonstration script that creates a test tenant, inserts data, and queries it.

```bash
pnpm db:demo:tenant
```

#### `pnpm db:studio`
Open Drizzle Studio for public schema (visual database browser).

```bash
pnpm db:studio
```

#### `pnpm db:studio:tenant`
Open Drizzle Studio for tenant schemas (visual database browser).

```bash
pnpm db:studio:tenant
```

### Type Checking

#### `pnpm typecheck`
Run TypeScript type checking without emitting files.

```bash
pnpm typecheck
```

## Common Workflows

### Creating a New Tenant

```bash
# 1. Create tenant schema
pnpm db:create:tenant acme_corp

# 2. Verify it was created
pnpm db:list:tenants
```

### Adding a New Column to Tenant Tables

```bash
# 1. Edit db/schema-tenant.ts to add column
# 2. Generate migration
pnpm db:generate:tenant

# 3. Apply to all tenant schemas
pnpm db:migrate:tenants

# 4. Verify health
pnpm db:health:check
```

### Adding a New Column to Public Schema

```bash
# 1. Edit db/schema-public.ts to add column
# 2. Generate migration
pnpm db:generate:public

# 3. Apply to public schema
pnpm db:migrate
```

### Full Migration Workflow

```bash
# 1. Update schema files (schema-public.ts or schema-tenant.ts)
# 2. Generate migrations
pnpm db:generate

# 3. Apply to public schema
pnpm db:migrate

# 4. Apply to all tenant schemas
pnpm db:migrate:tenants

# 5. Verify everything is healthy
pnpm db:health:check
```

## Project Structure

```
db/
├── schema-public.ts          # Public schema definitions (schema_tracker)
├── schema-tenant.ts         # Tenant schema definitions (dummy_table)
├── schema.ts                # Combined schema exports
├── tenant-schema.ts         # Core tenant management functions
├── db.ts                    # Database connection
├── index.ts                 # Package exports
├── drizzle.config.public.ts # Drizzle config for public schema
├── drizzle.config.tenant.ts # Drizzle config for tenant schemas
├── migrations/
│   ├── public/              # Public schema migrations
│   └── tenant/              # Tenant schema migrations
└── scripts/
    ├── migrate-public.ts    # Public migration script
    ├── migrate-tenants.ts   # Tenant migration script
    ├── create-tenant.ts    # Create tenant script
    ├── list-tenants.ts      # List tenants script
    ├── drop-tenant.ts       # Drop tenant script
    ├── health-check.ts      # Health check script
    └── demo-tenant-schema.ts # Demo script
```

## Documentation

- [TENANT_SCHEMA_MIGRATION.md](./TENANT_SCHEMA_MIGRATION.md) - Detailed technical guide covering architecture, search_path approach, troubleshooting, and advanced workflows

## Key Concepts

### Split Schema Approach
- `schema-public.ts`: Tables that exist only in public schema
- `schema-tenant.ts`: Tables that exist in each tenant schema
- Separate migration paths for public and tenant schemas

### search_path Method
- Migrations are schema-agnostic
- `search_path` is set to target schema before applying migrations
- Same migration files work for all tenant schemas

## Troubleshooting

### Schema Already Exists
If a schema exists but isn't tracked, add it manually:
```sql
INSERT INTO schema_tracker (name) VALUES ('schema_name');
```

### Migration Fails
Check logs for specific errors. The migration script continues processing other schemas even if one fails.

### Invalid Schema Name
Schema names must:
- Start with letter or underscore
- Be 63 characters or less
- Contain only letters, digits, and underscores
- Not be a reserved PostgreSQL keyword