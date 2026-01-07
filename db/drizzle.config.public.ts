import 'dotenv/config';
import type { Config } from 'drizzle-kit';

export default {
  // Public schema migrations - only schema_tracker table
  schema: './db/schema-public.ts',
  out: './db/migrations/public',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
} satisfies Config;

