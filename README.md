# Drizzle Multi-Tenancy Demo

A demonstration project showcasing **two different multi-tenancy approaches** using Drizzle ORM and PostgreSQL.

## Overview

This project contains **two independent multi-tenancy implementations**:

### 1. **Multi-Schema Approach** (`db/` folder)
- Each tenant has its own PostgreSQL schema
- Schema-level isolation (strong isolation)
- Migrations are schema-agnostic and applied via `search_path`
- Public schema contains `schema_tracker` table to track all tenant schemas
- Tenant schemas contain tenant-specific tables
- **Best for:** Strong isolation requirements, separate tenant data

### 2. **Row-Level Security (RLS) Approach** (`db-rls/` folder)
- All tenants share the same PostgreSQL schema (`public`)
- Row-level isolation using PostgreSQL RLS policies
- Single set of migrations for all tenants
- Uses `organizations` table (master table) and RLS policies
- **Best for:** Cross-tenant queries, analytics, reporting

**Note:** These are completely independent implementations. Choose the approach that fits your use case.

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
# Edit .env and set appropriate DATABASE_URL variables
```

---

## Multi-Schema Approach (`db/`)

### Environment Variables

Create a `.env` file in the project root:

```
DATABASE_URL=postgresql://user:password@localhost:5432/database_name
```

### Scripts

#### Migration Generation

- `pnpm db:generate` - Generate migration files for both public and tenant schemas
- `pnpm db:generate:public` - Generate migration files for public schema only (`schema_tracker` table)
- `pnpm db:generate:tenant` - Generate migration files for tenant schemas only (`dummy_table` and other tenant tables)

#### Migration Execution

- `pnpm db:migrate` - Apply migrations to the public schema
- `pnpm db:migrate:tenants` - Apply pending migrations to all tenant schemas listed in `schema_tracker`
- `pnpm db:migrate:tenant <schema_name>` - Apply pending migrations to a specific tenant schema

**Use cases for single tenant migration:**
- Test migrations on a single tenant before applying to all
- Debug migration issues for a specific tenant
- Apply migrations to a tenant that was created before new migrations were generated

#### Tenant Management

- `pnpm db:create:tenant <schema_name>` - Create a new tenant schema, apply migrations, and register it in `schema_tracker`

  **Requirements:**
  - Schema name must be a valid PostgreSQL identifier
  - Must start with letter or underscore
  - Maximum 63 characters
  - Only letters, digits, and underscores
  - Cannot be a reserved PostgreSQL keyword

- `pnpm db:list:tenants` - List all tenant schemas registered in `schema_tracker`
- `pnpm db:drop:tenant <schema_name>` - Drop a tenant schema and remove it from `schema_tracker`
- `pnpm db:health:check` - Verify all tenant schemas are healthy and up-to-date
- `pnpm db:cleanup:drop` - Drop all tenant schemas and public tables (complete reset)

  **Health Checks:**
  - **Schema existence**: Verifies each tracked schema exists in the database
  - **Table existence**: Checks that required tables (e.g., `dummy_table`) exist
  - **Migration status**: Compares applied migrations against expected migrations from journal
    - Detects missing migrations (schemas that haven't applied all migrations)
    - Detects extra migrations (schemas with unexpected migrations)
    - Ensures all tenants have identical schema structure
  - **Orphaned schemas**: Identifies schemas that exist in the database but are not tracked in `schema_tracker`

  **Exit codes:**
  - `0`: All schemas are healthy
  - `1`: Issues found (unhealthy schemas or orphaned schemas)

#### Development Tools

- `pnpm db:demo:tenant` - Run a demonstration script that creates a test tenant, inserts data, and queries it
- `pnpm db:demo:tenant:timing` - Run demo script with timing enabled (`--timing` flag)
- `pnpm db:benchmark` - Performance benchmarking (measures search_path overhead)
- `pnpm db:studio` - Open Drizzle Studio for public schema (visual database browser)
- `pnpm db:studio:tenant` - Open Drizzle Studio for tenant schemas (visual database browser)

### Common Workflows

#### Creating a New Tenant

```bash
# 1. Create tenant schema
pnpm db:create:tenant acme_corp

# 2. Verify it was created
pnpm db:list:tenants
```

#### Adding a New Column to Tenant Tables

```bash
# 1. Edit db/schema-tenant.ts to add column
# 2. Generate migration
pnpm db:generate:tenant

# 3. Apply to all tenant schemas
pnpm db:migrate:tenants

# 4. Verify health
pnpm db:health:check
```

#### Adding a New Column to Public Schema

```bash
# 1. Edit db/schema-public.ts to add column
# 2. Generate migration
pnpm db:generate:public

# 3. Apply to public schema
pnpm db:migrate
```

#### Full Migration Workflow

```bash
# 1. Update schema files (schema-public.ts or schema-tenant.ts)
# 2. Generate migrations
pnpm db:generate

# 3. Apply to public schema
pnpm db:migrate

# 4. Test on a single tenant first (recommended)
pnpm db:migrate:tenant test_tenant_001

# 5. Apply to all tenant schemas
pnpm db:migrate:tenants

# 6. Verify everything is healthy
pnpm db:health:check
```

### Project Structure

```
db/
├── schema-public.ts          # Public schema definitions (schema_tracker)
├── schema-tenant.ts         # Tenant schema definitions (dummy_table)
├── schema.ts                # Combined schema exports
├── tenant-schema.ts         # Core tenant management functions
├── migration-utils.ts       # Migration execution utilities (applyMigrations)
├── script-utils.ts          # Shared script utilities (client, validation, migrations)
├── db.ts                    # Database connection
├── index.ts                 # Package exports
├── drizzle.config.public.ts # Drizzle config for public schema
├── drizzle.config.tenant.ts # Drizzle config for tenant schemas
├── migrations/
│   ├── public/              # Public schema migrations
│   │   ├── *.sql           # Generated migration files
│   │   └── meta/           # Migration metadata (_journal.json)
│   └── tenant/              # Tenant schema migrations
│       ├── *.sql           # Generated migration files
│       └── meta/           # Migration metadata (_journal.json)
└── scripts/
    ├── migrate-public.ts    # Public migration script
    ├── migrate-tenants.ts   # Migrate all tenants script
    ├── migrate-tenant.ts    # Migrate single tenant script
    ├── create-tenant.ts     # Create tenant script
    ├── list-tenants.ts      # List tenants script
    ├── drop-tenant.ts       # Drop tenant script
    ├── health-check.ts      # Health check script
    └── demo-tenant-schema.ts # Demo script
```

### Key Concepts

#### Split Schema Approach
- `schema-public.ts`: Tables that exist only in public schema
- `schema-tenant.ts`: Tables that exist in each tenant schema
- Separate migration paths for public and tenant schemas

#### search_path Method
- Migrations are schema-agnostic
- `search_path` is set to target schema before applying migrations
- Same migration files work for all tenant schemas

### Troubleshooting

#### Schema Already Exists
If a schema exists but isn't tracked, add it manually:
```sql
INSERT INTO schema_tracker (name) VALUES ('schema_name');
```

#### Migration Fails
Check logs for specific errors. The migration script continues processing other schemas even if one fails.

#### Health Check Issues

**Migration mismatch**: A tenant schema has missing or extra migrations
- **Solution**: Run `pnpm db:migrate:tenant <schema_name>` to sync migrations

**Orphaned schemas**: Schemas exist in database but aren't tracked
- **Solution**: Either add to tracker (`INSERT INTO schema_tracker`) or drop the schema (`pnpm db:drop:tenant`)

#### Invalid Schema Name
Schema names must:
- Start with letter or underscore
- Be 63 characters or less
- Contain only letters, digits, and underscores
- Not be a reserved PostgreSQL keyword

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
- Use for complete database reset

### Documentation

- [db/README.md](./db/README.md) - Detailed technical guide covering architecture, search_path approach, troubleshooting, and advanced workflows

---

## Row-Level Security (RLS) Approach (`db-rls/`)

### Environment Variables

Create a `.env` file in the project root:

```bash
# Admin - for migrations (bypasses RLS)
# Use your Neon database owner credentials (from Neon dashboard)
DATABASE_URL_ADMIN=postgresql://neondb_owner:password@ep-xxx-xxx.region.aws.neon.tech/neondb?sslmode=require

# App - for application queries (respects RLS)
# Use app_owner role (created via setup-postgres.sql) or Neon branch connection string
DATABASE_URL_APP=postgresql://app_owner:password@ep-xxx-xxx.region.aws.neon.tech/neondb?sslmode=require
```

**Neon-Specific Notes:**
- **DATABASE_URL_ADMIN:** Use your Neon database owner credentials (found in Neon dashboard)
  - Neon restricts schema creation to owner accounts
  - Owner credentials are required for migrations
  - Connection string format: `postgresql://[user]:[password]@[host]/[database]?sslmode=require`
  
- **DATABASE_URL_APP:** Use `app_owner` role after running setup script, or use a Neon branch connection
  - The `app_owner` role respects RLS policies
  - You can also use a Neon branch connection string for application queries

### Setup

#### 1. Neon Database Setup

**Create roles and permissions:**

1. Connect to your Neon database using owner credentials:
   ```bash
   psql "postgresql://neondb_owner:password@ep-xxx-xxx.region.aws.neon.tech/neondb?sslmode=require"
   ```

2. Edit `db-rls/scripts/setup-postgres.sql`:
   - Replace `'your_password_here'` with secure passwords for both roles
   - Replace `'your_database'` with your Neon database name (usually `neondb`)

3. Run the setup script:
   ```bash
   psql "postgresql://neondb_owner:password@ep-xxx-xxx.region.aws.neon.tech/neondb?sslmode=require" -f db-rls/scripts/setup-postgres.sql
   ```

4. Verify setup:
   ```bash
   psql "postgresql://neondb_owner:password@ep-xxx-xxx.region.aws.neon.tech/neondb?sslmode=require" -f db-rls/scripts/verify-setup.sql
   ```

**Note:** Neon uses SSL connections by default. Always include `?sslmode=require` in connection strings.

#### 2. Generate Migrations

```bash
pnpm db-rls:generate
```

This will generate migration files in `db-rls/migrations/` with RLS enabling statements.

#### 3. Apply Migrations

```bash
pnpm db-rls:migrate
```

This creates tables and enables RLS policies using the Neon owner connection (`DATABASE_URL_ADMIN`).

**Note:** The migration script automatically checks if migrations have been generated before applying them. If migrations are missing, it will provide clear error messages and instructions.

### Scripts

- `pnpm db-rls:generate` - Generate migrations
- `pnpm db-rls:migrate` - Apply migrations (checks for migrations before applying)
- `pnpm db-rls:verify` - Verify migrations and RLS setup
- `pnpm db-rls:studio` - Open Drizzle Studio
- `pnpm db-rls:demo` - Run demo script (validates RLS isolation, includes batch vs single transaction comparison)
- `pnpm db-rls:demo:timing` - Run demo script with timing enabled (`--timing` flag)
- `pnpm db-rls:benchmark` - Performance benchmarking (measures RLS overhead, batch vs single operations)
  - Use `--iterations <number>` or `-i <number>` to override default iteration counts
- `pnpm db-rls:cleanup` - Delete all data (truncate tables)
- `pnpm db-rls:cleanup:drop` - Drop all tables (complete reset)

### Architecture

#### Tables

```
organizations (master table, NO RLS)
├── id (THIS IS THE TENANT ID)
├── name
└── created_at

users (tenant-scoped, RLS-protected)
├── id
├── organization_id (FK to organizations.id = tenant ID, RLS enforced)
├── name
├── email
└── created_at

stacks (tenant-scoped, RLS-protected)
├── id
├── organization_id (FK to organizations.id = tenant ID, direct column for optimal RLS performance)
├── user_id (FK to users.id)
├── name
├── description
└── created_at
```

#### Dual Connection Pattern

**Neon Owner (`masterDb` via `DATABASE_URL_ADMIN`):**
- Used for migrations and schema changes
- Uses Neon database owner credentials (required for migrations)
- Bypasses RLS policies (table owner privilege)
- Connection: `DATABASE_URL_ADMIN` (Neon owner connection string)

**App Owner (`appDb` via `DATABASE_URL_APP`):**
- Used for all application queries
- Uses `app_owner` role (created via setup script)
- Subject to RLS policies (enforced)
- Connection: `DATABASE_URL_APP` (app_owner connection string)

### Key Concepts

- **Tenant Wrapper (`withTenant`):** Sets tenant context using `SET LOCAL app.tenant_id` (transaction-scoped), wraps operations in a transaction, automatically filters queries based on RLS policies
- **RLS Policies:** Automatically filter rows based on `app.tenant_id` session variable (`organization_id = current_setting('app.tenant_id')::uuid`)
- **Important:** Always use `withTenant()` for tenant-scoped tables (`users`, `stacks`), pass `organization.id` as the tenant ID, use `db` directly only for master table (`organizations`)

See [db-rls/README.md](./db-rls/README.md) for detailed usage examples, migration workflow, troubleshooting, and security best practices.

### Performance

#### Benchmarking

Run performance benchmarks to measure RLS overhead:

```bash
pnpm db-rls:benchmark
```

This measures:
- RLS overhead (queries with RLS vs without)
- Transaction overhead (`SET LOCAL` cost)
- Context switching performance
- Throughput comparison
- **Batch vs Single operations** (INSERT and SELECT performance comparison)

**Note:** For remote databases (like Neon), network latency dominates the measurements. Run benchmarks on your specific setup to measure actual RLS overhead.

#### Best Practices for Performance

1. **Batch operations:** Use a single `withTenant()` call for multiple queries (see demo step 11 for comparison)
2. **Connection pooling:** Connection pools are configured with optimized settings (max: 20 for app, max: 5 for admin)
3. **Transaction efficiency:** Minimize the number of `withTenant()` calls
4. **Database indexes:** Indexes are defined in schema for optimal RLS policy performance (`organization_id` indexes)
5. **Timing analysis:** Use `--timing` flag with demo scripts to analyze query performance

### Database Cleanup

#### Delete All Data (Keep Tables)

```bash
pnpm db-rls:cleanup
```

- Truncates all tables (removes all data)
- Keeps table structure intact
- Resets sequences
- Use for quick test data reset

#### Drop All Tables (Complete Reset)

```bash
pnpm db-rls:cleanup:drop
```

- Drops all tables completely
- Removes migration tracking table
- Requires running migrations again: `pnpm db-rls:migrate`
- Use for complete database reset

### Documentation

- [db-rls/README.md](./db-rls/README.md) - Complete guide for RLS multi-tenancy implementation

---

## Comparison

| Use Case | Recommended Approach |
|----------|---------------------|
| Strong isolation requirements | Multi-Schema (`db/`) |
| Cross-tenant analytics/reporting | RLS (`db-rls/`) |
| Regulatory compliance (strict separation) | Multi-Schema (`db/`) |
| Shared resources across tenants | RLS (`db-rls/`) |
| Easier schema migrations per tenant | Multi-Schema (`db/`) |
| Simpler application code (no session vars) | Multi-Schema (`db/`) |
| Better performance for single-tenant queries | Multi-Schema (`db/`) |
| Easier cross-tenant queries | RLS (`db-rls/`) |

| Feature | RLS (db-rls/) | Multi-Schema (db/) |
|---------|---------------|---------------------|
| Isolation Level | Row-level | Schema-level |
| Cross-tenant Queries | Easy | Difficult |
| Schema Management | Single schema | Multiple schemas |
| Setup Complexity | Higher (roles, policies) | Lower |
| Session Management | Required (`SET LOCAL`) | Not needed |
| Best For | Analytics, reporting | Strong isolation |

---

## Type Checking

Run TypeScript type checking without emitting files:

```bash
pnpm typecheck
```
