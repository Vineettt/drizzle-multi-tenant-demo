import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';

if (!process.env.DATABASE_URL_ADMIN) {
  throw new Error('DATABASE_URL_ADMIN environment variable is required');
}

if (!process.env.DATABASE_URL_APP) {
  throw new Error('DATABASE_URL_APP environment variable is required');
}

// Master Owner - for migrations and admin operations (bypasses RLS)
export const masterClient = postgres(process.env.DATABASE_URL_ADMIN, {
  max: 5,
  idle_timeout: 20,
  connect_timeout: 10,
  max_lifetime: 60 * 30, // 30 minutes
});
export const masterDb = drizzle(masterClient, { schema });

// App Owner - for application queries (subject to RLS)
export const appClient = postgres(process.env.DATABASE_URL_APP, {
  max: 20,
  idle_timeout: 20,
  connect_timeout: 10,
  max_lifetime: 60 * 30, // 30 minutes
});
export const appDb = drizzle(appClient, { schema });
