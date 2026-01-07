import { pgTable, uuid, text } from 'drizzle-orm/pg-core';

// Schema tracker table - tracks all tenant schemas in public schema
export const schemaTracker = pgTable('schema_tracker', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().unique(),
});

