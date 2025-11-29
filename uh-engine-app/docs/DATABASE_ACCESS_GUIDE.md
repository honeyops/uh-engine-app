# AI Agent Implementation Guide: Database Access Strategy

## Context

Snowflake Native Apps do not support DATABASE as a valid reference object_type in the application manifest. This guide documents the implementation strategy for enabling database access in the Unified Honey application.

## Technical Constraint

**Invalid Approach (Will Fail)**:
```yaml
# This does NOT work in manifest.yml
references:
  - source_databases:
      object_type: DATABASE  # ❌ Invalid - DATABASE is not supported
```

**Valid Object Types** in Snowflake Native Apps:
- WAREHOUSE
- TABLE
- VIEW
- EXTERNAL TABLE
- FUNCTION
- PROCEDURE
- API INTEGRATION
- EXTERNAL ACCESS INTEGRATION
- SECRET

## Implemented Solution: Hybrid Approach

### Architecture Overview

```
Consumer Account               Native App Account
┌─────────────────┐           ┌──────────────────┐
│  GRANT USAGE    │  ──────>  │  SHOW DATABASES  │
│  (Manual)       │           │  Discovery APIs  │
└─────────────────┘           └──────────────────┘
                                       │
                                       ▼
                              ┌──────────────────┐
                              │  React UI        │
                              │  Table Selection │
                              └──────────────────┘
```

### Implementation Components

#### 1. Consumer-Side Setup (Manual Grants)

Consumers must execute GRANT statements in their account to provide database access to the application:

```sql
-- Template for granting database access
GRANT USAGE ON DATABASE <DATABASE_NAME>
  TO APPLICATION UNIFIED_HONEY_APPLICATION;

GRANT USAGE ON SCHEMA <DATABASE_NAME>.<SCHEMA_NAME>
  TO APPLICATION UNIFIED_HONEY_APPLICATION;

GRANT SELECT ON ALL TABLES IN SCHEMA <DATABASE_NAME>.<SCHEMA_NAME>
  TO APPLICATION UNIFIED_HONEY_APPLICATION;

-- Optional: Grant on future tables
GRANT SELECT ON FUTURE TABLES IN SCHEMA <DATABASE_NAME>.<SCHEMA_NAME>
  TO APPLICATION UNIFIED_HONEY_APPLICATION;
```

**Why Manual Grants**:
- Native Apps cannot request DATABASE in manifest references
- Direct GRANT is the only way to provide database-level access
- Application can discover granted databases via `SHOW DATABASES`

#### 2. Application-Side Discovery (Automated)

Once grants are in place, the application can discover accessible databases using:

```python
# Backend implementation uses SHOW commands
with SnowflakeClient() as client:
    # Discover all databases the app can access
    databases = client.run("SHOW DATABASES")

    # Discover schemas in a specific database
    schemas = client.run(f"SHOW SCHEMAS IN DATABASE {db_name}")

    # Discover tables in a specific schema
    tables = client.run(f"SHOW TABLES IN {db_name}.{schema_name}")
```

#### 3. React UI for Selection (User Interface)

The React UI provides:
- Cascading dropdowns (Database → Schema → Tables)
- Multi-select table picker with metadata display
- Persistent selection storage in `config.selected_tables`

## Implementation Files

### Backend API Routes
**File**: `service/backend/api/routes/data_sources.py`
- `GET /api/v1/data-sources/databases` - List accessible databases
- `GET /api/v1/data-sources/databases/{db}/schemas` - List schemas
- `GET /api/v1/data-sources/databases/{db}/schemas/{schema}/tables` - List tables
- `POST /api/v1/data-sources/selections` - Save table selections
- `GET /api/v1/data-sources/selections` - Retrieve saved selections

### SQL Schema
**File**: `app/data_sources.sql`
```sql
CREATE TABLE IF NOT EXISTS config.selected_tables (
    database_name STRING NOT NULL,
    schema_name STRING NOT NULL,
    table_name STRING NOT NULL,
    selected_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
    PRIMARY KEY (database_name, schema_name, table_name)
);
```

### Frontend Components
**Files**:
- `service/frontend/src/types/dataSources.ts` - TypeScript interfaces
- `service/frontend/src/services/dataSourcesService.ts` - API service layer
- `service/frontend/src/components/DataSources.tsx` - React component
- `service/frontend/src/components/DataSources.css` - Styling

## Integration Points

### 1. Application Manifest (manifest.yml)
No DATABASE reference needed. Only warehouse reference:
```yaml
references:
  - consumer_warehouse:
      object_type: WAREHOUSE  # ✅ This works
      register_callback: config.register_warehouse
```

### 2. Setup Script (setup.sql)
Must execute data_sources.sql to create storage tables:
```sql
execute immediate from './data_sources.sql';
```

### 3. FastAPI Application (app.py)
Must register the data_sources router:
```python
from api.routes import data_sources
app.include_router(data_sources.router)
```

## Security Model

### Read-Only Access
The application only requests SELECT privileges:
- Cannot INSERT, UPDATE, or DELETE consumer data
- Cannot CREATE or ALTER consumer objects
- Cannot access databases not explicitly granted

### Grant Isolation
- Grants are schema-specific (not database-wide)
- Consumer controls which schemas are accessible
- Revocable at any time via REVOKE commands

### Verification
Application can verify access before attempting operations:
```python
@router.get("/verify-access/{database_name}")
async def verify_database_access(database_name: str):
    try:
        client.run(f"USE DATABASE {database_name}")
        return {"has_access": True}
    except:
        return {"has_access": False}
```

## Testing Protocol

### 1. Grant Test Database Access
```sql
GRANT USAGE ON DATABASE TEST_DB TO APPLICATION UNIFIED_HONEY_APPLICATION;
GRANT USAGE ON SCHEMA TEST_DB.PUBLIC TO APPLICATION UNIFIED_HONEY_APPLICATION;
GRANT SELECT ON ALL TABLES IN SCHEMA TEST_DB.PUBLIC TO APPLICATION UNIFIED_HONEY_APPLICATION;
```

### 2. Verify Discovery
```bash
curl http://localhost:8000/api/v1/data-sources/databases
# Should return TEST_DB in the list
```

### 3. Test Table Selection Flow
1. Navigate to /data-sources in UI
2. Select TEST_DB from dropdown
3. Select PUBLIC schema
4. Verify tables appear with metadata
5. Select tables and save
6. Verify selections persist in config.selected_tables

## Deployment Checklist

- [ ] Backend API routes implemented
- [ ] SQL schema created and executed via setup.sql
- [ ] Frontend components created
- [ ] Router registered in app.py
- [ ] Docker image rebuilt with new code
- [ ] Image pushed to Snowflake registry
- [ ] Application redeployed with teardown
- [ ] Test database grants applied
- [ ] UI tested end-to-end
- [ ] Documentation updated

## Known Limitations

1. **No Automatic Discovery**: Consumer must manually grant access; app cannot "request" database access via manifest
2. **No Cross-Database Queries**: Application sees each database independently; cannot easily query across databases unless explicitly granted
3. **Schema-Level Granularity**: Best practice is schema-level grants, not database-wide
4. **No Future Database Detection**: Application only discovers databases already granted at query time

## Alternative Approaches Considered

### ❌ Option A: TABLE References (Rejected)
```yaml
references:
  - source_tables:
      object_type: TABLE
      multi_valued: true
```
**Rejected Because**: Too granular; consumers would need to bind every table individually

### ❌ Option C: External Configuration (Rejected)
Store database names in external configuration files
**Rejected Because**: Less secure; breaks Snowflake's permission model

### ✅ Option B: Manual Grants + Discovery UI (Chosen)
Best balance of:
- Works within Snowflake constraints
- Leverages native permission system
- Provides user-friendly interface
- Secure and auditable

## Future Enhancements

### Phase 2
- Auto-refresh when new databases are granted
- Bulk selection by schema
- Table metadata preview (row count, size, columns)
- Search/filter tables by name pattern

### Phase 3
- Intelligent table recommendations based on naming
- Lineage tracking between selected tables
- Permission health checks and validation
- Grant template generator for consumers

## References

- [Snowflake Native Apps References](https://docs.snowflake.com/en/developer-guide/native-apps/requesting-refs)
- [Valid Object Types Documentation](https://docs.snowflake.com/en/developer-guide/native-apps/requesting-refs#valid-object-types)
- [SHOW Commands Documentation](https://docs.snowflake.com/en/sql-reference/sql/show)

---

## APPENDIX: Complete TABLE References Implementation (Option A)

This appendix provides comprehensive, step-by-step implementation details for an AI agent to implement the TABLE references approach.

### Overview

Use TABLE object_type with multi-valued references, enabling consumers to bind specific tables through Snowflake's native reference UI.

### Implementation Requirements

#### Files to Create/Modify:
1. `app/manifest.yml` - Add TABLE reference configuration
2. `app/references.sql` - Add table tracking callbacks
3. `service/backend/api/routes/references.py` - Create discovery & reference APIs
4. `service/backend/app.py` - Register references router
5. `service/frontend/src/components/DatabaseSelector.tsx` - React UI
6. `service/frontend/src/components/DatabaseSelector.css` - Styling

---

### Step-by-Step Implementation

See [IMPLEMENTATION_PLAN_DATABASE_UI.md](../IMPLEMENTATION_PLAN_DATABASE_UI.md) for the complete implementation plan with all code examples, TypeScript interfaces, SQL schemas, and React components.

The TABLE references approach differs from the documented plan in these key ways:

**Manifest Changes:**
```yaml
references:
  - consumer_tables:
      label: "Data Tables"
      privileges:
        - SELECT
      object_type: TABLE      # Uses TABLE instead of no reference
      multi_valued: true
      register_callback: config.register_tables  # Different callback
```

**SQL Tracking:**
Uses `config.referenced_tables` instead of `config.selected_tables` with reference lifecycle tracking (ADD/REMOVE/CLEAR operations).

**API Differences:**
- Endpoint prefix: `/api/v1/references/` instead of `/api/v1/data-sources/`
- Additional endpoint: `POST /tables/request-access` creates SYSTEM$REFERENCE entries
- Consumers must bind references in Snowflake UI after requesting

**Consumer Workflow:**
1. Grant database access (same as Option B)
2. Discover & select tables in UI
3. Click "Request Access" → App creates SYSTEM$REFERENCE
4. Consumer opens Snowflake UI → Apps → References tab → Binds references
5. Tables become accessible

For full implementation code, refer to the original option description provided by the user.

