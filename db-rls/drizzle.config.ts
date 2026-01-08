import 'dotenv/config';
import type { Config } from 'drizzle-kit';

export default {
  schema: './db-rls/schema.ts',
  out: './db-rls/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL_ADMIN!,
  },
  // Use public schema for migration tracking table (instead of creating 'drizzle' schema)
  // Required for Neon PostgreSQL which doesn't allow schema creation
  migrations: {
    schema: 'public',
  },
} satisfies Config;
