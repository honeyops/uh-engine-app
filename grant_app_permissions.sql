-- Grant permissions to Unified Honey Engine Native App
-- Run these queries as ACCOUNTADMIN or a role with sufficient privileges

-- IMPORTANT: You must be in the application context to grant to application roles
USE APPLICATION unified_honey_application;

-- ============================================================================
-- 1. WAREHOUSE PERMISSIONS (CRITICAL - Required for all SQL queries)
-- ============================================================================
-- Grant usage on the warehouse that the app will use
-- Replace NATIVE_APP_WH with your warehouse name if different
-- NOTE: You must have OPERATE privilege on the warehouse to grant usage
GRANT USAGE ON WAREHOUSE NATIVE_APP_WH TO APPLICATION ROLE app_public;

-- ============================================================================
-- 2. APPLICATION DATABASE PERMISSIONS
-- ============================================================================
-- Grant usage on the application database (where config tables are stored)
-- This is typically UNIFIED_HONEY_APPLICATION or your app database name
GRANT USAGE ON DATABASE UNIFIED_HONEY_APPLICATION TO APPLICATION ROLE app_public;

-- Grant usage on the core schema (where config tables are)
GRANT USAGE ON SCHEMA UNIFIED_HONEY_APPLICATION.core TO APPLICATION ROLE app_public;

-- Grant SELECT, INSERT, UPDATE on config tables
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA UNIFIED_HONEY_APPLICATION.core TO APPLICATION ROLE app_public;

-- Grant SELECT, INSERT, UPDATE on future tables (for any new config tables)
GRANT SELECT, INSERT, UPDATE ON FUTURE TABLES IN SCHEMA UNIFIED_HONEY_APPLICATION.core TO APPLICATION ROLE app_public;

-- ============================================================================
-- 3. CUSTOMER DATABASE PERMISSIONS (if UNIFIED_HONEY database exists)
-- ============================================================================
-- These are optional - only needed if the customer has created the UNIFIED_HONEY database
-- Uncomment if needed:

-- GRANT USAGE ON DATABASE UNIFIED_HONEY TO APPLICATION ROLE app_public;
-- GRANT USAGE ON SCHEMA UNIFIED_HONEY.MODELLING TO APPLICATION ROLE app_public;
-- GRANT USAGE ON SCHEMA UNIFIED_HONEY.SEMANTIC TO APPLICATION ROLE app_public;
-- GRANT USAGE ON SCHEMA UNIFIED_HONEY.STORAGE TO APPLICATION ROLE app_public;
-- GRANT ALL PRIVILEGES ON SCHEMA UNIFIED_HONEY.MODELLING TO APPLICATION ROLE app_public;
-- GRANT ALL PRIVILEGES ON SCHEMA UNIFIED_HONEY.SEMANTIC TO APPLICATION ROLE app_public;
-- GRANT ALL PRIVILEGES ON SCHEMA UNIFIED_HONEY.STORAGE TO APPLICATION ROLE app_public;

-- ============================================================================
-- 4. VERIFY GRANTS
-- ============================================================================
-- Run this to verify the grants were successful:
SHOW GRANTS TO APPLICATION ROLE app_public;

-- ============================================================================
-- NOTES:
-- ============================================================================
-- 1. The warehouse name (NATIVE_APP_WH) must match what's in service_spec.yml
-- 2. The database name (UNIFIED_HONEY_APPLICATION) must match SNOWFLAKE_DATABASE env var
-- 3. If you're using a different warehouse, update the first GRANT statement
-- 4. These grants can also be done automatically by the grant callback (setup.create_service)
--    when the app is installed/upgraded, but manual grants work immediately

