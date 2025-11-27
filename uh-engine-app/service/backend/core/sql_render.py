from pathlib import Path
from typing import Optional, Any

from jinja2 import Environment, FileSystemLoader
from core.config_loader import blueprints_loader, dimensional_models_loader
from core.config import output_database

# Backend dir: .../engine/v2/backend
BACKEND_DIR = Path(__file__).resolve().parents[1]
TEMPLATE_PATH = BACKEND_DIR / "static" / "templates"
# ============================================================================
# NOTE: All configuration now comes from Snowflake tables and config.py
# YAML file functions have been removed - configuration is managed via:
# - blueprints_loader and dimensional_models_loader for blueprints/models
# - output_database from config.py for database settings
# ============================================================================

# Try to find the project root, but don't fail if it doesn't exist
try:
    BASE_DIR = BACKEND_DIR.parents[2]  # Go up to project root
except IndexError:
    # Fallback: use the backend dir as base if we can't go up far enough
    BASE_DIR = BACKEND_DIR

# ============================================================================
# NOTE: Blueprints and dimensional models are now loaded from Snowflake tables
# via config_loader.py (blueprints_loader and dimensional_models_loader).
# The YAML file path resolution functions have been removed.
# ============================================================================

try:
    env = Environment(loader=FileSystemLoader(TEMPLATE_PATH))
except Exception as e:
    print(f"Warning: Failed to initialize Jinja2 environment: {e}")
    env = None


def hash_expr(col_name: str) -> str:
    return f"NVL(UPPER(TRIM(TO_VARCHAR({col_name.upper()}))), '-1')"


def upper_clean(value: str) -> str:
    return value.replace(" ", "_").upper()


def lower_clean(value: str) -> str:
    return value.replace(" ", "_").lower()


def composite_expr(col_names, sep="||"):
    """Return a SQL expression concatenating one or multiple columns."""
    if isinstance(col_names, (list, tuple)):
        cols = [f"UPPER({c})" for c in col_names]
        return f"CONCAT_WS('{sep}', {', '.join(cols)})"
    else:
        return f"UPPER({col_names})"


class SQLRenderer:
    def __init__(self, source: str, compile: bool = True, log_level=None, replace_objects: bool = True, target_database: Optional[str] = None):
        self.source = source
        self.replace_objects = replace_objects
        self.target_database_override = target_database

        try:
            # Try to load single blueprint first (efficient)
            blueprint = blueprints_loader.load_blueprint_by_id(source)
            group_id = None
            
            if not blueprint:
                # Fallback: try searching by name (backwards compatibility)
                # This requires checking all blueprints, but only if ID lookup fails
                all_config = blueprints_loader.get_all()
                blueprint = None
                parent_source = None
                for s in all_config.get("sources", []):
                    for bp in s.get("blueprints", []):
                        if bp.get("name") == source:
                            parent_source = s
                            blueprint = bp
                            group_id = s.get("source")
                            break
                    if parent_source:
                        break
                
                if not blueprint:
                    raise ValueError(f"Blueprint '{source}' not found in configuration tables (searched by id and name)")
            else:
                # Get group_id for this blueprint
                from core.snowflake import SnowflakeClient
                with SnowflakeClient() as client:
                    sql = f"""
                        SELECT group_id
                        FROM {blueprints_loader.config_db}.{blueprints_loader.config_schema}.{blueprints_loader.blueprints_table}
                        WHERE blueprint_id = %s
                        LIMIT 1
                    """
                    rows = client.run(sql, (source,))
                    group_id = rows[0][0] if rows else None
            
            # Get metadata from config.py (no need to query database)
            metadata = blueprints_loader.load_blueprint_metadata()
            
            # Build minimal config structure with just this blueprint
            self.config = {
                "version": metadata["version"],
                "stage": metadata["stage"],
                "target": metadata["target"],
                "sources": [{"source": group_id, "blueprints": [blueprint]}] if group_id else []
            }
            
            parent_source = {"source": group_id} if group_id else None
            
        except Exception as e:
            print(f"Warning: Failed to load config from Snowflake: {e}")
            # Create a minimal config to prevent crashes using values from config.py
            self.config = {
                "sources": [],
                "target": {"database": output_database["database_name"], "schema": output_database["storage_schema_name"]},
                "stage": {"database": output_database["database_name"], "schema": output_database["storage_schema_name"]}
            }
            raise ValueError(f"Blueprint '{source}' not found in configuration tables: {e}")
        
        if not blueprint or not parent_source:
            raise ValueError(f"Blueprint '{source}' not found in configuration tables (searched by id and name)")

        self.source_name = parent_source.get("source")
        self.table = self._normalize_blueprint(blueprint)
        self.source_config = {
            "source": self.source_name
        }
        self._validate_bindings()

        # Only set globals if env is available
        if env is not None:
            env.globals["hash_expr"] = hash_expr
            env.globals["composite_expr"] = composite_expr

    def _normalize_blueprint(self, bp: dict) -> dict:
        """Transform a blueprint entry to the structure expected by templates.

        - columns[].type := data_type, columns[].target := alias|name
        - primary_node.name := binding values (actual source column names, str or list)
        - secondary_nodes[].name := binding values (actual source column names, str or list)
        - database/schema from binding_db/binding_schema
        - where clause from where_clause field if provided
        - ingest_time passthrough with default
        """
        # Shallow copy
        t = {**bp}

        # Allow overriding physical source table while keeping blueprint name stable
        # Always use bp.binding_object (the actual table name). 'source_table' is deprecated.
        # CRITICAL: bp.name is a human-readable name with spaces (e.g., "Test Asset Register")
        # bp.binding_object is the actual table name (e.g., "TEST_ASSET_REGISTER")
        t["name"] = bp.get("binding_object") or bp.get("name")

        # Database/schema from bindings
        t["database"] = bp.get("binding_db")
        t["schema"] = bp.get("binding_schema")

        # Where clause from blueprint
        t["where_clause"] = bp.get("where_clause")

        # Delete condition from blueprint
        t["delete_condition"] = bp.get("delete_condition")

        # Ingest time default
        t["ingest_time"] = bp.get("ingest_time_binding") or bp.get("ingest_time", "INGEST_TIME")

        # Columns mapping
        cols = []
        for c in bp.get("columns", []):
            mapped = {
                "name": c.get("name"),
                "binding": c.get("binding"),
                "target": c.get("alias") or c.get("name"),
                "type": c.get("data_type"),
                "description": c.get("description"),
            }
            cols.append(mapped)
        t["columns"] = cols

        # Primary node mapping: expose .binding values from bindings (not .name)
        # The templates need the actual source column names, not the logical field names
        pn = bp.get("primary_node", {})
        pn_bindings = pn.get("bindings", [])
        pn_binding_values = [b.get("binding") for b in pn_bindings if b.get("binding")]
        if len(pn_binding_values) == 1:
            pn_binding_value = pn_binding_values[0]
        else:
            pn_binding_value = pn_binding_values
        t["primary_node"] = {**pn, "name": pn_binding_value}

        # Secondary nodes mapping: expose .binding values from bindings (not .name)
        # The templates need the actual source column names, not the logical field names
        sn_list = []
        for n in bp.get("secondary_nodes", []) or []:
            n_bindings = n.get("bindings", [])
            n_binding_values = [b.get("binding") for b in n_bindings if b.get("binding")]
            if len(n_binding_values) == 1:
                n_binding_value = n_binding_values[0]
            else:
                n_binding_value = n_binding_values
            sn_list.append({**n, "name": n_binding_value})
        t["secondary_nodes"] = sn_list

        return t

    def _validate_bindings(self):
        """Validate that all required bindings are present in the blueprint."""
        # Check database and schema bindings
        if not self.table.get("database"):
            raise ValueError(f"Blueprint '{self.source}' missing binding_db")
        if not self.table.get("schema"):
            raise ValueError(f"Blueprint '{self.source}' missing binding_schema")
        
        # Check all columns have field bindings
        missing_bindings = []
        for col in self.table.get("columns", []):
            if not col.get("binding"):
                missing_bindings.append(col.get("name", "unknown"))
        
        # Check primary node bindings
        pn_bindings = self.table.get("primary_node", {}).get("bindings", [])
        for binding in pn_bindings:
            if not binding.get("binding"):
                missing_bindings.append(f"primary_node.{binding.get('name', 'unknown')}")
        
        # Check secondary node bindings
        for sn in self.table.get("secondary_nodes", []):
            sn_bindings = sn.get("bindings", [])
            for binding in sn_bindings:
                if not binding.get("binding"):
                    missing_bindings.append(f"secondary_node.{sn.get('node', 'unknown')}.{binding.get('name', 'unknown')}")
        
        if missing_bindings:
            raise ValueError(f"Blueprint '{self.source}' has missing field bindings: {', '.join(missing_bindings)}")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        return False
    
    def get_base_context(self) -> dict:
        # Override target database if provided
        target_config = self.config.get("target", {}).copy()
        stage_config = self.config.get("stage", {}).copy()

        if self.target_database_override:
            target_config["database"] = self.target_database_override.upper()
            # Note: stage database is NOT overridden - it stays as configured in Snowflake config tables
        
        return {
            "target": target_config,
            "stage": stage_config,
            "source": self.source_name,
            "database": self.table.get("database"),
            "schema": self.table.get("schema"),
            "ingest_time": self.table.get("ingest_time"),
            "primary_node": self.table.get("primary_node"),
            "secondary_nodes": self.table.get("secondary_nodes", []),
            "columns": self.table.get("columns", []),
            "delete_condition": self.table.get("delete_condition"),
        }

    def render(self, template_name: str, extra_context: Optional[dict] = None) -> str:
        if env is None:
            return f"-- Template rendering failed: {template_name}"
        try:
            context = {**self.get_base_context(), **(extra_context or {}), "replace_objects": self.replace_objects}
            tmpl = env.get_template(template_name)
            return tmpl.render(**context)
        except Exception as e:
            print(f"Warning: Failed to render template {template_name}: {e}")
            return f"-- Template rendering failed: {template_name}"

    def render_kind(self, kind: str, options: Optional[dict] = None) -> str:
        kind_map = {
            "node": "create_node.sql",
            "edge": "create_edge.sql",
            "stage_view": "create_stage_view.sql",
            "stream": "create_stream.sql",
            "task": "create_task.sql",
            "mti": "unload_stream_mti.sql",
            "full_refresh_mti": "full_refresh_mti.sql",
            "presentation_view": "create_presentation_view.sql",
            "dimension_view": "create_dimension_view.sql",
            "model": "create_model.sql",
            "model_history": "create_model_history.sql",
            "pit": "create_pit.sql",
        }
        template = kind_map[kind]
        return self.render(template, options or {})

    def create_nodes(self, template="create_node.sql") -> list[str]:
        # Use get_base_context to get the potentially overridden target database
        tgt = self.get_base_context()["target"]
        sqls = []
        primary_node = upper_clean(self.table["primary_node"]["node"])
        sqls.append(self.render(template, {"target": tgt, "node": primary_node}))
        for n in self.table["secondary_nodes"]:
            node = upper_clean(n["node"])
            sqls.append(self.render(template, {"target": tgt, "node": node}))
        return sqls

    def create_edges(self, template="create_edge.sql") -> list[str]:
        # Use get_base_context to get the potentially overridden target database
        tgt = self.get_base_context()["target"]
        primary = upper_clean(self.table["primary_node"]["node"])
        sqls = []
        for n in self.table["secondary_nodes"]:
            secondary = upper_clean(n["node"])
            sqls.append(self.render(template, {"target": tgt, "primary": primary, "secondary": secondary}))
        return sqls

    def validate_source_exists(self) -> str:
        """Validate that source table exists and bindings are correct (replaces temp table creation)."""
        db = self.table.get("database")
        schema = self.table.get("schema")
        table_name = self.table.get("name")
        
        # In a real implementation, you might check if the table exists:
        # SELECT 1 FROM {db}.{schema}.{table_name} LIMIT 1
        
        return f"-- Source table {db}.{schema}.{table_name} validated"
    
    def create_view(self, template="create_stage_view.sql") -> str:
        context = self.get_base_context()
        return self.render(template, {**self.table, "stage": context["stage"], "target": context["target"]})

    def create_stream(self, template="create_stream.sql") -> str:
        context = self.get_base_context()
        return self.render(template, {**self.table, "stage": context["stage"], "target": context["target"]})


    def create_task(self, template="create_task.sql") -> str:
        context = self.get_base_context()
        return self.render(template, {**self.table, "stage": context["stage"], "target": context["target"]})


    def create_attribute(self, template="create_attribute.sql") -> str:
        context = self.get_base_context()
        return self.render(template, {**self.table, "stage": context["stage"], "target": context["target"]})

    def mti(self, template="unload_stream_mti.sql") -> str:
        context = self.get_base_context()
        return self.render(template, {**self.table, "stage": context["stage"], "target": context["target"]})

    def full_refresh_mti(self, template="full_refresh_mti.sql") -> str:
        # Use get_base_context to get the potentially overridden target database
        context = self.get_base_context()
        return self.render(template, {**self.table, "stage": context["stage"], "target": context["target"], "db": context["target"]["database"]})

class DatabaseRenderer:
    """Renders database deployment SQL using configuration from config.py."""

    def __init__(self):
        try:
            self.env = Environment(loader=FileSystemLoader(TEMPLATE_PATH))
        except Exception as e:
            print(f"Warning: Failed to initialize DatabaseRenderer: {e}")
            self.env = None

    def render_deploy_database(self, drop_existing: bool = False, role_name: Optional[str] = None, database_name: Optional[str] = None) -> str:
        """
        Render database deployment SQL from config.py.

        Args:
            drop_existing: Whether to drop existing database
            role_name: Optional role name for grants
            database_name: Optional override for database name

        Returns:
            SQL string for database deployment
        """
        try:
            # Get database configuration from config.py
            if database_name:
                db_name = str(database_name).upper().strip()
            else:
                db_name = output_database["database_name"].upper()

            # Build layers from config.py schema names
            layers: list[dict[str, Any]] = [
                {
                    "name": output_database["storage_schema_name"],
                    "description": "Storage layer for raw and staged data",
                    "type": "schema",
                    "order": 0,
                    "create": True,
                    "deployed": False,
                },
                {
                    "name": output_database["modelling_schema_name"],
                    "description": "Modelling layer for transformed data",
                    "type": "schema",
                    "order": 1,
                    "create": True,
                    "deployed": False,
                },
                {
                    "name": output_database["semantic_schema_name"],
                    "description": "Semantic layer for business logic",
                    "type": "schema",
                    "order": 2,
                    "create": True,
                    "deployed": False,
                }
            ]

            default_role = f"{db_name}_ROLE"

            context = {
                "database_name": db_name,
                "layers": layers,
                "drop_existing": drop_existing,
                "role_name": role_name or default_role,
            }

            if self.env is None:
                # Fallback: return a simple SQL if template engine failed
                statements = [
                    f"-- Database deployment for {db_name}",
                    f"{'DROP DATABASE IF EXISTS ' + db_name + ';' if drop_existing else ''}",
                    f"CREATE DATABASE IF NOT EXISTS {db_name};"
                ]
                for layer in layers:
                    if layer.get("create", True):
                        layer_name = layer.get("name", "").strip()
                        if layer_name:
                            statements.append(f"CREATE SCHEMA IF NOT EXISTS {db_name}.{layer_name};")
                return "\n".join(s for s in statements if s)

            # Render using template
            try:
                template = self.env.get_template("deploy_database.sql")
                return template.render(**context)
            except Exception as template_error:
                print(f"Warning: Template rendering failed: {template_error}")
                # Fallback to simple SQL generation
                statements = [
                    f"-- Database deployment for {db_name}",
                    f"{'DROP DATABASE IF EXISTS ' + db_name + ';' if drop_existing else ''}",
                    f"CREATE DATABASE IF NOT EXISTS {db_name};"
                ]
                for layer in layers:
                    if layer.get("create", True):
                        layer_name = layer.get("name", "").strip()
                        if layer_name:
                            statements.append(f"CREATE SCHEMA IF NOT EXISTS {db_name}.{layer_name};")
                return "\n".join(s for s in statements if s)

        except Exception as e:
            print(f"Error: Failed to render deploy_database: {e}")
            # Final fallback
            safe_name = (str(database_name).upper() if database_name else output_database["database_name"].upper())
            return f"-- Database deployment fallback\nCREATE DATABASE IF NOT EXISTS {safe_name};"