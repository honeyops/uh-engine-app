"""
Dashboard metrics routes
"""

from fastapi import APIRouter, HTTPException
from core.snowflake import SnowflakeClient
from core.config import output_database, config_database

router = APIRouter()

@router.get("/dashboard/modelling/metrics")
async def get_modelling_metrics():
    """
    Get metrics for the modelling dashboard.

    Returns:
        - connected_sources: Number of views in UH_STAGING_TEMP.STAGE
        - storage_objects: Breakdown of attributes, edges, and nodes in UNIFIED_HONEY.STORAGE
        - deployed_models: Count of dimensions and facts in UNIFIED_HONEY.MODELLING
        - governance: Objects without steward contacts (storage + modelling)
    """
    try:
        # Get database and schema names from config
        db_name = output_database["name"]
        storage_schema = output_database["schemas"][0]["name"]  # "storage"
        modelling_schema = output_database["schemas"][1]["name"]  # "modelling"
        stage_db = config_database["name"]
        stage_schema = config_database["schemas"][0]["name"]  # "core"

        with SnowflakeClient() as client:
            # Initialize metrics
            metrics = {
                "connected_sources": 0,
                "storage_objects": {
                    "attributes": 0,
                    "edges": 0,
                    "nodes": 0,
                    "total": 0
                },
                "deployed_models": {
                    "dimensions": 0,
                    "facts": 0,
                    "total": 0
                },
                "governance": {
                    "objects_without_steward": 0,
                    "total_objects": 0,
                    "steward_coverage_percentage": 0
                },
                "database": db_name
            }

            # 1. Count connected sources (views in config database)
            try:
                views = client.run(f"SHOW VIEWS IN {stage_db}.{stage_schema}")
                metrics["connected_sources"] = len(views)
            except Exception:
                # If schema doesn't exist or no access, count stays 0
                pass

            # 2. Count storage objects in output database storage schema
            try:
                tables = client.run(f"SHOW TABLES IN {db_name}.{storage_schema}")

                attributes = 0
                edges = 0
                nodes = 0

                for row in tables:
                    table_name = str(row[1]).upper()
                    if table_name.startswith('ATTR_'):
                        attributes += 1
                    elif table_name.startswith('EDGE_'):
                        edges += 1
                    elif table_name.startswith('NODE_'):
                        nodes += 1

                metrics["storage_objects"]["attributes"] = attributes
                metrics["storage_objects"]["edges"] = edges
                metrics["storage_objects"]["nodes"] = nodes
                metrics["storage_objects"]["total"] = attributes + edges + nodes
            except Exception:
                pass

            # 3. Count deployed models (views with _DIM_ or _FACT_ in modelling schema)
            try:
                views = client.run(f"SHOW VIEWS IN {db_name}.{modelling_schema}")

                dimensions = 0
                facts = 0

                for row in views:
                    view_name = str(row[1]).upper()
                    if '_DIM_' in view_name:
                        dimensions += 1
                    elif '_FACT_' in view_name:
                        facts += 1

                metrics["deployed_models"]["dimensions"] = dimensions
                metrics["deployed_models"]["facts"] = facts
                metrics["deployed_models"]["total"] = dimensions + facts
            except Exception:
                pass

            # 4. Count objects without steward contacts
            # Combine storage tables + modelling views
            try:
                objects = []

                # Get storage tables (ATTR_, EDGE_, NODE_)
                try:
                    storage_tables = client.run(f"SHOW TABLES IN {db_name}.{storage_schema}")
                    for row in storage_tables:
                        table_name = str(row[1]).upper()
                        if table_name.startswith(('ATTR_', 'EDGE_', 'NODE_')):
                            objects.append({
                                "schema": storage_schema.upper(),
                                "name": table_name,
                                "type": "TABLE"
                            })
                except Exception:
                    pass

                # Get modelling views (with _DIM_ or _FACT_)
                try:
                    modelling_views = client.run("SHOW VIEWS IN UNIFIED_HONEY.MODELLING")
                    for row in modelling_views:
                        view_name = str(row[1]).upper()
                        if '_DIM_' in view_name or '_FACT_' in view_name:
                            objects.append({
                                "schema": "MODELLING",
                                "name": view_name,
                                "type": "VIEW"
                            })
                except Exception:
                    pass

                metrics["governance"]["total_objects"] = len(objects)

                # Query contact assignments from ACCOUNT_USAGE
                objects_without_steward = 0
                if objects:
                    try:
                        contacts_query = """
                            SELECT OBJECT_SCHEMA, OBJECT_NAME, PURPOSE, CONTACT_NAME
                            FROM SNOWFLAKE.ACCOUNT_USAGE.CONTACT_REFERENCES
                            WHERE OBJECT_DATABASE = 'UNIFIED_HONEY'
                              AND OBJECT_SCHEMA IN ('STORAGE', 'MODELLING')
                              AND OBJECT_TYPE IN ('TABLE', 'VIEW')
                              AND PURPOSE = 'STEWARD'
                        """
                        contact_rows = client.run(contacts_query)

                        # Create set of objects with stewards
                        objects_with_steward = set()
                        for row in contact_rows:
                            schema = str(row[0]).upper()
                            name = str(row[1]).upper()
                            objects_with_steward.add(f"{schema}.{name}")

                        # Count objects without stewards
                        for obj in objects:
                            obj_key = f"{obj['schema']}.{obj['name']}"
                            if obj_key not in objects_with_steward:
                                objects_without_steward += 1

                        metrics["governance"]["objects_without_steward"] = objects_without_steward

                        # Calculate coverage percentage
                        if metrics["governance"]["total_objects"] > 0:
                            coverage = ((metrics["governance"]["total_objects"] - objects_without_steward) /
                                      metrics["governance"]["total_objects"] * 100)
                            metrics["governance"]["steward_coverage_percentage"] = round(coverage, 1)
                    except Exception:
                        # If ACCOUNT_USAGE query fails, mark all as without steward
                        metrics["governance"]["objects_without_steward"] = len(objects)
                        metrics["governance"]["steward_coverage_percentage"] = 0
            except Exception:
                pass

            return {
                "message": "Modelling metrics retrieved successfully",
                "metrics": metrics
            }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to retrieve dashboard metrics: {str(e)}")


@router.get("/dashboard/timeseries/metrics")
async def get_timeseries_metrics():
    """
    Get metrics for the timeseries dashboard.
    Currently returns placeholder data.
    """
    return {
        "message": "Timeseries metrics coming soon",
        "metrics": {
            "status": "coming_soon"
        }
    }
