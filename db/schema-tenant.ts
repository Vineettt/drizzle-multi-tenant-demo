import { pgTable, uuid, text, timestamp } from 'drizzle-orm/pg-core';

// Dummy table - will be created in tenant schemas only
export const dummyTable = pgTable('dummy_table', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  value: text('value'),
  description: text('description'), // Added in Phase 6 to verify search_path migration behavior
  createdAt: timestamp('created_at').defaultNow(),
});

