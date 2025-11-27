"""
Configuration loader for blueprints and dimensional models from Snowflake tables.
Replaces YAML file loading with direct Snowflake queries.
"""

from typing import Dict, List, Any, Optional
from core.snowflake import SnowflakeClient
from core.config import config_database, output_database
import json
import re


def normalize_data_type(data_type: str) -> str:
    """
    Normalize data type strings to a standard format that fits in the database column.
    Converts detailed types like 'VARCHAR(16777216)' to simpler forms like 'VARCHAR'.
    
    Args:
        data_type: Raw data type string from Snowflake
        
    Returns:
        Normalized data type string (max 50 chars)
    """
    if not data_type or not isinstance(data_type, str):
        return data_type or ''
    
    # Remove whitespace and convert to uppercase
    data_type = data_type.strip().upper()
    
    # Extract base type (remove size/precision specifications)
    # Match patterns like VARCHAR(16777216), NUMBER(10,2), etc.
    match = re.match(r'^([A-Z_]+)', data_type)
    if match:
        base_type = match.group(1)
    else:
        base_type = data_type
    
    # Map common variations to standard types
    type_mapping = {
        'VARCHAR': 'STRING',
        'CHAR': 'STRING',
        'CHARACTER': 'STRING',
        'TEXT': 'STRING',
        'STRING': 'STRING',
        'NUMBER': 'NUMBER',
        'NUMERIC': 'NUMBER',
        'DECIMAL': 'NUMBER',
        'INT': 'NUMBER',
        'INTEGER': 'NUMBER',
        'BIGINT': 'NUMBER',
        'SMALLINT': 'NUMBER',
        'FLOAT': 'NUMBER',
        'DOUBLE': 'NUMBER',
        'REAL': 'NUMBER',
        'TIMESTAMP': 'TIMESTAMP',
        'TIMESTAMP_NTZ': 'TIMESTAMP',
        'TIMESTAMP_LTZ': 'TIMESTAMP',
        'TIMESTAMP_TZ': 'TIMESTAMP',
        'DATETIME': 'TIMESTAMP',
        'DATE': 'DATE',
        'TIME': 'TIME',
        'BOOLEAN': 'BOOLEAN',
        'BOOL': 'BOOLEAN',
        'BINARY': 'BINARY',
        'VARBINARY': 'BINARY',
        'VARIANT': 'VARIANT',
        'OBJECT': 'OBJECT',
        'ARRAY': 'ARRAY',
    }
    
    # Return mapped type or original base type, truncated to 50 chars
    normalized = type_mapping.get(base_type, base_type)
    return normalized[:50] if len(normalized) > 50 else normalized


class ConfigLoader:
    """Base class for loading configuration from Snowflake tables."""

    def __init__(self):
        # Use the config database name (should be application database in Native Apps)
        # In SPCS, SNOWFLAKE_DATABASE env var is automatically set to the application database
        self.config_db = config_database["database_name"]
        self.config_schema = config_database["schema_name"]
        # Table names
        self.blueprints_table = config_database["blueprints"]
        self.blueprint_columns_table = config_database["blueprint_columns"]
        self.dimensions_table = config_database["dimensions"]
        self.dimension_columns_table = config_database["dimension_columns"]
        self.facts_table = config_database["facts"]
        self.fact_columns_table = config_database["fact_columns"]

    def _parse_variant(self, value: Any) -> Any:
        """Parse VARIANT column values (returned as strings from Snowflake)."""
        if value is None:
            return None
        if isinstance(value, str):
            try:
                return json.loads(value)
            except (json.JSONDecodeError, TypeError):
                return value
        return value


class BlueprintsLoader(ConfigLoader):
    """Loads blueprint configuration from Snowflake tables."""

    def get_all(self) -> Dict[str, Any]:
        """
        Load all blueprints from Snowflake tables.
        Returns data in same structure as blueprints.yaml for backward compatibility.

        Structure:
        {
            "version": "1.0",
            "stage": {"database": "...", "schema": "..."},
            "target": {"database": "...", "schema": "..."},
            "sources": [
                {
                    "source": "erp",
                    "blueprints": [...]
                }
            ]
        }
        """
        with SnowflakeClient() as client:
            # Query all blueprints
            blueprints_sql = f"""
                SELECT
                    blueprint_id,
                    group_id,
                    name,
                    binding_object,
                    binding_db,
                    binding_schema,
                    description,
                    type,
                    ingest_time_binding,
                    mapping_complete,
                    version,
                    table_pk,
                    primary_node,
                    secondary_nodes,
                    link_objects,
                    delete_condition,
                    where_clause,
                    deployed
                FROM {self.config_db}.{self.config_schema}.{self.blueprints_table}
                ORDER BY group_id, blueprint_id
            """
            blueprint_rows = client.run(blueprints_sql)

            # Query all blueprint columns
            columns_sql = f"""
                SELECT
                    blueprint_id,
                    column_name,
                    binding,
                    alias,
                    data_type,
                    description,
                    column_type,
                    column_order,
                    is_custom,
                    excluded
                FROM {self.config_db}.{self.config_schema}.{self.blueprint_columns_table}
                ORDER BY blueprint_id, column_order
            """
            column_rows = client.run(columns_sql)

            # Build column lookup by blueprint_id
            columns_by_blueprint = {}
            for row in column_rows:
                bp_id = row[0]
                if bp_id not in columns_by_blueprint:
                    columns_by_blueprint[bp_id] = []
                columns_by_blueprint[bp_id].append({
                    "name": row[1],
                    "binding": row[2],
                    "alias": row[3],
                    "data_type": row[4],
                    "description": row[5],
                    "type": row[6],  # column_type mapped to "type" for YAML compatibility
                    "is_custom": row[8] if len(row) > 8 else False,
                    "excluded": row[9] if len(row) > 9 else False
                })

            # Group blueprints by source (group_name)
            sources_dict = {}
            version = None

            # Get stage/target from config.py (these are now centralized)
            stage_db = self.config_db  # Use config database for stage (uh_staging_temp)
            stage_schema = "stage"
            target_db = output_database["database_name"]
            target_schema = output_database["storage_schema_name"]

            for row in blueprint_rows:
                bp_id = row[0]
                group_id = row[1]

                # Extract version from first blueprint (all should be same)
                if version is None:
                    version = row[10]

                # Parse VARIANT columns (indices shifted by -4 after removing stage/target fields)
                table_pk = self._parse_variant(row[11])
                primary_node = self._parse_variant(row[12])
                secondary_nodes = self._parse_variant(row[13])
                link_objects = self._parse_variant(row[14])
                delete_condition = row[15] if len(row) > 15 else None
                where_clause = row[16] if len(row) > 16 else None
                deployed_value = self._parse_variant(row[17] if len(row) > 17 else None)
                
                # Convert deployed to boolean: True if not None and not empty array, False otherwise
                deployed_bool = False
                if deployed_value is not None:
                    if isinstance(deployed_value, list):
                        deployed_bool = len(deployed_value) > 0
                    else:
                        deployed_bool = True  # For non-array values (shouldn't happen but safe)

                blueprint = {
                    "id": bp_id,
                    "name": row[2],
                    "binding_object": row[3],
                    "binding_db": row[4],
                    "binding_schema": row[5],
                    "description": row[6],
                    "type": row[7],
                    "ingest_time_binding": row[8],
                    "mapping_complete": row[9],
                    "table_pk": table_pk or [],
                    "primary_node": primary_node or {},
                    "secondary_nodes": secondary_nodes or [],
                    "columns": columns_by_blueprint.get(bp_id, []),
                    "deployed": deployed_bool
                }

                # Add delete_condition and where_clause if present
                if delete_condition is not None:
                    blueprint["delete_condition"] = delete_condition
                if where_clause is not None:
                    blueprint["where_clause"] = where_clause

                # Add link_objects if present
                if link_objects is not None:
                    blueprint["link_objects"] = link_objects

                # Group by source
                if group_id not in sources_dict:
                    sources_dict[group_id] = []
                sources_dict[group_id].append(blueprint)

            # Convert to sources list format
            sources = [
                {"source": source_name, "blueprints": blueprints}
                for source_name, blueprints in sources_dict.items()
            ]

            return {
                "version": version or "1.0",
                "stage": {
                    "database": stage_db or self.config_db,
                    "schema": stage_schema or "stage"
                },
                "target": {
                    "database": target_db or output_database["database_name"],
                    "schema": target_schema or output_database["storage_schema_name"]
                },
                "sources": sources
            }

    def load_blueprint_by_id(self, blueprint_id: str) -> Optional[Dict[str, Any]]:
        """
        Load a single blueprint directly from Snowflake by ID.
        More efficient than get_all() when only one blueprint is needed.
        
        Returns blueprint in same format as get_all() item, or None if not found.
        """
        with SnowflakeClient() as client:
            # Query single blueprint
            blueprint_sql = f"""
                SELECT
                    blueprint_id,
                    group_id,
                    name,
                    binding_object,
                    binding_db,
                    binding_schema,
                    description,
                    type,
                    ingest_time_binding,
                    mapping_complete,
                    version,
                    table_pk,
                    primary_node,
                    secondary_nodes,
                    link_objects,
                    delete_condition,
                    where_clause,
                    deployed
                FROM {self.config_db}.{self.config_schema}.{self.blueprints_table}
                WHERE blueprint_id = %s
                LIMIT 1
            """
            blueprint_rows = client.run(blueprint_sql, (blueprint_id,))
            
            if not blueprint_rows or len(blueprint_rows) == 0:
                return None
            
            row = blueprint_rows[0]
            bp_id = row[0]
            group_id = row[1]
            
            # Query columns for this blueprint only
            columns_sql = f"""
                SELECT
                    column_name,
                    binding,
                    alias,
                    data_type,
                    description,
                    column_type,
                    column_order,
                    is_custom,
                    excluded
                FROM {self.config_db}.{self.config_schema}.{self.blueprint_columns_table}
                WHERE blueprint_id = %s
                ORDER BY column_order
            """
            column_rows = client.run(columns_sql, (bp_id,))
            
            # Build columns list
            columns = []
            for col_row in column_rows:
                columns.append({
                    "name": col_row[0],
                    "binding": col_row[1],
                    "alias": col_row[2],
                    "data_type": col_row[3],
                    "description": col_row[4],
                    "type": col_row[5],  # column_type mapped to "type"
                    "is_custom": col_row[7] if len(col_row) > 7 else False,
                    "excluded": col_row[8] if len(col_row) > 8 else False
                })
            
            # Parse VARIANT columns
            table_pk = self._parse_variant(row[11])
            primary_node = self._parse_variant(row[12])
            secondary_nodes = self._parse_variant(row[13])
            link_objects = self._parse_variant(row[14])
            delete_condition = row[15] if len(row) > 15 else None
            where_clause = row[16] if len(row) > 16 else None
            deployed_value = self._parse_variant(row[17] if len(row) > 17 else None)
            
            # Convert deployed to boolean: True if not None and not empty array, False otherwise
            deployed_bool = False
            if deployed_value is not None:
                if isinstance(deployed_value, list):
                    deployed_bool = len(deployed_value) > 0
                else:
                    deployed_bool = True  # For non-array values (shouldn't happen but safe)
            
            blueprint = {
                "id": bp_id,
                "name": row[2],
                "binding_object": row[3],
                "binding_db": row[4],
                "binding_schema": row[5],
                "description": row[6],
                "type": row[7],
                "ingest_time_binding": row[8],
                "mapping_complete": row[9],
                "table_pk": table_pk or [],
                "primary_node": primary_node or {},
                "secondary_nodes": secondary_nodes or [],
                "columns": columns,
                "deployed": deployed_bool
            }
            
            # Add delete_condition and where_clause if present
            if delete_condition is not None:
                blueprint["delete_condition"] = delete_condition
            if where_clause is not None:
                blueprint["where_clause"] = where_clause
            
            # Add link_objects if present
            if link_objects is not None:
                blueprint["link_objects"] = link_objects
            
            return blueprint

    def load_blueprint_metadata(self) -> Dict[str, Any]:
        """
        Load metadata (version, stage, target) from config.py.
        No longer needs to query database since these are centralized.
        """
        return {
            "version": "1.0",  # Default version
            "stage": {
                "database": self.config_db,
                "schema": "stage"
            },
            "target": {
                "database": output_database["database_name"],
                "schema": output_database["storage_schema_name"]
            }
        }

    def list_blueprint_ids(self, source: Optional[str] = None) -> List[Dict[str, str]]:
        """
        Get list of blueprint IDs and their group_ids without loading full blueprint data.
        Useful for validation and listing operations.
        
        Returns list of dicts with 'blueprint_id' and 'group_id' keys.
        """
        with SnowflakeClient() as client:
            if source:
                sql = f"""
                    SELECT DISTINCT blueprint_id, group_id
                    FROM {self.config_db}.{self.config_schema}.{self.blueprints_table}
                    WHERE group_id = %s
                    ORDER BY blueprint_id
                """
                rows = client.run(sql, (source,))
            else:
                sql = f"""
                    SELECT DISTINCT blueprint_id, group_id
                    FROM {self.config_db}.{self.config_schema}.{self.blueprints_table}
                    ORDER BY group_id, blueprint_id
                """
                rows = client.run(sql)
            
            return [{"blueprint_id": row[0], "group_id": row[1]} for row in rows]

    def blueprint_exists(self, blueprint_id: str) -> bool:
        """
        Lightweight check if a blueprint exists without fetching all data.
        Much faster than get_blueprint() for existence checks.

        Args:
            blueprint_id: Blueprint ID to check

        Returns:
            True if blueprint exists, False otherwise
        """
        with SnowflakeClient() as client:
            sql = f"""
                SELECT 1
                FROM {self.config_db}.{self.config_schema}.{self.blueprints_table}
                WHERE blueprint_id = %s
                LIMIT 1
            """
            rows = client.run(sql, (blueprint_id,))
            return len(rows) > 0

    def get_blueprint(self, blueprint_id: str) -> Optional[Dict[str, Any]]:
        """
        Get a single blueprint by ID.
        Blueprint IDs are unique across all sources.
        
        Now uses efficient load_blueprint_by_id() instead of get_all().
        """
        return self.load_blueprint_by_id(blueprint_id)

    def update_blueprint_deployed_status(self, blueprint_id: str, deployed: bool, error_message: Optional[str] = None):
        """
        Update the deployed status of a blueprint in Snowflake.
        Blueprint IDs are unique, so source_name is not needed.
        This replaces the YAML file write operation.
        """
        with SnowflakeClient() as client:
            # Note: We don't have deployed/deployment_error columns in the current schema
            # This is a placeholder for when those columns are added
            # For now, this is a no-op
            pass

    def create_blueprint(self, blueprint_data: Dict[str, Any]) -> None:
        """
        Create a new blueprint in Snowflake tables.
        Blueprint IDs must be unique across all sources.

        Args:
            blueprint_data: Blueprint configuration dict (must include 'id' and 'group_id' fields)
        """
        with SnowflakeClient() as client:
            # Extract blueprint fields
            bp_id = blueprint_data.get("id")
            if not bp_id:
                raise ValueError("Blueprint must have an 'id' field")
            
            # Get group_id from blueprint_data (required for new blueprints)
            group_id = blueprint_data.get("group_id")
            if not group_id:
                raise ValueError("Blueprint must have a 'group_id' field (source system name)")

            # Get config values from config.py (no need to call get_all() anymore!)
            version = "1.0"  # Default version, could be made configurable if needed
            stage_db = self.config_db  # Use config database for stage
            stage_schema = "stage"
            target_db = output_database["database_name"]
            target_schema = output_database["storage_schema_name"]

            # Prepare VARIANT fields as JSON strings
            table_pk = blueprint_data.get("table_pk", [])
            primary_node = blueprint_data.get("primary_node", {})
            secondary_nodes = blueprint_data.get("secondary_nodes", [])
            link_objects = blueprint_data.get("link_objects")

            # Insert blueprint
            import json
            insert_bp_sql = f"""
                INSERT INTO {self.config_db}.{self.config_schema}.{self.blueprints_table} (
                    blueprint_id, group_id, name, binding_object, binding_db, binding_schema,
                    description, type, ingest_time_binding, mapping_complete,
                    version, table_pk, primary_node, secondary_nodes, link_objects,
                    delete_condition, where_clause
                )
                VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s,
                    PARSE_JSON(%s), PARSE_JSON(%s), PARSE_JSON(%s), PARSE_JSON(%s),
                    %s, %s
                )
            """

            client.run(insert_bp_sql, (
                bp_id,
                group_id,
                blueprint_data.get("name"),
                blueprint_data.get("binding_object"),
                blueprint_data.get("binding_db"),
                blueprint_data.get("binding_schema"),
                blueprint_data.get("description"),
                blueprint_data.get("type"),
                blueprint_data.get("ingest_time_binding"),
                blueprint_data.get("mapping_complete", False),
                version,
                json.dumps(table_pk) if table_pk else None,
                json.dumps(primary_node) if primary_node else None,
                json.dumps(secondary_nodes) if secondary_nodes else None,
                json.dumps(link_objects) if link_objects is not None else None,
                blueprint_data.get("delete_condition"),
                blueprint_data.get("where_clause")
            ))

            # Insert columns
            columns = blueprint_data.get("columns", [])
            if columns:
                for idx, col in enumerate(columns):
                    insert_col_sql = f"""
                        INSERT INTO {self.config_db}.{self.config_schema}.{self.blueprint_columns_table} (
                            blueprint_id, column_name, binding, alias, data_type, description,
                            column_type, column_order, is_custom, excluded
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """
                    client.run(insert_col_sql, (
                        bp_id,
                        col.get("name"),
                        col.get("binding"),
                        col.get("alias"),
                        normalize_data_type(col.get("data_type")),  # Normalize data type
                        col.get("description"),
                        col.get("type"),  # column_type in DB
                        idx,
                        col.get("is_custom", False),
                        col.get("excluded", False)
                    ))

    def update_blueprint(self, blueprint_id: str, blueprint_data: Dict[str, Any]) -> None:
        """
        Update an existing blueprint in Snowflake tables.
        Blueprint IDs are unique, so source_name is not needed.

        Args:
            blueprint_id: Blueprint ID to update (unique across all sources)
            blueprint_data: New blueprint configuration dict
        """
        with SnowflakeClient() as client:
            import json

            # Get group_id from blueprint_data if provided, otherwise keep existing
            group_id = blueprint_data.get("group_id")
            if not group_id:
                # Get existing group_id from database
                sql = f"""
                    SELECT group_id
                    FROM {self.config_db}.{self.config_schema}.{self.blueprints_table}
                    WHERE blueprint_id = %s
                    LIMIT 1
                """
                rows = client.run(sql, (blueprint_id,))
                if not rows:
                    raise ValueError(f"Blueprint '{blueprint_id}' not found")
                group_id = rows[0][0]

            # Prepare VARIANT fields
            table_pk = blueprint_data.get("table_pk", [])
            primary_node = blueprint_data.get("primary_node", {})
            secondary_nodes = blueprint_data.get("secondary_nodes", [])
            link_objects = blueprint_data.get("link_objects")

            # Update blueprint
            update_bp_sql = f"""
                UPDATE {self.config_db}.{self.config_schema}.{self.blueprints_table}
                SET
                    group_id = %s,
                    name = %s,
                    binding_object = %s,
                    binding_db = %s,
                    binding_schema = %s,
                    description = %s,
                    type = %s,
                    ingest_time_binding = %s,
                    mapping_complete = %s,
                    delete_condition = %s,
                    where_clause = %s,
                    table_pk = PARSE_JSON(%s),
                    primary_node = PARSE_JSON(%s),
                    secondary_nodes = PARSE_JSON(%s),
                    link_objects = PARSE_JSON(%s)
                WHERE blueprint_id = %s
            """

            client.run(update_bp_sql, (
                group_id,
                blueprint_data.get("name"),
                blueprint_data.get("binding_object"),
                blueprint_data.get("binding_db"),
                blueprint_data.get("binding_schema"),
                blueprint_data.get("description"),
                blueprint_data.get("type"),
                blueprint_data.get("ingest_time_binding"),
                blueprint_data.get("mapping_complete", False),
                blueprint_data.get("delete_condition"),
                blueprint_data.get("where_clause"),
                json.dumps(table_pk) if table_pk else None,
                json.dumps(primary_node) if primary_node else None,
                json.dumps(secondary_nodes) if secondary_nodes else None,
                json.dumps(link_objects) if link_objects is not None else None,
                blueprint_id
            ))

            # Delete existing columns and re-insert
            delete_cols_sql = f"""
                DELETE FROM {self.config_db}.{self.config_schema}.{self.blueprint_columns_table}
                WHERE blueprint_id = %s
            """
            client.run(delete_cols_sql, (blueprint_id,))

            # Insert new columns
            columns = blueprint_data.get("columns", [])
            if columns:
                for idx, col in enumerate(columns):
                    insert_col_sql = f"""
                        INSERT INTO {self.config_db}.{self.config_schema}.{self.blueprint_columns_table} (
                            blueprint_id, column_name, binding, alias, data_type, description,
                            column_type, column_order, is_custom, excluded
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """
                    client.run(insert_col_sql, (
                        blueprint_id,
                        col.get("name"),
                        col.get("binding"),
                        col.get("alias"),
                        normalize_data_type(col.get("data_type")),  # Normalize data type
                        col.get("description"),
                        col.get("type"),  # column_type in DB
                        idx,
                        col.get("is_custom", False),
                        col.get("excluded", False)
                    ))

    def update_blueprint_partial(self, blueprint_id: str, updates: Dict[str, Any]) -> None:
        """
        Optimized partial update for blueprint bindings.
        Only updates fields that are provided in the updates dict.
        This is much faster than update_blueprint() for simple field changes.

        Args:
            blueprint_id: Blueprint ID to update
            updates: Dict containing only the fields to update
        """
        with SnowflakeClient() as client:
            # Build dynamic UPDATE statement for blueprint table
            update_fields = []
            update_values = []
            
            # Simple string fields
            if "binding_db" in updates:
                update_fields.append("binding_db = %s")
                update_values.append(updates["binding_db"])
            
            if "binding_schema" in updates:
                update_fields.append("binding_schema = %s")
                update_values.append(updates["binding_schema"])
            
            if "binding_object" in updates:
                update_fields.append("binding_object = %s")
                update_values.append(updates["binding_object"])
            
            if "delete_condition" in updates:
                update_fields.append("delete_condition = %s")
                update_values.append(updates["delete_condition"])
            
            if "where_clause" in updates:
                update_fields.append("where_clause = %s")
                update_values.append(updates["where_clause"])
            
            if "mapping_complete" in updates:
                update_fields.append("mapping_complete = %s")
                update_values.append(updates["mapping_complete"])
            
            if "ingest_time_binding" in updates:
                update_fields.append("ingest_time_binding = %s")
                update_values.append(updates["ingest_time_binding"])
            
            # VARIANT fields (JSON)
            if "table_pk" in updates:
                update_fields.append("table_pk = PARSE_JSON(%s)")
                update_values.append(json.dumps(updates["table_pk"]) if updates["table_pk"] else None)
            
            if "primary_node" in updates:
                update_fields.append("primary_node = PARSE_JSON(%s)")
                update_values.append(json.dumps(updates["primary_node"]) if updates["primary_node"] else None)
            
            if "secondary_nodes" in updates:
                update_fields.append("secondary_nodes = PARSE_JSON(%s)")
                update_values.append(json.dumps(updates["secondary_nodes"]) if updates["secondary_nodes"] else None)
            
            # Update blueprint table if there are fields to update
            if update_fields:
                update_sql = f"""
                    UPDATE {self.config_db}.{self.config_schema}.{self.blueprints_table}
                    SET {', '.join(update_fields)}
                    WHERE blueprint_id = %s
                """
                update_values.append(blueprint_id)
                client.run(update_sql, tuple(update_values))
            
            # Handle columns update only if columns are in the payload
            if "columns" in updates:
                columns = updates["columns"]
                
                # Delete existing columns
                delete_cols_sql = f"""
                    DELETE FROM {self.config_db}.{self.config_schema}.{self.blueprint_columns_table}
                    WHERE blueprint_id = %s
                """
                client.run(delete_cols_sql, (blueprint_id,))
                
                # Insert new columns
                if columns:
                    for idx, col in enumerate(columns):
                        insert_col_sql = f"""
                            INSERT INTO {self.config_db}.{self.config_schema}.{self.blueprint_columns_table} (
                                blueprint_id, column_name, binding, alias, data_type, description,
                                column_type, column_order, is_custom, excluded
                            )
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """
                        client.run(insert_col_sql, (
                            blueprint_id,
                            col.get("name"),
                            col.get("binding"),
                            col.get("alias"),
                            normalize_data_type(col.get("data_type")),  # Normalize data type
                            col.get("description"),
                            col.get("type"),  # column_type in DB
                            idx,
                            col.get("is_custom", False),
                            col.get("excluded", False)
                        ))

    def delete_blueprint(self, blueprint_id: str) -> None:
        """
        Delete a blueprint from Snowflake tables.

        Args:
            blueprint_id: Blueprint ID to delete
        """
        with SnowflakeClient() as client:
            # Delete columns first (foreign key constraint)
            delete_cols_sql = f"""
                DELETE FROM {self.config_db}.{self.config_schema}.{self.blueprint_columns_table}
                WHERE blueprint_id = %s
            """
            client.run(delete_cols_sql, (blueprint_id,))

            # Delete blueprint
            delete_bp_sql = f"""
                DELETE FROM {self.config_db}.{self.config_schema}.{self.blueprints_table}
                WHERE blueprint_id = %s
            """
            client.run(delete_bp_sql, (blueprint_id,))

    def update_blueprint_bindings(self, blueprint_id: str, binding_db: str, binding_schema: str, binding_object: str) -> None:
        """
        Update blueprint bindings (database, schema, table).

        Args:
            blueprint_id: Blueprint ID
            binding_db: Database name
            binding_schema: Schema name
            binding_object: Table/object name
        """
        with SnowflakeClient() as client:
            update_sql = f"""
                UPDATE {self.config_db}.{self.config_schema}.{self.blueprints_table}
                SET
                    binding_db = %s,
                    binding_schema = %s,
                    binding_object = %s,
                    mapping_complete = TRUE
                WHERE blueprint_id = %s
            """
            client.run(update_sql, (binding_db, binding_schema, binding_object, blueprint_id))

    def update_column_binding(self, blueprint_id: str, column_name: str, binding: str) -> None:
        """
        Update a single column's binding.

        Args:
            blueprint_id: Blueprint ID
            column_name: Column name
            binding: New binding value
        """
        with SnowflakeClient() as client:
            update_sql = f"""
                UPDATE {self.config_db}.{self.config_schema}.{self.blueprint_columns_table}
                SET binding = %s
                WHERE blueprint_id = %s AND column_name = %s
            """
            client.run(update_sql, (binding, blueprint_id, column_name))


class DimensionalModelsLoader(ConfigLoader):
    """Loads dimensional model configuration from Snowflake tables."""

    def get_all(self) -> Dict[str, Any]:
        """
        Load all dimensional models from Snowflake tables.
        Returns data in same structure as dimensional_models.yaml for backward compatibility.

        Structure:
        {
            "model_database": "...",
            "model_schema": "...",
            "source_database": "...",
            "source_schema": "...",
            "groups": [...],
            "dimensions": [...],
            "facts": [...]
        }
        """
        with SnowflakeClient() as client:
            # Query all dimensions
            dimensions_sql = f"""
                SELECT
                    dimension_id,
                    name,
                    description,
                    group_info,
                    is_master_data,
                    deployed,
                    deployment_error,
                    source_details,
                    also_required_for,
                    created_at,
                    pii,
                    roles
                FROM {self.config_db}.{self.config_schema}.{self.dimensions_table}
                ORDER BY dimension_id
            """
            dimension_rows = client.run(dimensions_sql)

            # Query dimension columns
            dim_columns_sql = f"""
                SELECT
                    dimension_id,
                    column_name,
                    column_type,
                    blueprint_mapping,
                    include,
                    column_order
                FROM {self.config_db}.{self.config_schema}.{self.dimension_columns_table}
                ORDER BY dimension_id, column_order
            """
            dim_column_rows = client.run(dim_columns_sql)

            # Query all facts
            facts_sql = f"""
                SELECT
                    fact_id,
                    name,
                    description,
                    group_info,
                    is_master_data,
                    deployed,
                    deployment_error,
                    bridge_pattern,
                    source_details,
                    attributes,
                    also_required_for,
                    edges,
                    join_keys,
                    created_at,
                    pii,
                    roles
                FROM {self.config_db}.{self.config_schema}.{self.facts_table}
                ORDER BY fact_id
            """
            fact_rows = client.run(facts_sql)

            # Query fact columns
            fact_columns_sql = f"""
                SELECT
                    fact_id,
                    column_name,
                    column_type,
                    blueprint_mapping,
                    include,
                    column_order
                FROM {self.config_db}.{self.config_schema}.{self.fact_columns_table}
                ORDER BY fact_id, column_order
            """
            fact_column_rows = client.run(fact_columns_sql)

            # Build column lookups
            dim_columns_by_id = {}
            for row in dim_column_rows:
                dim_id = row[0]
                if dim_id not in dim_columns_by_id:
                    dim_columns_by_id[dim_id] = []
                dim_columns_by_id[dim_id].append({
                    "name": row[1],
                    "type": row[2],
                    "blueprint_mapping": row[3],
                    "include": row[4]
                })

            fact_columns_by_id = {}
            for row in fact_column_rows:
                fact_id = row[0]
                if fact_id not in fact_columns_by_id:
                    fact_columns_by_id[fact_id] = []
                fact_columns_by_id[fact_id].append({
                    "name": row[1],
                    "type": row[2],
                    "blueprint_mapping": row[3],
                    "include": row[4]
                })

            # Build dimensions list
            dimensions = []
            groups_dict = {}  # Collect unique groups from group_info

            for row in dimension_rows:
                dim_id = row[0]
                group_info = self._parse_variant(row[3])
                source_details = self._parse_variant(row[7])
                also_required_for = self._parse_variant(row[8])
                roles_value = self._parse_variant(row[11])

                # Extract group from group_info
                belongs_to = None
                if group_info and isinstance(group_info, dict):
                    belongs_to = group_info.get("id")
                    # Store group info for groups list
                    if belongs_to and belongs_to not in groups_dict:
                        groups_dict[belongs_to] = group_info

                # Convert deployed to boolean: True if not None (has deployed object name), False if None
                deployed_value = row[5]
                deployed_bool = deployed_value is not None and deployed_value != ""
                
                dimension = {
                    "id": dim_id,
                    "name": row[1],
                    "description": row[2],
                    "belongs_to": belongs_to,
                    "is_master_data": row[4],
                    "deployed": deployed_bool,
                    "deployment_error": row[6],
                    "source": source_details or {},
                    "also_required_for": also_required_for or [],
                    "columns": dim_columns_by_id.get(dim_id, []),
                    "pii": None if row[10] is None else bool(row[10]),
                    "roles": roles_value or []
                }
                dimensions.append(dimension)

            # Build facts list
            facts = []

            for row in fact_rows:
                fact_id = row[0]
                group_info = self._parse_variant(row[3])
                source_details = self._parse_variant(row[8])
                attributes = self._parse_variant(row[9])
                also_required_for = self._parse_variant(row[10])
                edges = self._parse_variant(row[11])
                join_keys = self._parse_variant(row[12])
                roles_value = self._parse_variant(row[15])

                # Extract group from group_info
                belongs_to = None
                if group_info and isinstance(group_info, dict):
                    belongs_to = group_info.get("id")
                    # Store group info for groups list
                    if belongs_to and belongs_to not in groups_dict:
                        groups_dict[belongs_to] = group_info

                # Convert deployed to boolean: True if not None (has deployed object name), False if None
                deployed_value = row[5]
                deployed_bool = deployed_value is not None and deployed_value != ""
                
                fact = {
                    "id": fact_id,
                    "name": row[1],
                    "description": row[2],
                    "belongs_to": belongs_to,
                    "is_master_data": row[4],
                    "deployed": deployed_bool,
                    "deployment_error": row[6],
                    "bridge_pattern": row[7],
                    "source": source_details or {},
                    "attributes": attributes or {},
                    "also_required_for": also_required_for or [],
                    "edges": edges or [],
                    "join_keys": join_keys or [],
                    "columns": fact_columns_by_id.get(fact_id, []),
                    "pii": None if row[14] is None else bool(row[14]),
                    "roles": roles_value or []
                }
                facts.append(fact)

            # Build groups list from collected groups
            groups = list(groups_dict.values())

            return {
                "model_database": output_database["database_name"],
                "model_schema": output_database["modelling_schema_name"],  # "modelling"
                "source_database": output_database["database_name"],
                "source_schema": output_database["storage_schema_name"],  # "storage"
                "groups": groups,
                "dimensions": dimensions,
                "facts": facts
            }

    def load_dimension_by_id(self, dimension_id: str) -> Optional[Dict[str, Any]]:
        """
        Load a single dimension directly from Snowflake by ID.
        More efficient than get_all() when only one dimension is needed.
        """
        with SnowflakeClient() as client:
            # Query single dimension
            dimension_sql = f"""
                SELECT
                    dimension_id,
                    name,
                    description,
                    group_info,
                    is_master_data,
                    deployed,
                    deployment_error,
                    source_details,
                    also_required_for,
                    created_at,
                    pii,
                    roles
                FROM {self.config_db}.{self.config_schema}.{self.dimensions_table}
                WHERE dimension_id = %s
                LIMIT 1
            """
            dimension_rows = client.run(dimension_sql, (dimension_id,))
            
            if not dimension_rows or len(dimension_rows) == 0:
                return None
            
            row = dimension_rows[0]
            dim_id = row[0]
            
            # Query dimension columns
            dim_columns_sql = f"""
                SELECT
                    column_name,
                    column_type,
                    blueprint_mapping,
                    include,
                    column_order
                FROM {self.config_db}.{self.config_schema}.{self.dimension_columns_table}
                WHERE dimension_id = %s
                ORDER BY column_order
            """
            dim_column_rows = client.run(dim_columns_sql, (dim_id,))
            
            # Build columns list
            columns = []
            for col_row in dim_column_rows:
                columns.append({
                    "name": col_row[0],
                    "type": col_row[1],
                    "blueprint_mapping": col_row[2],
                    "include": col_row[3]
                })
            
            # Parse VARIANT columns
            group_info = self._parse_variant(row[3])
            source_details = self._parse_variant(row[7])
            also_required_for = self._parse_variant(row[8])
            roles_value = self._parse_variant(row[11])
            
            # Extract group from group_info
            belongs_to = None
            if group_info and isinstance(group_info, dict):
                belongs_to = group_info.get("id")
            
            # Convert deployed to boolean: True if not None (has deployed object name), False if None
            deployed_value = row[5]
            deployed_bool = deployed_value is not None and deployed_value != ""
            
            dimension = {
                "id": dim_id,
                "name": row[1],
                "description": row[2],
                "belongs_to": belongs_to,
                "is_master_data": row[4],
                "deployed": deployed_bool,
                "deployment_error": row[6],
                "source": source_details or {},
                "also_required_for": also_required_for or [],
                "columns": columns,
                "pii": None if row[10] is None else bool(row[10]),
                "roles": roles_value or []
            }
            
            return dimension

    def load_fact_by_id(self, fact_id: str) -> Optional[Dict[str, Any]]:
        """
        Load a single fact directly from Snowflake by ID.
        More efficient than get_all() when only one fact is needed.
        """
        with SnowflakeClient() as client:
            # Query single fact
            fact_sql = f"""
                SELECT
                    fact_id,
                    name,
                    description,
                    group_info,
                    is_master_data,
                    deployed,
                    deployment_error,
                    bridge_pattern,
                    source_details,
                    attributes,
                    also_required_for,
                    edges,
                    join_keys,
                    created_at,
                    pii,
                    roles
                FROM {self.config_db}.{self.config_schema}.{self.facts_table}
                WHERE fact_id = %s
                LIMIT 1
            """
            fact_rows = client.run(fact_sql, (fact_id,))
            
            if not fact_rows or len(fact_rows) == 0:
                return None
            
            row = fact_rows[0]
            f_id = row[0]
            
            # Query fact columns
            fact_columns_sql = f"""
                SELECT
                    column_name,
                    column_type,
                    blueprint_mapping,
                    include,
                    column_order
                FROM {self.config_db}.{self.config_schema}.{self.fact_columns_table}
                WHERE fact_id = %s
                ORDER BY column_order
            """
            fact_column_rows = client.run(fact_columns_sql, (f_id,))
            
            # Build columns list
            columns = []
            for col_row in fact_column_rows:
                columns.append({
                    "name": col_row[0],
                    "type": col_row[1],
                    "blueprint_mapping": col_row[2],
                    "include": col_row[3]
                })
            
            # Parse VARIANT columns
            group_info = self._parse_variant(row[3])
            source_details = self._parse_variant(row[8])
            attributes = self._parse_variant(row[9])
            also_required_for = self._parse_variant(row[10])
            edges = self._parse_variant(row[11])
            join_keys = self._parse_variant(row[12])
            roles_value = self._parse_variant(row[15])
            
            # Extract group from group_info
            belongs_to = None
            if group_info and isinstance(group_info, dict):
                belongs_to = group_info.get("id")
            
            # Convert deployed to boolean: True if not None (has deployed object name), False if None
            deployed_value = row[5]
            deployed_bool = deployed_value is not None and deployed_value != ""
            
            fact = {
                "id": f_id,
                "name": row[1],
                "description": row[2],
                "belongs_to": belongs_to,
                "is_master_data": row[4],
                "deployed": deployed_bool,
                "deployment_error": row[6],
                "bridge_pattern": row[7],
                "source": source_details or {},
                "attributes": attributes or {},
                "also_required_for": also_required_for or [],
                "edges": edges or [],
                "join_keys": join_keys or [],
                "columns": columns,
                "pii": None if row[14] is None else bool(row[14]),
                "roles": roles_value or []
            }
            
            return fact

    def load_group_by_id(self, group_id: str) -> Optional[Dict[str, Any]]:
        """
        Load a single group by extracting from any dimension or fact that belongs to it.
        Groups are stored in group_info VARIANT column.
        """
        with SnowflakeClient() as client:
            # Try dimensions first
            sql = f"""
                SELECT group_info
                FROM {self.config_db}.{self.config_schema}.{self.dimensions_table}
                WHERE group_info:id::STRING = %s
                LIMIT 1
            """
            rows = client.run(sql, (group_id,))
            
            if not rows or len(rows) == 0:
                # Try facts
                sql = f"""
                    SELECT group_info
                    FROM {self.config_db}.{self.config_schema}.{self.facts_table}
                    WHERE group_info:id::STRING = %s
                    LIMIT 1
                """
                rows = client.run(sql, (group_id,))
            
            if rows and rows[0][0]:
                return self._parse_variant(rows[0][0])
            
            return None

    def list_dimension_ids(self, group_id: Optional[str] = None) -> List[str]:
        """
        Get list of dimension IDs without loading full data.
        """
        with SnowflakeClient() as client:
            if group_id:
                sql = f"""
                    SELECT dimension_id
                    FROM {self.config_db}.{self.config_schema}.{self.dimensions_table}
                    WHERE group_info:id::STRING = %s
                    ORDER BY dimension_id
                """
                rows = client.run(sql, (group_id,))
            else:
                sql = f"""
                    SELECT dimension_id
                    FROM {self.config_db}.{self.config_schema}.{self.dimensions_table}
                    ORDER BY dimension_id
                """
                rows = client.run(sql)
            
            return [row[0] for row in rows]

    def list_fact_ids(self, group_id: Optional[str] = None) -> List[str]:
        """
        Get list of fact IDs without loading full data.
        """
        with SnowflakeClient() as client:
            if group_id:
                sql = f"""
                    SELECT fact_id
                    FROM {self.config_db}.{self.config_schema}.{self.facts_table}
                    WHERE group_info:id::STRING = %s
                    ORDER BY fact_id
                """
                rows = client.run(sql, (group_id,))
            else:
                sql = f"""
                    SELECT fact_id
                    FROM {self.config_db}.{self.config_schema}.{self.facts_table}
                    ORDER BY fact_id
                """
                rows = client.run(sql)
            
            return [row[0] for row in rows]

    def get_dimension(self, dimension_id: str) -> Optional[Dict[str, Any]]:
        """
        Get a single dimension by ID.
        Now uses efficient load_dimension_by_id() instead of get_all().
        """
        return self.load_dimension_by_id(dimension_id)

    def get_fact(self, fact_id: str) -> Optional[Dict[str, Any]]:
        """
        Get a single fact by ID.
        Now uses efficient load_fact_by_id() instead of get_all().
        """
        return self.load_fact_by_id(fact_id)

    def create_dimension(self, dimension_data: Dict[str, Any]) -> None:
        """
        Create a new dimension in Snowflake tables.

        Args:
            dimension_data: Dimension configuration dict
        """
        with SnowflakeClient() as client:
            dim_id = dimension_data.get("id")
            if not dim_id:
                raise ValueError("Dimension must have an 'id' field")

            # Prepare group_info as JSON
            belongs_to = dimension_data.get("belongs_to")
            group_info = None
            if belongs_to:
                # Get full group info using efficient loader
                group_info = self.load_group_by_id(belongs_to)
                if not group_info:
                    raise ValueError(f"Group '{belongs_to}' not found")

            # Prepare VARIANT fields
            source_details = dimension_data.get("source", {})
            also_required_for = dimension_data.get("also_required_for", [])

            # Insert dimension
            insert_dim_sql = f"""
                INSERT INTO {self.config_db}.{self.config_schema}.{self.dimensions_table} (
                    dimension_id, name, description, group_info, is_master_data,
                    deployed, deployment_error, source_details, also_required_for
                )
                VALUES (
                    %s, %s, %s, PARSE_JSON(%s), %s, %s, %s, PARSE_JSON(%s), PARSE_JSON(%s)
                )
            """

            client.run(insert_dim_sql, (
                dim_id,
                dimension_data.get("name"),
                dimension_data.get("description"),
                json.dumps(group_info) if group_info else None,
                dimension_data.get("is_master_data", False),
                dimension_data.get("deployed"),  # Can be string (view name) or None
                dimension_data.get("deployment_error"),
                json.dumps(source_details) if source_details else None,
                json.dumps(also_required_for) if also_required_for else None
            ))

            # Insert columns
            columns = dimension_data.get("columns", [])
            if columns:
                for idx, col in enumerate(columns):
                    insert_col_sql = f"""
                        INSERT INTO {self.config_db}.{self.config_schema}.{self.dimension_columns_table} (
                            dimension_id, column_name, column_type, blueprint_mapping,
                            include, column_order
                        )
                        VALUES (%s, %s, %s, %s, %s, %s)
                    """
                    client.run(insert_col_sql, (
                        dim_id,
                        col.get("name"),
                        col.get("type"),
                        col.get("blueprint_mapping"),
                        col.get("include", True),
                        idx
                    ))

    def update_dimension(self, dimension_id: str, dimension_data: Dict[str, Any]) -> None:
        """
        Update an existing dimension in Snowflake tables.

        Args:
            dimension_id: Dimension ID to update
            dimension_data: New dimension configuration dict
        """
        with SnowflakeClient() as client:
            # Prepare group_info as JSON
            belongs_to = dimension_data.get("belongs_to")
            group_info = None
            if belongs_to:
                # Get full group info using efficient loader
                group_info = self.load_group_by_id(belongs_to)
                if not group_info:
                    raise ValueError(f"Group '{belongs_to}' not found")

            # Prepare VARIANT fields
            source_details = dimension_data.get("source", {})
            also_required_for = dimension_data.get("also_required_for", [])

            # Update dimension
            update_dim_sql = f"""
                UPDATE {self.config_db}.{self.config_schema}.{self.dimensions_table}
                SET
                    name = %s,
                    description = %s,
                    group_info = PARSE_JSON(%s),
                    is_master_data = %s,
                    deployed = %s,
                    deployment_error = %s,
                    source_details = PARSE_JSON(%s),
                    also_required_for = PARSE_JSON(%s)
                WHERE dimension_id = %s
            """

            client.run(update_dim_sql, (
                dimension_data.get("name"),
                dimension_data.get("description"),
                json.dumps(group_info) if group_info else None,
                dimension_data.get("is_master_data", False),
                dimension_data.get("deployed"),  # Can be string (view name) or None
                dimension_data.get("deployment_error"),
                json.dumps(source_details) if source_details else None,
                json.dumps(also_required_for) if also_required_for else None,
                dimension_id
            ))

            # Delete existing columns and re-insert
            delete_cols_sql = f"""
                DELETE FROM {self.config_db}.{self.config_schema}.{self.dimension_columns_table}
                WHERE dimension_id = %s
            """
            client.run(delete_cols_sql, (dimension_id,))

            # Insert new columns
            columns = dimension_data.get("columns", [])
            if columns:
                for idx, col in enumerate(columns):
                    insert_col_sql = f"""
                        INSERT INTO {self.config_db}.{self.config_schema}.{self.dimension_columns_table} (
                            dimension_id, column_name, column_type, blueprint_mapping,
                            include, column_order
                        )
                        VALUES (%s, %s, %s, %s, %s, %s)
                    """
                    client.run(insert_col_sql, (
                        dimension_id,
                        col.get("name"),
                        col.get("type"),
                        col.get("blueprint_mapping"),
                        col.get("include", True),
                        idx
                    ))

    def delete_dimension(self, dimension_id: str) -> None:
        """
        Delete a dimension from Snowflake tables.

        Args:
            dimension_id: Dimension ID to delete
        """
        with SnowflakeClient() as client:
            # Delete columns first (foreign key constraint)
            delete_cols_sql = f"""
                DELETE FROM {self.config_db}.{self.config_schema}.{self.dimension_columns_table}
                WHERE dimension_id = %s
            """
            client.run(delete_cols_sql, (dimension_id,))

            # Delete dimension
            delete_dim_sql = f"""
                DELETE FROM {self.config_db}.{self.config_schema}.{self.dimensions_table}
                WHERE dimension_id = %s
            """
            client.run(delete_dim_sql, (dimension_id,))

    def create_fact(self, fact_data: Dict[str, Any]) -> None:
        """
        Create a new fact in Snowflake tables.

        Args:
            fact_data: Fact configuration dict
        """
        with SnowflakeClient() as client:
            fact_id = fact_data.get("id")
            if not fact_id:
                raise ValueError("Fact must have an 'id' field")

            # Prepare group_info as JSON
            belongs_to = fact_data.get("belongs_to")
            group_info = None
            if belongs_to:
                # Get full group info using efficient loader
                group_info = self.load_group_by_id(belongs_to)
                if not group_info:
                    raise ValueError(f"Group '{belongs_to}' not found")

            # Prepare VARIANT fields
            source_details = fact_data.get("source", {})
            attributes = fact_data.get("attributes", {})
            also_required_for = fact_data.get("also_required_for", [])
            edges = fact_data.get("edges", [])
            join_keys = fact_data.get("join_keys", [])

            # Insert fact
            insert_fact_sql = f"""
                INSERT INTO {self.config_db}.{self.config_schema}.{self.facts_table} (
                    fact_id, name, description, group_info, is_master_data,
                    deployed, deployment_error, bridge_pattern,
                    source_details, attributes, also_required_for, edges, join_keys
                )
                VALUES (
                    %s, %s, %s, PARSE_JSON(%s), %s, %s, %s, %s,
                    PARSE_JSON(%s), PARSE_JSON(%s), PARSE_JSON(%s), PARSE_JSON(%s), PARSE_JSON(%s)
                )
            """

            client.run(insert_fact_sql, (
                fact_id,
                fact_data.get("name"),
                fact_data.get("description"),
                json.dumps(group_info) if group_info else None,
                fact_data.get("is_master_data", False),
                fact_data.get("deployed"),  # Can be string (view name) or None
                fact_data.get("deployment_error"),
                fact_data.get("bridge_pattern", False),
                json.dumps(source_details) if source_details else None,
                json.dumps(attributes) if attributes else None,
                json.dumps(also_required_for) if also_required_for else None,
                json.dumps(edges) if edges else None,
                json.dumps(join_keys) if join_keys else None
            ))

            # Insert columns
            columns = fact_data.get("columns", [])
            if columns:
                for idx, col in enumerate(columns):
                    insert_col_sql = f"""
                        INSERT INTO {self.config_db}.{self.config_schema}.{self.fact_columns_table} (
                            fact_id, column_name, column_type, blueprint_mapping,
                            include, column_order
                        )
                        VALUES (%s, %s, %s, %s, %s, %s)
                    """
                    client.run(insert_col_sql, (
                        fact_id,
                        col.get("name"),
                        col.get("type"),
                        col.get("blueprint_mapping"),
                        col.get("include", True),
                        idx
                    ))

    def update_fact(self, fact_id: str, fact_data: Dict[str, Any]) -> None:
        """
        Update an existing fact in Snowflake tables.

        Args:
            fact_id: Fact ID to update
            fact_data: New fact configuration dict
        """
        with SnowflakeClient() as client:
            # Prepare group_info as JSON
            belongs_to = fact_data.get("belongs_to")
            group_info = None
            if belongs_to:
                # Get full group info using efficient loader
                group_info = self.load_group_by_id(belongs_to)
                if not group_info:
                    raise ValueError(f"Group '{belongs_to}' not found")

            # Prepare VARIANT fields
            source_details = fact_data.get("source", {})
            attributes = fact_data.get("attributes", {})
            also_required_for = fact_data.get("also_required_for", [])
            edges = fact_data.get("edges", [])
            join_keys = fact_data.get("join_keys", [])

            # Update fact
            update_fact_sql = f"""
                UPDATE {self.config_db}.{self.config_schema}.{self.facts_table}
                SET
                    name = %s,
                    description = %s,
                    group_info = PARSE_JSON(%s),
                    is_master_data = %s,
                    deployed = %s,
                    deployment_error = %s,
                    bridge_pattern = %s,
                    source_details = PARSE_JSON(%s),
                    attributes = PARSE_JSON(%s),
                    also_required_for = PARSE_JSON(%s),
                    edges = PARSE_JSON(%s),
                    join_keys = PARSE_JSON(%s)
                WHERE fact_id = %s
            """

            client.run(update_fact_sql, (
                fact_data.get("name"),
                fact_data.get("description"),
                json.dumps(group_info) if group_info else None,
                fact_data.get("is_master_data", False),
                fact_data.get("deployed"),  # Can be string (view name) or None
                fact_data.get("deployment_error"),
                fact_data.get("bridge_pattern", False),
                json.dumps(source_details) if source_details else None,
                json.dumps(attributes) if attributes else None,
                json.dumps(also_required_for) if also_required_for else None,
                json.dumps(edges) if edges else None,
                json.dumps(join_keys) if join_keys else None,
                fact_id
            ))

            # Delete existing columns and re-insert
            delete_cols_sql = f"""
                DELETE FROM {self.config_db}.{self.config_schema}.{self.fact_columns_table}
                WHERE fact_id = %s
            """
            client.run(delete_cols_sql, (fact_id,))

            # Insert new columns
            columns = fact_data.get("columns", [])
            if columns:
                for idx, col in enumerate(columns):
                    insert_col_sql = f"""
                        INSERT INTO {self.config_db}.{self.config_schema}.{self.fact_columns_table} (
                            fact_id, column_name, column_type, blueprint_mapping,
                            include, column_order
                        )
                        VALUES (%s, %s, %s, %s, %s, %s)
                    """
                    client.run(insert_col_sql, (
                        fact_id,
                        col.get("name"),
                        col.get("type"),
                        col.get("blueprint_mapping"),
                        col.get("include", True),
                        idx
                    ))

    def delete_fact(self, fact_id: str) -> None:
        """
        Delete a fact from Snowflake tables.

        Args:
            fact_id: Fact ID to delete
        """
        with SnowflakeClient() as client:
            # Delete columns first (foreign key constraint)
            delete_cols_sql = f"""
                DELETE FROM {self.config_db}.{self.config_schema}.{self.fact_columns_table}
                WHERE fact_id = %s
            """
            client.run(delete_cols_sql, (fact_id,))

            # Delete fact
            delete_fact_sql = f"""
                DELETE FROM {self.config_db}.{self.config_schema}.{self.facts_table}
                WHERE fact_id = %s
            """
            client.run(delete_fact_sql, (fact_id,))

    def create_group(self, group_data: Dict[str, Any]) -> None:
        """
        Create a new group by ensuring it exists in group_info of dimensions/facts.
        Groups are not stored in a separate table but embedded in group_info VARIANT column.

        Args:
            group_data: Group configuration dict with id, name, description, etc.
        """
        # Groups are embedded in dimensions/facts, so we just validate the structure
        group_id = group_data.get("id")
        if not group_id:
            raise ValueError("Group must have an 'id' field")

        # Check if group already exists in any dimension or fact
        all_config = self.get_all()
        for group in all_config.get("groups", []):
            if group.get("id") == group_id:
                raise ValueError(f"Group '{group_id}' already exists")

        # Group will be created when a dimension or fact is assigned to it
        # For now, we just validate that the group has the required fields

    def update_group(self, group_id: str, group_data: Dict[str, Any]) -> None:
        """
        Update a group by updating group_info in all dimensions/facts that belong to it.

        Args:
            group_id: Group ID to update
            group_data: New group configuration dict
        """
        with SnowflakeClient() as client:
            group_json = json.dumps(group_data)

            # Update group_info in dimensions
            update_dim_sql = f"""
                UPDATE {self.config_db}.{self.config_schema}.{self.dimensions_table}
                SET group_info = PARSE_JSON(%s)
                WHERE group_info:id::STRING = %s
            """
            client.run(update_dim_sql, (group_json, group_id))

            # Update group_info in facts
            update_fact_sql = f"""
                UPDATE {self.config_db}.{self.config_schema}.{self.facts_table}
                SET group_info = PARSE_JSON(%s)
                WHERE group_info:id::STRING = %s
            """
            client.run(update_fact_sql, (group_json, group_id))

    def delete_group(self, group_id: str) -> None:
        """
        Delete a group by removing group_info references from dimensions/facts.
        This sets group_info to NULL for all dimensions/facts that belong to the group.

        Args:
            group_id: Group ID to delete
        """
        with SnowflakeClient() as client:
            # Remove group_info from dimensions
            update_dim_sql = f"""
                UPDATE {self.config_db}.{self.config_schema}.{self.dimensions_table}
                SET group_info = NULL
                WHERE group_info:id::STRING = %s
            """
            client.run(update_dim_sql, (group_id,))

            # Remove group_info from facts
            update_fact_sql = f"""
                UPDATE {self.config_db}.{self.config_schema}.{self.facts_table}
                SET group_info = NULL
                WHERE group_info:id::STRING = %s
            """
            client.run(update_fact_sql, (group_id,))


# Singleton instances for easy import
blueprints_loader = BlueprintsLoader()
dimensional_models_loader = DimensionalModelsLoader()
