# DB-RLS: Row-Level Security Multi-Tenancy Implementation

This folder contains a completely independent Row-Level Security (RLS) multi-tenancy implementation using Drizzle ORM and PostgreSQL RLS policies.

## Overview

This implementation uses **single-schema RLS** approach on **Neon PostgreSQL** where:
- All tenants share the same PostgreSQL schema (`public`)
- Row-level isolation using PostgreSQL RLS policies
- Tables: `organizations` (master table, NO RLS), `users` and `stacks` (tenant-scoped, WITH RLS)
- Dual database connections: Neon owner credentials (for migrations) and `app_owner` (for queries)

## Architecture

### Tables

```
organizations (master table, NO RLS)
├── id (THIS IS THE TENANT ID)
├── name
└── created_at

users (tenant-scoped, RLS-protected)
├── id
├── organization_id (FK to organizations.id = tenant ID, RLS enforced, indexed)
├── name
├── email (indexed)
└── created_at
Indexes: users_organization_id_idx, users_email_idx

stacks (tenant-scoped, RLS-protected)
├── id
├── organization_id (FK to organizations.id = tenant ID, direct column for optimal RLS performance, indexed)
├── user_id (FK to users.id, indexed)
├── name
├── description
└── created_at
Indexes: stacks_organization_id_idx, stacks_user_id_idx, stacks_org_user_idx (composite)
```

### Dual Connection Pattern

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

## Setup

### 1. Environment Variables

Add to your `.env` file:

```bash
# Admin - for migrations (bypasses RLS)
# Use your Neon database owner credentials (from Neon dashboard)
# Format: postgresql://[user]:[password]@[host]/[database]?sslmode=require
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

### 2. Neon Database Setup

**Create roles and permissions:**

1. Connect to your Neon database using owner credentials:
   ```bash
   # Get connection string from Neon dashboard
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

### 3. Generate Migrations

```bash
pnpm db-rls:generate
```

This will generate migration files in `db-rls/migrations/` with RLS enabling statements.

### 4. Apply Migrations

```bash
pnpm db-rls:migrate
```

This creates tables and enables RLS policies using the Neon owner connection (`DATABASE_URL_ADMIN`).

**Migration Script Features:**
- Automatically checks if migrations have been generated before applying
- Provides clear error messages if migrations are missing
- Validates migration journal file exists
- Shows helpful instructions if migrations need to be generated first

## Usage

### Basic CRUD Operations

```typescript
import { withTenant, db } from './db-rls';
import { users, stacks, organizations } from './db-rls/schema';
import { eq } from 'drizzle-orm';

// Create organization (master table, no tenant wrapper)
// Note: organization.id IS the tenant ID
const [org] = await db.insert(organizations).values({
  name: 'Acme Corp',
}).returning();

// Create user (tenant-scoped, requires tenant wrapper)
// Pass org.id as tenantId (organizations.id = tenant ID)
const [user] = await withTenant(org.id, async (tx) => {
  return await tx.insert(users).values({
    organizationId: org.id, // organizationId IS the tenant ID
    name: 'John Doe',
    email: 'john@example.com',
  }).returning();
});

// Query users (automatically filtered by RLS)
const allUsers = await withTenant(org.id, async (tx) => {
  return await tx.select().from(users);
});

// Update user (only updates if organization_id matches tenant)
await withTenant(org.id, async (tx) => {
  return await tx.update(users)
    .set({ name: 'Jane Doe' })
    .where(eq(users.id, user.id));
});

// Delete stack (only deletes if user's organization_id matches tenant)
await withTenant(org.id, async (tx) => {
  return await tx.delete(stacks)
    .where(eq(stacks.id, stackId));
});
```

### Multiple Operations in Single Transaction

**Best Practice:** Batch multiple queries in a single `withTenant()` call for better performance:

```typescript
// organization.id IS the tenant ID
const [org] = await db.insert(organizations).values({
  name: 'Acme Corp',
}).returning();

// ✅ GOOD: Single transaction, multiple operations
await withTenant(org.id, async (tx) => {
  // All operations share the same tenant context and transaction
  const [newUser] = await tx.insert(users).values({
    organizationId: org.id, // organizationId IS the tenant ID
    name: 'New User',
    email: 'new@example.com',
  }).returning();
  
  const [newStack] = await tx.insert(stacks).values({
    organizationId: org.id, // organizationId IS the tenant ID (direct column for optimal RLS performance)
    userId: newUser.id,
    name: 'Backend Stack',
    description: 'Node.js + Express',
  }).returning();
  
  // Query within same transaction
  const userStacks = await tx.select()
    .from(stacks)
    .where(eq(stacks.userId, newUser.id));
  
  return { newUser, newStack, userStacks };
});

// ❌ LESS EFFICIENT: Multiple transactions (each has overhead)
await withTenant(org.id, async (tx) => await tx.insert(users).values({...}));
await withTenant(org.id, async (tx) => await tx.insert(stacks).values({...}));
```

**Performance Note:** Each `withTenant()` call creates a transaction with network overhead. Batching operations reduces this overhead significantly (typically 50-80% faster). See demo script step 11 for a practical comparison.

### Cross-Table Queries

```typescript
// organization.id IS the tenant ID
const [org] = await db.insert(organizations).values({
  name: 'Acme Corp',
}).returning();

const usersWithOrgs = await withTenant(org.id, async (tx) => {
  return await tx
    .select({
      userName: users.name,
      userEmail: users.email,
      orgName: organizations.name,
    })
    .from(users)
    .innerJoin(organizations, eq(users.organizationId, organizations.id));
});
```

## Key Concepts

### Tenant Wrapper (`withTenant`)

The `withTenant()` function:
- Sets tenant context using `SET LOCAL app.tenant_id` (transaction-scoped)
- Wraps operations in a transaction
- Automatically filters queries based on RLS policies
- Clears tenant context on commit/rollback

**Important:** 
- Always use `withTenant()` for tenant-scoped tables (`users`, `stacks`)
- Pass `organization.id` as the tenant ID (organizations represent tenants)
- Use `db` directly only for master table (`organizations`)

### RLS Policies

RLS policies automatically filter rows based on `app.tenant_id` session variable:
- **USING clause:** Filters rows for SELECT, UPDATE, DELETE
- **WITH CHECK clause:** Validates rows for INSERT, UPDATE

**For `users` table:**
- Filters by `organization_id = current_setting('app.tenant_id')::uuid`
- `organization_id` IS the tenant ID

**For `stacks` table:**
- Filters by `organization_id = current_setting('app.tenant_id')::uuid`
- `organization_id` IS the tenant ID (direct column for optimal RLS performance, eliminates subquery overhead)

Policies ensure:
- Users can only see/modify their own tenant's data
- Cross-tenant access is prevented at database level
- No data leakage possible

### Session Variable Management

- Uses `SET LOCAL` (transaction-scoped) not `SET` (session-scoped)
- Prevents tenant ID leakage between requests
- Safe with connection pooling (PgBouncer transaction mode)

## Scripts

- `pnpm db-rls:generate` - Generate migrations
- `pnpm db-rls:migrate` - Apply migrations (automatically checks if migrations exist before applying)
- `pnpm db-rls:verify` - Verify migrations and RLS setup
- `pnpm db-rls:studio` - Open Drizzle Studio
- `pnpm db-rls:demo` - Run demo script (validates RLS isolation, includes batch vs single transaction comparison)
- `pnpm db-rls:demo:timing` - Run demo script with timing enabled (use `--timing` or `-t` flag)
- `pnpm db-rls:benchmark` - Performance benchmarking (measures RLS overhead, batch vs single operations)
  - Use `--iterations <number>` or `-i <number>` to override default iteration counts for all benchmarks
  - Default iterations: baseline=50, standard=50, insert=50, batch=20, select=30
- `pnpm db-rls:cleanup` - Delete all data (truncate tables)
- `pnpm db-rls:cleanup:drop` - Drop all tables (complete reset)

## Migration Workflow

1. **Update schema** (`db-rls/schema.ts`):
   - Add new tables with `.enableRLS()` if tenant-scoped
   - Define RLS policies using `pgPolicy()` in the table builder
   - Use `organization_id` as tenant identifier (organizations.id = tenant ID)
   - Add indexes for performance (especially on `organization_id` for RLS)

2. **Generate migration**:
   ```bash
   pnpm db-rls:generate
   ```

3. **Verify migration**:
   - Check `db-rls/migrations/XXXX_*.sql`
   - Ensure `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` is present
   - Verify policies are created correctly
   - Verify indexes are created (CREATE INDEX statements)

4. **Apply migration**:
   ```bash
   pnpm db-rls:migrate
   ```
   
   The migration script will:
   - Check if migrations folder exists
   - Check if migration journal file exists
   - Validate migrations are present
   - Provide helpful error messages if migrations are missing

## Troubleshooting

### Queries Return Empty Results

**Problem:** Queries return no rows even though data exists.

**Solution:** Ensure you're using `withTenant()` wrapper and pass `organization.id` as tenant ID:
```typescript
// Create organization first
const [org] = await db.insert(organizations).values({
  name: 'Acme Corp',
}).returning();

// ❌ Wrong - no tenant context
const users = await db.select().from(users);

// ✅ Correct - tenant context set (org.id IS the tenant ID)
const users = await withTenant(org.id, async (tx) => {
  return await tx.select().from(users);
});
```

### RLS Not Enforced

**Problem:** App owner can see all data, RLS not working.

**Solution:** 
1. Verify tables are owned by Neon owner (not `app_owner`)
2. Verify RLS is enabled: `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';`
3. Verify policies exist: `SELECT * FROM pg_policies WHERE schemaname = 'public';`
4. Ensure you're using `DATABASE_URL_APP` (app_owner) for queries, not `DATABASE_URL_ADMIN`

### Migration Fails

**Problem:** Migration fails with "Can't find meta/_journal.json file" or similar errors.

**Solution:** 
1. Ensure migrations have been generated: `pnpm db-rls:generate`
2. The migration script now checks for migrations before applying and provides clear error messages
3. If migrations are missing, follow the instructions in the error message

**Problem:** Migration fails with permission errors.

**Solution:** Ensure `DATABASE_URL_ADMIN` uses your Neon database owner credentials. Neon requires owner credentials for migrations.

## Comparison with Multi-Schema Approach

| Feature | RLS (db-rls/) | Multi-Schema (db/) |
|---------|---------------|---------------------|
| Isolation Level | Row-level | Schema-level |
| Cross-tenant Queries | Easy | Difficult |
| Schema Management | Single schema | Multiple schemas |
| Setup Complexity | Higher (roles, policies) | Lower |
| Session Management | Required (`SET LOCAL`) | Not needed |
| Best For | Analytics, reporting | Strong isolation |

## Security Best Practices

1. **Never use `masterDb` (DATABASE_URL_ADMIN) for regular queries** - it bypasses RLS
2. **Always use `withTenant()`** for tenant-scoped operations
3. **Use `SET LOCAL`** (transaction-scoped) not `SET` (session-scoped)
4. **Validate tenant ID** before passing to `withTenant()`
5. **Keep passwords secure** - use environment variables, never hardcode
6. **Use SSL connections** - Neon requires `?sslmode=require` in connection strings
7. **Protect owner credentials** - Only use `DATABASE_URL_ADMIN` for migrations, never in application code

## Performance

### Benchmarking

Run performance benchmarks to measure RLS overhead:

```bash
pnpm db-rls:benchmark
```

This measures:
- RLS overhead (queries with RLS vs without)
- Transaction overhead (`SET LOCAL` cost)
- Context switching performance
- Throughput comparison
- **Batch vs Single operations** (Benchmarks 7-10):
  - Single INSERT operations (multiple transactions)
  - Batch INSERT operations (single transaction)
  - Single SELECT operations (multiple transactions)
  - Batch SELECT operations (single transaction)
  - Performance comparison with improvement percentages

**Note:** For remote databases (like Neon), network latency dominates the measurements. Run benchmarks on your specific setup to measure actual RLS overhead.

### Best Practices for Performance

1. **Batch operations:** Use a single `withTenant()` call for multiple queries (typically 50-80% faster)
   - Demo script step 11 demonstrates the performance difference
   - Benchmark script includes detailed batch vs single operation comparisons
2. **Connection pooling:** Optimized connection pools configured:
   - `appClient`: max 20 connections, 20s idle timeout, 30min max lifetime
   - `masterClient`: max 5 connections, 20s idle timeout, 30min max lifetime
3. **Transaction efficiency:** Minimize the number of `withTenant()` calls
4. **Database indexes:** Indexes are defined in schema for optimal performance:
   - `users_organization_id_idx` - Critical for RLS policy performance
   - `users_email_idx` - For email lookups
   - `stacks_organization_id_idx` - Critical for RLS policy performance
   - `stacks_user_id_idx` - For foreign key lookups
   - `stacks_org_user_idx` - Composite index for common join patterns
5. **Timing analysis:** Use `--timing` or `-t` flag with demo scripts to analyze query execution times

## Database Cleanup

### Delete All Data (Keep Tables)

```bash
pnpm db-rls:cleanup
```

- Truncates all tables (removes all data)
- Keeps table structure intact
- Resets sequences
- Use for quick test data reset

### Drop All Tables (Complete Reset)

```bash
pnpm db-rls:cleanup:drop
```

- Drops all tables completely
- Removes migration tracking table
- Requires running migrations again: `pnpm db-rls:migrate`
- Use for complete database reset

## References

- [Drizzle ORM RLS Documentation](https://orm.drizzle.team/docs/rls)
