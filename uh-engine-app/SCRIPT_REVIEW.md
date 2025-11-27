# Setup Scripts Review

## Issues Found

### 1. ❌ **CRITICAL: Invalid SQL Syntax**
**File:** `configuration.sql`

**Problem:** `CREATE IF NOT EXISTS TABLE` is invalid syntax. The correct syntax is `CREATE TABLE IF NOT EXISTS`.

**Additional Issue:** Snowflake **does NOT support** `CREATE TABLE IF NOT EXISTS ... AS SELECT`. When using `AS SELECT`, you must use `CREATE OR REPLACE TABLE`.

**Current (Invalid):**
```sql
CREATE IF NOT EXISTS TABLE core.config_blueprints AS SELECT ...
```

**Options:**
- **Option A (Recommended for setup scripts):** Use `CREATE OR REPLACE` - replaces table with fresh data on each install
```sql
CREATE OR REPLACE TABLE core.config_blueprints AS SELECT ...
```

- **Option B (If you need to preserve data):** Check existence first, then conditionally create
```sql
BEGIN
  IF (NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES 
                  WHERE TABLE_SCHEMA = 'CORE' AND TABLE_NAME = 'CONFIG_BLUEPRINTS')) THEN
    CREATE TABLE core.config_blueprints AS SELECT ...;
  END IF;
END;
```

### 2. ⚠️ **Execution Order Dependency**
**File:** `setup.sql`

**Current Order:**
1. `services.sql` - Creates procedures that reference `services.spcs_na_service`
2. `configuration.sql` - Creates config tables in `core` schema
3. `database.sql` - Creates `UNIFIED_HONEY` database

**Issue:** The `USE DATABASE UNIFIED_HONEY` in `database.sql` changes the context, but this happens after config tables are created (which is fine since config is in app DB).

**Recommendation:** Order is actually fine since:
- Config tables are in app database (default context)
- `UNIFIED_HONEY` is consumer database (created separately)
- Services are in app database

### 3. ⚠️ **Database Context in database.sql**
**File:** `database.sql`

**Issue:** `USE DATABASE UNIFIED_HONEY` changes context mid-script. This is fine, but ensure all subsequent statements are schema-qualified (which they are).

**Current:**
```sql
USE DATABASE UNIFIED_HONEY;
CREATE TAG IF NOT EXISTS Domain ...
```

**Note:** Tags are created in the current database context, so this is correct.

### 4. ✅ **Good Practices Found**
- Using `IF NOT EXISTS` for schemas and tags
- Proper schema qualification
- Grants are well-structured
- Application roles properly defined
- Owner's rights procedures correctly implemented

## Recommendations

### Immediate Fixes Required:
1. **Fix CREATE TABLE syntax** - Change all `CREATE IF NOT EXISTS TABLE ... AS SELECT` to `CREATE OR REPLACE TABLE ... AS SELECT`

### Optional Improvements:
1. **Add error handling** - Consider wrapping in BEGIN/EXCEPTION blocks for better error messages
2. **Add comments** - Document why `CREATE OR REPLACE` is used (fresh config on install)
3. **Consider versioning** - If config data needs to persist across upgrades, implement version checking

## Fixed Script Pattern

For configuration tables that should be recreated on each install:
```sql
-- Blueprints
CREATE OR REPLACE TABLE core.config_blueprints AS
SELECT ...
FROM VALUES (...);
```

For tables that should preserve data:
```sql
-- Deployment Logs (preserve historical data)
CREATE TABLE IF NOT EXISTS core.deployment_logs (
    deployment_timestamp TIMESTAMP_LTZ NOT NULL DEFAULT CURRENT_TIMESTAMP(),
    executed_by VARCHAR(255) NOT NULL DEFAULT CURRENT_USER(),
    deployment_log VARIANT NOT NULL COMMENT 'Full deployment run log as JSON'
) COMMENT = 'Stores deployment execution logs';
```

