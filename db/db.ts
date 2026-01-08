import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schemaPublic from './schema-public';
import * as schemaTenant from './schema-tenant';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

// Configure connection pool for better performance
const client = postgres(process.env.DATABASE_URL, {
  max: 20, // Maximum connections in pool
  idle_timeout: 20, // Close idle connections after 20 seconds
  connect_timeout: 10, // Connection timeout in seconds
  max_lifetime: 60 * 30, // 30 minutes - refresh connections periodically
});
// Combined schema for database operations
export const db = drizzle(client, { schema: { ...schemaPublic, ...schemaTenant } });

