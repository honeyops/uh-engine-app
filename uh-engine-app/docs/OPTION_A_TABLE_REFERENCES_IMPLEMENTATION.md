# Complete Implementation Guide: TABLE References Approach (Option A)

## Overview

This document provides comprehensive, production-ready implementation details for using TABLE references in the Unified Honey Snowflake Native App. An AI agent can follow this guide to implement the complete solution.

## Architecture

```
Consumer Account                    Native App Account
┌──────────────────┐               ┌─────────────────────┐
│  Manual GRANTS   │   ────────>   │  SHOW Commands      │
│  (Database/      │               │  (Discovery)        │
│   Schema/Table)  │               └──────────┬──────────┘
└──────────────────┘                          │
                                              ▼
┌──────────────────┐               ┌─────────────────────┐
│  React UI        │   <────────>  │  FastAPI Backend    │
│  Table Selection │               │  /api/v1/references │
└────────┬─────────┘               └──────────┬──────────┘
         │                                    │
         │ Request Access                     │ SYSTEM$REFERENCE
         └────────────────────────────────────┤
                                              ▼
                               ┌────────────────────────────┐
                               │  config.referenced_tables  │
                               │  (Tracking Storage)        │
                               └────────────────────────────┘
                                              │
         ┌────────────────────────────────────┘
         ▼
┌──────────────────┐
│  Snowflake UI    │
│  Bind References │
│  (Apps→Refs Tab) │
└──────────────────┘
```

## Consumer Workflow

1. **Grant Database Access** - Consumer runs GRANT statements
2. **Discover Tables** - Consumer browses tables in React UI
3. **Request Access** - Consumer selects tables and clicks "Request Access"
4. **App Creates References** - Backend creates SYSTEM$REFERENCE entries
5. **Bind in Snowflake UI** - Consumer opens Snowflake → Apps → References tab → Binds
6. **Tables Accessible** - Application can now query bound tables

---

## Implementation Steps

### Step 1: Update Application Manifest

**File:** `app/manifest.yml`

**Action:** Add TABLE reference configuration

```yaml
manifest_version: 1

version:
  name: dev
  label: "Development Version"
  comment: "Development version of Unified Honey"

artifacts:
  setup_script: setup.sql
  default_streamlit: ui/streamlit_app.py
  readme: README.md

configuration:
  log_level: INFO
  trace_level: ALWAYS

references:
  # Warehouse reference (existing - keep this)
  - consumer_warehouse:
      label: "Application Warehouse"
      description: "A warehouse in the consumer account for executing queries"
      privileges:
        - USAGE
        - OPERATE
      object_type: WAREHOUSE
      multi_valued: false
      register_callback: config.register_warehouse

  # TABLE REFERENCES (add this for Option A)
  - consumer_tables:
      label: "Data Tables"
      description: "Tables in the consumer account to analyze with Unified Honey"
      privileges:
        - SELECT
      object_type: TABLE
      multi_valued: true  # Allows binding multiple tables
      register_callback: config.register_tables  # Callback to handle reference lifecycle
```

---

### Step 2: Create SQL Callbacks and Storage

**File:** `app/references.sql`

**Action:** Add table tracking infrastructure

```sql
-- Schema for managing references
CREATE SCHEMA IF NOT EXISTS config;

-- ===== WAREHOUSE REFERENCE (existing - keep this) =====
CREATE OR REPLACE PROCEDURE config.register_warehouse(
    ref_name STRING,
    operation STRING,
    ref_or_alias STRING
)
RETURNS STRING
LANGUAGE SQL
EXECUTE AS OWNER
AS $$
    BEGIN
        CASE (operation)
            WHEN 'ADD' THEN
                SELECT SYSTEM$SET_REFERENCE(:ref_name, :ref_or_alias);
            WHEN 'REMOVE' THEN
                SELECT SYSTEM$REMOVE_REFERENCE(:ref_name);
            WHEN 'CLEAR' THEN
                SELECT SYSTEM$REMOVE_REFERENCE(:ref_name);
        ELSE
            RETURN 'Unknown operation: ' || operation;
        END CASE;
        RETURN 'Success';
    END;
$$;

GRANT USAGE ON PROCEDURE config.register_warehouse(STRING, STRING, STRING)
    TO APPLICATION ROLE app_public;

-- ===== TABLE REFERENCES (add this for Option A) =====

-- Table to track referenced tables with lifecycle
CREATE TABLE IF NOT EXISTS config.referenced_tables (
    reference_name STRING NOT NULL,      -- Always 'consumer_tables' from manifest
    table_fqn STRING NOT NULL,           -- Fully qualified table name (db.schema.table)
    reference_id STRING NOT NULL,        -- SYSTEM$REFERENCE ID
    added_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
    removed_at TIMESTAMP_LTZ,           -- Timestamp when reference was removed
    is_active BOOLEAN DEFAULT TRUE,      -- Whether reference is currently active
    PRIMARY KEY (reference_name, reference_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE config.referenced_tables
    TO APPLICATION ROLE app_public;

-- View to filter only active references
CREATE OR REPLACE VIEW config.active_referenced_tables AS
SELECT
    reference_name,
    table_fqn,
    reference_id,
    added_at
FROM config.referenced_tables
WHERE is_active = TRUE
ORDER BY added_at DESC;

GRANT SELECT ON VIEW config.active_referenced_tables
    TO APPLICATION ROLE app_public;

-- Callback procedure invoked by Snowflake when consumers bind/unbind references
CREATE OR REPLACE PROCEDURE config.register_tables(
    ref_name STRING,
    operation STRING,
    ref_or_alias STRING
)
RETURNS STRING
LANGUAGE SQL
EXECUTE AS OWNER
AS $$
    DECLARE
        result STRING;
    BEGIN
        CASE (operation)
            WHEN 'ADD' THEN
                -- Consumer has bound a table reference
                -- Set the reference in Snowflake's system
                CALL SYSTEM$SET_REFERENCE(:ref_name, :ref_or_alias);

                -- Track it in our application database
                -- ref_or_alias contains the reference ID from SYSTEM$REFERENCE
                INSERT INTO config.referenced_tables
                    (reference_name, reference_id, table_fqn, is_active)
                VALUES
                    (:ref_name, :ref_or_alias, :ref_or_alias, TRUE);

                result := 'Added table reference: ' || :ref_or_alias;

            WHEN 'REMOVE' THEN
                -- Consumer has unbound a table reference
                -- Remove the reference from Snowflake's system
                CALL SYSTEM$REMOVE_REFERENCE(:ref_name, :ref_or_alias);

                -- Mark as inactive in our tracking (soft delete)
                UPDATE config.referenced_tables
                SET is_active = FALSE,
                    removed_at = CURRENT_TIMESTAMP()
                WHERE reference_name = :ref_name
                  AND reference_id = :ref_or_alias;

                result := 'Removed table reference: ' || :ref_or_alias;

            WHEN 'CLEAR' THEN
                -- Consumer has cleared all table references
                -- Clear all references in Snowflake's system
                CALL SYSTEM$REMOVE_ALL_REFERENCES(:ref_name);

                -- Mark all as inactive in our tracking
                UPDATE config.referenced_tables
                SET is_active = FALSE,
                    removed_at = CURRENT_TIMESTAMP()
                WHERE reference_name = :ref_name
                  AND is_active = TRUE;

                result := 'Cleared all table references for: ' || :ref_name;
        ELSE
            result := 'Unknown operation: ' || operation;
        END CASE;

        RETURN result;
    END;
$$;

GRANT USAGE ON PROCEDURE config.register_tables(STRING, STRING, STRING)
    TO APPLICATION ROLE app_public;

GRANT USAGE ON SCHEMA config TO APPLICATION ROLE app_public;
```

---

### Step 3: Create Backend API Routes

**File:** `service/backend/api/routes/references.py` (create new file)

**Action:** Implement discovery and reference management APIs

```python
"""
API routes for managing Snowflake Native App table references (Option A).
Supports discovering available tables and requesting access via TABLE references.
"""
from fastapi import APIRouter, HTTPException
from typing import List, Dict
from pydantic import BaseModel
import logging
from core.snowflake import SnowflakeClient

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/references", tags=["references"])


# ===== Request/Response Models =====

class TableReference(BaseModel):
    """Represents a table in the consumer account."""
    name: str
    database: str
    schema: str
    type: str  # 'TABLE', 'VIEW', 'EXTERNAL TABLE'


class TableReferenceRequest(BaseModel):
    """Request body for creating table references."""
    tables: List[str]  # List of fully qualified names (db.schema.table)


class ActiveReference(BaseModel):
    """An active table reference."""
    reference_name: str
    table_fqn: str
    reference_id: str
    added_at: str


# ===== Discovery Endpoints =====

@router.get("/available-databases")
async def list_available_databases() -> Dict[str, List[str]]:
    """
    List databases accessible to the application.

    Prerequisites:
        Consumer must grant: GRANT USAGE ON DATABASE ... TO APPLICATION ...

    Returns:
        Dictionary with 'databases' key containing list of database names

    Example Response:
        {
            "databases": ["MY_DB", "SALES_DB", "ANALYTICS_DB"]
        }
    """
    try:
        with SnowflakeClient() as client:
            rows = client.run("SHOW DATABASES")
            # Database name is in column index 1
            databases = [row[1] for row in rows]

            logger.info(f"Found {len(databases)} accessible databases")
            return {"databases": databases}

    except Exception as e:
        logger.error(f"Error listing databases: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/databases/{database_name}/schemas")
async def list_database_schemas(database_name: str) -> Dict[str, List[str]]:
    """
    List schemas in a specific database.

    Prerequisites:
        Consumer must grant: GRANT USAGE ON SCHEMA ... TO APPLICATION ...

    Args:
        database_name: Name of the database

    Returns:
        Dictionary with database name and list of schema names

    Example Response:
        {
            "database": "MY_DB",
            "schemas": ["PUBLIC", "RAW", "ANALYTICS"]
        }
    """
    try:
        with SnowflakeClient() as client:
            rows = client.run(f"SHOW SCHEMAS IN DATABASE {database_name}")
            # Schema name is in column index 1
            schemas = [row[1] for row in rows]

            logger.info(f"Found {len(schemas)} schemas in {database_name}")
            return {
                "database": database_name,
                "schemas": schemas
            }

    except Exception as e:
        logger.error(f"Error listing schemas in {database_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/databases/{database_name}/schemas/{schema_name}/tables")
async def list_schema_tables(
    database_name: str,
    schema_name: str
) -> Dict[str, List[Dict]]:
    """
    List tables in a specific schema.

    Prerequisites:
        Consumer must grant: GRANT SELECT ON ALL TABLES IN SCHEMA ... TO APPLICATION ...

    Args:
        database_name: Name of the database
        schema_name: Name of the schema

    Returns:
        Dictionary with database, schema, and list of tables with metadata

    Example Response:
        {
            "database": "MY_DB",
            "schema": "PUBLIC",
            "tables": [
                {
                    "name": "CUSTOMERS",
                    "database": "MY_DB",
                    "schema": "PUBLIC",
                    "type": "TABLE"
                },
                {
                    "name": "ORDERS",
                    "database": "MY_DB",
                    "schema": "PUBLIC",
                    "type": "VIEW"
                }
            ]
        }
    """
    try:
        with SnowflakeClient() as client:
            rows = client.run(f"SHOW TABLES IN {database_name}.{schema_name}")

            tables = [
                {
                    "name": row[1],       # table name (column 1)
                    "database": row[2],   # database name (column 2)
                    "schema": row[3],     # schema name (column 3)
                    "type": row[4]        # table type (column 4)
                }
                for row in rows
            ]

            logger.info(f"Found {len(tables)} tables in {database_name}.{schema_name}")
            return {
                "database": database_name,
                "schema": schema_name,
                "tables": tables
            }

    except Exception as e:
        logger.error(f"Error listing tables in {database_name}.{schema_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ===== Reference Management Endpoints =====

@router.get("/active-references")
async def get_active_references() -> Dict[str, List[Dict]]:
    """
    Get all currently active table references that have been bound.

    Returns:
        Dictionary with list of active references

    Example Response:
        {
            "references": [
                {
                    "reference_name": "consumer_tables",
                    "table_fqn": "MY_DB.PUBLIC.CUSTOMERS",
                    "reference_id": "ref_abc123",
                    "added_at": "2025-01-15 10:30:00"
                }
            ]
        }
    """
    try:
        with SnowflakeClient() as client:
            rows = client.run("""
                SELECT reference_name, table_fqn, reference_id, added_at
                FROM config.active_referenced_tables
                ORDER BY added_at DESC
            """)

            references = [
                {
                    "reference_name": row[0],
                    "table_fqn": row[1],
                    "reference_id": row[2],
                    "added_at": str(row[3])
                }
                for row in rows
            ]

            logger.info(f"Found {len(references)} active references")
            return {"references": references}

    except Exception as e:
        logger.error(f"Error getting active references: {e}")
        # If table doesn't exist yet, return empty list
        return {"references": []}


@router.post("/tables/request-access")
async def request_table_access(request: TableReferenceRequest) -> Dict[str, str]:
    """
    Request access to specific tables by creating SYSTEM$REFERENCE entries.

    Flow:
        1. Application creates SYSTEM$REFERENCE for each table
        2. Application calls register_tables callback with 'ADD' operation
        3. Reference is tracked in config.referenced_tables
        4. Consumer must bind the reference in Snowflake UI:
           - Navigate to: Apps → Unified Honey → References tab
           - Click "Bind" next to each requested reference
        5. After binding, table becomes accessible to application

    Request Body:
        {
            "tables": ["MY_DB.PUBLIC.CUSTOMERS", "MY_DB.PUBLIC.ORDERS"]
        }

    Returns:
        Status message with count of created references

    Example Response:
        {
            "status": "success",
            "message": "Created references for 2 table(s). Consumer must bind them in Snowflake UI.",
            "tables": ["MY_DB.PUBLIC.CUSTOMERS", "MY_DB.PUBLIC.ORDERS"]
        }

    Consumer Action Required:
        After calling this endpoint, consumer must:
        1. Open Snowflake UI
        2. Navigate to Apps → Unified Honey
        3. Click on "References" tab
        4. Find the requested table references
        5. Click "Bind" for each reference
    """
    try:
        tables = request.tables

        if not tables:
            raise HTTPException(status_code=400, detail="No tables provided")

        with SnowflakeClient() as client:
            created_refs = []

            for table_fqn in tables:
                try:
                    # Create a SYSTEM$REFERENCE for this table
                    # Syntax: SYSTEM$REFERENCE('object_type', 'object_name', 'mode', 'privilege')
                    # - object_type: 'TABLE'
                    # - object_name: Fully qualified table name (DB.SCHEMA.TABLE)
                    # - mode: 'PERSISTENT' (reference persists across sessions)
                    # - privilege: 'SELECT' (read-only access)
                    ref_sql = f"""
                        SELECT SYSTEM$REFERENCE('TABLE', '{table_fqn}', 'PERSISTENT', 'SELECT')
                    """
                    result = client.run(ref_sql)
                    ref_id = result[0][0]

                    # Call the register callback to track it in our database
                    # This will be logged in config.referenced_tables
                    client.run(f"""
                        CALL config.register_tables('consumer_tables', 'ADD', '{ref_id}')
                    """)

                    created_refs.append(table_fqn)
                    logger.info(f"Created reference for table: {table_fqn} (ref_id: {ref_id})")

                except Exception as table_error:
                    logger.error(f"Failed to create reference for {table_fqn}: {table_error}")
                    # Continue with other tables even if one fails

        if created_refs:
            return {
                "status": "success",
                "message": f"Created references for {len(created_refs)} table(s). Consumer must bind them in Snowflake UI.",
                "tables": created_refs
            }
        else:
            raise HTTPException(
                status_code=500,
                detail="Failed to create any references. Check logs for details."
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error requesting table access: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/tables/{reference_id}")
async def remove_table_reference(reference_id: str) -> Dict[str, str]:
    """
    Remove a specific table reference.

    This unbinds the reference and marks it as inactive.

    Args:
        reference_id: The reference ID to remove (from active_referenced_tables)

    Returns:
        Status message

    Example Response:
        {
            "status": "success",
            "message": "Removed reference ref_abc123"
        }
    """
    try:
        with SnowflakeClient() as client:
            client.run(f"""
                CALL config.register_tables('consumer_tables', 'REMOVE', '{reference_id}')
            """)

            logger.info(f"Removed reference: {reference_id}")
            return {
                "status": "success",
                "message": f"Removed reference {reference_id}"
            }

    except Exception as e:
        logger.error(f"Error removing reference {reference_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/tables/clear-all")
async def clear_all_references() -> Dict[str, str]:
    """
    Clear all table references.

    This removes all bound references and marks them as inactive.

    Returns:
        Status message

    Example Response:
        {
            "status": "success",
            "message": "Cleared all table references"
        }
    """
    try:
        with SnowflakeClient() as client:
            client.run("""
                CALL config.register_tables('consumer_tables', 'CLEAR', '')
            """)

            logger.info("Cleared all table references")
            return {
                "status": "success",
                "message": "Cleared all table references"
            }

    except Exception as e:
        logger.error(f"Error clearing references: {e}")
        raise HTTPException(status_code=500, detail=str(e))
```

---

### Step 4: Register Router in FastAPI

**File:** `service/backend/app.py`

**Action:** Add references router to application

**Modify imports (around line 14):**
```python
from api.routes import (
    utilities,
    blueprints,
    dimensional_models,
    openflow,
    governance,
    dashboard,
    references  # Add this import
)
```

**Add router registration (around line 99):**
```python
# Register all routers
app.include_router(utilities.router)
app.include_router(blueprints.router)
app.include_router(dimensional_models.router)
app.include_router(openflow.router)
app.include_router(governance.router)
app.include_router(dashboard.router)
app.include_router(references.router)  # Add this line
```

---

### Step 5: Create React Component

**File:** `service/frontend/src/components/DatabaseSelector.tsx` (create new file)

**Action:** Implement table discovery and reference management UI

```typescript
import React, { useState, useEffect } from 'react';
import './DatabaseSelector.css';

// TypeScript interfaces
interface Table {
  name: string;
  database: string;
  schema: string;
  type: string;
}

interface ActiveReference {
  reference_name: string;
  table_fqn: string;
  reference_id: string;
  added_at: string;
}

export const DatabaseSelector: React.FC = () => {
  // State management
  const [databases, setDatabases] = useState<string[]>([]);
  const [selectedDb, setSelectedDb] = useState<string>('');
  const [schemas, setSchemas] = useState<string[]>([]);
  const [selectedSchema, setSelectedSchema] = useState<string>('');
  const [tables, setTables] = useState<Table[]>([]);
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [activeRefs, setActiveRefs] = useState<ActiveReference[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Load initial data on component mount
  useEffect(() => {
    fetchDatabases();
    fetchActiveReferences();
  }, []);

  // Fetch available databases
  const fetchDatabases = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/v1/references/available-databases');
      if (!response.ok) throw new Error('Failed to fetch databases');

      const data = await response.json();
      setDatabases(data.databases);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load databases');
    } finally {
      setLoading(false);
    }
  };

  // Fetch schemas for a database
  const fetchSchemas = async (dbName: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/references/databases/${dbName}/schemas`);
      if (!response.ok) throw new Error('Failed to fetch schemas');

      const data = await response.json();
      setSchemas(data.schemas);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load schemas');
    } finally {
      setLoading(false);
    }
  };

  // Fetch tables for a schema
  const fetchTables = async (dbName: string, schemaName: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/references/databases/${dbName}/schemas/${schemaName}/tables`
      );
      if (!response.ok) throw new Error('Failed to fetch tables');

      const data = await response.json();
      setTables(data.tables);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tables');
    } finally {
      setLoading(false);
    }
  };

  // Fetch active references
  const fetchActiveReferences = async () => {
    try {
      const response = await fetch('/api/v1/references/active-references');
      if (!response.ok) throw new Error('Failed to fetch active references');

      const data = await response.json();
      setActiveRefs(data.references);
    } catch (err) {
      console.error('Failed to load active references:', err);
    }
  };

  // Handle database selection change
  const handleDatabaseChange = (dbName: string) => {
    setSelectedDb(dbName);
    setSelectedSchema('');
    setTables([]);
    setError(null);

    if (dbName) {
      fetchSchemas(dbName);
    }
  };

  // Handle schema selection change
  const handleSchemaChange = (schemaName: string) => {
    setSelectedSchema(schemaName);
    setError(null);

    if (selectedDb && schemaName) {
      fetchTables(selectedDb, schemaName);
    }
  };

  // Toggle table selection
  const toggleTableSelection = (tableFqn: string) => {
    const newSelection = new Set(selectedTables);
    if (newSelection.has(tableFqn)) {
      newSelection.delete(tableFqn);
    } else {
      newSelection.add(tableFqn);
    }
    setSelectedTables(newSelection);
  };

  // Request access to selected tables
  const requestAccess = async () => {
    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const response = await fetch('/api/v1/references/tables/request-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tables: Array.from(selectedTables) })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to request access');
      }

      const data = await response.json();
      setSuccessMessage(
        `${data.message} Go to Snowflake UI → Apps → Unified Honey → References tab to bind them.`
      );

      // Refresh active references
      await fetchActiveReferences();

      // Clear selection
      setSelectedTables(new Set());

      // Auto-hide success message after 10 seconds
      setTimeout(() => setSuccessMessage(null), 10000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to request access');
    } finally {
      setLoading(false);
    }
  };

  // Remove a table reference
  const removeReference = async (refId: string) => {
    if (!window.confirm('Remove this table reference?')) return;

    try {
      const response = await fetch(`/api/v1/references/tables/${refId}`, {
        method: 'DELETE'
      });

      if (!response.ok) throw new Error('Failed to remove reference');

      await fetchActiveReferences();
      setSuccessMessage('Reference removed successfully');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove reference');
    }
  };

  // Render component
  return (
    <div className="database-selector">
      {/* Header */}
      <div className="header">
        <h1>Select Data Sources</h1>
        <p className="subtitle">
          Choose tables to analyze with Unified Honey (TABLE References Mode)
        </p>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="alert alert-error">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Success Alert */}
      {successMessage && (
        <div className="alert alert-success">
          {successMessage}
        </div>
      )}

      {/* Info Box */}
      <div className="info-box">
        <h3>How TABLE References Work:</h3>
        <ol>
          <li>Grant database access: <code>GRANT USAGE ON DATABASE ... TO APPLICATION ...</code></li>
          <li>Discover and select tables in the UI below</li>
          <li>Click "Request Access" to create references</li>
          <li>Bind references in Snowflake UI (Apps → Unified Honey → References tab)</li>
          <li>Tables become available for analysis</li>
        </ol>
      </div>

      {/* Table Discovery Section */}
      <div className="selector-section">
        <h2>Discover Tables</h2>

        {/* Database Selector */}
        <div className="selector-group">
          <label htmlFor="database-select">Database:</label>
          <select
            id="database-select"
            value={selectedDb}
            onChange={(e) => handleDatabaseChange(e.target.value)}
            disabled={loading}
            className="form-control"
          >
            <option value="">Select a database...</option>
            {databases.map(db => (
              <option key={db} value={db}>{db}</option>
            ))}
          </select>
          {databases.length === 0 && !loading && (
            <p className="help-text">
              No databases found. Grant USAGE on databases first.
            </p>
          )}
        </div>

        {/* Schema Selector */}
        {selectedDb && (
          <div className="selector-group">
            <label htmlFor="schema-select">Schema:</label>
            <select
              id="schema-select"
              value={selectedSchema}
              onChange={(e) => handleSchemaChange(e.target.value)}
              disabled={loading}
              className="form-control"
            >
              <option value="">Select a schema...</option>
              {schemas.map(schema => (
                <option key={schema} value={schema}>{schema}</option>
              ))}
            </select>
          </div>
        )}

        {/* Table List */}
        {tables.length > 0 && (
          <div className="table-list">
            <h3>Tables in {selectedDb}.{selectedSchema}</h3>
            {tables.map(table => {
              const fqn = `${table.database}.${table.schema}.${table.name}`;
              const isSelected = selectedTables.has(fqn);

              return (
                <div key={fqn} className="table-item">
                  <input
                    type="checkbox"
                    id={`table-${fqn}`}
                    checked={isSelected}
                    onChange={() => toggleTableSelection(fqn)}
                  />
                  <label htmlFor={`table-${fqn}`}>
                    <strong>{table.name}</strong>
                    <span className="table-type">({table.type})</span>
                  </label>
                </div>
              );
            })}
          </div>
        )}

        {/* Action Buttons */}
        {selectedTables.size > 0 && (
          <div className="action-buttons">
            <button
              onClick={requestAccess}
              disabled={loading}
              className="btn btn-primary"
            >
              {loading ? 'Requesting...' : `Request Access to ${selectedTables.size} Table(s)`}
            </button>
            <button
              onClick={() => setSelectedTables(new Set())}
              disabled={loading}
              className="btn btn-secondary"
            >
              Clear Selection
            </button>
          </div>
        )}
      </div>

      {/* Active References Section */}
      {activeRefs.length > 0 && (
        <div className="active-refs-section">
          <h2>Active Table References</h2>
          <p className="help-text">
            These table references have been created and bound
          </p>

          <div className="refs-list">
            {activeRefs.map(ref => (
              <div key={ref.reference_id} className="ref-item">
                <div className="ref-info">
                  <strong>{ref.table_fqn}</strong>
                  <span className="ref-date">
                    Added: {new Date(ref.added_at).toLocaleString()}
                  </span>
                </div>
                <button
                  onClick={() => removeReference(ref.reference_id)}
                  className="btn btn-danger btn-sm"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Loading Overlay */}
      {loading && (
        <div className="loading-overlay">
          <div className="spinner"></div>
          <p>Loading...</p>
        </div>
      )}
    </div>
  );
};
```

---

### Step 6: Create Styling

**File:** `service/frontend/src/components/DatabaseSelector.css` (create new file)

**Action:** Add component styles

```css
.database-selector {
  padding: 24px;
  max-width: 1000px;
  margin: 0 auto;
}

.header {
  margin-bottom: 24px;
}

.header h1 {
  font-size: 28px;
  font-weight: 600;
  margin-bottom: 8px;
  color: #1a1a1a;
}

.subtitle {
  color: #666;
  font-size: 16px;
}

/* Info Box */
.info-box {
  background: #f0f8ff;
  border: 1px solid #b3d9ff;
  border-radius: 6px;
  padding: 16px;
  margin-bottom: 24px;
}

.info-box h3 {
  margin-top: 0;
  font-size: 16px;
  color: #0066cc;
}

.info-box ol {
  margin: 12px 0 0 20px;
  padding: 0;
}

.info-box code {
  background: #fff;
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 13px;
  font-family: 'Courier New', monospace;
}

/* Alerts */
.alert {
  padding: 12px 16px;
  border-radius: 4px;
  margin-bottom: 20px;
}

.alert-error {
  background-color: #fee;
  border: 1px solid #fcc;
  color: #c00;
}

.alert-success {
  background-color: #efe;
  border: 1px solid #cfc;
  color: #060;
}

/* Sections */
.selector-section,
.active-refs-section {
  background: white;
  border-radius: 8px;
  padding: 24px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  margin-bottom: 24px;
}

.selector-section h2,
.active-refs-section h2 {
  font-size: 20px;
  font-weight: 600;
  margin-bottom: 16px;
  color: #1a1a1a;
}

/* Form Controls */
.selector-group {
  margin-bottom: 20px;
}

.selector-group label {
  display: block;
  font-weight: 500;
  margin-bottom: 8px;
  color: #333;
}

.form-control {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 14px;
  transition: border-color 0.2s;
}

.form-control:focus {
  outline: none;
  border-color: #0066cc;
}

.form-control:disabled {
  background-color: #f5f5f5;
  cursor: not-allowed;
}

.help-text {
  font-size: 13px;
  color: #666;
  margin-top: 8px;
}

/* Table List */
.table-list {
  margin-top: 24px;
}

.table-list h3 {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 12px;
  color: #1a1a1a;
}

.table-item {
  display: flex;
  align-items: center;
  padding: 10px;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  margin-bottom: 8px;
  transition: background-color 0.2s;
  cursor: pointer;
}

.table-item:hover {
  background-color: #f8f9fa;
}

.table-item input[type="checkbox"] {
  margin-right: 12px;
  width: 18px;
  height: 18px;
  cursor: pointer;
}

.table-item label {
  flex: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
}

.table-type {
  font-size: 12px;
  color: #666;
  font-weight: normal;
}

/* Action Buttons */
.action-buttons {
  display: flex;
  gap: 12px;
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid #e0e0e0;
}

.btn {
  padding: 12px 24px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background-color: #0066cc;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background-color: #0052a3;
}

.btn-secondary {
  background-color: #f0f0f0;
  color: #333;
}

.btn-secondary:hover:not(:disabled) {
  background-color: #e0e0e0;
}

.btn-danger {
  background-color: #dc3545;
  color: white;
}

.btn-danger:hover:not(:disabled) {
  background-color: #c82333;
}

.btn-sm {
  padding: 6px 12px;
  font-size: 12px;
}

/* Active References */
.refs-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ref-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  background-color: #f8f9fa;
}

.ref-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ref-info strong {
  color: #1a1a1a;
}

.ref-date {
  font-size: 12px;
  color: #666;
}

/* Loading Overlay */
.loading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(255, 255, 255, 0.9);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.loading-overlay p {
  margin-top: 16px;
  font-size: 16px;
  color: #666;
}

.spinner {
  width: 50px;
  height: 50px;
  border: 4px solid #f3f3f3;
  border-top: 4px solid #0066cc;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
```

---

### Step 7: Add Route to React Router

**File:** Your React routing configuration (likely `App.tsx` or `routes.tsx`)

**Action:** Add database selector route

```typescript
import { DatabaseSelector } from './components/DatabaseSelector';

// Add to your routes configuration
<Route path="/data-sources" element={<DatabaseSelector />} />
```

**Add navigation link:**
```typescript
<Link to="/data-sources">Data Sources</Link>
```

---

## Testing & Deployment

### Test Locally

1. **Grant Database Access:**
   ```sql
   GRANT USAGE ON DATABASE TEST_DB TO APPLICATION UNIFIED_HONEY_APPLICATION;
   GRANT USAGE ON SCHEMA TEST_DB.PUBLIC TO APPLICATION UNIFIED_HONEY_APPLICATION;
   GRANT SELECT ON ALL TABLES IN SCHEMA TEST_DB.PUBLIC TO APPLICATION UNIFIED_HONEY_APPLICATION;
   ```

2. **Test Discovery:**
   ```bash
   curl http://localhost:8000/api/v1/references/available-databases
   # Should return: {"databases": ["TEST_DB"]}
   ```

3. **Test UI:**
   - Navigate to http://localhost:3000/data-sources
   - Select TEST_DB → PUBLIC
   - Select tables
   - Click "Request Access"
   - Verify references created

### Deploy to Snowflake

1. **Rebuild Docker Image:**
   ```bash
   cd c:/Users/carla/unified-honey/uh-engine-app/uh-engine-app
   docker buildx build --no-cache --platform=linux/amd64 -t goistmo-uswest.registry.snowflakecomputing.com/uh_engine_app_database/public/images/uh_engine_app_service ./service
   ```

2. **Push to Registry:**
   ```bash
   snow spcs image-registry login
   docker push goistmo-uswest.registry.snowflakecomputing.com/uh_engine_app_database/public/images/uh_engine_app_service
   ```

3. **Redeploy Application:**
   ```bash
   snow app teardown --cascade
   snow app run
   ```

4. **Test Reference Binding:**
   - Open Snowflake UI
   - Navigate to Apps → Unified Honey
   - Click "References" tab
   - Bind requested table references
   - Verify tables accessible in application

---

## Key Differences from Option B

| Aspect | Option A (TABLE Refs) | Option B (Manual Grants) |
|--------|----------------------|--------------------------|
| **Manifest** | Declares TABLE references | No table references |
| **Consumer Binding** | Via Snowflake UI References tab | Manual GRANT only |
| **Discovery** | SHOW commands after grants | SHOW commands after grants |
| **Tracking Table** | `config.referenced_tables` | `config.selected_tables` |
| **Reference System** | Uses SYSTEM$REFERENCE | No reference system |
| **Workflow** | Two-step (request + bind) | One-step (grant + select) |
| **Granularity** | Per-table binding | Schema-level grants |
| **API Prefix** | `/api/v1/references/*` | `/api/v1/data-sources/*` |
| **Complexity** | Higher (lifecycle mgmt) | Lower (simple discovery) |

---

## Troubleshooting

### Consumer sees "No databases found"
**Solution:** Consumer must grant USAGE on database:
```sql
GRANT USAGE ON DATABASE MY_DB TO APPLICATION UNIFIED_HONEY_APPLICATION;
```

### "Failed to create reference" error
**Possible causes:**
1. Table doesn't exist
2. Consumer hasn't granted SELECT on table
3. Fully qualified name incorrect (must be `DB.SCHEMA.TABLE`)

**Solution:** Verify grants:
```sql
SHOW GRANTS TO APPLICATION UNIFIED_HONEY_APPLICATION;
```

### References not appearing in Snowflake UI
**Solution:**
1. Verify application redeployed with updated manifest.yml
2. Check reference was created: `SELECT * FROM config.referenced_tables`
3. Ensure using correct reference_name from manifest

---

## Summary

This implementation provides:
- ✅ Native Snowflake TABLE reference mechanism
- ✅ Full lifecycle management (ADD/REMOVE/CLEAR)
- ✅ User-friendly React discovery UI
- ✅ Per-table granular access control
- ✅ Complete tracking and audit trail

**Consumer Workflow:**
1. GRANT database access
2. Discover tables in UI
3. Request access (creates SYSTEM$REFERENCE)
4. Bind in Snowflake UI
5. Tables accessible

For alternative approaches, see [DATABASE_ACCESS_GUIDE.md](DATABASE_ACCESS_GUIDE.md).
