import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schemaPublic from './schema-public';
import * as schemaTenant from './schema-tenant';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

const client = postgres(process.env.DATABASE_URL);
// Combined schema for database operations
export const db = drizzle(client, { schema: { ...schemaPublic, ...schemaTenant } });

