# Warehouse Reference Setup & Automation

## Summary

This document explains the warehouse activation issue, the fix implemented, and the one-time manual setup required for Snowflake Native Apps.

## The Problem

When running in SPCS (Snowflake Container Services), the application encountered:
```
Error 000606 (57P03): No active warehouse selected in the current session
```

**Root Cause:**
- Environment variable `SNOWFLAKE_WAREHOUSE` is not available in SPCS
- Application uses OAuth token authentication (not user/password)
- Previous code relied on manual warehouse binding + connection pooling to work
- When connection pool reset, warehouse context was lost

## The Solution (Implemented)

### Automatic Warehouse Retrieval from References

**File:** `service/backend/core/snowflake.py`

Added `_get_warehouse_from_references()` function that:
1. Queries `SYSTEM$GET_ALL_REFERENCES()` to find bound warehouse
2. Returns the warehouse name dynamically
3. Activates it with `USE WAREHOUSE` in both pooled and non-pooled connections

**Code Location:** Lines 25-47 in snowflake.py

This function is called automatically when:
- Creating pooled connections (`_get_pooled_connection()`)
- Creating non-pooled connections (`SnowflakeClient.connect()`)

## One-Time Manual Setup Required

Before the automatic warehouse retrieval works, these manual steps are needed:

### Step 1: Grant Warehouse Privileges to Application

```sql
-- Grant USAGE privilege
GRANT USAGE ON WAREHOUSE NATIVE_APP_WH
  TO APPLICATION UNIFIED_HONEY_APPLICATION;

-- Grant OPERATE privilege
GRANT OPERATE ON WAREHOUSE NATIVE_APP_WH
  TO APPLICATION UNIFIED_HONEY_APPLICATION;
```

**Why Required:**
- The manifest.yml declares a warehouse reference requiring USAGE + OPERATE privileges
- Snowflake cannot bind the reference until these grants exist
- This is a Snowflake security requirement (applications cannot auto-grant themselves access)

### Step 2: Bind Warehouse Reference (Done via UI or deployment)

The warehouse reference `consumer_warehouse` must be bound to an actual warehouse (`NATIVE_APP_WH`).

**Two Ways to Bind:**

1. **Through Snowflake UI** (Recommended):
   - Navigate to Apps → UNIFIED_HONEY_APPLICATION
   - Click "References" tab
   - Bind `consumer_warehouse` to `NATIVE_APP_WH`

2. **During Deployment** (Automatic):
   - The reference is automatically bound when you deploy with `snow app run`
   - Snowflake sees the grants exist and creates the binding

**Verify Binding:**
```sql
SHOW REFERENCES IN APPLICATION UNIFIED_HONEY_APPLICATION;
```

Expected output:
- Name: `CONSUMER_WAREHOUSE`
- Object Type: `WAREHOUSE`
- Object Name: `NATIVE_APP_WH`
- Privileges: `OPERATE, USAGE`

## How It Works (Technical Details)

### Flow Diagram

```
Application Startup
       ↓
Create Snowflake Connection (OAuth)
       ↓
Check: SNOWFLAKE_WAREHOUSE env var?
       ↓ (No in SPCS)
Call _get_warehouse_from_references()
       ↓
Execute: SYSTEM$GET_ALL_REFERENCES()
       ↓
Parse result for WAREHOUSE object_type
       ↓
Execute: USE WAREHOUSE {warehouse_name}
       ↓
Connection Ready with Active Warehouse
```

### Code Implementation

**Function: `_get_warehouse_from_references()`**
```python
def _get_warehouse_from_references(conn: snowflake.connector.SnowflakeConnection) -> Optional[str]:
    """
    Get the warehouse name from bound references in SPCS environment.
    Returns warehouse name or None if not found.
    """
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT SYSTEM$GET_ALL_REFERENCES()")
            refs = cur.fetchall()

            for ref in refs:
                # ref format: [reference_name, object_type, object_name, ...]
                if len(ref) >= 3 and ref[1] == 'WAREHOUSE':
                    warehouse_name = ref[2]
                    logger.info(f"Found warehouse from references: {warehouse_name}")
                    return warehouse_name

        logger.warning("No warehouse reference found in SYSTEM$GET_ALL_REFERENCES")
        return None
    except Exception as e:
        logger.error(f"Failed to get warehouse from references: {e}")
        return None
```

**Integration in Connection Logic:**
```python
# Get warehouse from env or references
warehouse = os.getenv("SNOWFLAKE_WAREHOUSE")

# For SPCS OAuth connections, get warehouse from references if not in env
if os.path.isfile(token_path):
    if not warehouse:
        warehouse = _get_warehouse_from_references(_connection_pool)

    if warehouse:
        try:
            with _connection_pool.cursor() as cur:
                cur.execute(f"USE WAREHOUSE {warehouse}")
            logger.info(f"Activated warehouse: {warehouse}")
        except Exception as e:
            logger.error(f"Failed to activate warehouse {warehouse}: {e}")
    else:
        logger.error("No warehouse found - cannot activate warehouse")
```

## Why Manual Commands Were Needed Initially

### The Bootstrap Problem

1. **First Deployment**: Application deployed without warehouse grants
2. **Reference Cannot Bind**: Snowflake refuses to bind reference (privilege error)
3. **Manual Grants**: Developer runs GRANT USAGE and GRANT OPERATE commands
4. **Reference Binds**: Now Snowflake can bind the reference
5. **Automatic From Here**: `_get_warehouse_from_references()` can query and activate

### Why It Worked "Last Night"

You asked: *"Why did I not need this last night to work?"*

**Answer:**
- You manually ran `CALL config.register_warehouse(...)` which bound the warehouse
- The connection pool persisted that session context (warehouse already active)
- When you made API calls, the pooled connection reused that same session
- **Today:** Connection pool reset (service restart), context lost, error returned

The new code ensures warehouse is activated on **every** connection, not just when pooled connections are reused.

## Testing the Fix

### Test 1: Verify Grants Exist
```sql
SHOW GRANTS ON WAREHOUSE NATIVE_APP_WH;
```

Should show:
- `USAGE` granted to `APPLICATION UNIFIED_HONEY_APPLICATION`
- `OPERATE` granted to `APPLICATION UNIFIED_HONEY_APPLICATION`

### Test 2: Verify Reference is Bound
```sql
SHOW REFERENCES IN APPLICATION UNIFIED_HONEY_APPLICATION;
```

Should show `CONSUMER_WAREHOUSE` → `NATIVE_APP_WH`

### Test 3: Verify Service Can Query
```sql
-- Check service logs for warehouse activation
SELECT SYSTEM$GET_SERVICE_LOGS('services.uh_engine_app_service', 0, 'my-service', 100);
```

Should see in logs:
```
INFO - Found warehouse from references: NATIVE_APP_WH
INFO - Activated warehouse: NATIVE_APP_WH
```

### Test 4: Test API Endpoint
```bash
curl https://{app-url}/api/v1/dimensional-models
```

Should return data (not warehouse error).

## Deployment Checklist

When deploying to a new environment or account:

- [ ] Verify manifest.yml includes warehouse reference (already done)
- [ ] Deploy application: `snow app run`
- [ ] Grant USAGE on warehouse to application
- [ ] Grant OPERATE on warehouse to application
- [ ] Verify reference is bound: `SHOW REFERENCES`
- [ ] Test API endpoints
- [ ] Check service logs for warehouse activation messages

## Common Issues & Solutions

### Issue: "No warehouse reference found"
**Symptom:** Log shows `WARNING - No warehouse reference found in SYSTEM$GET_ALL_REFERENCES`

**Solution:**
1. Check if reference is bound: `SHOW REFERENCES IN APPLICATION`
2. If not bound, check grants: `SHOW GRANTS ON WAREHOUSE {name}`
3. Grant missing privileges and redeploy

### Issue: "Failed to activate warehouse"
**Symptom:** Log shows `ERROR - Failed to activate warehouse {name}: {error}`

**Solution:**
1. Verify warehouse name is correct
2. Check if warehouse is suspended (resume it)
3. Verify application has USAGE privilege

### Issue: Privilege error when binding
**Symptom:** `The reference to be set/add to a reference definition is required to cover all the specified privileges`

**Solution:**
This means the warehouse doesn't have the required privileges granted. Run:
```sql
GRANT USAGE ON WAREHOUSE {name} TO APPLICATION {app_name};
GRANT OPERATE ON WAREHOUSE {name} TO APPLICATION {app_name};
```

## Summary

**What Changed:**
- Added automatic warehouse detection from Snowflake's reference system
- No more reliance on environment variables in SPCS
- Warehouse is activated on every connection (pooled or not)

**What's Required (One-Time):**
- Grant USAGE + OPERATE on warehouse to application
- Bind warehouse reference (usually automatic during deployment)

**What's Automatic Now:**
- Warehouse retrieval from `SYSTEM$GET_ALL_REFERENCES()`
- Warehouse activation with `USE WAREHOUSE`
- Works across connection pool resets and service restarts

## Files Modified

1. **service/backend/core/snowflake.py**
   - Added: `_get_warehouse_from_references()` (lines 25-47)
   - Modified: `_get_pooled_connection()` (lines 114-128)
   - Modified: `SnowflakeClient.connect()` (lines 207-221)

2. **app/manifest.yml** (already configured)
   - Defines `consumer_warehouse` reference
   - Requires USAGE + OPERATE privileges

3. **app/references.sql** (already configured)
   - Defines `config.register_warehouse()` callback
   - Handles ADD/REMOVE/CLEAR operations

## References

- [Snowflake Native Apps - References](https://docs.snowflake.com/en/developer-guide/native-apps/requesting-refs)
- [SYSTEM$GET_ALL_REFERENCES](https://docs.snowflake.com/en/sql-reference/functions/system_get_all_references)
- [WAREHOUSE Privileges](https://docs.snowflake.com/en/user-guide/security-access-control-privileges#warehouse-privileges)
