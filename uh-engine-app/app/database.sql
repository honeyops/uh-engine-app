-- Note: Native Apps cannot create top-level databases in customer accounts
-- The customer must create the UNIFIED_HONEY database manually before running this script
-- Example SQL for customer to run:
--   CREATE DATABASE UNIFIED_HONEY COMMENT = 'Unified Honey Engine - Data Modeling and Analytics Platform';
--
-- After the database is created, this script will create schemas within it
-- Alternatively, use the setup.create_database_schemas() procedure

-- Use the database (assumes it exists - customer must create it first)
USE DATABASE UNIFIED_HONEY;

-- Create schemas in the Unified Honey database
CREATE SCHEMA IF NOT EXISTS MODELLING
    COMMENT = 'Dimensional models and analytical views';
CREATE SCHEMA IF NOT EXISTS SEMANTIC
    COMMENT = 'Semantic layer and business logic';
CREATE SCHEMA IF NOT EXISTS STORAGE
    COMMENT = 'Storage layer for nodes, edges, and attributes';

-- Create tags in MODELLING schema (tags can be used across all schemas in the database)
CREATE TAG IF NOT EXISTS MODELLING.Domain COMMENT = 'Unified Honey Business domain classification for data objects (e.g., Procurement, Maintenance, Finance)';
CREATE TAG IF NOT EXISTS MODELLING.Process COMMENT = 'Unified Honey Business process classification for data objects (e.g., Procure to Pay, Asset Management, Accounting)';
CREATE TAG IF NOT EXISTS MODELLING.PII COMMENT = 'Unified Honey personal identifiable information classification for sensitive data elements (e.g., employee identifiers, customer contact details)';

-- Grant usage on database and schemas to ACCOUNTADMIN (for access)
GRANT USAGE ON DATABASE UNIFIED_HONEY TO ROLE ACCOUNTADMIN;
GRANT USAGE ON SCHEMA UNIFIED_HONEY.MODELLING TO ROLE ACCOUNTADMIN;
GRANT USAGE ON SCHEMA UNIFIED_HONEY.SEMANTIC TO ROLE ACCOUNTADMIN;
GRANT USAGE ON SCHEMA UNIFIED_HONEY.STORAGE TO ROLE ACCOUNTADMIN;

-- Grant all privileges on database and schemas to ACCOUNTADMIN (without transferring ownership)
GRANT ALL PRIVILEGES ON DATABASE UNIFIED_HONEY TO ROLE ACCOUNTADMIN;
GRANT ALL PRIVILEGES ON SCHEMA UNIFIED_HONEY.MODELLING TO ROLE ACCOUNTADMIN;
GRANT ALL PRIVILEGES ON SCHEMA UNIFIED_HONEY.SEMANTIC TO ROLE ACCOUNTADMIN;
GRANT ALL PRIVILEGES ON SCHEMA UNIFIED_HONEY.STORAGE TO ROLE ACCOUNTADMIN;

-- Grant schema usage to app_public role (for application access)
GRANT USAGE ON DATABASE UNIFIED_HONEY TO APPLICATION ROLE app_public;
GRANT USAGE ON SCHEMA UNIFIED_HONEY.MODELLING TO APPLICATION ROLE app_public;
GRANT USAGE ON SCHEMA UNIFIED_HONEY.SEMANTIC TO APPLICATION ROLE app_public;
GRANT USAGE ON SCHEMA UNIFIED_HONEY.STORAGE TO APPLICATION ROLE app_public;

-- Grant privileges on schemas to app_public role
GRANT ALL PRIVILEGES ON SCHEMA UNIFIED_HONEY.MODELLING TO APPLICATION ROLE app_public;
GRANT ALL PRIVILEGES ON SCHEMA UNIFIED_HONEY.SEMANTIC TO APPLICATION ROLE app_public;
GRANT ALL PRIVILEGES ON SCHEMA UNIFIED_HONEY.STORAGE TO APPLICATION ROLE app_public;
