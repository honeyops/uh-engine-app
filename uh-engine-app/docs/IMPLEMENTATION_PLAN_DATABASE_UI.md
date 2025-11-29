# Comprehensive Implementation Plan: Database Selection React UI

This document provides a step-by-step plan to implement a React-based UI that allows users to browse and select databases/tables accessible to the Unified Honey Native App.

---

## Overview

**Goal**: Create a user interface where consumers can:
1. View databases they have granted access to
2. Browse schemas and tables within those databases
3. Select specific tables for analysis
4. Save their selections for use in dimensional modeling

**Approach**: Hybrid solution using manual grants + React UI for table discovery

---

## Architecture

```
┌─────────────────┐
│  React Frontend │
│  (Data Sources) │
└────────┬────────┘
         │ HTTP/REST
         ↓
┌─────────────────┐
│ FastAPI Backend │
│  (Python APIs)  │
└────────┬────────┘
         │ SQL
         ↓
┌─────────────────┐
│   Snowflake     │
│ (Consumer DBs)  │
└─────────────────┘
```

---

## Part 1: Backend Implementation

### Step 1.1: Create Data Discovery API

**File**: `c:\Users\carla\unified-honey\uh-engine-app\uh-engine-app\service\backend\api\routes\data_sources.py`

**Create new file** with these endpoints:

```python
"""
API routes for discovering and managing data sources (databases, schemas, tables).
"""
from fastapi import APIRouter, HTTPException
from typing import List, Dict, Optional
from pydantic import BaseModel
import logging
from core.snowflake import SnowflakeClient

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/data-sources", tags=["data-sources"])


# --- Request/Response Models ---

class DatabaseInfo(BaseModel):
    name: str
    owner: str
    comment: Optional[str] = None
    created_on: str


class SchemaInfo(BaseModel):
    name: str
    database_name: str
    owner: str
    comment: Optional[str] = None
    created_on: str


class TableInfo(BaseModel):
    name: str
    database_name: str
    schema_name: str
    table_type: str  # 'TABLE', 'VIEW', 'EXTERNAL TABLE'
    row_count: Optional[int] = None
    bytes: Optional[int] = None
    comment: Optional[str] = None


class TableSelection(BaseModel):
    database: str
    schema: str
    table: str
    selected: bool = True


class SaveSelectionsRequest(BaseModel):
    selections: List[TableSelection]


# --- API Endpoints ---

@router.get("/databases", response_model=Dict[str, List[DatabaseInfo]])
async def list_accessible_databases():
    """
    List all databases accessible to the application.
    Note: Consumers must grant USAGE on databases first.
    """
    try:
        with SnowflakeClient() as client:
            rows = client.run("SHOW DATABASES")

            databases = [
                DatabaseInfo(
                    name=row[1],           # name
                    owner=row[2],          # owner
                    comment=row[5] if len(row) > 5 else None,  # comment
                    created_on=str(row[0])  # created_on
                )
                for row in rows
            ]

            logger.info(f"Found {len(databases)} accessible databases")
            return {"databases": databases}

    except Exception as e:
        logger.error(f"Error listing databases: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/databases/{database_name}/schemas", response_model=Dict[str, List[SchemaInfo]])
async def list_database_schemas(database_name: str):
    """
    List all schemas in a specific database.
    """
    try:
        with SnowflakeClient() as client:
            rows = client.run(f"SHOW SCHEMAS IN DATABASE {database_name}")

            schemas = [
                SchemaInfo(
                    name=row[1],                # name
                    database_name=row[2],       # database_name
                    owner=row[3],               # owner
                    comment=row[5] if len(row) > 5 else None,
                    created_on=str(row[0])      # created_on
                )
                for row in rows
            ]

            logger.info(f"Found {len(schemas)} schemas in {database_name}")
            return {
                "database": database_name,
                "schemas": schemas
            }

    except Exception as e:
        logger.error(f"Error listing schemas for {database_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get(
    "/databases/{database_name}/schemas/{schema_name}/tables",
    response_model=Dict[str, List[TableInfo]]
)
async def list_schema_tables(database_name: str, schema_name: str):
    """
    List all tables and views in a specific schema.
    """
    try:
        with SnowflakeClient() as client:
            rows = client.run(f"SHOW TABLES IN {database_name}.{schema_name}")

            tables = [
                TableInfo(
                    name=row[1],                # name
                    database_name=row[2],       # database_name
                    schema_name=row[3],         # schema_name
                    table_type=row[4],          # kind (TABLE, VIEW, etc.)
                    row_count=row[5] if len(row) > 5 else None,
                    bytes=row[6] if len(row) > 6 else None,
                    comment=row[7] if len(row) > 7 else None
                )
                for row in rows
            ]

            logger.info(f"Found {len(tables)} tables in {database_name}.{schema_name}")
            return {
                "database": database_name,
                "schema": schema_name,
                "tables": tables
            }

    except Exception as e:
        logger.error(f"Error listing tables for {database_name}.{schema_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/selections", response_model=Dict[str, List[Dict]])
async def get_saved_selections():
    """
    Retrieve previously saved table selections.
    """
    try:
        with SnowflakeClient() as client:
            rows = client.run("""
                SELECT database_name, schema_name, table_name, selected_at
                FROM config.selected_tables
                ORDER BY selected_at DESC
            """)

            selections = [
                {
                    "database": row[0],
                    "schema": row[1],
                    "table": row[2],
                    "selected_at": str(row[3])
                }
                for row in rows
            ]

            return {"selections": selections}

    except Exception as e:
        logger.error(f"Error retrieving saved selections: {e}")
        # If table doesn't exist yet, return empty list
        return {"selections": []}


@router.post("/selections", response_model=Dict[str, str])
async def save_table_selections(request: SaveSelectionsRequest):
    """
    Save user's table selections to the database.
    """
    try:
        with SnowflakeClient() as client:
            # Clear existing selections
            client.run("DELETE FROM config.selected_tables")

            # Insert new selections
            for selection in request.selections:
                if selection.selected:
                    client.run(f"""
                        INSERT INTO config.selected_tables
                        (database_name, schema_name, table_name)
                        VALUES ('{selection.database}', '{selection.schema}', '{selection.table}')
                    """)

            logger.info(f"Saved {len(request.selections)} table selections")
            return {
                "status": "success",
                "message": f"Saved {len(request.selections)} table selections"
            }

    except Exception as e:
        logger.error(f"Error saving selections: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/verify-access/{database_name}", response_model=Dict[str, bool])
async def verify_database_access(database_name: str):
    """
    Verify if the application has access to a specific database.
    """
    try:
        with SnowflakeClient() as client:
            # Try to use the database
            client.run(f"USE DATABASE {database_name}")
            return {"has_access": True, "database": database_name}
    except Exception as e:
        logger.warning(f"No access to database {database_name}: {e}")
        return {"has_access": False, "database": database_name}
```

### Step 1.2: Create SQL Schema for Tracking Selections

**File**: `c:\Users\carla\unified-honey\uh-engine-app\uh-engine-app\app\data_sources.sql`

**Create new file**:

```sql
-- Schema for tracking user data source selections
-- This tracks which tables users have selected for analysis

-- Ensure config schema exists
CREATE SCHEMA IF NOT EXISTS config;

-- Table to track selected data sources
CREATE TABLE IF NOT EXISTS config.selected_tables (
    database_name STRING NOT NULL,
    schema_name STRING NOT NULL,
    table_name STRING NOT NULL,
    selected_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
    PRIMARY KEY (database_name, schema_name, table_name)
);

-- Grant access to app_public role
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE config.selected_tables
    TO APPLICATION ROLE app_public;

-- Helper view to get fully qualified table names
CREATE OR REPLACE VIEW config.selected_tables_fqn AS
SELECT
    database_name || '.' || schema_name || '.' || table_name AS fqn,
    database_name,
    schema_name,
    table_name,
    selected_at
FROM config.selected_tables;

GRANT SELECT ON VIEW config.selected_tables_fqn
    TO APPLICATION ROLE app_public;
```

### Step 1.3: Update setup.sql to Include New Schema

**File**: `c:\Users\carla\unified-honey\uh-engine-app\uh-engine-app\app\setup.sql`

**Add this line** after the references.sql execution:

```sql
execute immediate from './data_sources.sql';
```

### Step 1.4: Register Router in FastAPI

**File**: `c:\Users\carla\unified-honey\uh-engine-app\uh-engine-app\service\backend\app.py`

**Update imports** (around line 14):

```python
from api.routes import utilities, blueprints, dimensional_models, openflow, governance, dashboard, data_sources
```

**Add router** (around line 99):

```python
app.include_router(data_sources.router)
```

---

## Part 2: Frontend Implementation

### Step 2.1: Create TypeScript Interfaces

**File**: `c:\Users\carla\unified-honey\uh-engine-app\uh-engine-app\service\frontend\src\types\dataSources.ts`

**Create new file**:

```typescript
export interface DatabaseInfo {
  name: string;
  owner: string;
  comment?: string;
  created_on: string;
}

export interface SchemaInfo {
  name: string;
  database_name: string;
  owner: string;
  comment?: string;
  created_on: string;
}

export interface TableInfo {
  name: string;
  database_name: string;
  schema_name: string;
  table_type: string;
  row_count?: number;
  bytes?: number;
  comment?: string;
}

export interface TableSelection {
  database: string;
  schema: string;
  table: string;
  selected: boolean;
}

export interface SavedSelection {
  database: string;
  schema: string;
  table: string;
  selected_at: string;
}
```

### Step 2.2: Create Data Sources Service

**File**: `c:\Users\carla\unified-honey\uh-engine-app\uh-engine-app\service\frontend\src\services\dataSourcesService.ts`

**Create new file**:

```typescript
import {
  DatabaseInfo,
  SchemaInfo,
  TableInfo,
  TableSelection,
  SavedSelection
} from '../types/dataSources';

const API_BASE = '/api/v1/data-sources';

export const dataSourcesService = {
  async getDatabases(): Promise<DatabaseInfo[]> {
    const response = await fetch(`${API_BASE}/databases`);
    if (!response.ok) throw new Error('Failed to fetch databases');
    const data = await response.json();
    return data.databases;
  },

  async getSchemas(databaseName: string): Promise<SchemaInfo[]> {
    const response = await fetch(`${API_BASE}/databases/${databaseName}/schemas`);
    if (!response.ok) throw new Error(`Failed to fetch schemas for ${databaseName}`);
    const data = await response.json();
    return data.schemas;
  },

  async getTables(databaseName: string, schemaName: string): Promise<TableInfo[]> {
    const response = await fetch(
      `${API_BASE}/databases/${databaseName}/schemas/${schemaName}/tables`
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch tables for ${databaseName}.${schemaName}`);
    }
    const data = await response.json();
    return data.tables;
  },

  async getSavedSelections(): Promise<SavedSelection[]> {
    const response = await fetch(`${API_BASE}/selections`);
    if (!response.ok) throw new Error('Failed to fetch saved selections');
    const data = await response.json();
    return data.selections;
  },

  async saveSelections(selections: TableSelection[]): Promise<string> {
    const response = await fetch(`${API_BASE}/selections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selections })
    });
    if (!response.ok) throw new Error('Failed to save selections');
    const data = await response.json();
    return data.message;
  },

  async verifyDatabaseAccess(databaseName: string): Promise<boolean> {
    const response = await fetch(`${API_BASE}/verify-access/${databaseName}`);
    if (!response.ok) return false;
    const data = await response.json();
    return data.has_access;
  }
};
```

### Step 2.3: Create Data Sources React Component

**File**: `c:\Users\carla\unified-honey\uh-engine-app\uh-engine-app\service\frontend\src\components\DataSources.tsx`

**Create new file**:

```typescript
import React, { useState, useEffect } from 'react';
import {
  DatabaseInfo,
  SchemaInfo,
  TableInfo,
  TableSelection
} from '../types/dataSources';
import { dataSourcesService } from '../services/dataSourcesService';
import './DataSources.css';

export const DataSources: React.FC = () => {
  // State management
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [selectedDatabase, setSelectedDatabase] = useState<string>('');
  const [schemas, setSchemas] = useState<SchemaInfo[]>([]);
  const [selectedSchema, setSelectedSchema] = useState<string>('');
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Load databases on mount
  useEffect(() => {
    loadDatabases();
    loadSavedSelections();
  }, []);

  const loadDatabases = async () => {
    setLoading(true);
    setError(null);
    try {
      const dbs = await dataSourcesService.getDatabases();
      setDatabases(dbs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load databases');
    } finally {
      setLoading(false);
    }
  };

  const loadSavedSelections = async () => {
    try {
      const selections = await dataSourcesService.getSavedSelections();
      const selected = new Set(
        selections.map(s => `${s.database}.${s.schema}.${s.table}`)
      );
      setSelectedTables(selected);
    } catch (err) {
      console.error('Failed to load saved selections:', err);
    }
  };

  const handleDatabaseChange = async (dbName: string) => {
    setSelectedDatabase(dbName);
    setSelectedSchema('');
    setTables([]);

    if (!dbName) return;

    setLoading(true);
    setError(null);
    try {
      const schemas = await dataSourcesService.getSchemas(dbName);
      setSchemas(schemas);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load schemas');
    } finally {
      setLoading(false);
    }
  };

  const handleSchemaChange = async (schemaName: string) => {
    setSelectedSchema(schemaName);

    if (!selectedDatabase || !schemaName) return;

    setLoading(true);
    setError(null);
    try {
      const tables = await dataSourcesService.getTables(selectedDatabase, schemaName);
      setTables(tables);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tables');
    } finally {
      setLoading(false);
    }
  };

  const toggleTableSelection = (tableFqn: string) => {
    const newSelection = new Set(selectedTables);
    if (newSelection.has(tableFqn)) {
      newSelection.delete(tableFqn);
    } else {
      newSelection.add(tableFqn);
    }
    setSelectedTables(newSelection);
  };

  const handleSaveSelections = async () => {
    setLoading(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const selections: TableSelection[] = Array.from(selectedTables).map(fqn => {
        const [database, schema, table] = fqn.split('.');
        return { database, schema, table, selected: true };
      });

      const message = await dataSourcesService.saveSelections(selections);
      setSuccessMessage(message);
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save selections');
    } finally {
      setLoading(false);
    }
  };

  const formatBytes = (bytes?: number): string => {
    if (!bytes) return 'Unknown';
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <div className="data-sources-container">
      <div className="header">
        <h1>Data Sources</h1>
        <p className="subtitle">
          Select databases and tables to analyze with Unified Honey
        </p>
      </div>

      {error && (
        <div className="alert alert-error">
          <strong>Error:</strong> {error}
        </div>
      )}

      {successMessage && (
        <div className="alert alert-success">
          {successMessage}
        </div>
      )}

      <div className="selection-panel">
        {/* Database Selector */}
        <div className="form-group">
          <label htmlFor="database-select">Database</label>
          <select
            id="database-select"
            value={selectedDatabase}
            onChange={(e) => handleDatabaseChange(e.target.value)}
            disabled={loading}
            className="form-control"
          >
            <option value="">Select a database...</option>
            {databases.map(db => (
              <option key={db.name} value={db.name}>
                {db.name} ({db.owner})
              </option>
            ))}
          </select>
          {databases.length === 0 && !loading && (
            <p className="help-text">
              No databases found. Please grant USAGE access to databases you want to analyze.
              <a href="/database-access-guide" target="_blank"> Learn how →</a>
            </p>
          )}
        </div>

        {/* Schema Selector */}
        {selectedDatabase && (
          <div className="form-group">
            <label htmlFor="schema-select">Schema</label>
            <select
              id="schema-select"
              value={selectedSchema}
              onChange={(e) => handleSchemaChange(e.target.value)}
              disabled={loading}
              className="form-control"
            >
              <option value="">Select a schema...</option>
              {schemas.map(schema => (
                <option key={schema.name} value={schema.name}>
                  {schema.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Tables List */}
        {tables.length > 0 && (
          <div className="tables-section">
            <h2>
              Tables in {selectedDatabase}.{selectedSchema}
              <span className="table-count">({tables.length} tables)</span>
            </h2>

            <div className="tables-list">
              {tables.map(table => {
                const fqn = `${table.database_name}.${table.schema_name}.${table.name}`;
                const isSelected = selectedTables.has(fqn);

                return (
                  <div
                    key={fqn}
                    className={`table-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => toggleTableSelection(fqn)}
                  >
                    <div className="table-checkbox">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleTableSelection(fqn)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>

                    <div className="table-info">
                      <div className="table-name">{table.name}</div>
                      <div className="table-meta">
                        <span className="table-type">{table.table_type}</span>
                        {table.row_count !== undefined && (
                          <span className="table-rows">
                            {table.row_count.toLocaleString()} rows
                          </span>
                        )}
                        {table.bytes && (
                          <span className="table-size">
                            {formatBytes(table.bytes)}
                          </span>
                        )}
                      </div>
                      {table.comment && (
                        <div className="table-comment">{table.comment}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        {selectedTables.size > 0 && (
          <div className="actions">
            <button
              onClick={handleSaveSelections}
              disabled={loading}
              className="btn btn-primary"
            >
              {loading ? 'Saving...' : `Save ${selectedTables.size} Selected Table(s)`}
            </button>
            <button
              onClick={() => setSelectedTables(new Set())}
              disabled={loading}
              className="btn btn-secondary"
            >
              Clear All
            </button>
          </div>
        )}
      </div>

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

### Step 2.4: Create Styles

**File**: `c:\Users\carla\unified-honey\uh-engine-app\uh-engine-app\service\frontend\src\components\DataSources.css`

**Create new file**:

```css
.data-sources-container {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
}

.header {
  margin-bottom: 32px;
}

.header h1 {
  font-size: 28px;
  font-weight: 600;
  color: #1a1a1a;
  margin-bottom: 8px;
}

.subtitle {
  font-size: 16px;
  color: #666;
}

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

.selection-panel {
  background: white;
  border-radius: 8px;
  padding: 24px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.form-group {
  margin-bottom: 20px;
}

.form-group label {
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
  margin-top: 8px;
  font-size: 13px;
  color: #666;
}

.help-text a {
  color: #0066cc;
  text-decoration: none;
}

.help-text a:hover {
  text-decoration: underline;
}

.tables-section {
  margin-top: 32px;
}

.tables-section h2 {
  font-size: 20px;
  font-weight: 600;
  margin-bottom: 16px;
  color: #1a1a1a;
}

.table-count {
  font-size: 14px;
  font-weight: 400;
  color: #666;
  margin-left: 8px;
}

.tables-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 500px;
  overflow-y: auto;
}

.table-item {
  display: flex;
  align-items: flex-start;
  padding: 12px;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.table-item:hover {
  background-color: #f8f9fa;
  border-color: #0066cc;
}

.table-item.selected {
  background-color: #e6f2ff;
  border-color: #0066cc;
}

.table-checkbox {
  margin-right: 12px;
  padding-top: 2px;
}

.table-checkbox input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
}

.table-info {
  flex: 1;
}

.table-name {
  font-size: 15px;
  font-weight: 500;
  color: #1a1a1a;
  margin-bottom: 4px;
}

.table-meta {
  display: flex;
  gap: 12px;
  font-size: 13px;
  color: #666;
  margin-bottom: 4px;
}

.table-type {
  background-color: #e8e8e8;
  padding: 2px 8px;
  border-radius: 3px;
  font-size: 11px;
  text-transform: uppercase;
}

.table-comment {
  font-size: 13px;
  color: #888;
  font-style: italic;
}

.actions {
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

### Step 2.5: Add Route to React Router

**File**: Update your routing file (likely `App.tsx` or `routes.tsx`)

**Add**:

```typescript
import { DataSources } from './components/DataSources';

// In your route configuration:
<Route path="/data-sources" element={<DataSources />} />
```

### Step 2.6: Add Navigation Link

Update your navigation menu to include:

```typescript
<Link to="/data-sources">Data Sources</Link>
```

---

## Part 3: Testing Procedure

### Step 3.1: Local Testing

1. **Rebuild Docker image**:
   ```bash
   cd c:/Users/carla/unified-honey/uh-engine-app/uh-engine-app
   docker buildx build --no-cache --platform=linux/amd64 -t goistmo-uswest.registry.snowflakecomputing.com/uh_engine_app_database/public/images/uh_engine_app_service ./service
   ```

2. **Push to Snowflake**:
   ```bash
   snow spcs image-registry login
   docker push goistmo-uswest.registry.snowflakecomputing.com/uh_engine_app_database/public/images/uh_engine_app_service
   ```

3. **Redeploy application**:
   ```bash
   snow app teardown --cascade
   snow app run
   ```

### Step 3.2: Grant Database Access

In Snowflake, run:

```sql
GRANT USAGE ON DATABASE <YOUR_TEST_DATABASE>
  TO APPLICATION UNIFIED_HONEY_APPLICATION;

GRANT USAGE ON SCHEMA <YOUR_TEST_DATABASE>.<YOUR_SCHEMA>
  TO APPLICATION UNIFIED_HONEY_APPLICATION;

GRANT SELECT ON ALL TABLES IN SCHEMA <YOUR_TEST_DATABASE>.<YOUR_SCHEMA>
  TO APPLICATION UNIFIED_HONEY_APPLICATION;
```

### Step 3.3: Test UI Flow

1. Open application in browser
2. Navigate to `/data-sources`
3. Verify databases appear in dropdown
4. Select a database
5. Verify schemas appear
6. Select a schema
7. Verify tables appear with metadata
8. Select some tables
9. Click "Save Selections"
10. Refresh page and verify selections persist

---

## Part 4: Deployment Checklist

- [ ] Backend API endpoints created (`data_sources.py`)
- [ ] SQL schema created (`data_sources.sql`)
- [ ] SQL schema added to `setup.sql`
- [ ] Router registered in `app.py`
- [ ] TypeScript interfaces created
- [ ] Data sources service created
- [ ] React component created
- [ ] CSS styles added
- [ ] Route added to router
- [ ] Navigation link added
- [ ] Docker image rebuilt and pushed
- [ ] Application redeployed
- [ ] Database access granted for testing
- [ ] UI tested end-to-end
- [ ] Documentation updated

---

## Part 5: Future Enhancements

### Phase 2 Features:
1. **Search/Filter**: Add search box to filter tables by name
2. **Bulk Actions**: Select all tables in a schema at once
3. **Table Preview**: Show sample data from selected tables
4. **Column Discovery**: Show columns and data types for each table
5. **Access Validation**: Real-time validation of table access
6. **Usage Analytics**: Track which tables are most commonly selected

### Phase 3 Features:
1. **Auto-Discovery**: Automatically detect new databases granted access
2. **Intelligent Suggestions**: Recommend tables based on naming patterns
3. **Lineage Tracking**: Show relationships between selected tables
4. **Permission Templates**: Pre-defined grant statements for common scenarios

---

## Summary

This plan provides a complete, production-ready implementation for database discovery and selection in your React-based Snowflake Native App. The hybrid approach (manual grants + discovery UI) works within Snowflake's limitations while providing a user-friendly experience.

**Key Benefits**:
- No dependence on unsupported DATABASE references
- Clean separation of concerns (backend API, frontend UI)
- Persistent selection storage
- Extensible architecture for future features
- Works with existing Snowflake permission model
