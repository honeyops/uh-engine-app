"""
Openflow snapshot state management routes
"""

from fastapi import APIRouter, HTTPException
from typing import List, Dict, Any, Optional
from urllib.parse import unquote
import os
import logging
import httpx
from datetime import datetime

from api.schema.api_schema import (
    SnapshotStateCreateRequest,
    SnapshotStateUpdateRequest,
    SnapshotStateResponse,
    SnapshotStateListResponse,
    SnapshotStateCRUDResponse,
)
from core.snowflake import SnowflakeClient
from core.config import snowflake_data_table

router = APIRouter()
logger = logging.getLogger(__name__)

def _build_cdc_state_table_name() -> str:
    """
    Build fully-qualified table name for CDC state metadata using configuration.
    Raises error if configuration is incomplete (no fallback).
    """
    database = snowflake_data_table.get("database_name")
    schema = snowflake_data_table.get("schema_name")
    table = snowflake_data_table.get("table_name")

    if not database or not schema or not table:
        raise ValueError(
            "snowflake_data_table configuration incomplete. Cannot determine CDC table name."
        )

    return f"{database}.{schema}.{table}"

try:
    CDC_STATE_TABLE = _build_cdc_state_table_name()
except ValueError as e:
    logger.error(str(e))
    CDC_STATE_TABLE = None

# Webhook configuration
OPENFLOW_WEBHOOK_URL = os.getenv("OPENFLOW_WEBHOOK_URL", "")

async def _send_webhook_notification(
    event_type: str,
    database_name: str,
    schema_name: str,
    table_name: str,
    data: Optional[Dict[str, Any]] = None
):
    """
    Send webhook notification to Openflow when snapshot state changes.
    
    Args:
        event_type: Type of event ('created', 'updated', 'deleted')
        database_name: Database name
        schema_name: Schema name
        table_name: Table name
        data: Optional snapshot state data (for created/updated events)
    """
    if not OPENFLOW_WEBHOOK_URL:
        # Webhook not configured, skip silently
        return
    
    try:
        payload = {
            "event_type": event_type,
            "database_name": database_name,
            "schema_name": schema_name,
            "table_name": table_name,
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }
        
        if data:
            payload["data"] = data
        
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.post(
                OPENFLOW_WEBHOOK_URL,
                json=payload,
                headers={"Content-Type": "application/json"}
            )
            response.raise_for_status()
            logger.info(f"Webhook notification sent successfully for {event_type} event: {database_name}.{schema_name}.{table_name}")
    except httpx.TimeoutException:
        logger.warning(f"Webhook notification timeout for {event_type} event: {database_name}.{schema_name}.{table_name}")
    except httpx.HTTPStatusError as e:
        logger.warning(f"Webhook notification failed with status {e.response.status_code} for {event_type} event: {database_name}.{schema_name}.{table_name}")
    except Exception as e:
        logger.warning(f"Webhook notification error for {event_type} event: {database_name}.{schema_name}.{table_name}: {str(e)}")
        # Don't raise - webhook failures shouldn't break the main operation

def _row_to_dict(row: tuple, columns: List[str]) -> Dict[str, Any]:
    """Convert a Snowflake row tuple to a dictionary."""
    return dict(zip(columns, row))

def _get_columns_from_cursor(cursor) -> List[str]:
    """Extract column names from cursor description."""
    return [desc[0] for desc in cursor.description] if cursor.description else []

def _is_table_not_found_error(error: Exception) -> bool:
    """
    Check if an error indicates the table doesn't exist.
    Snowflake errors typically contain phrases like 'does not exist' or 'Object does not exist'.
    """
    error_str = str(error).lower()
    return (
        "does not exist" in error_str
        or "object does not exist" in error_str
        or "table" in error_str and "not found" in error_str
    )

@router.get("/openflow/snapshot-state", response_model=SnapshotStateListResponse)
async def list_snapshot_states():
    """
    List all snapshot states from the configured CDC_STATE_METADATA table.
    """
    if not CDC_STATE_TABLE:
        raise HTTPException(
            status_code=503,
            detail="Can't find OpenFlow configuration table"
        )
    
    try:
        with SnowflakeClient() as client:
            query = f"""
                SELECT
                    DATABASE_NAME,
                    SCHEMA_NAME,
                    TABLE_NAME,
                    ENABLED,
                    SNAPSHOT_REQUEST,
                    TABLE_DDL_INITIALIZE,
                    WATERMARK_COLUMN_PATTERNS,
                    WATERMARK_COLUMN,
                    LAST_SNAPSHOT_WATERMARK,
                    PRIMARY_KEY_COLUMNS,
                    CHUNKING_STRATEGY,
                    LAST_SNAPSHOT_TIMESTAMP,
                    SNAPSHOT_STATUS,
                    CREATED_AT,
                    UPDATED_AT
                FROM {CDC_STATE_TABLE}
                ORDER BY DATABASE_NAME, SCHEMA_NAME, TABLE_NAME
            """
            result = client.run(query)
            
            # Convert rows to dictionaries
            snapshot_states = []
            if result:
                # Get column names from the first row's structure
                # Snowflake returns rows as tuples, we need to map them
                columns = [
                    "DATABASE_NAME", "SCHEMA_NAME", "TABLE_NAME", "ENABLED",
                    "SNAPSHOT_REQUEST", "TABLE_DDL_INITIALIZE", "WATERMARK_COLUMN_PATTERNS",
                    "WATERMARK_COLUMN", "LAST_SNAPSHOT_WATERMARK",
                    "PRIMARY_KEY_COLUMNS", "CHUNKING_STRATEGY",
                    "LAST_SNAPSHOT_TIMESTAMP", "SNAPSHOT_STATUS",
                    "CREATED_AT", "UPDATED_AT"
                ]
                
                for row in result:
                    row_dict = dict(zip(columns, row))
                    # Convert to response format
                    snapshot_states.append(SnapshotStateResponse(
                        database_name=row_dict.get("DATABASE_NAME", ""),
                        schema_name=row_dict.get("SCHEMA_NAME", ""),
                        table_name=row_dict.get("TABLE_NAME", ""),
                        enabled=row_dict.get("ENABLED"),
                        snapshot_request=row_dict.get("SNAPSHOT_REQUEST"),
                        table_ddl_initialize=row_dict.get("TABLE_DDL_INITIALIZE"),
                        watermark_column_pattern=row_dict.get("WATERMARK_COLUMN_PATTERNS"),
                        watermark_column=row_dict.get("WATERMARK_COLUMN"),
                        primary_key_columns=row_dict.get("PRIMARY_KEY_COLUMNS"),
                        chunking_strategy=row_dict.get("CHUNKING_STRATEGY"),
                        last_snapshot_watermark=str(row_dict.get("LAST_SNAPSHOT_WATERMARK")) if row_dict.get("LAST_SNAPSHOT_WATERMARK") else None,
                        last_snapshot_timestamp=str(row_dict.get("LAST_SNAPSHOT_TIMESTAMP")) if row_dict.get("LAST_SNAPSHOT_TIMESTAMP") else None,
                        snapshot_status=row_dict.get("SNAPSHOT_STATUS"),
                        created_at=str(row_dict.get("CREATED_AT")) if row_dict.get("CREATED_AT") else None,
                        updated_at=str(row_dict.get("UPDATED_AT")) if row_dict.get("UPDATED_AT") else None,
                    ))
            
            return SnapshotStateListResponse(
                message="Retrieved snapshot states successfully",
                snapshot_states=snapshot_states
            )
    except HTTPException:
        raise
    except Exception as e:
        if _is_table_not_found_error(e):
            raise HTTPException(
                status_code=503,
                detail="Can't find OpenFlow configuration table"
            )
        raise HTTPException(status_code=500, detail=f"Failed to retrieve snapshot states: {str(e)}")

@router.get("/openflow/snapshot-state/{database_name}/{schema_name}/{table_name}", response_model=SnapshotStateResponse)
async def get_snapshot_state(database_name: str, schema_name: str, table_name: str):
    """
    Get a single snapshot state by composite primary key.
    """
    if not CDC_STATE_TABLE:
        raise HTTPException(
            status_code=503,
            detail="Can't find OpenFlow configuration table"
        )
    
    try:
        # URL decode the parameters
        database_name = unquote(database_name)
        schema_name = unquote(schema_name)
        table_name = unquote(table_name)
        
        with SnowflakeClient() as client:
            # Use proper identifier quoting for safety
            query = f"""
                SELECT
                    DATABASE_NAME,
                    SCHEMA_NAME,
                    TABLE_NAME,
                    ENABLED,
                    SNAPSHOT_REQUEST,
                    TABLE_DDL_INITIALIZE,
                    WATERMARK_COLUMN_PATTERNS,
                    WATERMARK_COLUMN,
                    LAST_SNAPSHOT_WATERMARK,
                    PRIMARY_KEY_COLUMNS,
                    CHUNKING_STRATEGY,
                    LAST_SNAPSHOT_TIMESTAMP,
                    SNAPSHOT_STATUS,
                    CREATED_AT,
                    UPDATED_AT
                FROM {CDC_STATE_TABLE}
                WHERE DATABASE_NAME = '{database_name.replace("'", "''")}'
                  AND SCHEMA_NAME = '{schema_name.replace("'", "''")}'
                  AND TABLE_NAME = '{table_name.replace("'", "''")}'
            """
            result = client.run(query)
            
            if not result or len(result) == 0:
                raise HTTPException(
                    status_code=404,
                    detail=f"Snapshot state not found for {database_name}.{schema_name}.{table_name}"
                )
            
            columns = [
                "DATABASE_NAME", "SCHEMA_NAME", "TABLE_NAME", "ENABLED",
                "SNAPSHOT_REQUEST", "TABLE_DDL_INITIALIZE", "WATERMARK_COLUMN_PATTERNS",
                "WATERMARK_COLUMN", "LAST_SNAPSHOT_WATERMARK",
                "PRIMARY_KEY_COLUMNS", "CHUNKING_STRATEGY",
                "LAST_SNAPSHOT_TIMESTAMP", "SNAPSHOT_STATUS",
                "CREATED_AT", "UPDATED_AT"
            ]

            row_dict = dict(zip(columns, result[0]))

            return SnapshotStateResponse(
                database_name=row_dict.get("DATABASE_NAME", ""),
                schema_name=row_dict.get("SCHEMA_NAME", ""),
                table_name=row_dict.get("TABLE_NAME", ""),
                enabled=row_dict.get("ENABLED"),
                snapshot_request=row_dict.get("SNAPSHOT_REQUEST"),
                table_ddl_initialize=row_dict.get("TABLE_DDL_INITIALIZE"),
                watermark_column_pattern=row_dict.get("WATERMARK_COLUMN_PATTERNS"),
                watermark_column=row_dict.get("WATERMARK_COLUMN"),
                primary_key_columns=row_dict.get("PRIMARY_KEY_COLUMNS"),
                chunking_strategy=row_dict.get("CHUNKING_STRATEGY"),
                last_snapshot_watermark=str(row_dict.get("LAST_SNAPSHOT_WATERMARK")) if row_dict.get("LAST_SNAPSHOT_WATERMARK") else None,
                last_snapshot_timestamp=str(row_dict.get("LAST_SNAPSHOT_TIMESTAMP")) if row_dict.get("LAST_SNAPSHOT_TIMESTAMP") else None,
                snapshot_status=row_dict.get("SNAPSHOT_STATUS"),
                created_at=str(row_dict.get("CREATED_AT")) if row_dict.get("CREATED_AT") else None,
                updated_at=str(row_dict.get("UPDATED_AT")) if row_dict.get("UPDATED_AT") else None,
            )
    except HTTPException:
        raise
    except Exception as e:
        if _is_table_not_found_error(e):
            raise HTTPException(
                status_code=503,
                detail="Can't find OpenFlow configuration table"
            )
        raise HTTPException(status_code=500, detail=f"Failed to retrieve snapshot state: {str(e)}")

@router.post("/openflow/snapshot-state", response_model=SnapshotStateCRUDResponse)
async def create_snapshot_state(request: SnapshotStateCreateRequest):
    """
    Create a new snapshot state record.
    """
    if not CDC_STATE_TABLE:
        raise HTTPException(
            status_code=503,
            detail="Can't find OpenFlow configuration table"
        )
    
    try:
        with SnowflakeClient() as client:
            # Check if record already exists
            db_name = request.database_name.replace("'", "''")
            schema_name = request.schema_name.replace("'", "''")
            table_name = request.table_name.replace("'", "''")
            
            check_query = f"""
                SELECT COUNT(*) as cnt
                FROM {CDC_STATE_TABLE}
                WHERE DATABASE_NAME = '{db_name}'
                  AND SCHEMA_NAME = '{schema_name}'
                  AND TABLE_NAME = '{table_name}'
            """
            check_result = client.run(check_query)
            
            if check_result and len(check_result) > 0 and check_result[0][0] > 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"Snapshot state already exists for {request.database_name}.{request.schema_name}.{request.table_name}"
                )
            
            # Insert new record - escape single quotes in string values
            enabled_val = "TRUE" if (request.enabled if request.enabled is not None else False) else "FALSE"
            snapshot_request_val = "TRUE" if (request.snapshot_request if request.snapshot_request is not None else False) else "FALSE"
            table_ddl_init_val = "TRUE" if (request.table_ddl_initialize if request.table_ddl_initialize is not None else False) else "FALSE"
            # Escape single quotes by replacing ' with '' for SQL
            sq = "'"  # single quote character
            pattern_val = f"'{request.watermark_column_pattern.replace(sq, sq + sq)}'" if request.watermark_column_pattern else "NULL"
            watermark_val = f"'{request.watermark_column.replace(sq, sq + sq)}'" if request.watermark_column else "NULL"
            pk_cols_val = f"'{request.primary_key_columns.replace(sq, sq + sq)}'" if request.primary_key_columns else "NULL"
            chunking_val = f"'{request.chunking_strategy.replace(sq, sq + sq)}'" if request.chunking_strategy else "'primary_key'"

            insert_query = f"""
                INSERT INTO {CDC_STATE_TABLE} (
                    DATABASE_NAME,
                    SCHEMA_NAME,
                    TABLE_NAME,
                    ENABLED,
                    SNAPSHOT_REQUEST,
                    TABLE_DDL_INITIALIZE,
                    WATERMARK_COLUMN_PATTERNS,
                    WATERMARK_COLUMN,
                    PRIMARY_KEY_COLUMNS,
                    CHUNKING_STRATEGY
                ) VALUES (
                    '{db_name}',
                    '{schema_name}',
                    '{table_name}',
                    {enabled_val},
                    {snapshot_request_val},
                    {table_ddl_init_val},
                    {pattern_val},
                    {watermark_val},
                    {pk_cols_val},
                    {chunking_val}
                )
            """
            client.run(insert_query)
            
            # Send webhook notification
            snapshot_data = {
                "database_name": request.database_name,
                "schema_name": request.schema_name,
                "table_name": request.table_name,
                "enabled": request.enabled if request.enabled is not None else False,
                "snapshot_request": request.snapshot_request if request.snapshot_request is not None else False,
                "table_ddl_initialize": request.table_ddl_initialize if request.table_ddl_initialize is not None else False,
                "watermark_column_pattern": request.watermark_column_pattern,
                "watermark_column": request.watermark_column,
                "primary_key_columns": request.primary_key_columns,
                "chunking_strategy": request.chunking_strategy if request.chunking_strategy is not None else "primary_key",
            }
            await _send_webhook_notification(
                "created",
                request.database_name,
                request.schema_name,
                request.table_name,
                snapshot_data
            )
            
            return SnapshotStateCRUDResponse(
                message=f"Snapshot state created successfully for {request.database_name}.{request.schema_name}.{request.table_name}",
                database_name=request.database_name,
                schema_name=request.schema_name,
                table_name=request.table_name
            )
    except HTTPException:
        raise
    except Exception as e:
        if _is_table_not_found_error(e):
            raise HTTPException(
                status_code=503,
                detail="Can't find OpenFlow configuration table"
            )
        raise HTTPException(status_code=500, detail=f"Failed to create snapshot state: {str(e)}")

@router.put("/openflow/snapshot-state/{database_name}/{schema_name}/{table_name}", response_model=SnapshotStateCRUDResponse)
async def update_snapshot_state(
    database_name: str,
    schema_name: str,
    table_name: str,
    request: SnapshotStateUpdateRequest
):
    """
    Update an existing snapshot state record.
    """
    if not CDC_STATE_TABLE:
        raise HTTPException(
            status_code=503,
            detail="Can't find OpenFlow configuration table"
        )
    
    try:
        # URL decode the parameters
        database_name = unquote(database_name)
        schema_name = unquote(schema_name)
        table_name = unquote(table_name)
        
        with SnowflakeClient() as client:
            # Escape single quotes for WHERE clause
            db_name = database_name.replace("'", "''")
            schema_name_escaped = schema_name.replace("'", "''")
            table_name_escaped = table_name.replace("'", "''")
            
            # Check if record exists
            check_query = f"""
                SELECT COUNT(*) as cnt
                FROM {CDC_STATE_TABLE}
                WHERE DATABASE_NAME = '{db_name}'
                  AND SCHEMA_NAME = '{schema_name_escaped}'
                  AND TABLE_NAME = '{table_name_escaped}'
            """
            check_result = client.run(check_query)
            
            if not check_result or len(check_result) == 0 or check_result[0][0] == 0:
                raise HTTPException(
                    status_code=404,
                    detail=f"Snapshot state not found for {database_name}.{schema_name}.{table_name}"
                )
            
            # Build update query dynamically based on provided fields
            update_fields = []

            if request.enabled is not None:
                enabled_val = "TRUE" if request.enabled else "FALSE"
                update_fields.append(f"ENABLED = {enabled_val}")

            if request.snapshot_request is not None:
                snapshot_request_val = "TRUE" if request.snapshot_request else "FALSE"
                update_fields.append(f"SNAPSHOT_REQUEST = {snapshot_request_val}")

            if request.table_ddl_initialize is not None:
                table_ddl_init_val = "TRUE" if request.table_ddl_initialize else "FALSE"
                update_fields.append(f"TABLE_DDL_INITIALIZE = {table_ddl_init_val}")

            # Escape single quotes by replacing ' with '' for SQL
            sq = "'"  # single quote character
            if request.watermark_column_pattern is not None:
                pattern_val = f"'{request.watermark_column_pattern.replace(sq, sq + sq)}'"
                update_fields.append(f"WATERMARK_COLUMN_PATTERNS = {pattern_val}")

            if request.watermark_column is not None:
                watermark_val = f"'{request.watermark_column.replace(sq, sq + sq)}'"
                update_fields.append(f"WATERMARK_COLUMN = {watermark_val}")

            if request.primary_key_columns is not None:
                pk_cols_val = f"'{request.primary_key_columns.replace(sq, sq + sq)}'"
                update_fields.append(f"PRIMARY_KEY_COLUMNS = {pk_cols_val}")

            if request.chunking_strategy is not None:
                chunking_val = f"'{request.chunking_strategy.replace(sq, sq + sq)}'"
                update_fields.append(f"CHUNKING_STRATEGY = {chunking_val}")
            
            if not update_fields:
                raise HTTPException(
                    status_code=400,
                    detail="No fields provided to update"
                )
            
            # Always update UPDATED_AT
            update_fields.append("UPDATED_AT = CURRENT_TIMESTAMP()")
            
            update_query = f"""
                UPDATE {CDC_STATE_TABLE}
                SET {', '.join(update_fields)}
                WHERE DATABASE_NAME = '{db_name}'
                  AND SCHEMA_NAME = '{schema_name_escaped}'
                  AND TABLE_NAME = '{table_name_escaped}'
            """
            
            client.run(update_query)
            
            # Get updated record for webhook notification
            updated_query = f"""
                SELECT
                    DATABASE_NAME,
                    SCHEMA_NAME,
                    TABLE_NAME,
                    ENABLED,
                    SNAPSHOT_REQUEST,
                    TABLE_DDL_INITIALIZE,
                    WATERMARK_COLUMN_PATTERNS,
                    WATERMARK_COLUMN,
                    PRIMARY_KEY_COLUMNS,
                    CHUNKING_STRATEGY
                FROM {CDC_STATE_TABLE}
                WHERE DATABASE_NAME = '{db_name}'
                  AND SCHEMA_NAME = '{schema_name_escaped}'
                  AND TABLE_NAME = '{table_name_escaped}'
            """
            updated_result = client.run(updated_query)

            # Send webhook notification
            if updated_result and len(updated_result) > 0:
                columns = [
                    "DATABASE_NAME", "SCHEMA_NAME", "TABLE_NAME", "ENABLED",
                    "SNAPSHOT_REQUEST", "TABLE_DDL_INITIALIZE", "WATERMARK_COLUMN_PATTERNS",
                    "WATERMARK_COLUMN", "PRIMARY_KEY_COLUMNS", "CHUNKING_STRATEGY"
                ]
                row_dict = dict(zip(columns, updated_result[0]))
                snapshot_data = {
                    "database_name": row_dict.get("DATABASE_NAME", ""),
                    "schema_name": row_dict.get("SCHEMA_NAME", ""),
                    "table_name": row_dict.get("TABLE_NAME", ""),
                    "enabled": row_dict.get("ENABLED"),
                    "snapshot_request": row_dict.get("SNAPSHOT_REQUEST"),
                    "table_ddl_initialize": row_dict.get("TABLE_DDL_INITIALIZE"),
                    "watermark_column_pattern": row_dict.get("WATERMARK_COLUMN_PATTERNS"),
                    "watermark_column": row_dict.get("WATERMARK_COLUMN"),
                    "primary_key_columns": row_dict.get("PRIMARY_KEY_COLUMNS"),
                    "chunking_strategy": row_dict.get("CHUNKING_STRATEGY"),
                }
                await _send_webhook_notification(
                    "updated",
                    database_name,
                    schema_name,
                    table_name,
                    snapshot_data
                )
            
            return SnapshotStateCRUDResponse(
                message=f"Snapshot state updated successfully for {database_name}.{schema_name}.{table_name}",
                database_name=database_name,
                schema_name=schema_name,
                table_name=table_name
            )
    except HTTPException:
        raise
    except Exception as e:
        if _is_table_not_found_error(e):
            raise HTTPException(
                status_code=503,
                detail="Can't find OpenFlow configuration table"
            )
        raise HTTPException(status_code=500, detail=f"Failed to update snapshot state: {str(e)}")

@router.delete("/openflow/snapshot-state/{database_name}/{schema_name}/{table_name}", response_model=SnapshotStateCRUDResponse)
async def delete_snapshot_state(database_name: str, schema_name: str, table_name: str):
    """
    Delete a snapshot state record.
    """
    if not CDC_STATE_TABLE:
        raise HTTPException(
            status_code=503,
            detail="Can't find OpenFlow configuration table"
        )
    
    try:
        # URL decode the parameters
        database_name = unquote(database_name)
        schema_name = unquote(schema_name)
        table_name = unquote(table_name)
        
        with SnowflakeClient() as client:
            # Escape single quotes for WHERE clause
            db_name = database_name.replace("'", "''")
            schema_name_escaped = schema_name.replace("'", "''")
            table_name_escaped = table_name.replace("'", "''")
            
            # Check if record exists
            check_query = f"""
                SELECT COUNT(*) as cnt
                FROM {CDC_STATE_TABLE}
                WHERE DATABASE_NAME = '{db_name}'
                  AND SCHEMA_NAME = '{schema_name_escaped}'
                  AND TABLE_NAME = '{table_name_escaped}'
            """
            check_result = client.run(check_query)
            
            if not check_result or len(check_result) == 0 or check_result[0][0] == 0:
                raise HTTPException(
                    status_code=404,
                    detail=f"Snapshot state not found for {database_name}.{schema_name}.{table_name}"
                )
            
            # Delete record
            delete_query = f"""
                DELETE FROM {CDC_STATE_TABLE}
                WHERE DATABASE_NAME = '{db_name}'
                  AND SCHEMA_NAME = '{schema_name_escaped}'
                  AND TABLE_NAME = '{table_name_escaped}'
            """
            client.run(delete_query)
            
            # Send webhook notification
            await _send_webhook_notification(
                "deleted",
                database_name,
                schema_name,
                table_name
            )
            
            return SnapshotStateCRUDResponse(
                message=f"Snapshot state deleted successfully for {database_name}.{schema_name}.{table_name}",
                database_name=database_name,
                schema_name=schema_name,
                table_name=table_name
            )
    except HTTPException:
        raise
    except Exception as e:
        if _is_table_not_found_error(e):
            raise HTTPException(
                status_code=503,
                detail="Can't find OpenFlow configuration table"
            )
        raise HTTPException(status_code=500, detail=f"Failed to delete snapshot state: {str(e)}")

