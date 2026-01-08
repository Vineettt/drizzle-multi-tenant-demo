import { sql } from 'drizzle-orm';
import { appDb, masterDb } from './connections';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Tenant wrapper that sets tenant context and allows any DML operations
 * 
 * This function wraps database operations in a transaction and sets the tenant context
 * using PostgreSQL session variables. All queries within the transaction will be
 * automatically filtered by RLS policies based on the organization_id.
 * 
 * **Important:** Pass `organization.id` as the tenantId parameter. Organizations represent
 * tenants, so `organizations.id` IS the tenant ID.
 * 
 * @param tenantId - The tenant ID (organization.id) to set for this transaction (must be a valid UUID string)
 * @param operation - Function that receives a transaction with tenant context set
 * @returns Result of the operation
 * 
 * @example
 * ```typescript
 * // Create organization (organization.id = tenant ID)
 * const [org] = await db.insert(organizations).values({
 *   name: 'Acme Corp',
 * }).returning();
 * 
 * // Use org.id as tenant ID
 * const users = await withTenant(org.id, async (tx) => {
 *   return await tx.select().from(users);
 * });
 * ```
 * 
 * @security Uses `SET LOCAL` which is transaction-scoped, ensuring tenant context
 * is automatically cleared on commit/rollback and preventing data leakage.
 * Validates tenantId is a valid UUID to prevent SQL injection.
 */
export async function withTenant<T>(
  tenantId: string,
  operation: (tx: Parameters<Parameters<typeof appDb.transaction>[0]>[0]) => Promise<T>
): Promise<T> {
  if (!UUID_REGEX.test(tenantId)) {
    throw new Error(`Invalid tenantId: must be a valid UUID, got: ${tenantId}`);
  }

  return await appDb.transaction(async (tx) => {
    // SET LOCAL doesn't support parameterized queries, so we use string interpolation
    // tenantId is validated as UUID above, so SQL injection risk is mitigated
    await tx.execute(sql.raw(`SET LOCAL app.tenant_id = '${tenantId}'`));
    return await operation(tx);
  });
}

export const db = appDb;
export { masterDb };
