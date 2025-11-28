"""
API routes for managing Snowflake Native App references.
Allows discovering bound databases and exploring their structure.
"""
from fastapi import APIRouter, HTTPException
from typing import List, Dict
import logging
from core.references import (
    get_bound_databases,
    get_database_schemas,
    get_database_tables
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/references", tags=["references"])


@router.get("/databases")
async def list_bound_databases() -> Dict[str, List[Dict[str, str]]]:
    """
    Get list of databases that have been bound to this application.

    Returns:
        Dictionary with 'databases' key containing list of bound databases
    """
    try:
        databases = get_bound_databases()
        return {"databases": databases}
    except Exception as e:
        logger.error(f"Error listing bound databases: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/databases/{database_name}/schemas")
async def list_database_schemas(database_name: str) -> Dict[str, List[str]]:
    """
    Get list of schemas in a bound database.

    Args:
        database_name: Name of the database

    Returns:
        Dictionary with 'schemas' key containing list of schema names
    """
    try:
        schemas = get_database_schemas(database_name)
        return {"database": database_name, "schemas": schemas}
    except Exception as e:
        logger.error(f"Error listing schemas for {database_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/databases/{database_name}/schemas/{schema_name}/tables")
async def list_schema_tables(
    database_name: str,
    schema_name: str
) -> Dict[str, List[Dict[str, str]]]:
    """
    Get list of tables in a database schema.

    Args:
        database_name: Name of the database
        schema_name: Name of the schema

    Returns:
        Dictionary with 'tables' key containing list of table metadata
    """
    try:
        tables = get_database_tables(database_name, schema_name)
        return {
            "database": database_name,
            "schema": schema_name,
            "tables": tables
        }
    except Exception as e:
        logger.error(f"Error listing tables for {database_name}.{schema_name}: {e}")
        raise HTTPException(status_code=500, detail=str(e))
