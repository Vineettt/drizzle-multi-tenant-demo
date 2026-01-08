-- Verification Script for RLS Setup on Neon
-- 
-- This script verifies that PostgreSQL roles and permissions are set up correctly
-- for Row-Level Security (RLS) multi-tenancy on Neon.
--
-- Usage (Neon):
--   psql "postgresql://neondb_owner:password@ep-xxx-xxx.region.aws.neon.tech/neondb?sslmode=require" -f db-rls/scripts/verify-setup.sql

-- ============================================================================
-- Step 1: Check Role Existence
-- ============================================================================

SELECT 
  'Role Existence Check' as check_type,
  rolname as role_name,
  rolcanlogin as can_login
FROM pg_roles
WHERE rolname IN ('app_owner')
ORDER BY rolname;

-- ============================================================================
-- Step 2: Verify Table Ownership
-- ============================================================================
-- Tables should be owned by Neon owner (not app_owner)
-- This ensures RLS policies are enforced for app_owner

SELECT 
  'Table Ownership Check' as check_type,
  tablename,
  tableowner
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('organizations', 'users', 'stacks')
ORDER BY tablename;

-- ============================================================================
-- Step 3: Verify RLS is Enabled
-- ============================================================================
-- Tenant-scoped tables (users, stacks) should have RLS enabled
-- Master table (organizations) should NOT have RLS

SELECT 
  'RLS Status Check' as check_type,
  tablename,
  rowsecurity as rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('organizations', 'users', 'stacks')
ORDER BY tablename;

-- ============================================================================
-- Step 4: Verify RLS Policies Exist
-- ============================================================================

SELECT 
  'RLS Policy Check' as check_type,
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd as command_type
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('users', 'stacks')
ORDER BY tablename, policyname;

-- ============================================================================
-- Step 5: Check App Owner Permissions
-- ============================================================================
-- app_owner should have SELECT, INSERT, UPDATE, DELETE on tables
-- app_owner should NOT have ALTER, DROP, TRUNCATE privileges

SELECT 
  'App Owner Permissions' as check_type,
  table_schema,
  table_name,
  privilege_type
FROM information_schema.table_privileges
WHERE grantee = 'app_owner'
  AND table_schema = 'public'
  AND table_name IN ('organizations', 'users', 'stacks')
ORDER BY table_name, privilege_type;

-- ============================================================================
-- Expected Results:
-- ============================================================================
-- 1. app_owner role should exist and be able to login
-- 2. All tables should be owned by Neon owner (not app_owner)
-- 3. users and stacks tables should have RLS enabled (rowsecurity = true)
-- 4. organizations table should NOT have RLS enabled (rowsecurity = false)
-- 5. RLS policies should exist for users and stacks tables
-- 6. app_owner should have SELECT, INSERT, UPDATE, DELETE privileges
-- 7. app_owner should NOT have ALTER, DROP, TRUNCATE privileges
-- ============================================================================
