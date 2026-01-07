import 'dotenv/config';
import type { Config } from 'drizzle-kit';

export default {
  // Tenant schema migrations - only dummy_table
  schema: './db/schema-tenant.ts',
  out: './db/migrations/tenant',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config;

