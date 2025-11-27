"""
Utility routes for database validation and source metadata
"""

from fastapi import APIRouter, HTTPException, Query, Body
from fastapi.responses import StreamingResponse
from typing import Optional, Dict, Any, List, AsyncGenerator
from pydantic import BaseModel
import time
import json
import os
import logging
from datetime import datetime

from api.schema.api_schema import SourceMetadataResponse, DatabaseValidateResponse
from core.snowflake import SnowflakeClient
from core.config import output_database, snowflake_data_table
from core.deployment_logs import persist_deployment_log
from core.config_loader import dimensional_models_loader, blueprints_loader
from core.sql_render import SQLRenderer

router = APIRouter()

# Initialize logger for deployment logs
logger = logging.getLogger("model_deployment")

# Mapping of Snowflake object types to the privilege we grant for data access
OBJECT_PRIVILEGE_MAP = {
    "TABLE": "SELECT",
    "VIEW": "SELECT",
    "STREAM": "SELECT",
    "TASK": "OPERATE",
}

def _format_identifier(value: str) -> str:
    """
    Quote and escape a Snowflake identifier.
    """
    if value is None:
        return ""
    escaped = value.replace('"', '""')
    return f'"{escaped}"'


def _ensure_role_exists(client: SnowflakeClient, role_name: str) -> None:
    """
    Create a Snowflake role if it doesn't already exist.
    """
    if not role_name:
        return
    try:
        client.run(f"CREATE ROLE IF NOT EXISTS {_format_identifier(role_name.upper())}")
    except Exception as e:
        logger.warning(f"Could not ensure role {role_name} exists: {str(e)}")


def _grant_access_to_object(
    client: SnowflakeClient,
    object_type: str,
    database: str,
    schema: str,
    object_name: Optional[str],
    roles: Optional[List[str]]
) -> None:
    """
    Grant read/operate access on a Snowflake object to the configured roles.
    Also grants USAGE on database and schema if not already granted.
    """
    if not roles or not object_name:
        return

    privilege = OBJECT_PRIVILEGE_MAP.get(object_type.upper())
    if not privilege:
        return

    fully_qualified = (
        f"{_format_identifier(database.upper())}."
        f"{_format_identifier(schema.upper())}."
        f"{_format_identifier(object_name.upper())}"
    )

    for role in roles:
        if not role:
            continue
        role_upper = role.upper()
        _ensure_role_exists(client, role_upper)

        # Grant USAGE on database and schema first (idempotent, will succeed if already granted)
        try:
            client.run(
                f"GRANT USAGE ON DATABASE {_format_identifier(database.upper())} "
                f"TO ROLE {_format_identifier(role_upper)}"
            )
        except Exception as e:
            logger.warning(
                f"Could not grant USAGE on database {database} to role {role_upper}: {str(e)}"
            )

        try:
            client.run(
                f"GRANT USAGE ON SCHEMA {_format_identifier(database.upper())}."
                f"{_format_identifier(schema.upper())} "
                f"TO ROLE {_format_identifier(role_upper)}"
            )
        except Exception as e:
            logger.warning(
                f"Could not grant USAGE on schema {database}.{schema} to role {role_upper}: {str(e)}"
            )

        # Grant object-level privilege
        try:
            client.run(
                f"GRANT {privilege} ON {object_type.upper()} {fully_qualified} "
                f"TO ROLE {_format_identifier(role_upper)}"
            )
        except Exception as e:
            logger.warning(
                f"Could not grant {privilege} on {object_type.upper()} {fully_qualified} "
                f"to role {role_upper}: {str(e)}"
            )

# Database validation routes
@router.post("/database/validate", response_model=DatabaseValidateResponse)
async def validate_database():
    """
    Validate that the output database exists in Snowflake with all 3 required schemas.
    
    Checks:
    - Database from output_database["database_name"] exists in Snowflake
    - Database contains all 3 required schemas: storage, modelling, semantic
    
    Returns:
        {
            "valid": bool,
            "database_name": str,
            "database_exists": bool,
            "missing_schemas": [str],
            "existing_schemas": [str]
        }
    """
    try:
        # Get database name and expected schemas from config
        db_name = output_database["database_name"].upper().strip()
        expected_schemas = [
            output_database["storage_schema_name"].upper().strip(),
            output_database["modelling_schema_name"].upper().strip(),
            output_database["semantic_schema_name"].upper().strip()
        ]

        with SnowflakeClient() as client:
            # Check if database exists
            db_result = client.run(f"SHOW DATABASES LIKE '{db_name}'")
            database_exists = len(db_result) > 0

            # If database doesn't exist, return early
            if not database_exists:
                return {
                    "valid": False,
                    "database_exists": False,
                    "database_name": db_name,
                    "missing_schemas": expected_schemas,
                    "existing_schemas": []
                }

            # Check schemas in the database
            schema_result = client.run(f"SHOW SCHEMAS IN DATABASE {db_name}")
            # Schema name is in the second column (index 1) of SHOW SCHEMAS result
            existing_schemas = [row[1].upper() for row in schema_result]

            # Compare expected vs existing schemas (case-insensitive)
            missing_schemas = [s for s in expected_schemas if s not in existing_schemas]

            return {
                "valid": len(missing_schemas) == 0,
                "database_exists": True,
                "database_name": db_name,
                "missing_schemas": missing_schemas,
                "existing_schemas": existing_schemas
            }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to validate database: {str(e)}")

# Source metadata routes
@router.get("/sources/warmup")
async def warmup_connection_pool():
    """
    Warmup endpoint to pre-establish the Snowflake connection pool.
    Call this when the app loads to make subsequent requests instant.

    Returns:
        Connection status and timing
    """
    start = time.time()

    try:
        with SnowflakeClient() as client:
            # Simple query to verify connection works
            client.run("SELECT 1")

        elapsed_ms = (time.time() - start) * 1000

        return {
            "status": "ready",
            "message": "Connection pool warmed up successfully",
            "elapsed_ms": round(elapsed_ms, 2),
            "note": "Subsequent requests will be much faster"
        }

    except Exception as e:
        elapsed_ms = (time.time() - start) * 1000
        raise HTTPException(
            status_code=500,
            detail=f"Failed to warm up connection pool after {elapsed_ms:.2f}ms: {str(e)}"
        )

@router.get("/sources/metadata/databases")
async def list_databases():
    """
    List all databases accessible to the current user.
    
    Returns:
        List of database names (strings)
    """
    try:
        with SnowflakeClient() as client:
            result = client.run("SHOW DATABASES")
            
            # Return just the database names as a sorted list
            databases = sorted([str(row[1]).upper() for row in result if len(row) > 1])
            
            return databases
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list databases: {str(e)}")

@router.get("/sources/metadata/schemas")
async def list_schemas(db: str = Query(..., description="Database name")):
    """
    List all schemas in the specified database.
    
    Args:
        db: Database name
    
    Returns:
        List of schema names (strings)
    """
    try:
        with SnowflakeClient() as client:
            result = client.run(f"SHOW SCHEMAS IN DATABASE {db}")
            
            # Return just the schema names as a sorted list
            schemas = sorted([str(row[1]).upper() for row in result if len(row) > 1])
            
            return schemas
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list schemas: {str(e)}")

@router.get("/sources/metadata/tables")
async def list_tables(
    db: str = Query(..., description="Database name"),
    schema: str = Query(..., description="Schema name")
):
    """
    List all tables in the specified database and schema.

    Args:
        db: Database name
        schema: Schema name

    Returns:
        List of table names (strings)
    """
    try:
        with SnowflakeClient() as client:
            result = client.run(f"SHOW TABLES IN SCHEMA {db}.{schema}")

            # Return just the table names as a sorted list
            tables = sorted([str(row[1]).upper() for row in result if len(row) > 1])

            return tables

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list tables: {str(e)}")

@router.get("/sources/metadata/columns", response_model=SourceMetadataResponse)
async def list_columns(
    db: str = Query(..., description="Database name"),
    schema: str = Query(..., description="Schema name"),
    table: str = Query(..., description="Table name")
):
    """
    List all columns in the specified table.
    
    Args:
        db: Database name
        schema: Schema name
        table: Table name
    
    Returns:
        SourceMetadataResponse with list of columns
    """
    try:
        with SnowflakeClient() as client:
            result = client.run(f"DESCRIBE TABLE {db}.{schema}.{table}")
            
            columns = []
            for row in result:
                columns.append({
                    "name": row[0],  # COLUMN_NAME column
                    "type": row[1],  # DATA_TYPE column
                    "nullable": row[2] == "Y" if row[2] else False,  # NULLABLE column
                    "default": row[3] if row[3] else None,  # DEFAULT column
                    "comment": row[4] if row[4] else None  # COMMENT column
                })
            
            return SourceMetadataResponse(
                message=f"Found {len(columns)} columns in {db}.{schema}.{table}",
                data=columns
            )
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list columns: {str(e)}")

# ============================================================================
# DIMENSIONAL MODEL DEPLOYMENT CALCULATION
# ============================================================================

class ModelDeploymentSummaryRequest(BaseModel):
    """Request model for calculating deployment summary"""
    model_ids: List[str]

@router.post("/dimensional-models/deployment-summary", response_model=Dict[str, Any])
async def calculate_deployment_summary(request: ModelDeploymentSummaryRequest):
    """
    Calculate what needs to be deployed for one or more dimensional models.
    
    For each model, returns:
    - Staging: Stage views to deploy
    - Data processing: Streams and tasks to deploy
    - Key storage: Node deployments (with count)
    - Build Relationships: Edge deployments (with count)
    - Data storage: Attributes to deploy (with count)
    - Supporting artefacts: Other objects to deploy
    - Model deployment: The dimension or fact view to deploy
    - Seed load: Full refresh capability
    
    Returns a user-friendly list per model for display in the model-catalog modal.
    """
    try:
        # Load dimensional models config
        dim_config = dimensional_models_loader.get_all()
        dimensions = dim_config.get("dimensions", [])
        facts = dim_config.get("facts", [])
        
        # Load blueprints config
        blueprints_config = blueprints_loader.get_all()
        
        # Combine all models
        all_models = dimensions + facts
        
        # Normalize model IDs for case-insensitive matching
        requested_ids_lower = [mid.lower() for mid in request.model_ids]
        
        # Filter to requested models (case-insensitive)
        selected_models = [
            m for m in all_models 
            if m.get("id", "").lower() in requested_ids_lower
        ]
        
        if not selected_models:
            # Return helpful error message with available IDs
            available_ids = [m.get("id") for m in all_models]
            return {
                "message": f"No models found for the provided IDs: {request.model_ids}. Available IDs: {available_ids[:20]}",
                "models": [],
                "requested_ids": request.model_ids,
                "available_ids": available_ids
            }
        
        models_summary = []
        
        for model in selected_models:
            model_id = model.get("id")
            model_type = "dimension" if model in dimensions else "fact"
            model_name = model.get("name", model_id)
            
            # Collect all blueprints referenced by this model
            blueprint_keys = set()
            
            # For dimensions: get blueprint from source.attribute_table
            if model_type == "dimension":
                source = model.get("source", {})
                attr_table = source.get("attribute_table", {})
                if attr_table:
                    blueprint_id = attr_table.get("name")
                    attr_source = attr_table.get("source")
                    if blueprint_id and attr_source:
                        blueprint_key = f"{attr_source}.{blueprint_id}"
                        blueprint_keys.add(blueprint_key)
            
            # For facts: get blueprint from attributes.attribute_table
            elif model_type == "fact":
                attributes = model.get("attributes", {})
                attr_table = attributes.get("attribute_table", {})
                if attr_table:
                    blueprint_id = attr_table.get("name")
                    attr_source = attr_table.get("source")
                    if blueprint_id and attr_source:
                        blueprint_key = f"{attr_source}.{blueprint_id}"
                        blueprint_keys.add(blueprint_key)
            
            # Also extract from blueprint_mapping in columns (for additional blueprints if any)
            columns = model.get("columns", [])
            for col in columns:
                mapping = col.get("blueprint_mapping") or col.get("source")
                if mapping and isinstance(mapping, str) and "." in mapping:
                    parts = mapping.split(".")
                    if len(parts) >= 2:
                        source = parts[0]
                        blueprint_name = parts[1]
                        blueprint_keys.add(f"{source}.{blueprint_name}")
            
            # If no blueprints found, this is an error
            if not blueprint_keys:
                raise ValueError(
                    f"Model '{model_id}' ({model_type}) does not reference any blueprints. "
                    f"Check source.attribute_table for dimensions or attributes.attribute_table for facts."
                )
            
            # Calculate deployment items for each blueprint
            staging_views = []
            streams = []
            tasks = []
            nodes = []
            edges = []
            attributes = []
            supporting_artefacts = []
            
            # Get blueprint details - find blueprints that match the keys we found
            sources_list = blueprints_config.get("sources", [])
            found_blueprints = []
            
            for source_obj in sources_list:
                source_name = source_obj.get("source")
                blueprints_list = source_obj.get("blueprints", [])
                
                for bp in blueprints_list:
                    bp_id = bp.get("id")
                    if bp_id:
                        key = f"{source_name}.{bp_id}"
                        if key in blueprint_keys:
                            found_blueprints.append({
                                "blueprint": bp,
                                "source": source_name,
                                "blueprint_id": bp_id,
                                "key": key
                            })
            
            # If no blueprints found, raise error with helpful message
            if not found_blueprints:
                available_blueprints = []
                for source_obj in sources_list:
                    source_name = source_obj.get("source")
                    for bp in source_obj.get("blueprints", []):
                        bp_id = bp.get("id")
                        if bp_id:
                            available_blueprints.append(f"{source_name}.{bp_id}")
                
                raise ValueError(
                    f"Model '{model_id}' references blueprints {list(blueprint_keys)}, "
                    f"but none were found in the blueprints configuration. "
                    f"Available blueprints: {available_blueprints[:20]}"
                )
            
            # Collect blueprint info for seed_load
            blueprint_info_for_seed = []
            
            # Process each found blueprint
            for bp_info in found_blueprints:
                bp = bp_info["blueprint"]
                source_name = bp_info["source"]
                bp_id = bp_info["blueprint_id"]
                binding_object = bp.get("binding_object", "")
                
                if not binding_object:
                    # Skip if no binding_object
                    continue
                
                # Collect info for seed_load
                blueprint_info_for_seed.append({
                    "blueprint_id": bp_id,
                    "source": source_name,
                    "binding_object": binding_object
                })
                
                # Staging: Stage view
                staging_views.append({
                    "name": f"VIEW_{binding_object.upper()}",
                    "blueprint_id": bp_id,
                    "source": source_name
                })
                
                # Data processing: Stream and Task
                streams.append({
                    "name": f"STREAM_{binding_object.upper()}",
                    "blueprint_id": bp_id,
                    "source": source_name
                })
                tasks.append({
                    "name": f"TASK_{binding_object.upper()}",
                    "blueprint_id": bp_id,
                    "source": source_name
                })
                
                # Key storage: Nodes
                primary_node = bp.get("primary_node", {})
                if primary_node and primary_node.get("node"):
                    node_name = primary_node.get("node", "").upper()
                    nodes.append({
                        "name": f"NODE_{node_name}",
                        "blueprint_id": bp_id,
                        "source": source_name,
                        "type": "primary"
                    })
                
                secondary_nodes = bp.get("secondary_nodes", [])
                
                # Add ALL secondary nodes - artifacts are created regardless of load flag
                # (load flag only controls data loading via MTI, not artifact creation)
                for sec_node in secondary_nodes:
                    if sec_node.get("node"):
                        node_name = sec_node.get("node", "").upper()
                        nodes.append({
                            "name": f"NODE_{node_name}",
                            "blueprint_id": bp_id,
                            "source": source_name,
                            "type": "secondary"
                        })
                
                # Build Relationships: Edges
                if primary_node and primary_node.get("node"):
                    primary = primary_node.get("node", "").upper()
                    for sec_node in secondary_nodes:
                        if sec_node.get("node"):
                            secondary = sec_node.get("node", "").upper()
                            edges.append({
                                "name": f"EDGE_{primary}_{secondary}",
                                "blueprint_id": bp_id,
                                "source": source_name
                            })
                
                # Data storage: Attributes
                if primary_node and primary_node.get("node"):
                    node_name = primary_node.get("node", "").upper()
                    attr_name = f"ATTR_{node_name}_{binding_object.upper()}_{source_name.upper()}"
                    attributes.append({
                        "name": attr_name,
                        "blueprint_id": bp_id,
                        "source": source_name,
                        "node": node_name
                    })
                
                # Supporting artefacts: Currently none for standard blueprint deployment
                # (PIT tables are created separately if needed, not as part of standard deployment)
            
            # If no deployment items were found, this indicates a problem
            if not staging_views and not nodes:
                raise ValueError(
                    f"Model '{model_id}' found blueprints but no deployment items were calculated. "
                    f"This may indicate missing blueprint configuration (primary_node, binding_object, etc.)."
                )
            
            # Model deployment: The dimension or fact view itself
            # Get view name matching deployment format
            if model_type == "dimension":
                view_name = model.get("view_name") or f"V_DIM_{model_id.upper()}"
            else:  # fact
                view_name = model.get("view_name") or f"V_FACT_{model_id.upper()}"

            model_deployment = {
                "name": view_name,
                "model_id": model_id,
                "model_type": model_type
            }
            
            # Seed load: Full refresh step for all blueprints
            seed_load = {
                "available": True,
                "description": "Full refresh step (full_refresh_mti) for all blueprints",
                "blueprints": blueprint_info_for_seed
            }
            
            # Get tags and grants info from model config
            pii_flag = model.get("pii")
            roles_value = model.get("roles") or []

            # Calculate tagging items (all deployed objects will be tagged)
            tagging_items = []
            grant_items = []

            # Count objects that will receive tags and grants
            total_objects = len(nodes) + len(edges) + len(attributes) + 1  # +1 for the model view

            if total_objects > 0:
                # Add tagging item for each type of object
                if nodes:
                    tagging_items.append({"name": "Tag Nodes", "count": len(nodes)})
                    if roles_value:
                        grant_items.append({"name": "Grant access to Nodes", "count": len(nodes)})
                if edges:
                    tagging_items.append({"name": "Tag Edges", "count": len(edges)})
                    if roles_value:
                        grant_items.append({"name": "Grant access to Edges", "count": len(edges)})
                if attributes:
                    tagging_items.append({"name": "Tag Attributes", "count": len(attributes)})
                    if roles_value:
                        grant_items.append({"name": "Grant access to Attributes", "count": len(attributes)})
                tagging_items.append({"name": f"Tag {model_type} view", "count": 1})
                if roles_value:
                    grant_items.append({"name": f"Grant access to {model_type} view", "count": 1})

            models_summary.append({
                "model_id": model_id,
                "model_name": model_name,
                "model_type": model_type,
                "staging": {
                    "items": staging_views,
                    "count": len(staging_views)
                },
                "data_processing": {
                    "streams": streams,
                    "tasks": tasks,
                    "count": len(streams) + len(tasks)
                },
                "key_storage": {
                    "items": nodes,
                    "count": len(nodes)
                },
                "build_relationships": {
                    "items": edges,
                    "count": len(edges)
                },
                "data_storage": {
                    "items": attributes,
                    "count": len(attributes)
                },
                "supporting_artefacts": {
                    "items": supporting_artefacts,
                    "count": len(supporting_artefacts)
                },
                "model_deployment": model_deployment,
                "seed_load": seed_load,
                "apply_tags": {
                    "items": tagging_items,
                    "count": sum(item.get("count", 0) for item in tagging_items)
                },
                "apply_grants": {
                    "items": grant_items,
                    "count": sum(item.get("count", 0) for item in grant_items)
                }
            })
        
        return {
            "message": f"Calculated deployment summary for {len(models_summary)} model(s)",
            "models": models_summary
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to calculate deployment summary: {str(e)}")

# ============================================================================
# DIMENSIONAL MODEL STAGED DEPLOYMENT WITH STREAMING
# ============================================================================

class ModelStagedDeployRequest(BaseModel):
    """Request model for staged deployment"""
    model_ids: List[str]
    replace_objects: bool = True
    run_full_refresh: bool = False
    model_database: Optional[str] = None
    model_schema: Optional[str] = None

def _get_model_governance_tags(model_config: dict) -> Dict[str, Optional[str]]:
    """
    Extract domain and process from model configuration.
    
    Args:
        model_config: Model configuration dict with belongs_to field
        
    Returns:
        Dict with 'domain' and 'process' keys (values may be None)
    """
    belongs_to = model_config.get("belongs_to")
    if not belongs_to:
        return {"domain": None, "process": None}
    
    # Load group info to get domain and process
    group_info = dimensional_models_loader.load_group_by_id(belongs_to)
    if not group_info:
        return {"domain": None, "process": None}
    
    # Determine PII flag and roles from the model config (dimensions/facts tables)
    pii_flag = model_config.get("pii")
    roles_value = model_config.get("roles") or []
    if isinstance(roles_value, str):
        roles_iterable = [roles_value]
    else:
        roles_iterable = roles_value

    roles_list = []
    for role in roles_iterable:
        if not role:
            continue
        normalized = str(role).strip()
        if not normalized:
            continue
        if normalized not in roles_list:
            roles_list.append(normalized)

    return {
        "domain": group_info.get("domain"),
        "process": group_info.get("process"),
        "pii": None if pii_flag is None else bool(pii_flag),
        "roles": roles_list
    }

def _ensure_tags_exist(client: SnowflakeClient) -> None:
    """
    Ensure DOMAIN and PROCESS tags exist in Snowflake.
    Creates them if they don't exist.
    
    Args:
        client: SnowflakeClient instance
    """
    try:
        # Create DOMAIN tag if it doesn't exist
        client.run("""
            CREATE TAG IF NOT EXISTS DOMAIN
                COMMENT = 'Business domain classification for data objects (e.g., Procurement, Maintenance, Finance)'
        """)
        
        # Create PROCESS tag if it doesn't exist
        client.run("""
            CREATE TAG IF NOT EXISTS PROCESS
                COMMENT = 'Business process classification for data objects (e.g., Procure to Pay, Asset Management, Accounting)'
        """)

        # Create PII tag if it doesn't exist
        client.run("""
            CREATE TAG IF NOT EXISTS PII
                COMMENT = 'PII classification flag for data objects (TRUE indicates PII)'
        """)
    except Exception as e:
        # Tags might already exist or there might be permission issues
        # Log but don't fail deployment
        import logging
        logger = logging.getLogger(__name__)
        logger.warning(f"Could not ensure tags exist: {str(e)}")

def _apply_tags_to_object(
    client: SnowflakeClient,
    object_type: str,
    database: str,
    schema: str,
    object_name: str,
    domain: Optional[str],
    process: Optional[str],
    pii: Optional[bool] = None
) -> bool:
    """
    Apply DOMAIN and PROCESS tags to a Snowflake object.

    Args:
        client: SnowflakeClient instance
        object_type: Type of object (TABLE, VIEW, STREAM, TASK, etc.)
        database: Database name
        schema: Schema name
        object_name: Object name
        domain: Domain value to set (None to skip)
        process: Process value to set (None to skip)

    Returns:
        True if tags were applied successfully, False otherwise
    """
    if not domain and not process and pii is None:
        return True  # Nothing to tag, consider success

    try:
        object_type_upper = object_type.upper()
        fully_qualified_name = f"{database.upper()}.{schema.upper()}.{object_name.upper()}"

        statements = []

        if domain:
            # Escape single quotes for SQL by doubling them
            domain_escaped = domain.replace("'", "''")
            statements.append(
                f"ALTER {object_type_upper} {fully_qualified_name} SET TAG DOMAIN = '{domain_escaped}'"
            )

        if process:
            # Escape single quotes for SQL by doubling them
            process_escaped = process.replace("'", "''")
            statements.append(
                f"ALTER {object_type_upper} {fully_qualified_name} SET TAG PROCESS = '{process_escaped}'"
            )

        if pii is not None:
            pii_value = 'TRUE' if pii else 'FALSE'
            statements.append(
                f"ALTER {object_type_upper} {fully_qualified_name} SET TAG PII = '{pii_value}'"
            )

        if statements:
            sql = ";\n".join(statements)
            client.run(sql)
        return True
    except Exception as e:
        # Log but don't fail deployment if tagging fails
        import logging
        logger = logging.getLogger(__name__)
        logger.warning(f"Could not apply tags to {object_type} {database}.{schema}.{object_name}: {str(e)}")
        return False

async def _deploy_model_staged_streaming(
    model_id: str,
    model_config: dict,
    model_type: str,
    blueprints_to_deploy: List[Dict[str, Any]],
    model_database: str,
    model_schema: str,
    replace_objects: bool,
    run_full_refresh: bool,
    client: SnowflakeClient
) -> AsyncGenerator[dict, None]:
    """
    Deploy a single model in stages with streaming updates.
    Stages:
    1. Staging (stage views)
    2. Data processing (streams and tasks)
    3. Key storage (nodes)
    4. Build relationships (edges)
    5. Data storage (attributes)
    6. Supporting artefacts (MTI, etc.)
    7. Model deployment (dimension/fact view)
    8. Seed load (full refresh if requested)
    """
    try:
        steps_completed = {}
        
        # Get model governance tags (domain and process)
        governance_tags = _get_model_governance_tags(model_config)
        domain = governance_tags.get("domain")
        process = governance_tags.get("process")
        pii_flag = governance_tags.get("pii")
        roles = governance_tags.get("roles") or []
        
        # Ensure tags exist in Snowflake
        _ensure_tags_exist(client)
        
        # Get stage database and schema from config
        from core.config import output_database
        stage_database = output_database.get("database_name", "UNIFIED_HONEY").upper()
        stage_schema = output_database.get("storage_schema_name", "STORAGE").upper()
        
        # Stage 1: Staging - Deploy stage views
        yield {
            "timestamp": datetime.utcnow().isoformat(),
            "level": "SUCCESS",
            "step": "staging",
            "model_id": model_id,
            "status": "starting",
            "message": f"Starting staging deployment for {model_id}"
        }

        staging_complete = True
        staging_errors = []
        for bp_info in blueprints_to_deploy:
            blueprint_id = bp_info.get("blueprint_id")
            source = bp_info.get("source")

            try:
                with SQLRenderer(blueprint_id, compile=True, replace_objects=replace_objects) as renderer:
                    view_sql = renderer.create_view()
                    client.run(view_sql)

                    # Get binding_object for object name
                    binding_object = bp_info.get("blueprint", {}).get("binding_object", "")
                    view_name = f"VIEW_{binding_object.upper()}" if binding_object else None

                    # Note: We don't apply governance tags to staging area objects
                    # Individual view deployments are not logged to reduce noise

            except Exception as e:
                staging_complete = False
                # Get binding_object for object name
                binding_object = bp_info.get("blueprint", {}).get("binding_object", "")
                view_name = f"VIEW_{binding_object.upper()}" if binding_object else None
                staging_errors.append(f"{blueprint_id}: {str(e)}")

                yield {
                    "timestamp": datetime.utcnow().isoformat(),
                    "level": "ERROR",
                    "step": "staging",
                    "model_id": model_id,
                    "blueprint_id": blueprint_id,
                    "object_name": view_name,
                    "status": "failed",
                    "message": f"Failed to deploy stage view for {blueprint_id}: {str(e)}"
                }

        # Emit completion message for staging
        if staging_complete:
            yield {
                "timestamp": datetime.utcnow().isoformat(),
                "level": "SUCCESS",
                "step": "staging",
                "model_id": model_id,
                "status": "complete",
                "message": f"Completed staging deployment for {model_id} ({len(blueprints_to_deploy)} views)"
            }

        steps_completed["staging"] = staging_complete
        
        # Stage 2: Data processing - Deploy streams and tasks
        yield {
            "timestamp": datetime.utcnow().isoformat(),
            "level": "SUCCESS",
            "step": "data_processing",
            "model_id": model_id,
            "status": "starting",
            "message": f"Starting data processing deployment for {model_id}"
        }

        data_processing_complete = True
        for bp_info in blueprints_to_deploy:
            blueprint_id = bp_info.get("blueprint_id")

            try:
                with SQLRenderer(blueprint_id, compile=True, replace_objects=replace_objects) as renderer:
                    # Deploy stream
                    stream_sql = renderer.create_stream()
                    client.run(stream_sql)

                    # Get binding_object for object names
                    binding_object = bp_info.get("blueprint", {}).get("binding_object", "")
                    if not binding_object:
                        # Get from renderer context
                        context = renderer.get_base_context()
                        binding_object = renderer.table.get("binding_object", "").upper()

                    stream_name = f"STREAM_{binding_object.upper()}" if binding_object else None

                    # Note: We don't apply governance tags to staging area objects
                    # Individual stream deployments are not logged to reduce noise

                    # Deploy task
                    task_sql = renderer.create_task()
                    client.run(task_sql)

                    # Resume task
                    context = renderer.get_base_context()
                    stage_db = context["stage"]["database"]
                    stage_schema = context["stage"]["schema"]
                    task_name = f"{stage_db}.{stage_schema}.TASK_{binding_object}"
                    client.run(f"ALTER TASK {task_name} RESUME")

                    task_obj_name = f"TASK_{binding_object.upper()}" if binding_object else None

                    # Apply governance tags to the task
                    if task_obj_name:
                        _apply_tags_to_object(
                            client,
                            "TASK",
                            stage_db.upper(),
                            stage_schema.upper(),
                            task_obj_name,
                            domain,
                            process,
                            pii_flag
                        )
                        _grant_access_to_object(
                            client,
                            "TASK",
                            stage_db.upper(),
                            stage_schema.upper(),
                            task_obj_name,
                            roles
                        )

                    # Individual task deployments are not logged to reduce noise

            except Exception as e:
                data_processing_complete = False
                # Get binding_object for object names
                binding_object = bp_info.get("blueprint", {}).get("binding_object", "")
                stream_name = f"STREAM_{binding_object.upper()}" if binding_object else None
                task_name = f"TASK_{binding_object.upper()}" if binding_object else None

                # Emit error for stream/task
                yield {
                    "timestamp": datetime.utcnow().isoformat(),
                    "level": "ERROR",
                    "step": "data_processing",
                    "model_id": model_id,
                    "blueprint_id": blueprint_id,
                    "object_name": stream_name or task_name,
                    "status": "failed",
                    "message": f"Failed to deploy data processing for {blueprint_id}: {str(e)}"
                }

        # Emit completion message for data processing
        if data_processing_complete:
            yield {
                "timestamp": datetime.utcnow().isoformat(),
                "level": "SUCCESS",
                "step": "data_processing",
                "model_id": model_id,
                "status": "complete",
                "message": f"Completed data processing deployment for {model_id} ({len(blueprints_to_deploy)} streams/tasks)"
            }

        steps_completed["data_processing"] = data_processing_complete
        
        # Stage 3: Key storage - Deploy nodes
        yield {
            "timestamp": datetime.utcnow().isoformat(),
            "level": "INFO",
            "step": "key_storage",
            "model_id": model_id,
            "status": "starting",
            "message": f"Deploying nodes for {model_id}"
        }
        
        key_storage_complete = True
        for bp_info in blueprints_to_deploy:
            blueprint_id = bp_info.get("blueprint_id")
            
            try:
                with SQLRenderer(blueprint_id, compile=True, replace_objects=replace_objects) as renderer:
                    nodes_sqls = renderer.create_nodes()
                    for node_sql in nodes_sqls:
                        client.run(node_sql)
                    
                    # Get target database and schema from renderer context
                    context = renderer.get_base_context()
                    target_db = context.get("target", {}).get("database", model_database).upper()
                    target_schema = context.get("target", {}).get("schema", model_schema).upper()
                    
                    # Get node names from blueprint
                    primary_node = bp_info.get("blueprint", {}).get("primary_node", {})
                    secondary_nodes = bp_info.get("blueprint", {}).get("secondary_nodes", [])
                    
                    # Mark all nodes as deployed
                    node_names = []
                    if primary_node and primary_node.get("node"):
                        node_names.append(f"NODE_{primary_node.get('node', '').upper()}")
                    for sec_node in secondary_nodes:
                        if sec_node.get("node"):
                            node_names.append(f"NODE_{sec_node.get('node', '').upper()}")
                    
                    for node_name in node_names:
                        # Apply governance tags to the node
                        tags_success = _apply_tags_to_object(
                            client,
                            "TABLE",
                            target_db,
                            target_schema,
                            node_name,
                            domain,
                            process,
                            pii_flag
                        )

                        # Emit tag application log
                        if tags_success and (domain or process or pii_flag is not None):
                            yield {
                                "timestamp": datetime.utcnow().isoformat(),
                                "level": "SUCCESS",
                                "step": "apply_tags",
                                "model_id": model_id,
                                "blueprint_id": blueprint_id,
                                "object_name": f"Tag Nodes",
                                "status": "complete",
                                "message": f"Applied tags to node {node_name.lower()}"
                            }

                        _grant_access_to_object(
                            client,
                            "TABLE",
                            target_db,
                            target_schema,
                            node_name,
                            roles
                        )

                        # Emit grant application log
                        if roles:
                            yield {
                                "timestamp": datetime.utcnow().isoformat(),
                                "level": "SUCCESS",
                                "step": "apply_grants",
                                "model_id": model_id,
                                "blueprint_id": blueprint_id,
                                "object_name": f"Grant access to Nodes",
                                "status": "complete",
                                "message": f"Granted access to node {node_name.lower()} for roles: {', '.join(roles)}"
                            }

                        yield {
                            "timestamp": datetime.utcnow().isoformat(),
                            "level": "SUCCESS",
                            "step": "key_storage",
                            "model_id": model_id,
                            "blueprint_id": blueprint_id,
                            "object_name": node_name,
                            "status": "complete",
                            "message": f"Node {node_name.lower()} deployed for {blueprint_id}"
                        }
            except Exception as e:
                key_storage_complete = False
                # Get node names from blueprint
                primary_node = bp_info.get("blueprint", {}).get("primary_node", {})
                secondary_nodes = bp_info.get("blueprint", {}).get("secondary_nodes", [])
                
                # Mark all nodes as failed
                node_names = []
                if primary_node and primary_node.get("node"):
                    node_names.append(f"NODE_{primary_node.get('node', '').upper()}")
                for sec_node in secondary_nodes:
                    if sec_node.get("node"):
                        node_names.append(f"NODE_{sec_node.get('node', '').upper()}")
                
                for node_name in node_names:
                    yield {
                        "timestamp": datetime.utcnow().isoformat(),
                        "level": "ERROR",
                        "step": "key_storage",
                        "model_id": model_id,
                        "blueprint_id": blueprint_id,
                        "object_name": node_name,
                        "status": "failed",
                        "message": f"Failed to deploy node {node_name.lower()} for {blueprint_id}: {str(e)}"
                    }
        
        steps_completed["key_storage"] = key_storage_complete
        
        # Stage 4: Build relationships - Deploy edges
        yield {
            "timestamp": datetime.utcnow().isoformat(),
            "level": "INFO",
            "step": "build_relationships",
            "model_id": model_id,
            "status": "starting",
            "message": f"Deploying edges for {model_id}"
        }
        
        build_relationships_complete = True
        for bp_info in blueprints_to_deploy:
            blueprint_id = bp_info.get("blueprint_id")
            
            try:
                with SQLRenderer(blueprint_id, compile=True, replace_objects=replace_objects) as renderer:
                    edges_sqls = renderer.create_edges()
                    for edge_sql in edges_sqls:
                        client.run(edge_sql)
                    
                    # Get target database and schema from renderer context
                    context = renderer.get_base_context()
                    target_db = context.get("target", {}).get("database", model_database).upper()
                    target_schema = context.get("target", {}).get("schema", model_schema).upper()
                    
                    # Get edge names from blueprint
                    primary_node = bp_info.get("blueprint", {}).get("primary_node", {})
                    secondary_nodes = bp_info.get("blueprint", {}).get("secondary_nodes", [])
                    
                    edge_names = []
                    if primary_node and primary_node.get("node"):
                        primary = primary_node.get("node", "").upper()
                        for sec_node in secondary_nodes:
                            if sec_node.get("node"):
                                secondary = sec_node.get("node", "").upper()
                                edge_names.append(f"EDGE_{primary}_{secondary}")
                    
                    for edge_name in edge_names:
                        # Apply governance tags to the edge
                        tags_success = _apply_tags_to_object(
                            client,
                            "TABLE",
                            target_db,
                            target_schema,
                            edge_name,
                            domain,
                            process,
                            pii_flag
                        )

                        # Emit tag application log
                        if tags_success and (domain or process or pii_flag is not None):
                            yield {
                                "timestamp": datetime.utcnow().isoformat(),
                                "level": "SUCCESS",
                                "step": "apply_tags",
                                "model_id": model_id,
                                "blueprint_id": blueprint_id,
                                "object_name": f"Tag Edges",
                                "status": "complete",
                                "message": f"Applied tags to edge {edge_name.lower()}"
                            }

                        _grant_access_to_object(
                            client,
                            "TABLE",
                            target_db,
                            target_schema,
                            edge_name,
                            roles
                        )

                        # Emit grant application log
                        if roles:
                            yield {
                                "timestamp": datetime.utcnow().isoformat(),
                                "level": "SUCCESS",
                                "step": "apply_grants",
                                "model_id": model_id,
                                "blueprint_id": blueprint_id,
                                "object_name": f"Grant access to Edges",
                                "status": "complete",
                                "message": f"Granted access to edge {edge_name.lower()} for roles: {', '.join(roles)}"
                            }

                        yield {
                            "timestamp": datetime.utcnow().isoformat(),
                            "level": "SUCCESS",
                            "step": "build_relationships",
                            "model_id": model_id,
                            "blueprint_id": blueprint_id,
                            "object_name": edge_name,
                            "status": "complete",
                            "message": f"Edge {edge_name.lower()} deployed for {blueprint_id}"
                        }
            except Exception as e:
                build_relationships_complete = False
                # Get edge names from blueprint
                primary_node = bp_info.get("blueprint", {}).get("primary_node", {})
                secondary_nodes = bp_info.get("blueprint", {}).get("secondary_nodes", [])
                
                edge_names = []
                if primary_node and primary_node.get("node"):
                    primary = primary_node.get("node", "").upper()
                    for sec_node in secondary_nodes:
                        if sec_node.get("node"):
                            secondary = sec_node.get("node", "").upper()
                            edge_names.append(f"EDGE_{primary}_{secondary}")
                
                for edge_name in edge_names:
                    yield {
                        "timestamp": datetime.utcnow().isoformat(),
                        "level": "ERROR",
                        "step": "build_relationships",
                        "model_id": model_id,
                        "blueprint_id": blueprint_id,
                        "object_name": edge_name,
                        "status": "failed",
                        "message": f"Failed to deploy edge {edge_name.lower()} for {blueprint_id}: {str(e)}"
                    }
        
        steps_completed["build_relationships"] = build_relationships_complete
        
        # Stage 5: Data storage - Deploy attributes
        yield {
            "timestamp": datetime.utcnow().isoformat(),
            "level": "INFO",
            "step": "data_storage",
            "model_id": model_id,
            "status": "starting",
            "message": f"Deploying attributes for {model_id}"
        }
        
        data_storage_complete = True
        for bp_info in blueprints_to_deploy:
            blueprint_id = bp_info.get("blueprint_id")
            
            try:
                with SQLRenderer(blueprint_id, compile=True, replace_objects=replace_objects) as renderer:
                    attr_sql = renderer.create_attribute()
                    client.run(attr_sql)
                    
                    # Deploy MTI logic
                    mti_sql = renderer.mti()
                    client.run(mti_sql)
                    
                    # Get target database and schema from renderer context
                    context = renderer.get_base_context()
                    target_db = context.get("target", {}).get("database", model_database).upper()
                    target_schema = context.get("target", {}).get("schema", model_schema).upper()
                    
                    # Get attribute name
                    primary_node = bp_info.get("blueprint", {}).get("primary_node", {})
                    binding_object = bp_info.get("blueprint", {}).get("binding_object", "")
                    source = bp_info.get("source", "")
                    
                    attr_name = None
                    if primary_node and primary_node.get("node") and binding_object and source:
                        node_name = primary_node.get("node", "").upper()
                        attr_name = f"ATTR_{node_name}_{binding_object.upper()}_{source.upper()}"
                    
                    # Apply governance tags to the attribute
                    if attr_name:
                        tags_success = _apply_tags_to_object(
                            client,
                            "TABLE",
                            target_db,
                            target_schema,
                            attr_name,
                            domain,
                            process,
                            pii_flag
                        )

                        # Emit tag application log
                        if tags_success and (domain or process or pii_flag is not None):
                            yield {
                                "timestamp": datetime.utcnow().isoformat(),
                                "level": "SUCCESS",
                                "step": "apply_tags",
                                "model_id": model_id,
                                "blueprint_id": blueprint_id,
                                "object_name": f"Tag Attributes",
                                "status": "complete",
                                "message": f"Applied tags to attribute {attr_name.lower()}"
                            }

                        _grant_access_to_object(
                            client,
                            "TABLE",
                            target_db,
                            target_schema,
                            attr_name,
                            roles
                        )

                        # Emit grant application log
                        if roles:
                            yield {
                                "timestamp": datetime.utcnow().isoformat(),
                                "level": "SUCCESS",
                                "step": "apply_grants",
                                "model_id": model_id,
                                "blueprint_id": blueprint_id,
                                "object_name": f"Grant access to Attributes",
                                "status": "complete",
                                "message": f"Granted access to attribute {attr_name.lower()} for roles: {', '.join(roles)}"
                            }

                    yield {
                        "timestamp": datetime.utcnow().isoformat(),
                        "level": "SUCCESS",
                        "step": "data_storage",
                        "model_id": model_id,
                        "blueprint_id": blueprint_id,
                        "object_name": attr_name,
                        "status": "complete",
                        "message": f"Attributes and MTI deployed for {blueprint_id}"
                    }
            except Exception as e:
                data_storage_complete = False
                # Get attribute name
                primary_node = bp_info.get("blueprint", {}).get("primary_node", {})
                binding_object = bp_info.get("blueprint", {}).get("binding_object", "")
                source = bp_info.get("source", "")
                
                attr_name = None
                if primary_node and primary_node.get("node") and binding_object and source:
                    node_name = primary_node.get("node", "").upper()
                    attr_name = f"ATTR_{node_name}_{binding_object.upper()}_{source.upper()}"
                
                yield {
                    "timestamp": datetime.utcnow().isoformat(),
                    "level": "ERROR",
                    "step": "data_storage",
                    "model_id": model_id,
                    "blueprint_id": blueprint_id,
                    "object_name": attr_name,
                    "status": "failed",
                    "message": f"Failed to deploy attributes for {blueprint_id}: {str(e)}"
                }
        
        steps_completed["data_storage"] = data_storage_complete
        
        # Stage 6: Supporting artefacts (already done with MTI above, but mark as complete)
        steps_completed["supporting_artefacts"] = True
        
        # Stage 7: Model deployment - Deploy dimension/fact view
        yield {
            "timestamp": datetime.utcnow().isoformat(),
            "level": "INFO",
            "step": "model_deployment",
            "model_id": model_id,
            "status": "starting",
            "message": f"Deploying {model_type} view for {model_id}"
        }
        
        # Import the deployment functions from dimensional_models
        from api.routes.dimensional_models import _deploy_single_dimension_streaming, _deploy_single_fact_streaming
        
        model_deployment_complete = False
        try:
            # Get the view name from model config (matching actual deployment format)
            view_name = None
            if model_type == "dimension":
                view_name = model_config.get("view_name") or f"V_DIM_{model_id.upper()}"
            else:  # fact
                view_name = model_config.get("view_name") or f"V_FACT_{model_id.upper()}"
            
            if model_type == "dimension":
                async for log_event in _deploy_single_dimension_streaming(
                    dimension_id=model_id,
                    dimension_config=model_config,
                    model_database=model_database,
                    model_schema=model_schema,
                    replace_objects=replace_objects,
                    client=client
                ):
                    # Forward log events with correct object_name for model_deployment
                    yield {
                        **log_event,
                        "step": "model_deployment",
                        "model_id": model_id,
                        "object_name": view_name if log_event.get("step") in ["dimension_view", "complete"] else log_event.get("object_name")
                    }
                    if log_event.get("step") == "complete" and log_event.get("status") == "complete":
                        model_deployment_complete = True
                        # Apply governance tags to the dimension view
                        if view_name:
                            tags_success = _apply_tags_to_object(
                                client,
                                "VIEW",
                                model_database.upper(),
                                model_schema.upper(),
                                view_name,
                                domain,
                                process,
                                pii_flag
                            )

                            # Emit tag application log
                            if tags_success and (domain or process or pii_flag is not None):
                                yield {
                                    "timestamp": datetime.utcnow().isoformat(),
                                    "level": "SUCCESS",
                                    "step": "apply_tags",
                                    "model_id": model_id,
                                    "object_name": f"Tag {model_type} view",
                                    "status": "complete",
                                    "message": f"Applied tags to {model_type} view {view_name.lower()}"
                                }

                            _grant_access_to_object(
                                client,
                                "VIEW",
                                model_database.upper(),
                                model_schema.upper(),
                                view_name,
                                roles
                            )

                            # Emit grant application log
                            if roles:
                                yield {
                                    "timestamp": datetime.utcnow().isoformat(),
                                    "level": "SUCCESS",
                                    "step": "apply_grants",
                                    "model_id": model_id,
                                    "object_name": f"Grant access to {model_type} view",
                                    "status": "complete",
                                    "message": f"Granted access to {model_type} view {view_name.lower()} for roles: {', '.join(roles)}"
                                }
            else:  # fact
                async for log_event in _deploy_single_fact_streaming(
                    fact_id=model_id,
                    fact_config=model_config,
                    model_database=model_database,
                    model_schema=model_schema,
                    replace_objects=replace_objects,
                    client=client
                ):
                    # Forward log events with correct object_name for model_deployment
                    yield {
                        **log_event,
                        "step": "model_deployment",
                        "model_id": model_id,
                        "object_name": view_name if log_event.get("step") in ["fact_view", "complete"] else log_event.get("object_name")
                    }
                    if log_event.get("step") == "complete" and log_event.get("status") == "complete":
                        model_deployment_complete = True
                        # Apply governance tags to the fact view
                        if view_name:
                            tags_success = _apply_tags_to_object(
                                client,
                                "VIEW",
                                model_database.upper(),
                                model_schema.upper(),
                                view_name,
                                domain,
                                process,
                                pii_flag
                            )

                            # Emit tag application log
                            if tags_success and (domain or process or pii_flag is not None):
                                yield {
                                    "timestamp": datetime.utcnow().isoformat(),
                                    "level": "SUCCESS",
                                    "step": "apply_tags",
                                    "model_id": model_id,
                                    "object_name": f"Tag {model_type} view",
                                    "status": "complete",
                                    "message": f"Applied tags to {model_type} view {view_name.lower()}"
                                }

                            _grant_access_to_object(
                                client,
                                "VIEW",
                                model_database.upper(),
                                model_schema.upper(),
                                view_name,
                                roles
                            )

                            # Emit grant application log
                            if roles:
                                yield {
                                    "timestamp": datetime.utcnow().isoformat(),
                                    "level": "SUCCESS",
                                    "step": "apply_grants",
                                    "model_id": model_id,
                                    "object_name": f"Grant access to {model_type} view",
                                    "status": "complete",
                                    "message": f"Granted access to {model_type} view {view_name.lower()} for roles: {', '.join(roles)}"
                                }
        except Exception as e:
            yield {
                "timestamp": datetime.utcnow().isoformat(),
                "level": "ERROR",
                "step": "model_deployment",
                "model_id": model_id,
                "status": "failed",
                "message": f"Failed to deploy {model_type} view: {str(e)}"
            }
        
        steps_completed["model_deployment"] = model_deployment_complete
        
        # Stage 8: Seed load - Full refresh if requested
        if run_full_refresh:
            yield {
                "timestamp": datetime.utcnow().isoformat(),
                "level": "INFO",
                "step": "seed_load",
                "model_id": model_id,
                "status": "starting",
                "message": f"Running full refresh for {model_id}"
            }
            
            seed_load_complete = True
            for bp_info in blueprints_to_deploy:
                blueprint_id = bp_info.get("blueprint_id")
                
                try:
                    with SQLRenderer(blueprint_id, compile=True, replace_objects=replace_objects) as renderer:
                        refresh_sql = renderer.full_refresh_mti()
                        client.run(refresh_sql)
                        
                        refresh_item_name = f"{blueprint_id}_refresh"
                        
                        yield {
                            "timestamp": datetime.utcnow().isoformat(),
                            "level": "SUCCESS",
                            "step": "seed_load",
                            "model_id": model_id,
                            "blueprint_id": blueprint_id,
                            "object_name": refresh_item_name,
                            "status": "complete",
                            "message": f"Full refresh completed for {blueprint_id}"
                        }
                except Exception as e:
                    seed_load_complete = False
                    refresh_item_name = f"{blueprint_id}_refresh"
                    
                    yield {
                        "timestamp": datetime.utcnow().isoformat(),
                        "level": "ERROR",
                        "step": "seed_load",
                        "model_id": model_id,
                        "blueprint_id": blueprint_id,
                        "object_name": refresh_item_name,
                        "status": "failed",
                        "message": f"Failed to run full refresh for {blueprint_id}: {str(e)}"
                    }
            
            steps_completed["seed_load"] = seed_load_complete
        else:
            steps_completed["seed_load"] = None  # Not requested
        
        # Final summary
        yield {
            "timestamp": datetime.utcnow().isoformat(),
            "level": "SUCCESS",
            "step": "complete",
            "model_id": model_id,
            "status": "complete",
            "message": f"Model {model_id} deployment completed",
            "steps_completed": steps_completed
        }
    
    except Exception as e:
        yield {
            "timestamp": datetime.utcnow().isoformat(),
            "level": "ERROR",
            "step": "error",
            "model_id": model_id,
            "status": "failed",
            "message": f"Error deploying model {model_id}: {str(e)}"
        }
        raise

@router.post("/dimensional-models/deploy-staged")
async def deploy_models_staged(request: ModelStagedDeployRequest):
    """
    Deploy dimensional models in a staged way with streaming updates.
    
    Stages deployed in order:
    1. Staging (stage views)
    2. Data processing (streams and tasks)
    3. Key storage (nodes)
    4. Build relationships (edges)
    5. Data storage (attributes)
    6. Supporting artefacts (MTI, etc.)
    7. Model deployment (dimension/fact view)
    8. Seed load (full refresh if requested)
    
    Streams updates as each step completes, ticking to true as steps are deployed.
    """
    
    async def event_generator() -> AsyncGenerator[str, None]:
        deployment_events: List[Dict[str, Any]] = []
        final_summary: Optional[Dict[str, Any]] = None
        successful: List[Dict[str, Any]] = []
        failed: List[Dict[str, Any]] = []
        total_count = len(request.model_ids)
        error_message: Optional[str] = None

        def send_event(event_type: str, data: dict) -> str:
            deployment_events.append({
                "event": event_type,
                "data": data
            })
            return f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
        
        try:
            # Load dimensional models config
            dim_config = dimensional_models_loader.get_all()
            dimensions = dim_config.get("dimensions", [])
            facts = dim_config.get("facts", [])
            
            # Get database and schema from config or request
            model_database = request.model_database or dim_config.get("model_database")
            model_schema = request.model_schema or dim_config.get("model_schema")
            
            if not model_database or not model_schema:
                raise ValueError("model_database and model_schema must be specified in config or request")
            
            # Load blueprints config
            blueprints_config = blueprints_loader.get_all()
            
            # Count processed models
            current = 0
            
            msg = f"Starting staged deployment of {total_count} model(s)"
            logger.info(msg)
            yield send_event("log", {
                "timestamp": datetime.utcnow().isoformat(),
                "message": msg,
                "level": "INFO"
            })
            
            # Create single shared Snowflake connection
            with SnowflakeClient() as shared_client:
                msg = "Connected to Snowflake"
                logger.info(msg)
                yield send_event("log", {
                    "timestamp": datetime.utcnow().isoformat(),
                    "message": msg,
                    "level": "INFO"
                })
                
                # Process each model
                for model_id in request.model_ids:
                    current += 1
                    
                    # Find model config (case-insensitive)
                    model_config = None
                    model_type = None
                    model_id_lower = model_id.lower()
                    
                    for dim in dimensions:
                        if dim.get("id", "").lower() == model_id_lower:
                            model_config = dim
                            model_type = "dimension"
                            break
                    
                    if not model_config:
                        for fact in facts:
                            if fact.get("id", "").lower() == model_id_lower:
                                model_config = fact
                                model_type = "fact"
                                break
                    
                    if not model_config:
                        failed.append({"type": model_type or "unknown", "id": model_id, "error": "Configuration not found"})
                        msg = f"Model '{model_id}' not found in configuration"
                        logger.error(msg)
                        yield send_event("log", {
                            "timestamp": datetime.utcnow().isoformat(),
                            "message": msg,
                            "level": "ERROR"
                        })
                        continue
                    
                    # Get blueprints for this model
                    blueprint_keys = set()
                    
                    if model_type == "dimension":
                        source = model_config.get("source", {})
                        attr_table = source.get("attribute_table", {})
                        if attr_table:
                            blueprint_id = attr_table.get("name")
                            attr_source = attr_table.get("source")
                            if blueprint_id and attr_source:
                                blueprint_keys.add(f"{attr_source}.{blueprint_id}")
                    elif model_type == "fact":
                        attributes = model_config.get("attributes", {})
                        attr_table = attributes.get("attribute_table", {})
                        if attr_table:
                            blueprint_id = attr_table.get("name")
                            attr_source = attr_table.get("source")
                            if blueprint_id and attr_source:
                                blueprint_keys.add(f"{attr_source}.{blueprint_id}")
                    
                    # Also from columns (for additional blueprints if any)
                    columns = model_config.get("columns", [])
                    for col in columns:
                        mapping = col.get("blueprint_mapping") or col.get("source")
                        if mapping and isinstance(mapping, str) and "." in mapping:
                            parts = mapping.split(".")
                            if len(parts) >= 2:
                                source = parts[0]
                                blueprint_name = parts[1]
                                blueprint_keys.add(f"{source}.{blueprint_name}")
                    
                    # Build blueprint info list - find blueprints that match
                    blueprints_to_deploy = []
                    sources_list = blueprints_config.get("sources", [])
                    
                    for source_obj in sources_list:
                        source_name = source_obj.get("source")
                        blueprints_list = source_obj.get("blueprints", [])
                        
                        for bp in blueprints_list:
                            bp_id = bp.get("id")
                            if bp_id:
                                key = f"{source_name}.{bp_id}"
                                if key in blueprint_keys:
                                    blueprints_to_deploy.append({
                                        "blueprint_id": bp_id,
                                        "source": source_name,
                                        "blueprint": bp
                                    })
                    
                    if not blueprints_to_deploy:
                        raise ValueError(
                            f"Model '{model_id}' references blueprints {list(blueprint_keys)}, "
                            f"but none were found in the blueprints configuration."
                        )
                    
                    logger.info(f"Starting deployment of model '{model_id}' ({model_type}) - {current}/{total_count}")
                    yield send_event("model_start", {
                        "timestamp": datetime.utcnow().isoformat(),
                        "model_id": model_id,
                        "model_type": model_type,
                        "index": current,
                        "total": total_count
                    })
                    
                    deployment_successful = False
                    try:
                        # Stream deployment logs for this model
                        async for log_event in _deploy_model_staged_streaming(
                            model_id=model_id,
                            model_config=model_config,
                            model_type=model_type,
                            blueprints_to_deploy=blueprints_to_deploy,
                            model_database=model_database,
                            model_schema=model_schema,
                            replace_objects=request.replace_objects,
                            run_full_refresh=request.run_full_refresh,
                            client=shared_client
                        ):
                            # Log to console/uvicorn based on level
                            log_level = log_event.get("level", "INFO").upper()
                            log_msg = log_event.get("message", "")
                            log_step = log_event.get("step", "")
                            log_obj = log_event.get("object_name", "")

                            # Format log message with context
                            if log_step and log_obj:
                                formatted_msg = f"[{model_id}] [{log_step}] {log_obj}: {log_msg}"
                            elif log_step:
                                formatted_msg = f"[{model_id}] [{log_step}] {log_msg}"
                            else:
                                formatted_msg = f"[{model_id}] {log_msg}"

                            if log_level == "ERROR":
                                logger.error(formatted_msg)
                            elif log_level == "WARNING":
                                logger.warning(formatted_msg)
                            elif log_level == "SUCCESS":
                                logger.info(formatted_msg)
                            else:
                                logger.info(formatted_msg)

                            # Forward all log events as SSE
                            yield send_event("log", log_event)

                            # Track if deployment completed successfully
                            if log_event.get("step") == "complete" and log_event.get("status") == "complete":
                                deployment_successful = True
                        
                        if deployment_successful:
                            successful.append({"type": model_type, "id": model_id})
                            logger.info(f"Model '{model_id}' deployment completed successfully")
                            yield send_event("model_complete", {
                                "timestamp": datetime.utcnow().isoformat(),
                                "model_id": model_id,
                                "status": "success"
                            })
                        else:
                            failed.append({"type": model_type, "id": model_id, "error": "Deployment did not complete"})
                            logger.error(f"Model '{model_id}' deployment failed: Deployment did not complete")
                            yield send_event("model_complete", {
                                "timestamp": datetime.utcnow().isoformat(),
                                "model_id": model_id,
                                "status": "failed",
                                "error": "Deployment did not complete"
                            })

                    except Exception as e:
                        failed.append({"type": model_type, "id": model_id, "error": str(e)})
                        logger.error(f"Model '{model_id}' deployment failed with exception: {str(e)}")
                        yield send_event("model_complete", {
                            "timestamp": datetime.utcnow().isoformat(),
                            "model_id": model_id,
                            "status": "failed",
                            "error": str(e)
                        })
                
                # Send final summary
                summary_msg = f"Staged deployment complete: {len(successful)} successful, {len(failed)} failed"
                final_summary = {
                    "timestamp": datetime.utcnow().isoformat(),
                    "message": summary_msg,
                    "total": total_count,
                    "successful": successful,
                    "failed": failed
                }
                logger.info(summary_msg)
                yield send_event("complete", final_summary)

        except Exception as e:
            error_message = str(e)
            error_msg = f"Deployment error: {error_message}"
            logger.error(error_msg)
            yield send_event("error", {
                "timestamp": datetime.utcnow().isoformat(),
                "message": error_message,
                "level": "ERROR"
            })
        finally:
            close_payload = {
                "timestamp": datetime.utcnow().isoformat(),
                "message": "Stream closed"
            }
            yield send_event("close", close_payload)

            summary_payload = final_summary or {
                "timestamp": datetime.utcnow().isoformat(),
                "message": error_message or "Deployment ended before summary event",
                "total": total_count,
                "successful": successful,
                "failed": failed
            }

            if "timestamp" not in summary_payload or not summary_payload.get("timestamp"):
                summary_payload["timestamp"] = datetime.utcnow().isoformat()

            success_count = len(successful)
            failure_count = len(failed)
            error_count = failure_count if failure_count > 0 else (1 if error_message else 0)

            if error_message or failure_count > 0:
                status = "failed" if success_count == 0 else "partial"
            else:
                status = "success"

            persist_deployment_log(
                deployment_type="dimensional_models_staged",
                model_ids=request.model_ids,
                events=deployment_events,
                summary=summary_payload,
                status=status,
                success_count=success_count,
                error_count=error_count,
                total_count=total_count
            )
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

@router.get("/snowflake/account-url")
async def get_snowflake_account_url():
    """
    Get the Snowflake data table URL for the connected customer account.
    Opens the configured data table in Snowflake's web UI.
    
    Returns:
        {
            "account_url": str  # e.g., "https://app.snowflake.com/goistmo/uswest/#/data/databases/LANDING_ZONE/schemas/CDC_METADATA/table/CDC_SNAPSHOT_ACTIVITY/data-preview"
        }
    """
    try:
        account = os.getenv("SNOWFLAKE_ACCOUNT", "GOISTMO-USWEST")
        
        # Parse account identifier (format: ORG-REGION, e.g., "GOISTMO-USWEST")
        # Split by hyphen, take first part as org, rest as region
        account_parts = account.upper().split("-", 1)
        if len(account_parts) == 2:
            org = account_parts[0].lower()
            region = account_parts[1].lower()
        else:
            # Fallback: use entire account as org, try to get region from env or default
            org = account.lower()
            region = os.getenv("SNOWFLAKE_REGION", "uswest").lower()
        
        # Get table location from config
        database = snowflake_data_table["database_name"]
        schema = snowflake_data_table["schema_name"]
        table = snowflake_data_table["table_name"]
        
        # Construct Snowflake web UI URL for data table preview
        account_url = f"https://app.snowflake.com/{org}/{region}/#/data/databases/{database}/schemas/{schema}/table/{table}/data-preview"
        
        return {
            "account_url": account_url
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get Snowflake account URL: {str(e)}")

