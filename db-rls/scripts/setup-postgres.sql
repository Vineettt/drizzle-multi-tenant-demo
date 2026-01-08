-- Neon PostgreSQL Setup Script for RLS Multi-Tenancy
-- 
-- This script creates the app_owner role and grants appropriate permissions
-- for Row-Level Security (RLS) multi-tenancy on Neon.
--
-- IMPORTANT: Before running this script:
-- 1. Replace 'your_password_here' with a secure password for app_owner role
-- 2. Replace 'your_database' with your Neon database name (usually 'neondb')
-- 3. Connect using your Neon database owner credentials
-- 4. Neon uses SSL - include ?sslmode=require in connection strings
--
-- Note: DATABASE_URL_ADMIN uses Neon owner credentials (not created here)
--       Only app_owner role is created by this script for DATABASE_URL_APP
--
-- Usage (Neon):
--   psql "postgresql://neondb_owner:password@ep-xxx-xxx.region.aws.neon.tech/neondb?sslmode=require" -f db-rls/scripts/setup-postgres.sql

-- ============================================================================
-- Create App Owner Role
-- ============================================================================
-- App owner has limited privileges and respects RLS (used for application queries)
-- ============================================================================

CREATE ROLE app_owner WITH LOGIN PASSWORD 'your_password_here';

-- Grant database-level privileges (connection only)
GRANT CONNECT ON DATABASE your_database TO app_owner;

-- Grant schema-level privileges (usage only, no CREATE)
GRANT USAGE ON SCHEMA public TO app_owner;

-- Grant table privileges (SELECT, INSERT, UPDATE, DELETE only)
-- NO ALTER, NO DROP, NO TRUNCATE - these are schema operations
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_owner;

-- Grant sequence privileges (for default values)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_owner;

-- Set default privileges for future tables
-- This ensures app_owner gets permissions on tables created by Neon owner
ALTER DEFAULT PRIVILEGES IN SCHEMA public 
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_owner;

ALTER DEFAULT PRIVILEGES IN SCHEMA public 
  GRANT USAGE, SELECT ON SEQUENCES TO app_owner;

-- ============================================================================
-- Neon Connection String Examples
-- ============================================================================
-- After running this script, update your .env file:
--
-- DATABASE_URL_ADMIN: Use your Neon database owner credentials (from Neon dashboard)
-- DATABASE_URL_ADMIN=postgresql://neondb_owner:owner_password@ep-xxx-xxx.region.aws.neon.tech/neondb?sslmode=require
--
-- DATABASE_URL_APP: Use app_owner role created by this script
-- DATABASE_URL_APP=postgresql://app_owner:your_password_here@ep-xxx-xxx.region.aws.neon.tech/neondb?sslmode=require
--
-- Important Notes for Neon:
-- 1. DATABASE_URL_ADMIN must use Neon owner credentials (required for migrations)
-- 2. Neon restricts schema creation to owner accounts
-- 3. Always include ?sslmode=require in Neon connection strings
-- 4. Get connection strings from Neon dashboard: Project Settings > Connection Details
-- 5. Only app_owner role is created by this script; use Neon owner for migrations
--
-- ============================================================================
