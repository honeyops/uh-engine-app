#!/usr/bin/env python3
"""
Dimensional Models management endpoints for Unified Honey Engine v2
Handles groups, dimensions, and facts based on dimensional_models.yaml
"""

from fastapi import APIRouter, HTTPException, Query, Body
from fastapi.responses import StreamingResponse
from typing import Dict, Any, List, Optional, AsyncGenerator
from pydantic import BaseModel
from datetime import datetime
import json
import logging
from jinja2 import Environment, FileSystemLoader
from pathlib import Path
from core.config_loader import dimensional_models_loader, blueprints_loader
from core.snowflake import SnowflakeClient
from core.sql_render import TEMPLATE_PATH
from core.deployment_logs import persist_deployment_log

router = APIRouter()
logger = logging.getLogger(__name__)

# ============================================================================
# REQUEST MODELS
# ============================================================================

class DimensionalModelDeployRequest(BaseModel):
    """Request model for dimensional model deployment"""
    dimensions: List[str] = []
    facts: List[str] = []
    replace_objects: bool = True
    model_database: Optional[str] = None
    model_schema: Optional[str] = None

# ============================================================================
# GROUPS ENDPOINTS
# ============================================================================

@router.get("/dimensional-models/groups", response_model=Dict[str, Any])
async def list_groups():
    """
    List all groups from the dimensional models configuration.
    """
    try:
        config = dimensional_models_loader.get_all()
        groups = config.get("groups", [])

        return {
            "message": f"Found {len(groups)} groups",
            "groups": groups
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load groups: {str(e)}")

# ============================================================================
# DIMENSIONS ENDPOINTS
# ============================================================================

@router.get("/dimensional-models/dimensions", response_model=Dict[str, Any])
async def list_dimensions():
    """
    List all dimensions from the dimensional models configuration.
    """
    try:
        config = dimensional_models_loader.get_all()
        dimensions = config.get("dimensions", [])

        return {
            "message": f"Found {len(dimensions)} dimensions",
            "dimensions": dimensions
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load dimensions: {str(e)}")

# ============================================================================
# FACTS ENDPOINTS
# ============================================================================

@router.get("/dimensional-models/facts", response_model=Dict[str, Any])
async def list_facts():
    """
    List all facts from the dimensional models configuration.
    """
    try:
        config = dimensional_models_loader.get_all()
        facts = config.get("facts", [])

        return {
            "message": f"Found {len(facts)} facts",
            "facts": facts
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load facts: {str(e)}")

# ============================================================================
# DEPLOYMENT ENDPOINTS
# ============================================================================


# ============================================================================
# HELPER FUNCTIONS FOR STREAMING DEPLOYMENT
# ============================================================================

async def _deploy_single_dimension_streaming(
    dimension_id: str,
    dimension_config: dict,
    model_database: str,
    model_schema: str,
    replace_objects: bool,
    client: SnowflakeClient
) -> AsyncGenerator[dict, None]:
    """
    Deploy a single dimension with streaming logs.
    Yields log events as dictionaries.
    """
    try:
        # Step 1: Validate configuration
        yield {
            "timestamp": datetime.utcnow().isoformat(),
            "level": "INFO",
            "step": "validation",
            "object_name": dimension_id,
            "status": "starting",
            "message": f"Validating dimension '{dimension_id}' configuration"
        }

        # Get source attribute table info
        source = dimension_config.get("source", {})
        attr_table = source.get("attribute_table", {})

        if not attr_table:
            raise ValueError(f"Dimension '{dimension_id}' missing attribute_table configuration")

        blueprint_id = attr_table.get("name")  # Now this is blueprint_id instead of binding_object
        attr_source = attr_table.get("source")
        attr_node = attr_table.get("node")

        # Detailed validation
        missing_fields = []
        if not blueprint_id:
            missing_fields.append("name")
        if not attr_source:
            missing_fields.append("source")
        if not attr_node:
            missing_fields.append("node")

        if missing_fields:
            raise ValueError(f"Dimension '{dimension_id}' has incomplete attribute_table configuration. Missing fields: {', '.join(missing_fields)}")

        # Resolve blueprint_id to binding_object and get target database/schema from blueprint
        blueprints_config = blueprints_loader.get_all()
        binding_object = None
        blueprint_target_db = None
        blueprint_target_schema = None

        for source_obj in blueprints_config.get("sources", []):
            if source_obj.get("source") == attr_source:
                for bp in source_obj.get("blueprints", []):
                    if bp.get("id") == blueprint_id:
                        binding_object = bp.get("binding_object")
                        break
                if binding_object:
                    break

        if not binding_object:
            raise ValueError(f"Could not find blueprint '{blueprint_id}' in source '{attr_source}' to resolve binding_object")

        # Get target database/schema from blueprints (where attributes are deployed)
        blueprint_target_db = blueprints_config.get("target", {}).get("database")
        blueprint_target_schema = blueprints_config.get("target", {}).get("schema")

        # Use binding_object for the actual table name
        attr_name = binding_object

        # Get database/schema - prioritize dimension-specific, then fall back to blueprint target, then dimensional_models defaults
        dimensional_models_config = dimensional_models_loader.get_all()
        attr_db = (attr_table.get("database") or
                   blueprint_target_db or
                   dimensional_models_config.get("source_database") or
                   dimensional_models_config.get("model_database"))
        attr_schema = (attr_table.get("schema") or
                       blueprint_target_schema or
                       dimensional_models_config.get("source_schema") or
                       dimensional_models_config.get("model_schema"))

        yield {
            "timestamp": datetime.utcnow().isoformat(),
            "level": "SUCCESS",
            "step": "validation",
            "object_name": dimension_id,
            "status": "complete",
            "message": f"Configuration validated for dimension '{dimension_id}'"
        }

        # Step 2: Check if source attribute table exists
        yield {
            "timestamp": datetime.utcnow().isoformat(),
            "level": "INFO",
            "step": "source_validation",
            "object_name": dimension_id,
            "status": "starting",
            "message": f"Checking source table {attr_db}.{attr_schema}.ATTR_{attr_node}_{attr_name}_{attr_source}"
        }

        # Verify the attribute table exists
        check_sql = f"SHOW TABLES LIKE 'ATTR_{attr_node.upper()}_{attr_name.upper()}_{attr_source.upper()}' IN {attr_db}.{attr_schema}"
        result = client.run(check_sql)

        if not result or len(result) == 0:
            raise ValueError(f"Source attribute table ATTR_{attr_node}_{attr_name}_{attr_source} not found in {attr_db}.{attr_schema}")

        yield {
            "timestamp": datetime.utcnow().isoformat(),
            "level": "SUCCESS",
            "step": "source_validation",
            "object_name": dimension_id,
            "status": "complete",
            "message": f"Source attribute table verified"
        }

        # Step 3: Generate dimension view SQL
        yield {
            "timestamp": datetime.utcnow().isoformat(),
            "level": "INFO",
            "step": "dimension_view",
            "object_name": dimension_id,
            "status": "starting",
            "message": f"Generating dimension view SQL for '{dimension_id}'"
        }

        # Prepare template context
        columns = dimension_config.get("columns", [])
        dimension_name = dimension_config.get("name", dimension_id)
        description = dimension_config.get("description", "")
        belongs_to = dimension_config.get("belongs_to", "")

        # Build column selections for the view
        column_selections = []
        for col in columns:
            col_name = col.get("name")
            col_type = col.get("type", "string")
            col_desc = col.get("description", "")
            # Map blueprint_mapping to the actual source column
            blueprint_mapping = col.get("blueprint_mapping", "")

            if blueprint_mapping:
                # Extract the column name from blueprint mapping (e.g., "pronto.blueprint.column_name")
                parts = blueprint_mapping.split(".")
                source_col = parts[-1] if len(parts) > 0 else col_name
            else:
                source_col = col_name

            column_selections.append({
                "name": col_name.upper(),
                "source": source_col.upper(),
                "type": col_type,
                "description": col_desc
            })

        # Create SQL for dimension view (simplified presentation view)
        view_name = f"V_DIM_{dimension_id.upper()}"

        # Build the SELECT statement with proper comma separation
        select_cols = []
        for col in column_selections:
            select_cols.append(f"    {col['source']} AS {col['name']}")

        # Add standard columns
        select_cols.append(f"    {attr_node.upper()}_HK AS {attr_node.upper()}_KEY")
        select_cols.append("    INGEST_TIME")
        select_cols.append("    LOAD_TIME")
        select_cols.append("    LOADED_FROM")

        # Join columns with commas
        select_statement = ",\n".join(select_cols)

        create_or_replace = "OR REPLACE VIEW" if replace_objects else "VIEW IF NOT EXISTS"

        dimension_sql = f"""
-- Dimension View: {dimension_name}
-- Description: {description}
-- Group: {belongs_to}
-- Generated by DimensionalModelDeployment

CREATE {create_or_replace} {model_database}.{model_schema}.{view_name}
AS
SELECT
{select_statement}
FROM {attr_db}.{attr_schema}.ATTR_{attr_node.upper()}_{attr_name.upper()}_{attr_source.upper()}
QUALIFY ROW_NUMBER() OVER (
    PARTITION BY {attr_node.upper()}_HK
    ORDER BY INGEST_TIME DESC
) = 1;

-- Add view metadata comment
COMMENT ON VIEW {model_database}.{model_schema}.{view_name} IS
'{description} (Group: {belongs_to})';
"""

        yield {
            "timestamp": datetime.utcnow().isoformat(),
            "level": "INFO",
            "step": "dimension_view",
            "object_name": dimension_id,
            "status": "in_progress",
            "message": f"Executing CREATE VIEW {view_name}"
        }

        # Execute the view creation
        client.run(dimension_sql)
        
        # Track deployed view name
        deployed_view_name = f"{model_database}.{model_schema}.{view_name}"

        yield {
            "timestamp": datetime.utcnow().isoformat(),
            "level": "SUCCESS",
            "step": "dimension_view",
            "object_name": dimension_id,
            "status": "complete",
            "message": f"Dimension view {view_name} created successfully"
        }

        # Step 4: Mark as complete
        yield {
            "timestamp": datetime.utcnow().isoformat(),
            "level": "SUCCESS",
            "step": "complete",
            "object_name": dimension_id,
            "status": "complete",
            "message": f"Dimension '{dimension_id}' deployed successfully"
        }
        
        # Update deployed status with view name
        dimension_config["deployed"] = deployed_view_name
        dimension_config["deployment_error"] = None
        dimensional_models_loader.update_dimension(dimension_id, dimension_config)

    except Exception as e:
        yield {
            "timestamp": datetime.utcnow().isoformat(),
            "level": "ERROR",
            "step": "error",
            "object_name": dimension_id,
            "status": "failed",
            "message": f"Error deploying dimension '{dimension_id}': {str(e)}"
        }
        raise


async def _deploy_single_fact_streaming(
    fact_id: str,
    fact_config: dict,
    model_database: str,
    model_schema: str,
    replace_objects: bool,
    client: SnowflakeClient
) -> AsyncGenerator[dict, None]:
    """
    Deploy a single fact with streaming logs.
    Yields log events as dictionaries.
    """
    try:
        # Step 1: Validate configuration
        yield {
            "timestamp": datetime.utcnow().isoformat(),
            "level": "INFO",
            "step": "validation",
            "object_name": fact_id,
            "status": "starting",
            "message": f"Validating fact '{fact_id}' configuration"
        }

        # Get edges and attributes info
        edges = fact_config.get("edges", [])
        join_keys = fact_config.get("join_keys", [])
        attributes = fact_config.get("attributes", {})

        if not edges:
            raise ValueError(f"Fact '{fact_id}' missing edges configuration")

        if not attributes:
            raise ValueError(f"Fact '{fact_id}' missing attributes configuration")

        attr_table = attributes.get("attribute_table", {})
        if not attr_table:
            raise ValueError(f"Fact '{fact_id}' missing attribute_table configuration")

        # Resolve blueprint_id to binding_object for facts
        blueprint_id = attr_table.get("name")
        attr_source = attr_table.get("source")

        if blueprint_id and attr_source:
            blueprints_config = blueprints_loader.get_all()
            binding_object = None
            blueprint_target_db = None
            blueprint_target_schema = None

            for source_obj in blueprints_config.get("sources", []):
                if source_obj.get("source") == attr_source:
                    for bp in source_obj.get("blueprints", []):
                        if bp.get("id") == blueprint_id:
                            binding_object = bp.get("binding_object")
                            break
                    if binding_object:
                        break

            # Get target database/schema from blueprints
            blueprint_target_db = blueprints_config.get("target", {}).get("database")
            blueprint_target_schema = blueprints_config.get("target", {}).get("schema")

            if binding_object:
                # Update the attribute_table name to use binding_object
                attr_table["name"] = binding_object

            # Update database/schema - prioritize fact-specific, then fall back to blueprint target, then dimensional_models defaults
            # Note: This runs even if binding_object is None, to ensure database/schema are always set
            dimensional_models_config = dimensional_models_loader.get_all()
            if not attr_table.get("database"):
                attr_table["database"] = (blueprint_target_db or
                                          dimensional_models_config.get("source_database") or
                                          dimensional_models_config.get("model_database"))
            if not attr_table.get("schema"):
                attr_table["schema"] = (blueprint_target_schema or
                                       dimensional_models_config.get("source_schema") or
                                       dimensional_models_config.get("model_schema"))

        yield {
            "timestamp": datetime.utcnow().isoformat(),
            "level": "SUCCESS",
            "step": "validation",
            "object_name": fact_id,
            "status": "complete",
            "message": f"Configuration validated for fact '{fact_id}'"
        }

        # Step 2: Validate that all referenced edges exist
        yield {
            "timestamp": datetime.utcnow().isoformat(),
            "level": "INFO",
            "step": "edge_validation",
            "object_name": fact_id,
            "status": "starting",
            "message": f"Validating {len(edges)} edge table(s)"
        }

        for edge in edges:
            edge_name = edge.get("name")
            if not edge_name:
                raise ValueError(f"Edge in fact '{fact_id}' missing name")

            check_sql = f"SHOW TABLES LIKE 'EDGE_{edge_name.upper()}' IN {model_database}.{model_schema}"
            result = client.run(check_sql)

            if not result or len(result) == 0:
                raise ValueError(f"Edge table EDGE_{edge_name} not found in {model_database}.{model_schema}")

        yield {
            "timestamp": datetime.utcnow().isoformat(),
            "level": "SUCCESS",
            "step": "edge_validation",
            "object_name": fact_id,
            "status": "complete",
            "message": f"All edge tables validated"
        }

        # Step 3: Generate fact view SQL from template
        yield {
            "timestamp": datetime.utcnow().isoformat(),
            "level": "INFO",
            "step": "fact_view",
            "object_name": fact_id,
            "status": "starting",
            "message": f"Generating fact view SQL for '{fact_id}'"
        }

        # Use Jinja2 template
        jinja_env = Environment(loader=FileSystemLoader(str(TEMPLATE_PATH)))
        template = jinja_env.get_template("create_fact_view.sql")

        # Prepare template context
        fact_name = fact_id
        description = fact_config.get("description", "")
        belongs_to = fact_config.get("belongs_to", "")
        columns = fact_config.get("columns", [])
        bridge_pattern = fact_config.get("bridge_pattern", False)

        # Render the template
        fact_sql = template.render(
            replace_objects=replace_objects,
            model_database=model_database,
            model_schema=model_schema,
            fact_name=fact_name,
            description=description,
            group=belongs_to,
            bridge_pattern=bridge_pattern,
            edges=edges,
            join_keys=join_keys,
            attributes=attributes,
            columns=columns
        )

        yield {
            "timestamp": datetime.utcnow().isoformat(),
            "level": "INFO",
            "step": "fact_view",
            "object_name": fact_id,
            "status": "in_progress",
            "message": f"Executing CREATE VIEW V_FACT_{fact_id.upper()}"
        }

        # Execute the view creation
        client.run(fact_sql)
        
        # Track deployed view name
        deployed_view_name = f"{model_database}.{model_schema}.V_FACT_{fact_id.upper()}"

        yield {
            "timestamp": datetime.utcnow().isoformat(),
            "level": "SUCCESS",
            "step": "fact_view",
            "object_name": fact_id,
            "status": "complete",
            "message": f"Fact view V_FACT_{fact_id.upper()} created successfully"
        }

        # Step 4: Mark as complete
        yield {
            "timestamp": datetime.utcnow().isoformat(),
            "level": "SUCCESS",
            "step": "complete",
            "object_name": fact_id,
            "status": "complete",
            "message": f"Fact '{fact_id}' deployed successfully"
        }
        
        # Update deployed status with view name
        fact_config["deployed"] = deployed_view_name
        fact_config["deployment_error"] = None
        dimensional_models_loader.update_fact(fact_id, fact_config)

    except Exception as e:
        yield {
            "timestamp": datetime.utcnow().isoformat(),
            "level": "ERROR",
            "step": "error",
            "object_name": fact_id,
            "status": "failed",
            "message": f"Error deploying fact '{fact_id}': {str(e)}"
        }
        raise


@router.post("/dimensional-models/deploy/follow")
async def deploy_dimensional_models_follow(request: DimensionalModelDeployRequest):
    """
    Deploy dimensions and facts with streaming logs (SSE).

    Accepts:
    - dimensions: List of dimension IDs to deploy
    - facts: List of fact IDs to deploy
    - replace_objects: Whether to use CREATE OR REPLACE (default: true)
    - model_database: Override target database (optional)
    - model_schema: Override target schema (optional)

    Returns SSE events: log, dimension_start, dimension_complete, fact_start, fact_complete, error, complete, close
    """

    async def event_generator() -> AsyncGenerator[str, None]:
        deployment_events: List[Dict[str, Any]] = []
        final_summary: Optional[Dict[str, Any]] = None
        error_message: Optional[str] = None
        successful: List[Dict[str, Any]] = []
        failed: List[Dict[str, Any]] = []
        total_count = len(request.dimensions) + len(request.facts)

        def send_event(event_type: str, data: dict) -> str:
            deployment_events.append({
                "event": event_type,
                "data": data
            })
            return f"event: {event_type}\ndata: {json.dumps(data)}\n\n"

        try:
            # Load dimensional models configuration
            config = dimensional_models_loader.get_all()

            # Get database and schema from config or request
            model_database = request.model_database or config.get("model_database")
            model_schema = request.model_schema or config.get("model_schema")

            if not model_database or not model_schema:
                raise ValueError("model_database and model_schema must be specified in config or request")

            # Count processed items
            current = 0

            yield send_event("log", {
                "timestamp": datetime.utcnow().isoformat(),
                "message": f"Starting deployment of {len(request.dimensions)} dimension(s) and {len(request.facts)} fact(s)",
                "level": "INFO"
            })

            # Create single shared Snowflake connection for all deployments
            with SnowflakeClient() as shared_client:
                yield send_event("log", {
                    "timestamp": datetime.utcnow().isoformat(),
                    "message": "Connected to Snowflake (shared connection for all dimensional models)",
                    "level": "INFO"
                })

                # Deploy dimensions first
                dimensions_list = config.get("dimensions", [])
                for dimension_id in request.dimensions:
                    current += 1

                    # Find dimension config
                    dimension_config = None
                    for dim in dimensions_list:
                        if dim.get("id") == dimension_id:
                            dimension_config = dim
                            break

                    if not dimension_config:
                        failed.append({"type": "dimension", "id": dimension_id, "error": "Configuration not found"})
                        yield send_event("log", {
                            "timestamp": datetime.utcnow().isoformat(),
                            "message": f"Dimension '{dimension_id}' not found in configuration",
                            "level": "ERROR"
                        })
                        continue

                    yield send_event("dimension_start", {
                        "timestamp": datetime.utcnow().isoformat(),
                        "dimension_id": dimension_id,
                        "index": current,
                        "total": total_count
                    })

                    deployment_successful = False
                    try:
                        # Stream deployment logs for this dimension
                        async for log_event in _deploy_single_dimension_streaming(
                            dimension_id=dimension_id,
                            dimension_config=dimension_config,
                            model_database=model_database,
                            model_schema=model_schema,
                            replace_objects=request.replace_objects,
                            client=shared_client
                        ):
                            # Forward all log events as SSE
                            yield send_event("log", log_event)

                            # Track if deployment completed successfully
                            if log_event.get("step") == "complete" and log_event.get("status") == "complete":
                                deployment_successful = True

                        if deployment_successful:
                            successful.append({"type": "dimension", "id": dimension_id})
                            # Deployed status is already updated in _deploy_single_dimension_streaming
                            yield send_event("dimension_complete", {
                                "timestamp": datetime.utcnow().isoformat(),
                                "dimension_id": dimension_id,
                                "status": "success"
                            })
                        else:
                            failed.append({"type": "dimension", "id": dimension_id, "error": "Deployment did not complete"})
                            dimension_config["deployed"] = None
                            dimension_config["deployment_error"] = "Deployment did not complete"
                            dimensional_models_loader.update_dimension(dimension_id, dimension_config)

                    except Exception as e:
                        failed.append({"type": "dimension", "id": dimension_id, "error": str(e)})
                        dimension_config["deployed"] = None
                        dimension_config["deployment_error"] = str(e)
                        dimensional_models_loader.update_dimension(dimension_id, dimension_config)
                        yield send_event("dimension_complete", {
                            "timestamp": datetime.utcnow().isoformat(),
                            "dimension_id": dimension_id,
                            "status": "failed",
                            "error": str(e)
                        })

                # Deploy facts second
                facts_list = config.get("facts", [])
                for fact_id in request.facts:
                    current += 1

                    # Find fact config
                    fact_config = None
                    for fct in facts_list:
                        if fct.get("id") == fact_id:
                            fact_config = fct
                            break

                    if not fact_config:
                        failed.append({"type": "fact", "id": fact_id, "error": "Configuration not found"})
                        yield send_event("log", {
                            "timestamp": datetime.utcnow().isoformat(),
                            "message": f"Fact '{fact_id}' not found in configuration",
                            "level": "ERROR"
                        })
                        continue

                    yield send_event("fact_start", {
                        "timestamp": datetime.utcnow().isoformat(),
                        "fact_id": fact_id,
                        "index": current,
                        "total": total_count
                    })

                    deployment_successful = False
                    try:
                        # Stream deployment logs for this fact
                        async for log_event in _deploy_single_fact_streaming(
                            fact_id=fact_id,
                            fact_config=fact_config,
                            model_database=model_database,
                            model_schema=model_schema,
                            replace_objects=request.replace_objects,
                            client=shared_client
                        ):
                            # Forward all log events as SSE
                            yield send_event("log", log_event)

                            # Track if deployment completed successfully
                            if log_event.get("step") == "complete" and log_event.get("status") == "complete":
                                deployment_successful = True

                        if deployment_successful:
                            successful.append({"type": "fact", "id": fact_id})
                            # Deployed status is already updated in _deploy_single_fact_streaming
                            yield send_event("fact_complete", {
                                "timestamp": datetime.utcnow().isoformat(),
                                "fact_id": fact_id,
                                "status": "success"
                            })
                        else:
                            failed.append({"type": "fact", "id": fact_id, "error": "Deployment did not complete"})
                            fact_config["deployed"] = None
                            fact_config["deployment_error"] = "Deployment did not complete"
                            dimensional_models_loader.update_fact(fact_id, fact_config)

                    except Exception as e:
                        failed.append({"type": "fact", "id": fact_id, "error": str(e)})
                        fact_config["deployed"] = None
                        fact_config["deployment_error"] = str(e)
                        dimensional_models_loader.update_fact(fact_id, fact_config)
                        yield send_event("fact_complete", {
                            "timestamp": datetime.utcnow().isoformat(),
                            "fact_id": fact_id,
                            "status": "failed",
                            "error": str(e)
                        })

            # Send final summary
            final_summary = {
                "timestamp": datetime.utcnow().isoformat(),
                "message": f"Deployment complete: {len(successful)} successful, {len(failed)} failed",
                "total": total_count,
                "successful": successful,
                "failed": failed
            }
            yield send_event("complete", final_summary)

        except Exception as e:
            error_message = str(e)
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

            if not summary_payload.get("timestamp"):
                summary_payload["timestamp"] = datetime.utcnow().isoformat()

            success_count = len(successful)
            failure_count = len(failed)
            error_count = failure_count if failure_count > 0 else (1 if error_message else 0)

            if error_message or failure_count > 0:
                status = "failed" if success_count == 0 else "partial"
            else:
                status = "success"

            logger.info(
                f"Calling persist_deployment_log: type=dimensional_models_follow, "
                f"events={len(deployment_events)}, status={status}, "
                f"success={success_count}, errors={error_count}, total={total_count}"
            )
            persist_deployment_log(
                deployment_type="dimensional_models_follow",
                model_ids={
                    "dimensions": request.dimensions,
                    "facts": request.facts
                },
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

# ============================================================================
# MODAL LOADER ENDPOINT
# ============================================================================

@router.post("/dimensional-models/modal-loader", response_model=Dict[str, Any])
async def load_modal_data(model_ids: List[str] = Body(..., embed=True)):
    """
    Load all data needed for the wizard modal in a single API call.
    Returns: databases_schemas, blueprints, schema_tables, table_fields
    """
    import time
    start_total = time.time()

    try:
        # Removed verbose debug printing; rely on structured logging instead

        # Get blueprints for the selected models
        start = time.time()
        blueprints_response = await get_blueprints_for_models(model_ids)
        print(f"⏱️  Blueprints: {(time.time()-start)*1000:.0f}ms")

        blueprints = blueprints_response.get("blueprints", {})

        # Get list of databases and pre-load schemas/tables for bound blueprints
        databases = []
        databases_schemas_map = {}  # db -> schemas mapping for bound DBs
        schema_tables = {}
        table_fields = {}

        with SnowflakeClient() as client:
            # Get all databases
            start = time.time()
            databases_result = client.run("SHOW DATABASES")
            for db_row in databases_result:
                db_name = db_row[1]
                databases.append(db_name)
            print(f"⏱️  SHOW DATABASES: {(time.time()-start)*1000:.0f}ms ({len(databases)} databases)")

            # Collect unique bound databases and schemas from blueprints
            bound_dbs = {}  # db -> set of schemas
            for source_name, source_blueprints in blueprints.items():
                for bp in source_blueprints:
                    binding_db = bp.get("binding_db")
                    binding_schema = bp.get("binding_schema")

                    if binding_db and binding_schema:
                        if binding_db not in bound_dbs:
                            bound_dbs[binding_db] = set()
                        bound_dbs[binding_db].add(binding_schema)
            print(f"⏱️  Found {len(bound_dbs)} bound databases with schemas")

            # Pre-load schemas and tables for bound databases
            start = time.time()
            for db_name in bound_dbs.keys():
                try:
                    # Load all schemas for this bound database
                    start_schemas = time.time()
                    schemas_result = client.run(f"SHOW SCHEMAS IN DATABASE {db_name}")
                    schemas = [row[1] for row in schemas_result]
                    # Use uppercase key to match frontend expectations
                    databases_schemas_map[db_name.upper()] = schemas
                    print(f"  ⏱️  SHOW SCHEMAS IN {db_name}: {(time.time()-start_schemas)*1000:.0f}ms ({len(schemas)} schemas)")

                    # Load tables for each bound schema
                    for schema_name in bound_dbs[db_name]:
                        # Use uppercase for cache key to match frontend
                        schema_key = f"{db_name.upper()}.{schema_name.upper()}"
                        try:
                            start_tables = time.time()
                            tables_result = client.run(f"SHOW TABLES IN SCHEMA {db_name}.{schema_name}")
                            tables = [{"name": row[1]} for row in tables_result]
                            schema_tables[schema_key] = tables
                            print(f"    ⏱️  SHOW TABLES IN {schema_key}: {(time.time()-start_tables)*1000:.0f}ms ({len(tables)} tables)")
                        except Exception as e:
                            print(f"Could not load tables for {schema_key}: {e}")
                            schema_tables[schema_key] = []
                except Exception as e:
                    print(f"Could not load schemas for {db_name}: {e}")
            print(f"⏱️  Total schemas+tables loading: {(time.time()-start)*1000:.0f}ms")

            # Load fields for bound tables
            start = time.time()
            field_count = 0
            for source_name, source_blueprints in blueprints.items():
                for bp in source_blueprints:
                    binding_db = bp.get("binding_db")
                    binding_schema = bp.get("binding_schema")
                    binding_object = bp.get("binding_object")

                    if binding_db and binding_schema and binding_object:
                        # Use uppercase for cache key to match frontend
                        table_key = f"{binding_db.upper()}.{binding_schema.upper()}.{binding_object.upper()}"
                        if table_key not in table_fields:
                            try:
                                start_fields = time.time()
                                fields_result = client.run(f"DESCRIBE TABLE {binding_db}.{binding_schema}.{binding_object}")
                                fields = [{"name": row[0], "type": row[1]} for row in fields_result]
                                table_fields[table_key] = fields
                                field_count += 1
                                print(f"    ⏱️  DESCRIBE {table_key}: {(time.time()-start_fields)*1000:.0f}ms ({len(fields)} fields)")
                            except Exception as e:
                                print(f"Could not load fields for {table_key}: {e}")
                                table_fields[table_key] = []
            print(f"⏱️  Total fields loading: {(time.time()-start)*1000:.0f}ms ({field_count} tables)")

        print(f"⏱️  TOTAL modal-loader: {(time.time()-start_total)*1000:.0f}ms")

        return {
            "message": "Modal data loaded successfully",
            "databases": databases,
            "databases_schemas_map": databases_schemas_map,  # Pre-loaded schemas for bound DBs
            "blueprints": blueprints,
            "schema_tables": schema_tables,
            "table_fields": table_fields
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback
        print(f"ERROR in modal-loader: {str(e)}")
        print(f"Full traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Failed to load modal data: {str(e)}")


# ============================================================================
# BLUEPRINT DISCOVERY ENDPOINT
# ============================================================================

@router.post("/dimensional-models/blueprints", response_model=Dict[str, Any])
async def get_blueprints_for_models(model_ids: List[str] = Body(..., embed=True)):
    """
    Get all blueprints referenced by the specified dimensional models (dimensions and/or facts).
    Analyzes the blueprint_mapping fields in model columns to find required blueprints.
    """
    try:
        # Load dimensional models config
        dim_config = dimensional_models_loader.get_all()
        dimensions = dim_config.get("dimensions", [])
        facts = dim_config.get("facts", [])

        # Combine all models
        all_models = dimensions + facts

        # Filter to requested models
        selected_models = [m for m in all_models if m.get("id") in model_ids]

        if not selected_models:
            return {
                "message": "No models found for the provided IDs",
                "blueprints": {}
            }

        # Extract blueprint references from columns
        blueprint_keys = set()
        for model in selected_models:
            columns = model.get("columns", [])
            for col in columns:
                mapping = col.get("blueprint_mapping") or col.get("source")
                if mapping and isinstance(mapping, str) and "." in mapping:
                    parts = mapping.split(".")
                    if len(parts) >= 2:
                        # Format: source.blueprint_name.field
                        source = parts[0]
                        blueprint_name = parts[1]
                        blueprint_keys.add(f"{source}.{blueprint_name}")


        # Load blueprints config
        blueprints_config = blueprints_loader.get_all()

        # Filter blueprints to only those referenced
        result_blueprints = {}
        sources_list = blueprints_config.get("sources", [])
        
        for source_obj in sources_list:
            source_name = source_obj.get("source")
            blueprints_list = source_obj.get("blueprints", [])
            
            if not source_name or not blueprints_list:
                continue
            
            filtered_blueprints = []
            for bp in blueprints_list:
                # Blueprints use 'id' field, not 'name'
                bp_id = bp.get("id")
                if bp_id:
                    key = f"{source_name}.{bp_id}"
                    if key in blueprint_keys:
                        # Add source to blueprint object for easier frontend use
                        bp_with_source = dict(bp)
                        bp_with_source["source"] = source_name
                        # Also add 'name' field from 'id' for compatibility
                        if "name" not in bp_with_source:
                            bp_with_source["name"] = bp_id
                        filtered_blueprints.append(bp_with_source)
            
            if filtered_blueprints:
                result_blueprints[source_name] = filtered_blueprints

        total_blueprints = sum(len(bps) for bps in result_blueprints.values())

        return {
            "message": f"Found {total_blueprints} blueprints for {len(selected_models)} models",
            "model_ids": model_ids,
            "blueprint_keys": list(blueprint_keys),
            "blueprints": result_blueprints
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get blueprints for models: {str(e)}")

