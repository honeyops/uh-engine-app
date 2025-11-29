# Warehouse Setup - Quick Start

## Problem
Application shows: `Error 000606: No active warehouse selected in the current session`

## Solution (Already Implemented in Code)

The Python code in `service/backend/core/snowflake.py` automatically retrieves and activates the warehouse from Snowflake's reference system.

**You only need to run manual commands ONCE per environment.**

## One-Time Setup Commands

Run these commands in order:

### 1. Grant Warehouse Privileges
```bash
cd "c:\Users\carla\unified-honey\uh-engine-app\uh-engine-app" && snow sql -q "GRANT USAGE ON WAREHOUSE NATIVE_APP_WH TO APPLICATION UNIFIED_HONEY_APPLICATION"

cd "c:\Users\carla\unified-honey\uh-engine-app\uh-engine-app" && snow sql -q "GRANT OPERATE ON WAREHOUSE NATIVE_APP_WH TO APPLICATION UNIFIED_HONEY_APPLICATION"
```

### 2. Verify Grants
```bash
cd "c:\Users\carla\unified-honey\uh-engine-app\uh-engine-app" && snow sql -q "SHOW GRANTS ON WAREHOUSE NATIVE_APP_WH"
```

Expected: See USAGE and OPERATE granted to UNIFIED_HONEY_APPLICATION

### 3. Verify Reference is Bound
```bash
cd "c:\Users\carla\unified-honey\uh-engine-app\uh-engine-app" && snow sql -q "SHOW REFERENCES IN APPLICATION UNIFIED_HONEY_APPLICATION"
```

Expected: See CONSUMER_WAREHOUSE → NATIVE_APP_WH with OPERATE, USAGE privileges

## After Setup: Automatic Behavior

Once grants are in place and reference is bound:

1. **Application starts** → Connects to Snowflake with OAuth token
2. **Code queries** → `SYSTEM$GET_ALL_REFERENCES()` to find warehouse
3. **Code activates** → `USE WAREHOUSE NATIVE_APP_WH`
4. **API calls work** → Warehouse is active for all queries

**No more manual intervention needed!**

## When to Re-run Commands

You only need to re-run these commands if:
- [ ] Deploying to a completely new Snowflake account
- [ ] Using a different warehouse name
- [ ] Privileges were revoked for some reason

## Verification Commands

### Check Service Status
```bash
cd "c:\Users\carla\unified-honey\uh-engine-app\uh-engine-app" && snow sql -q "USE DATABASE UNIFIED_HONEY_APPLICATION; SELECT SYSTEM"'$'"GET_SERVICE_STATUS('services.uh_engine_app_service')"
```

### Check Service Logs (for warehouse activation messages)
```bash
cd "c:\Users\carla\unified-honey\uh-engine-app\uh-engine-app" && snow sql -q "USE DATABASE UNIFIED_HONEY_APPLICATION; SELECT SYSTEM"'$'"GET_SERVICE_LOGS('services.uh_engine_app_service', 0, 'my-service', 100)"
```

Look for:
```
INFO - Found warehouse from references: NATIVE_APP_WH
INFO - Activated warehouse: NATIVE_APP_WH
```

## Troubleshooting

### Error: "The reference to be set/add to a reference definition is required to cover all the specified privileges"

**Cause:** Grants not yet applied

**Fix:** Run the GRANT commands in step 1 above

### Error: "No warehouse reference found"

**Cause:** Reference not bound

**Fix:**
1. Verify grants exist (step 2)
2. Redeploy application: `snow app teardown --cascade --force && snow app run`
3. Verify binding (step 3)

## Files That Handle This Automatically

- **service/backend/core/snowflake.py** - Warehouse retrieval and activation logic
- **app/manifest.yml** - Declares warehouse reference requirement
- **app/references.sql** - Defines warehouse registration callback

See [WAREHOUSE_REFERENCE_SETUP.md](./docs/WAREHOUSE_REFERENCE_SETUP.md) for detailed technical documentation.
