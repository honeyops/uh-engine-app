"""
Blueprint deployment routes
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from typing import Optional, AsyncGenerator, Dict, List, Any
import asyncio
import json
import traceback
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

from api.schema.api_schema import (
    BlueprintDeployRequest, BlueprintListResponse, BlueprintGetResponse,
    BlueprintBindingsRequest, BlueprintBindingsUpdateRequest, BlueprintBindingsResponse,
    FullRefreshRequest, FullRefreshResponse, BlueprintListDetailedResponse, BlueprintDetail
)
from pydantic import BaseModel
from core.sql_render import SQLRenderer
from core.snowflake import SnowflakeClient
from core.config_loader import blueprints_loader
from core.config import config_database
from core.deployment_logs import persist_deployment_log

router = APIRouter()


def _update_blueprint_deployed_status(blueprint_id: str, deployed_objects: list[str] = None, error_message: str = None):
    """
    Update the 'deployed' field in the blueprint table with array of deployed object names.
    Blueprint IDs are unique, so source_name is not needed.

    Args:
        blueprint_id: Blueprint ID (unique across all sources)
        deployed_objects: List of fully qualified object names (e.g., ["DB.SCHEMA.VIEW_NAME", "DB.SCHEMA.STREAM_NAME"])
        error_message: Optional error message if deployment failed
    """
    try:
        with SnowflakeClient() as client:
            config_db = config_database["database_name"]
            config_schema = config_database["schema_name"]
            blueprints_table = config_database["blueprints"]
            
            if deployed_objects is None:
                deployed_objects = []
            
            # Convert list to JSON string for VARIANT column
            deployed_json = json.dumps(deployed_objects) if deployed_objects else None
            
            update_sql = f"""
                UPDATE {config_db}.{config_schema}.{blueprints_table}
                SET deployed = PARSE_JSON(%s),
                    deployment_error = %s
                WHERE blueprint_id = %s
            """
            client.run(update_sql, (deployed_json, error_message, blueprint_id))
    except Exception as e:
        # Log but don't fail deployment on status update error
        print(f"Warning: Could not update deployed status: {e}")


async def _deploy_single_blueprint_streaming(
    blueprint_id: str,
    replace_objects: bool,
    run_full_refresh: bool,
    database_name: Optional[str],
    client: SnowflakeClient
) -> AsyncGenerator[dict, None]:
    """
    Deploy a single blueprint with streaming log events.

    Yields log events for each deployment step:
    - level: INFO, SUCCESS, ERROR, WARNING
    - step: step name (e.g., "nodes", "edges", "attributes")
    - object_name: name of object being deployed
    - status: "starting", "complete", "failed"
    - timestamp: ISO format timestamp
    - message: human-readable message

    Modeled after the original run.py deployment steps.
    """
    steps_completed = []
    deployed_objects = []  # Track all deployed objects for the deployed column

    try:
        yield {
            "level": "INFO",
            "step": "initialization",
            "object_name": blueprint_id,
            "status": "starting",
            "timestamp": datetime.utcnow().isoformat(),
            "message": f"Initializing deployment for blueprint '{blueprint_id}'"
        }

        # Initialize renderer
        with SQLRenderer(blueprint_id, compile=True, replace_objects=replace_objects, target_database=database_name) as renderer:
            context = renderer.get_base_context()
            target_db = context["target"]["database"]
            target_schema = context["target"]["schema"]
            stage_db = context["stage"]["database"]
            stage_schema = context["stage"]["schema"]

            # Get the binding_object (actual table name) for object naming
            binding_object = renderer.table.get("name")  # This is the binding_object from _normalize_blueprint

            # Step 0: Database validation
            yield {
                "level": "INFO",
                "step": "database_validation",
                "object_name": target_db,
                "status": "starting",
                "timestamp": datetime.utcnow().isoformat(),
                "message": f"Validating target database '{target_db}'"
            }

            db_check_sql = f"SHOW DATABASES LIKE '{target_db}'"
            db_result = client.run(db_check_sql)
            if not db_result or len(db_result) == 0:
                raise ValueError(f"Target database '{target_db}' does not exist")

            yield {
                "level": "SUCCESS",
                "step": "database_validation",
                "object_name": target_db,
                "status": "complete",
                "timestamp": datetime.utcnow().isoformat(),
                "message": f"Database '{target_db}' validated"
            }
            steps_completed.append("database_validation")

            # Step 1: Source validation
            yield {
                "level": "INFO",
                "step": "source_validation",
                "object_name": blueprint_id,
                "status": "starting",
                "timestamp": datetime.utcnow().isoformat(),
                "message": "Validating source table exists"
            }

            validation_sql = renderer.validate_source_exists()

            yield {
                "level": "SUCCESS",
                "step": "source_validation",
                "object_name": blueprint_id,
                "status": "complete",
                "timestamp": datetime.utcnow().isoformat(),
                "message": "Source validation complete"
            }
            steps_completed.append("source_validation")

            # Step 2: Stage view DDL
            view_name = f"VIEW_{binding_object.upper()}"
            yield {
                "level": "INFO",
                "step": "stage_view",
                "object_name": view_name,
                "status": "starting",
                "timestamp": datetime.utcnow().isoformat(),
                "message": f"Creating stage view {stage_db}.{stage_schema}.{view_name}"
            }

            view_sql = renderer.create_view()
            client.run(view_sql)
            
            # Track deployed object
            deployed_objects.append(f"{stage_db}.{stage_schema}.STG_{binding_object.upper()}_{renderer.source_name.upper()}")

            yield {
                "level": "SUCCESS",
                "step": "stage_view",
                "object_name": view_name,
                "status": "complete",
                "timestamp": datetime.utcnow().isoformat(),
                "message": f"Stage view created: {stage_db}.{stage_schema}.{view_name}"
            }
            steps_completed.append("stage_view")

            # Step 3: Stream DDL
            stream_name = f"STREAM_{binding_object.upper()}"
            yield {
                "level": "INFO",
                "step": "stream",
                "object_name": stream_name,
                "status": "starting",
                "timestamp": datetime.utcnow().isoformat(),
                "message": f"Creating stream {stage_db}.{stage_schema}.{stream_name}"
            }

            stream_sql = renderer.create_stream()
            client.run(stream_sql)
            
            # Track deployed object
            deployed_objects.append(f"{stage_db}.{stage_schema}.{stream_name}")

            yield {
                "level": "SUCCESS",
                "step": "stream",
                "object_name": stream_name,
                "status": "complete",
                "timestamp": datetime.utcnow().isoformat(),
                "message": f"Stream created: {stage_db}.{stage_schema}.{stream_name}"
            }
            steps_completed.append("stream")

            # Step 4: Nodes DDL
            yield {
                "level": "INFO",
                "step": "nodes",
                "object_name": "nodes",
                "status": "starting",
                "timestamp": datetime.utcnow().isoformat(),
                "message": "Creating node tables"
            }

            nodes_sqls = renderer.create_nodes()
            node_count = 0
            primary_node = renderer.table["primary_node"]["node"].upper()
            
            # Track primary node
            deployed_objects.append(f"{target_db}.{target_schema}.NODE_{primary_node}")
            
            for node_sql in nodes_sqls:
                client.run(node_sql)
                node_count += 1
            
            # Track secondary nodes that are loaded
            for sec_node in renderer.table.get("secondary_nodes", []):
                if sec_node.get("load", True):
                    sec_node_name = sec_node["node"].upper()
                    deployed_objects.append(f"{target_db}.{target_schema}.NODE_{sec_node_name}")

            yield {
                "level": "SUCCESS",
                "step": "nodes",
                "object_name": "nodes",
                "status": "complete",
                "timestamp": datetime.utcnow().isoformat(),
                "message": f"Nodes created: {node_count} node table(s) in {target_db}.{target_schema}"
            }
            steps_completed.append("nodes")

            # Step 5: Edges DDL
            yield {
                "level": "INFO",
                "step": "edges",
                "object_name": "edges",
                "status": "starting",
                "timestamp": datetime.utcnow().isoformat(),
                "message": "Creating edge tables"
            }

            edges_sqls = renderer.create_edges()
            edge_count = 0
            primary_node = renderer.table["primary_node"]["node"].upper()
            # Track edges - one per secondary node
            for sec_node in renderer.table.get("secondary_nodes", []):
                sec_node_name = sec_node["node"].upper()
                deployed_objects.append(f"{target_db}.{target_schema}.EDGE_{primary_node}_{sec_node_name}")
            
            for edge_sql in edges_sqls:
                client.run(edge_sql)
                edge_count += 1

            yield {
                "level": "SUCCESS",
                "step": "edges",
                "object_name": "edges",
                "status": "complete",
                "timestamp": datetime.utcnow().isoformat(),
                "message": f"Edges created: {edge_count} edge table(s) in {target_db}.{target_schema}"
            }
            steps_completed.append("edges")

            # Step 6: Attributes DDL
            primary_node = renderer.table["primary_node"]["node"].upper()
            table_name = renderer.table.get("name", blueprint_id).upper()
            # Get source_name from renderer context (it's still available for template rendering)
            source_name = renderer.source_name.upper() if hasattr(renderer, 'source_name') and renderer.source_name else "UNKNOWN"
            attr_table_name = f"ATTR_{primary_node}_{table_name}_{source_name}"

            yield {
                "level": "INFO",
                "step": "attributes",
                "object_name": attr_table_name,
                "status": "starting",
                "timestamp": datetime.utcnow().isoformat(),
                "message": f"Creating attribute table {target_db}.{target_schema}.{attr_table_name}"
            }

            attr_sql = renderer.create_attribute()
            client.run(attr_sql)
            
            # Track deployed object
            deployed_objects.append(f"{target_db}.{target_schema}.{attr_table_name}")

            yield {
                "level": "SUCCESS",
                "step": "attributes",
                "object_name": attr_table_name,
                "status": "complete",
                "timestamp": datetime.utcnow().isoformat(),
                "message": f"Attribute table created: {target_db}.{target_schema}.{attr_table_name}"
            }
            steps_completed.append("attributes")

            # Step 7: Multi-table insert (MTI)
            yield {
                "level": "INFO",
                "step": "mti",
                "object_name": "multi_table_insert",
                "status": "starting",
                "timestamp": datetime.utcnow().isoformat(),
                "message": "Creating multi-table insert procedure"
            }

            mti_sql = renderer.mti()
            client.run(mti_sql)

            yield {
                "level": "SUCCESS",
                "step": "mti",
                "object_name": "multi_table_insert",
                "status": "complete",
                "timestamp": datetime.utcnow().isoformat(),
                "message": "Multi-table insert procedure created"
            }
            steps_completed.append("mti")

            # Step 8: Task DDL
            task_name = f"TASK_{binding_object.upper()}"
            yield {
                "level": "INFO",
                "step": "task",
                "object_name": task_name,
                "status": "starting",
                "timestamp": datetime.utcnow().isoformat(),
                "message": f"Creating and resuming task {stage_db}.{stage_schema}.{task_name}"
            }

            task_sql = renderer.create_task()
            try:
                client.run(task_sql)
            except Exception as task_error:
                yield {
                    "level": "ERROR",
                    "step": "task",
                    "object_name": task_name,
                    "status": "failed",
                    "timestamp": datetime.utcnow().isoformat(),
                    "message": f"Task creation failed: {str(task_error)}"
                }
                raise ValueError(f"Task creation failed: {str(task_error)}")

            client.run(f'ALTER TASK {stage_db}.{stage_schema}.{task_name} RESUME')
            
            # Track deployed object
            deployed_objects.append(f"{stage_db}.{stage_schema}.{task_name}")

            yield {
                "level": "SUCCESS",
                "step": "task",
                "object_name": task_name,
                "status": "complete",
                "timestamp": datetime.utcnow().isoformat(),
                "message": f"Task created and resumed: {stage_db}.{stage_schema}.{task_name}"
            }
            steps_completed.append("task")

            # Step 9: Full refresh (optional)
            if run_full_refresh:
                yield {
                    "level": "INFO",
                    "step": "full_refresh",
                    "object_name": "full_refresh_mti",
                    "status": "starting",
                    "timestamp": datetime.utcnow().isoformat(),
                    "message": "Executing full refresh (initial data load)"
                }

                # Generate full refresh SQL
                full_refresh_sql = renderer.full_refresh_mti()

                # Parse and execute TRUNCATE and INSERT statements separately
                # Full refresh MTI contains TRUNCATE statements followed by one large INSERT ALL
                lines = full_refresh_sql.split('\n')

                truncate_statements = []
                insert_start = -1
                insert_end = -1

                for i, line in enumerate(lines):
                    line_stripped = line.strip()
                    if line_stripped.startswith('TRUNCATE TABLE') and line_stripped.endswith(';'):
                        truncate_statements.append(line_stripped)
                    elif 'INSERT ALL' in line_stripped:
                        insert_start = i
                    elif insert_start != -1 and line_stripped.startswith('FROM') and line_stripped.endswith(';'):
                        insert_end = i
                        break

                # Execute TRUNCATE statements first
                for truncate_sql in truncate_statements:
                    client.run(truncate_sql)
                    yield {
                        "level": "INFO",
                        "step": "full_refresh",
                        "object_name": "truncate",
                        "status": "complete",
                        "timestamp": datetime.utcnow().isoformat(),
                        "message": f"Executed: {truncate_sql[:80]}..."
                    }

                # Execute the INSERT ALL statement as one block
                if insert_start != -1 and insert_end != -1:
                    insert_sql = '\n'.join(lines[insert_start:insert_end+1])
                    client.run(insert_sql)
                else:
                    yield {
                        "level": "WARNING",
                        "step": "full_refresh",
                        "object_name": "insert_all",
                        "status": "warning",
                        "timestamp": datetime.utcnow().isoformat(),
                        "message": "Could not find INSERT ALL statement in full refresh MTI"
                    }

                # Get data summary
                try:
                    node_count_result = client.run(
                        f"SELECT COUNT(*) as count FROM {target_db}.{target_schema}.NODE_{primary_node}"
                    )
                    attr_count_result = client.run(
                        f"SELECT COUNT(*) as count FROM {target_db}.{target_schema}.{attr_table_name}"
                    )

                    node_count = node_count_result[0][0] if node_count_result else 0
                    attr_count = attr_count_result[0][0] if attr_count_result else 0

                    yield {
                        "level": "SUCCESS",
                        "step": "full_refresh",
                        "object_name": "full_refresh_mti",
                        "status": "complete",
                        "timestamp": datetime.utcnow().isoformat(),
                        "message": f"Full refresh complete: NODE_{primary_node} ({node_count:,} records), {attr_table_name} ({attr_count:,} records)"
                    }

                    # Check secondary nodes
                    for sec_node in renderer.table.get("secondary_nodes", []):
                        if sec_node.get("load", True):
                            sec_node_name = sec_node["node"].upper()
                            sec_count_result = client.run(
                                f"SELECT COUNT(*) as count FROM {target_db}.{target_schema}.NODE_{sec_node_name}"
                            )
                            sec_count = sec_count_result[0][0] if sec_count_result else 0

                            yield {
                                "level": "INFO",
                                "step": "full_refresh",
                                "object_name": f"NODE_{sec_node_name}",
                                "status": "complete",
                                "timestamp": datetime.utcnow().isoformat(),
                                "message": f"  └─ NODE_{sec_node_name}: {sec_count:,} records"
                            }

                except Exception as e:
                    yield {
                        "level": "WARNING",
                        "step": "full_refresh",
                        "object_name": "data_summary",
                        "status": "partial",
                        "timestamp": datetime.utcnow().isoformat(),
                        "message": f"⚠ Full refresh completed but could not retrieve counts: {e}"
                    }

                steps_completed.append("full_refresh")

        # Update deployed status with list of deployed objects
        _update_blueprint_deployed_status(blueprint_id, deployed_objects)

        yield {
            "level": "SUCCESS",
            "step": "complete",
            "object_name": blueprint_id,
            "status": "complete",
            "timestamp": datetime.utcnow().isoformat(),
            "message": f"Blueprint '{blueprint_id}' deployed successfully ({len(steps_completed)} steps completed)"
        }

    except Exception as e:
        error_msg = str(e)

        # Update deployed status with any objects that were deployed before failure
        _update_blueprint_deployed_status(blueprint_id, deployed_objects, error_msg)

        yield {
            "level": "ERROR",
            "step": "deployment",
            "object_name": blueprint_id,
            "status": "failed",
            "timestamp": datetime.utcnow().isoformat(),
            "message": f"Deployment failed: {error_msg}"
        }

        raise


async def _deploy_single_blueprint(
    blueprint_id: str,
    replace_objects: bool,
    run_full_refresh: bool,
    database_name: Optional[str],
    client: Optional[SnowflakeClient] = None
) -> dict:
    """
    Deploy a single blueprint and return results.
    Blueprint IDs are unique, so source_name is not needed.
    
    Args:
        blueprint_id: ID of blueprint to deploy (unique across all sources)
        replace_objects: Use CREATE OR REPLACE
        run_full_refresh: Run full data refresh
        database_name: Optional database override
        client: Optional shared SnowflakeClient (for connection pooling)
    
    Returns:
        Dict with status, steps_completed, data_summary, and error (if failed)
    """
    try:
        steps_completed = []
        data_summary = {}
        
        # Initialize renderer with optional database override
        with SQLRenderer(blueprint_id, compile=True, replace_objects=replace_objects, target_database=database_name) as renderer:
            
            # Define deployment logic
            def execute_deployment(sf_client):
                nonlocal steps_completed, data_summary
                
                # Step 0: Validate target database exists
                context = renderer.get_base_context()
                target_db = context["target"]["database"]
                
                db_check_sql = f"SHOW DATABASES LIKE '{target_db}'"
                db_result = sf_client.run(db_check_sql)
                if not db_result or len(db_result) == 0:
                    raise ValueError(f"Target database '{target_db}' does not exist")
                steps_completed.append("database_validation")
                
                # Step 1: Validate source exists (validation only, no execution)
                validation_sql = renderer.validate_source_exists()
                steps_completed.append("source_validation")
                
                # Step 2: Create stage view
                view_sql = renderer.create_view()
                sf_client.run(view_sql)
                steps_completed.append("stage_view")
                
                # Step 3: Create stream
                stream_sql = renderer.create_stream()
                sf_client.run(stream_sql)
                steps_completed.append("stream")
                
                # Step 4: Create nodes (multiple statements)
                nodes_sqls = renderer.create_nodes()
                for node_sql in nodes_sqls:
                    sf_client.run(node_sql)
                steps_completed.append("nodes")
                
                # Step 5: Create edges (multiple statements)
                edges_sqls = renderer.create_edges()
                for edge_sql in edges_sqls:
                    sf_client.run(edge_sql)
                steps_completed.append("edges")
                
                # Step 6: Create attributes
                attr_sql = renderer.create_attribute()
                sf_client.run(attr_sql)
                steps_completed.append("attributes")
                
                # Step 7: Multi-table insert (MTI)
                mti_sql = renderer.mti()
                sf_client.run(mti_sql)
                steps_completed.append("mti")
                
                # Step 8: Create task
                task_sql = renderer.create_task()
                sf_client.run(task_sql)
                steps_completed.append("task")
                
                # Step 9: (Optional) Full refresh
                if run_full_refresh:
                    # Generate full refresh SQL
                    full_refresh_sql = renderer.full_refresh_mti()

                    # Parse and execute TRUNCATE and INSERT statements separately
                    lines = full_refresh_sql.split('\n')
                    truncate_statements = []
                    insert_start = -1
                    insert_end = -1

                    for i, line in enumerate(lines):
                        line_stripped = line.strip()
                        if line_stripped.startswith('TRUNCATE TABLE') and line_stripped.endswith(';'):
                            truncate_statements.append(line_stripped)
                        elif 'INSERT ALL' in line_stripped:
                            insert_start = i
                        elif insert_start != -1 and line_stripped.startswith('FROM') and line_stripped.endswith(';'):
                            insert_end = i
                            break

                    # Execute TRUNCATE statements first
                    for truncate_sql in truncate_statements:
                        sf_client.run(truncate_sql)

                    # Execute the INSERT ALL statement as one block
                    if insert_start != -1 and insert_end != -1:
                        insert_sql = '\n'.join(lines[insert_start:insert_end+1])
                        sf_client.run(insert_sql)

                    steps_completed.append("full_refresh")
                    
                    # Get data summary after full refresh
                    try:
                        context = renderer.get_base_context()
                        target_db = context["target"]["database"]
                        target_schema = context["target"]["schema"]
                        primary_node = renderer.table["primary_node"]["node"].upper()
                        
                        # Get counts
                        node_count_result = sf_client.run(
                            f"SELECT COUNT(*) as count FROM {target_db}.{target_schema}.NODE_{primary_node}"
                        )
                        # Attribute table name format: ATTR_<NODE>_<TABLE_NAME>_<SOURCE>
                        table_name = renderer.table.get("name", blueprint_id).upper()
                        source_name = renderer.source_name.upper() if hasattr(renderer, 'source_name') and renderer.source_name else "UNKNOWN"
                        attr_table_name = f"ATTR_{primary_node}_{table_name}_{source_name}"
                        attr_count_result = sf_client.run(
                            f"SELECT COUNT(*) as count FROM {target_db}.{target_schema}.{attr_table_name}"
                        )
                        
                        data_summary[f"NODE_{primary_node}"] = node_count_result[0][0] if node_count_result else 0
                        data_summary[attr_table_name] = attr_count_result[0][0] if attr_count_result else 0
                        
                        # Get secondary node counts
                        for sec_node in renderer.table.get("secondary_nodes", []):
                            if sec_node.get("load", True):
                                sec_node_name = sec_node["node"].upper()
                                sec_count_result = sf_client.run(
                                    f"SELECT COUNT(*) as count FROM {target_db}.{target_schema}.NODE_{sec_node_name}"
                                )
                                data_summary[f"NODE_{sec_node_name}"] = sec_count_result[0][0] if sec_count_result else 0
                        
                    except Exception as e:
                        data_summary["warning"] = f"Could not retrieve counts: {str(e)}"
            
            # Use provided client or create new one
            if client is not None:
                # Use shared connection (no context manager)
                execute_deployment(client)
            else:
                # Create new connection
                with SnowflakeClient() as new_client:
                    execute_deployment(new_client)
        
        return {
            "status": "success",
            "steps_completed": steps_completed,
            "data_summary": data_summary if data_summary else None
        }
    
    except Exception as e:
        return {
            "status": "failed",
            "error": str(e),
            "error_type": type(e).__name__
        }

@router.post("/blueprint/deploy/follow")
async def deploy_blueprints_follow(request: BlueprintDeployRequest):
    """
    Deploy one or more blueprints with streaming logs (SSE).
    Blueprint IDs are unique across all sources, so no source parameter is needed.
    
    Same flexible structure as /blueprint/deploy:
    - Single: {"blueprint_ids": ["work_order_master"]}
    - Multiple: {"blueprint_ids": ["bp1", "bp2"]}
    
    Returns SSE events: log, blueprint_start, blueprint_complete, error, complete, close
    """
    
    async def event_generator() -> AsyncGenerator[str, None]:
        deployment_events: List[Dict[str, Any]] = []
        final_summary: Optional[Dict[str, Any]] = None
        error_message: Optional[str] = None
        successful: List[Dict[str, Any]] = []
        failed: List[Dict[str, Any]] = []
        total_count = len(request.blueprint_ids)

        def send_event(event_type: str, data: dict) -> str:
            deployment_events.append({
                "event": event_type,
                "data": data
            })
            return f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
        
        try:
            # Count processed blueprints
            current = 0
            
            yield send_event("log", {
                "timestamp": datetime.utcnow().isoformat(),
                "message": f"Starting deployment of {total_count} blueprint(s)",
                "level": "INFO"
            })
            
            # Create single shared Snowflake connection for all deployments
            with SnowflakeClient() as shared_client:
                yield send_event("log", {
                    "timestamp": datetime.utcnow().isoformat(),
                    "message": "Connected to Snowflake (shared connection for all blueprints)",
                    "level": "INFO"
                })
                
                # Deploy each blueprint
                for blueprint_id in request.blueprint_ids:
                    current += 1
                    
                    yield send_event("blueprint_start", {
                        "timestamp": datetime.utcnow().isoformat(),
                        "blueprint_id": blueprint_id,
                        "index": current,
                        "total": total_count
                    })
                    
                    deployment_successful = False
                    try:
                        # Stream deployment logs for this blueprint
                        async for log_event in _deploy_single_blueprint_streaming(
                            blueprint_id=blueprint_id,
                            replace_objects=request.replace_objects,
                            run_full_refresh=request.run_full_refresh,
                            database_name=request.database_name,
                            client=shared_client
                        ):
                            # Forward all log events as SSE
                            yield send_event("log", log_event)

                            # Track if deployment completed successfully
                            if log_event.get("step") == "complete" and log_event.get("status") == "complete":
                                deployment_successful = True

                        if deployment_successful:
                            successful.append({"blueprint_id": blueprint_id})
                            yield send_event("blueprint_complete", {
                                "timestamp": datetime.utcnow().isoformat(),
                                "blueprint_id": blueprint_id,
                                "status": "success"
                            })
                        else:
                            failed.append({"blueprint_id": blueprint_id, "error": "Deployment did not complete"})

                    except Exception as e:
                        failed.append({"blueprint_id": blueprint_id, "error": str(e)})
                        # Error event is already sent by the streaming function
                        # Just mark the blueprint as complete with error status
                        yield send_event("blueprint_complete", {
                            "timestamp": datetime.utcnow().isoformat(),
                            "blueprint_id": blueprint_id,
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

            persist_deployment_log(
                deployment_type="blueprints_follow",
                model_ids=request.blueprint_ids,
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


@router.get("/blueprint/list", response_model=BlueprintListResponse)
async def list_blueprints(
    source: str = None,
    id_like: str = None
):
    """
    Get a list of all available blueprints organized by source.

    Query Parameters:
        source: Filter by source name (exact match)
        id_like: Filter blueprints where this value appears in the blueprint id

    Returns:
        BlueprintListResponse with blueprints grouped by source
    """
    try:
        config = blueprints_loader.get_all()

        sources = {}
        total_blueprints = 0

        for source_obj in config.get("sources", []):
            source_name = source_obj.get("source")

            # Filter by source if provided
            if source and source_name != source:
                continue

            if source_name:
                blueprints = []
                for blueprint in source_obj.get("blueprints", []):
                    # Use id if available, otherwise fall back to name
                    blueprint_id = blueprint.get("id") or blueprint.get("name")

                    # Filter by id_like if provided
                    if id_like and id_like.lower() not in blueprint_id.lower():
                        continue

                    if blueprint_id:
                        blueprints.append(blueprint_id)
                        total_blueprints += 1
                if blueprints:
                    sources[source_name] = blueprints

        return BlueprintListResponse(
            message=f"Found {total_blueprints} blueprints across {len(sources)} sources (from Snowflake tables)",
            sources=sources
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load blueprints: {str(e)}")

@router.get("/blueprint/list/detailed", response_model=BlueprintListDetailedResponse)
async def list_blueprints_detailed(
    source: str = None,
    id_like: str = None
):
    """
    Get a detailed list of all available blueprints with bindings and deployment status.
    
    Query Parameters:
        source: Filter by source name (exact match)
        id_like: Filter blueprints where this value appears in the blueprint id
    
    Returns:
        BlueprintListDetailedResponse with detailed blueprint information
    """
    try:
        config = blueprints_loader.get_all()

        blueprints_list = []

        for source_obj in config.get("sources", []):
            source_name = source_obj.get("source")

            # Filter by source if provided
            if source and source_name != source:
                continue

            if source_name:
                for blueprint in source_obj.get("blueprints", []):
                    # Use id if available, otherwise fall back to name
                    blueprint_id = blueprint.get("id") or blueprint.get("name")

                    # Filter by id_like if provided
                    if id_like and id_like.lower() not in blueprint_id.lower():
                        continue

                    if blueprint_id:
                        binding_db = blueprint.get("binding_db")
                        binding_schema = blueprint.get("binding_schema")
                        # Try to get table name from binding_object, or from table_pk if available
                        binding_table = blueprint.get("binding_object")
                        if not binding_table and blueprint.get("table_pk"):
                            # If table_pk exists, we can infer the table from the schema or use the blueprint name
                            binding_table = blueprint_id

                        # Count columns
                        columns = blueprint.get("columns", [])
                        column_count = len(columns)

                        # Mapping is complete if binding_db and binding_schema are set
                        mapping_complete = bool(binding_db and binding_schema)

                        # Check deployed status
                        deployed = blueprint.get("deployed", False)
                        
                        blueprint_detail = BlueprintDetail(
                            id=blueprint_id,
                            name=blueprint.get("name") or blueprint_id,
                            source=source_name,
                            binding_db=binding_db,
                            binding_schema=binding_schema,
                            binding_table=binding_table,
                            column_count=column_count,
                            mapping_complete=mapping_complete,
                            deployed=deployed
                        )
                        blueprints_list.append(blueprint_detail)
        
        return BlueprintListDetailedResponse(
            message=f"Found {len(blueprints_list)} blueprints",
            blueprints=blueprints_list
        )
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load detailed blueprints: {str(e)}")

@router.get("/blueprint/bindings/{blueprint_id}", response_model=BlueprintBindingsResponse)
async def get_blueprint_bindings(blueprint_id: str):
    """
    Get blueprint bindings for a specific blueprint.
    Blueprint IDs are unique across all sources.
    
    Args:
        blueprint_id: ID of the blueprint (unique across all sources)
    
    Returns:
        BlueprintBindingsResponse with blueprint bindings
    """
    try:
        # Get blueprint from Snowflake
        blueprint = blueprints_loader.get_blueprint(blueprint_id)

        if not blueprint:
            raise ValueError(f"Blueprint '{blueprint_id}' not found")
        
        # Return the full blueprint object (not just bindings subset)
        # The frontend expects fields like binding_db, binding_schema, table_pk, etc. at the top level
        return BlueprintBindingsResponse(
            message=f"Blueprint bindings retrieved successfully for '{blueprint_id}'",
            blueprint_id=blueprint_id,
            bindings=blueprint  # Return full blueprint object
        )
    
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get blueprint bindings: {str(e)}")

@router.get("/blueprint/{blueprint_id}", response_model=BlueprintGetResponse)
async def get_blueprint(blueprint_id: str):
    """
    Get the full blueprint configuration for a specific blueprint.
    Blueprint IDs are unique across all sources.
    
    Args:
        blueprint_id: ID of the blueprint to retrieve (unique across all sources)
    
    Returns:
        BlueprintGetResponse with full blueprint configuration
    """
    try:
        # Get blueprint from Snowflake (searches across all sources)
        blueprint = blueprints_loader.get_blueprint(blueprint_id)

        if not blueprint:
            raise ValueError(f"Blueprint '{blueprint_id}' not found")

        # Extract source (group_id) by querying directly (more efficient)
        from core.snowflake import SnowflakeClient
        with SnowflakeClient() as client:
            sql = f"""
                SELECT group_id
                FROM {blueprints_loader.config_db}.{blueprints_loader.config_schema}.{blueprints_loader.blueprints_table}
                WHERE blueprint_id = %s
                LIMIT 1
            """
            rows = client.run(sql, (blueprint_id,))
            source_name = rows[0][0] if rows else None

        return BlueprintGetResponse(
            message=f"Blueprint '{blueprint_id}' retrieved successfully",
            blueprint_name=blueprint_id,
            blueprint={
                "source": source_name,
                "blueprint": blueprint
            }
        )

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve blueprint: {str(e)}")

@router.put("/blueprint/bindings", response_model=BlueprintBindingsResponse)
async def update_blueprint_bindings(request: BlueprintBindingsUpdateRequest):
    """
    Update blueprint bindings for a specific blueprint.
    Blueprint IDs are unique across all sources.
    
    Optimized to only update fields that are provided in the request,
    avoiding unnecessary full blueprint fetches and column re-insertions.
    
    Args:
        request: BlueprintBindingsUpdateRequest with blueprint_id and bindings
    
    Returns:
        BlueprintBindingsResponse with updated bindings
    """
    try:
        # Verify blueprint exists (lightweight check - no data fetch)
        if not blueprints_loader.blueprint_exists(request.blueprint_id):
            raise ValueError(f"Blueprint '{request.blueprint_id}' not found")

        # Prepare updates dict - handle legacy source_table field
        updates = dict(request.bindings)
        if "source_table" in updates and "binding_object" not in updates:
            # Backward compatibility: map legacy field to new one
            updates["binding_object"] = updates.pop("source_table")

        # Use optimized partial update - only updates provided fields
        blueprints_loader.update_blueprint_partial(request.blueprint_id, updates)

        return BlueprintBindingsResponse(
            message=f"Blueprint bindings updated successfully for '{request.blueprint_id}'",
            blueprint_id=request.blueprint_id,
            bindings=request.bindings
        )

    except ValueError as e:
        logger.error(f"ValueError in update_blueprint_bindings: {str(e)}")
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        error_traceback = traceback.format_exc()
        logger.error(
            f"Exception in update_blueprint_bindings: {type(e).__name__}: {str(e)}\n"
            f"Traceback:\n{error_traceback}",
            exc_info=True
        )
        raise HTTPException(status_code=500, detail=f"Failed to update blueprint bindings: {str(e)}")

@router.post("/full-refresh/table", response_model=FullRefreshResponse)
async def full_refresh_table(request: FullRefreshRequest):
    """
    Execute full refresh for a specific table/blueprint.
    
    Args:
        request: FullRefreshRequest with table_name and options
    
    Returns:
        FullRefreshResponse with refresh status
    """
    try:
        table_name = request.table_name
        options = request.options or {}
        
        # Initialize renderer for the table
        with SQLRenderer(table_name, compile=True, replace_objects=True) as renderer:
            with SnowflakeClient() as client:
                # Execute full refresh
                full_refresh_sql = renderer.full_refresh_mti()
                
                # Parse and execute the full refresh SQL
                lines = full_refresh_sql.split('\n')
                truncate_statements = []
                insert_start = -1
                insert_end = -1
                
                for i, line in enumerate(lines):
                    line_stripped = line.strip()
                    if line_stripped.startswith('TRUNCATE TABLE') and line_stripped.endswith(';'):
                        truncate_statements.append(line_stripped)
                    elif 'INSERT ALL' in line_stripped:
                        insert_start = i
                    elif insert_start != -1 and line_stripped.startswith('FROM') and line_stripped.endswith(';'):
                        insert_end = i
                        break
                
                # Execute TRUNCATE statements
                for truncate_sql in truncate_statements:
                    client.run(truncate_sql)
                
                # Execute INSERT ALL statement
                if insert_start != -1 and insert_end != -1:
                    insert_sql = '\n'.join(lines[insert_start:insert_end+1])
                    client.run(insert_sql)
        
        return FullRefreshResponse(
            message=f"Full refresh completed successfully for table '{table_name}'",
            table_name=table_name,
            success=True
        )
    
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to execute full refresh: {str(e)}")

