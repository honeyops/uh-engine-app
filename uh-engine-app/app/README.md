# Snowflake Native App - SPCS

This is a sample Snowflake Native App deployed using Snowpark Container Services.

## Deployment Steps

1. **Click grant on the app install page**
   - Grant the required account privileges (CREATE COMPUTE POOL, BIND SERVICE ENDPOINT, CREATE DATABASE)

2. **Activate app** (this can take a while)
   - Wait for the activation process to complete

3. **Run the following SQL commands after activation:**

   ```sql
   -- Grant warehouse access
   GRANT USAGE, OPERATE ON WAREHOUSE NATIVE_APP_WH TO APPLICATION UNIFIED_HONEY_APPLICATION;
   
   -- Grant access to UNIFIED_HONEY database
   GRANT USAGE ON DATABASE UNIFIED_HONEY TO APPLICATION UNIFIED_HONEY_APPLICATION;
   
   -- Grant access to source database and schema (replace <source db> and <source schema> with actual values)
   GRANT USAGE ON DATABASE <source db> TO APPLICATION UNIFIED_HONEY_APPLICATION;
   GRANT USAGE ON SCHEMA <source db>.<source schema> TO APPLICATION UNIFIED_HONEY_APPLICATION;
   GRANT SELECT ON ALL TABLES IN SCHEMA <source db>.<source schema> TO APPLICATION UNIFIED_HONEY_APPLICATION;
   GRANT SELECT ON ALL VIEWS IN SCHEMA <source db>.<source schema> TO APPLICATION UNIFIED_HONEY_APPLICATION;
   ```

4. **Launch the app**
   - Open the app from the Snowflake Apps page

## Known Issues

The following issues have been identified and will be fixed in a future release:

- When a table is selected without a previous mapping, it still asks to clear the bindings
- `__NONE__` shows in the field combos
- Deploy doesn't run as it deploys