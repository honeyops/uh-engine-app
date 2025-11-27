"""
Governance & Snowflake contact management routes.
"""

from fastapi import APIRouter, HTTPException, Query
from typing import Dict, List, Tuple, Any
import json

from api.schema.api_schema import (
    GovernanceObjectsResponse,
    ContactsResponse,
    ContactCreateRequest,
    ContactAssignmentRequest,
    GovernanceObject,
    ContactRecord,
    ModelGovernanceResponse,
    ModelGovernanceObject,
    ModelContactAssignmentRequest,
    ComponentObject,
)
from core.snowflake import SnowflakeClient
from core.config import output_database
from core.config_loader import dimensional_models_loader, blueprints_loader

router = APIRouter()

_VALID_OBJECT_TYPES = {'TABLE', 'VIEW', 'MATERIALIZED VIEW', 'DYNAMIC TABLE'}
_CONTACT_PURPOSES = {'STEWARD', 'SUPPORT', 'ACCESS_APPROVAL'}


def _quote_identifier(value: str) -> str:
    if value is None:
        raise HTTPException(status_code=400, detail="Identifier cannot be null")
    # Escape double quotes for SQL by doubling them
    value_escaped = value.replace('"', '""')
    return f'"{value_escaped}"'


def _quote_literal(value: str) -> str:
    if value is None:
        raise HTTPException(status_code=400, detail="Literal cannot be null")
    return "'" + value.replace("'", "''") + "'"


def _normalized_table_type(table_type: str) -> str:
    mapping = {
        'BASE TABLE': 'TABLE',
        'TABLE': 'TABLE',
        'VIEW': 'VIEW',
        'MATERIALIZED VIEW': 'MATERIALIZED VIEW',
        'DYNAMIC TABLE': 'DYNAMIC TABLE',
    }
    return mapping.get(table_type.upper(), table_type.upper())


def _load_database_layers() -> Tuple[str, List[Dict[str, Any]]]:
    """Load database and schema information from output_database config."""
    database_name = output_database.get("database_name")
    if not database_name:
        raise HTTPException(status_code=400, detail="Database configuration missing database_name")

    # Get the 3 required schemas from config
    schema_names = [
        output_database.get("storage_schema_name"),
        output_database.get("modelling_schema_name"),
        output_database.get("semantic_schema_name"),
    ]
    
    # Filter out None values
    schema_names = [name for name in schema_names if name]
    
    if not schema_names:
        raise HTTPException(status_code=400, detail="No schemas defined in database configuration")

    # Create normalized entries (descriptions are None since not in config)
    normalized_entries: List[Dict[str, Any]] = [
        {"name": name, "description": None} for name in schema_names
    ]

    return database_name.upper(), normalized_entries


def _fully_qualified_name(database: str, schema: str, object_name: str) -> str:
    return f'{_quote_identifier(database)}.{_quote_identifier(schema)}.{_quote_identifier(object_name)}'


def _fetch_contact_assignments(
    client: SnowflakeClient,
    database_name: str,
    schema_names: List[str],
    objects: List[Dict[str, Any]],
) -> Dict[Tuple[str, str, str], Dict[str, str]]:
    """Fetch contact assignments using GET_CONTACTS for each object (most reliable method)."""
    import logging
    logger = logging.getLogger(__name__)
    
    contact_map: Dict[Tuple[str, str, str], Dict[str, str]] = {}
    if not objects:
        return contact_map

    conn = client.connection()
    
    # Use GET_CONTACTS per object - this is the most reliable method
    # ACCOUNT_USAGE views can be stale or inaccessible
    for obj in objects:
        normalized_type = _normalized_table_type(obj["object_type"])
        key = (obj["database_name"], obj["schema_name"], obj["object_name"])
        
        # Try with schema context first (most reliable)
        try:
            with conn.cursor() as cur:
                # Set the database and schema context
                cur.execute(f'USE DATABASE {_quote_identifier(obj["database_name"])}')
                cur.execute(f'USE SCHEMA {_quote_identifier(obj["schema_name"])}')
                
                # GET_CONTACTS expects just the object name when in the right schema context
                # Use SELECT * to get all columns, then inspect them
                object_name_quoted = _quote_literal(obj["object_name"])
                type_quoted = _quote_literal(normalized_type)
                sql = f"""
                    SELECT *
                    FROM TABLE(
                        SNOWFLAKE.CORE.GET_CONTACTS({object_name_quoted}, {type_quoted})
                    )
                """
                # Execute the query
                cur.execute(sql)
                
                # Get column names from cursor description
                columns = [desc[0] for desc in cur.description] if cur.description else []
                columns_upper = [col.upper() for col in columns]
                rows = cur.fetchall()
                
                # Log column names for debugging (only for V_DIM_MATERIAL to avoid spam)
                if obj["object_name"].upper() == "V_DIM_MATERIAL":
                    logger.info(f"GET_CONTACTS columns for {obj['object_name']}: {columns}")
                    logger.info(f"GET_CONTACTS rows for {obj['object_name']}: {rows}")

                # Find column indices dynamically
                purpose_idx = next((i for i, col in enumerate(columns_upper) if col == 'PURPOSE'), None)

                # Snowflake GET_CONTACTS returns EMAIL, URL, or USER columns for contact values
                email_idx = next((i for i, col in enumerate(columns_upper) if col == 'EMAIL'), None)
                url_idx = next((i for i, col in enumerate(columns_upper) if col == 'URL'), None)
                user_idx = next((i for i, col in enumerate(columns_upper) if col == 'USER'), None)

                # If we can't find the PURPOSE column, skip
                if purpose_idx is None:
                    logger.warning(f"Could not find PURPOSE column for {obj['object_name']}. Available columns: {columns}")
                    continue

                for row in rows:
                    if len(row) > purpose_idx:
                        purpose = str(row[purpose_idx]).upper().strip() if row[purpose_idx] else None

                        # Get contact value from EMAIL, URL, or USER column (whichever is populated)
                        contact = None
                        if email_idx is not None and row[email_idx]:
                            contact = str(row[email_idx]).strip()
                        elif url_idx is not None and row[url_idx]:
                            contact = str(row[url_idx]).strip()
                        elif user_idx is not None and row[user_idx]:
                            contact = str(row[user_idx]).strip()

                        if purpose in _CONTACT_PURPOSES and contact:
                            contact_map.setdefault(key, {})[purpose] = contact
        except Exception as e:
            logger.warning(f"Failed to fetch contacts for {obj['schema_name']}.{obj['object_name']} with schema context: {e}")
            # Try alternative: fully qualified name without schema context
            try:
                with conn.cursor() as cur:
                    # Use fully qualified name
                    object_identifier = f'{_quote_identifier(obj["database_name"])}.{_quote_identifier(obj["schema_name"])}.{_quote_identifier(obj["object_name"])}'
                    object_literal = _quote_literal(object_identifier)
                    type_quoted = _quote_literal(normalized_type)
                    sql = f"""
                        SELECT *
                        FROM TABLE(
                            SNOWFLAKE.CORE.GET_CONTACTS({object_literal}, {type_quoted})
                        )
                    """
                    cur.execute(sql)
                    
                    # Get column names from cursor description
                    columns = [desc[0] for desc in cur.description] if cur.description else []
                    columns_upper = [col.upper() for col in columns]
                    rows = cur.fetchall()

                    # Find column indices dynamically
                    purpose_idx = next((i for i, col in enumerate(columns_upper) if col == 'PURPOSE'), None)
                    email_idx = next((i for i, col in enumerate(columns_upper) if col == 'EMAIL'), None)
                    url_idx = next((i for i, col in enumerate(columns_upper) if col == 'URL'), None)
                    user_idx = next((i for i, col in enumerate(columns_upper) if col == 'USER'), None)

                    # If we can't find the PURPOSE column, skip
                    if purpose_idx is None:
                        logger.warning(f"Could not find PURPOSE column for {obj['object_name']} (fallback). Available columns: {columns}")
                        continue

                    for row in rows:
                        if len(row) > purpose_idx:
                            purpose = str(row[purpose_idx]).upper().strip() if row[purpose_idx] else None

                            # Get contact value from EMAIL, URL, or USER column (whichever is populated)
                            contact = None
                            if email_idx is not None and row[email_idx]:
                                contact = str(row[email_idx]).strip()
                            elif url_idx is not None and row[url_idx]:
                                contact = str(row[url_idx]).strip()
                            elif user_idx is not None and row[user_idx]:
                                contact = str(row[user_idx]).strip()

                            if purpose in _CONTACT_PURPOSES and contact:
                                contact_map.setdefault(key, {})[purpose] = contact
            except Exception as e2:
                # Log but continue - some objects might not exist or have permission issues
                logger.warning(f"Failed to fetch contacts for {obj['schema_name']}.{obj['object_name']} with fully qualified name: {e2}")
                continue
    
    return contact_map


def _extract_contact_records_from_rows(columns: List[str], rows: List[Tuple[Any, ...]]) -> List[ContactRecord]:
    normalized_columns = [col.lower() for col in columns]
    name_idx = next((i for i, c in enumerate(normalized_columns) if c in ('contact_name', 'name')), None)
    type_idx = next((i for i, c in enumerate(normalized_columns) if c in ('communication_type', 'communication_method', 'type')), None)
    value_idx = next((i for i, c in enumerate(normalized_columns) if c in ('communication_value', 'communication_method_value', 'value')), None)
    created_idx = next((i for i, c in enumerate(normalized_columns) if c in ('created_on', 'created', 'created_at')), None)
    updated_idx = next((i for i, c in enumerate(normalized_columns) if c in ('last_altered', 'updated_on', 'updated_at')), None)
    options_idx = next((i for i, c in enumerate(normalized_columns) if c == 'options'), None)

    records: List[ContactRecord] = []
    for row in rows:
        name = str(row[name_idx]) if name_idx is not None and row[name_idx] is not None else None
        if not name:
            continue
        method = str(row[type_idx]) if type_idx is not None and row[type_idx] is not None else None
        value = None
        raw_options = str(row[options_idx]) if options_idx is not None and row[options_idx] is not None else None
        if value_idx is not None and row[value_idx] is not None:
            value = str(row[value_idx])
        elif raw_options:
            try:
                parsed = json.loads(raw_options)
                value = parsed.get('value') or parsed.get('communication_value') or parsed.get('url') or parsed.get('email')
                method = method or parsed.get('method') or parsed.get('communication_method')
            except Exception:
                pass

        created_on = str(row[created_idx]) if created_idx is not None and row[created_idx] is not None else None
        updated_on = str(row[updated_idx]) if updated_idx is not None and row[updated_idx] is not None else None

        records.append(ContactRecord(
            name=name,
            communication_type=method,
            communication_value=value,
            created_on=created_on,
            updated_on=updated_on,
            raw_options=raw_options,
        ))
    records.sort(key=lambda r: r.name.upper())
    return records


def _fetch_contacts_via_account_usage(client: SnowflakeClient) -> List[ContactRecord]:
    try:
        conn = client.connection()
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM SNOWFLAKE.ACCOUNT_USAGE.CONTACTS")
            columns = [col[0] for col in cur.description]
            rows = cur.fetchall()
        if not rows:
            return []
        return _extract_contact_records_from_rows(columns, rows)
    except Exception:
        return []


def _fetch_contacts_via_show(client: SnowflakeClient, database_name: str, schema_names: List[str]) -> List[ContactRecord]:
    """Fetch contacts from all configured schemas."""
    all_contacts: List[ContactRecord] = []
    seen_names: set[str] = set()
    
    try:
        conn = client.connection()
        for schema_name in schema_names:
            try:
                with conn.cursor() as cur:
                    # Switch to the database and schema context
                    cur.execute(f'USE DATABASE {_quote_identifier(database_name)}')
                    cur.execute(f'USE SCHEMA {_quote_identifier(schema_name)}')
                    cur.execute("SHOW CONTACTS")
                    columns = [col[0] for col in cur.description]
                    rows = cur.fetchall()
                    records = _extract_contact_records_from_rows(columns, rows)
                    # Deduplicate by name (contacts with same name in different schemas)
                    for record in records:
                        if record.name not in seen_names:
                            seen_names.add(record.name)
                            all_contacts.append(record)
            except Exception:
                # Continue to next schema if this one fails
                continue
        return all_contacts
    except Exception:
        return []


def _build_contact_method_clause(payload: ContactCreateRequest) -> str:
    method = payload.method.upper()
    if method == 'URL':
        if not isinstance(payload.value, str):
            raise HTTPException(status_code=400, detail="URL contact requires a string value")
        return f"URL = {_quote_literal(payload.value)}"
    if method == 'EMAIL':
        if not isinstance(payload.value, str):
            raise HTTPException(status_code=400, detail="Email contact requires a string value")
        return f"EMAIL_DISTRIBUTION_LIST = {_quote_literal(payload.value)}"
    if method == 'USERS':
        if isinstance(payload.value, str):
            values = [v.strip() for v in payload.value.split(",") if v.strip()]
        else:
            values = [str(v).strip() for v in payload.value if str(v).strip()]
        if not values:
            raise HTTPException(status_code=400, detail="User contact requires at least one user")
        user_list = ", ".join(_quote_literal(v) for v in values)
        return f"USERS = ({user_list})"
    raise HTTPException(status_code=400, detail="Unsupported communication method")


@router.get("/governance/objects", response_model=GovernanceObjectsResponse)
async def get_governance_objects(
    page: int = Query(1, ge=1, description="Page number (1-indexed)"),
    page_size: int = Query(50, ge=1, le=500, description="Number of items per page"),
):
    try:
        database_name, schema_entries = _load_database_layers()
        schema_names = [entry["name"].upper() for entry in schema_entries]
        schema_descriptions = {entry["name"].upper(): entry.get("description") for entry in schema_entries}

        with SnowflakeClient() as client:
            schema_clause = ", ".join(_quote_literal(name) for name in schema_names)
            objects_sql = f"""
                SELECT TABLE_CATALOG AS DATABASE_NAME,
                       TABLE_SCHEMA AS SCHEMA_NAME,
                       TABLE_NAME AS OBJECT_NAME,
                       TABLE_TYPE AS OBJECT_TYPE
                FROM "{database_name}".INFORMATION_SCHEMA.TABLES
                WHERE TABLE_SCHEMA IN ({schema_clause})
                  AND TABLE_TYPE IN ('BASE TABLE', 'VIEW', 'MATERIALIZED VIEW')
                ORDER BY TABLE_SCHEMA, TABLE_NAME
            """
            rows = client.run(objects_sql)
            objects: List[Dict[str, Any]] = []
            for row in rows:
                db = str(row[0]).upper()
                schema = str(row[1]).upper()
                # Preserve exact object name case - Snowflake object names can be case-sensitive
                obj_name = str(row[2]) if row[2] else ""
                table_type = str(row[3]) if row[3] else 'TABLE'
                normalized_type = _normalized_table_type(table_type)
                objects.append({
                    "database_name": db,
                    "schema_name": schema,
                    "object_name": obj_name,  # Keep original case
                    "object_type": normalized_type,
                })

            # Fetch contacts for all objects
            contacts_map = _fetch_contact_assignments(client, database_name, schema_names, objects)

        # Build response objects with contact assignments
        all_response_objects: List[GovernanceObject] = []
        for obj in objects:
            key = (obj["database_name"], obj["schema_name"], obj["object_name"])
            assignments = contacts_map.get(key, {})
            all_response_objects.append(GovernanceObject(
                database_name=obj["database_name"],
                schema_name=obj["schema_name"],
                schema_description=schema_descriptions.get(obj["schema_name"]),
                object_name=obj["object_name"],
                object_type=obj["object_type"],
                steward_contact=assignments.get('STEWARD'),
                support_contact=assignments.get('SUPPORT'),
                approver_contact=assignments.get('ACCESS_APPROVAL'),
            ))

        # Apply pagination
        total = len(all_response_objects)
        start_idx = (page - 1) * page_size
        end_idx = start_idx + page_size
        paginated_objects = all_response_objects[start_idx:end_idx]

        return GovernanceObjectsResponse(
            message=f"Found {total} object(s) across {len(schema_names)} schema(s)",
            objects=paginated_objects,
            total=total,
            page=page,
            page_size=page_size,
        )
    except HTTPException:
        raise
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to load governance objects: {exc}")


@router.get("/governance/contacts", response_model=ContactsResponse)
async def list_contacts():
    try:
        database_name, schema_entries = _load_database_layers()
        schema_names = [entry["name"].upper() for entry in schema_entries]
        
        with SnowflakeClient() as client:
            records = _fetch_contacts_via_account_usage(client)
            if not records:
                records = _fetch_contacts_via_show(client, database_name, schema_names)
        return ContactsResponse(
            message=f"Found {len(records)} contact(s)",
            contacts=records,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to list contacts: {exc}")


@router.post("/governance/contacts")
async def create_contact(payload: ContactCreateRequest):
    try:
        contact_name = payload.name.strip()
        if not contact_name:
            raise HTTPException(status_code=400, detail="Contact name is required")

        method_clause = _build_contact_method_clause(payload)
        sql = f"CREATE CONTACT {_quote_identifier(contact_name)} {method_clause}"
        with SnowflakeClient() as client:
            client.run(sql)

        return {"message": f"Contact {contact_name} created successfully"}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to create contact: {exc}")


@router.post("/governance/contacts/assign")
async def assign_contacts(payload: ContactAssignmentRequest):
    if not payload.assignments:
        raise HTTPException(status_code=400, detail="At least one assignment is required")

    object_type = payload.object_type.upper()
    if object_type not in _VALID_OBJECT_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported object type: {payload.object_type}")

    identifier = _fully_qualified_name(
        payload.database_name.upper(),
        payload.schema_name.upper(),
        payload.object_name,
    )

    statements: List[str] = []
    for assignment in payload.assignments:
        purpose = assignment.purpose.upper()
        if purpose not in _CONTACT_PURPOSES:
            raise HTTPException(status_code=400, detail=f"Unsupported contact purpose: {assignment.purpose}")
        if assignment.contact_name:
            statements.append(
                f"ALTER {object_type} {identifier} SET CONTACT {purpose} = {_quote_identifier(assignment.contact_name)}"
            )
        else:
            statements.append(
                f"ALTER {object_type} {identifier} UNSET CONTACT {purpose}"
            )

    sql = ";\n".join(statements)
    try:
        with SnowflakeClient() as client:
            client.run(sql)
        return {"message": f"Updated contacts for {payload.schema_name}.{payload.object_name}"}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to assign contacts: {exc}")


def _resolve_model_component_objects(
    model_id: str,
    model_type: str,
    client: "SnowflakeClient",
) -> Tuple[str, str, List[Dict[str, Any]]]:
    """
    Resolve all database objects that make up a dimensional model.
    Returns: (model_database, model_schema, list_of_component_objects)

    For dimensions: Returns the dimension view + source attribute table
    For facts: Returns the fact view + edge tables + attribute table
    """
    import logging
    logger = logging.getLogger(__name__)

    # Load dimensional models config
    dim_config = dimensional_models_loader.get_all()
    model_database = dim_config.get("model_database")
    model_schema = dim_config.get("model_schema")

    if not model_database or not model_schema:
        raise HTTPException(
            status_code=500,
            detail="Model database and schema not configured in dimensional_models config"
        )

    component_objects = []

    if model_type == "dimension":
        dimensions = dim_config.get("dimensions", [])
        dimension_config = next((d for d in dimensions if d.get("id") == model_id), None)

        if not dimension_config:
            raise HTTPException(status_code=404, detail=f"Dimension '{model_id}' not found")

        # Add dimension view
        dimension_view_name = f"V_DIM_{model_id.upper()}"
        component_objects.append({
            "database_name": model_database.upper(),
            "schema_name": model_schema.upper(),
            "object_name": dimension_view_name,
            "object_type": "VIEW",
        })

        # Add source attribute table
        source = dimension_config.get("source", {})
        attr_table = source.get("attribute_table", {})

        if attr_table:
            blueprint_id = attr_table.get("name")
            attr_source = attr_table.get("source")
            attr_node = attr_table.get("node")

            if blueprint_id and attr_source and attr_node:
                # Resolve blueprint to get binding_object
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

                if binding_object:
                    blueprint_target_db = blueprints_config.get("target", {}).get("database")
                    blueprint_target_schema = blueprints_config.get("target", {}).get("schema")

                    attr_db = (attr_table.get("database") or
                              blueprint_target_db or
                              dim_config.get("source_database") or
                              model_database)
                    attr_schema = (attr_table.get("schema") or
                                  blueprint_target_schema or
                                  dim_config.get("source_schema") or
                                  model_schema)

                    attr_name = f"ATTR_{attr_node.upper()}_{binding_object.upper()}_{attr_source.upper()}"

                    component_objects.append({
                        "database_name": attr_db.upper(),
                        "schema_name": attr_schema.upper(),
                        "object_name": attr_name,
                        "object_type": "TABLE",
                    })

    elif model_type == "fact":
        facts = dim_config.get("facts", [])
        fact_config = next((f for f in facts if f.get("id") == model_id), None)

        if not fact_config:
            raise HTTPException(status_code=404, detail=f"Fact '{model_id}' not found")

        # Add fact view
        fact_view_name = f"V_FACT_{model_id.upper()}"
        component_objects.append({
            "database_name": model_database.upper(),
            "schema_name": model_schema.upper(),
            "object_name": fact_view_name,
            "object_type": "VIEW",
        })

        # Add edge tables
        edges = fact_config.get("edges", [])
        for edge in edges:
            edge_name = edge.get("name")
            if edge_name:
                edge_table_name = f"EDGE_{edge_name.upper()}"
                component_objects.append({
                    "database_name": model_database.upper(),
                    "schema_name": model_schema.upper(),
                    "object_name": edge_table_name,
                    "object_type": "TABLE",
                })

        # Add attribute table for fact measures
        attributes = fact_config.get("attributes", {})
        attr_table = attributes.get("attribute_table", {})

        if attr_table:
            blueprint_id = attr_table.get("name")
            attr_source = attr_table.get("source")
            attr_node = attr_table.get("node")

            if blueprint_id and attr_source:
                # Resolve blueprint
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

                if binding_object and attr_node:
                    blueprint_target_db = blueprints_config.get("target", {}).get("database")
                    blueprint_target_schema = blueprints_config.get("target", {}).get("schema")

                    attr_db = (attr_table.get("database") or
                              blueprint_target_db or
                              dim_config.get("source_database") or
                              model_database)
                    attr_schema = (attr_table.get("schema") or
                                  blueprint_target_schema or
                                  dim_config.get("source_schema") or
                                  model_schema)

                    attr_name = f"ATTR_{attr_node.upper()}_{binding_object.upper()}_{attr_source.upper()}"

                    component_objects.append({
                        "database_name": attr_db.upper(),
                        "schema_name": attr_schema.upper(),
                        "object_name": attr_name,
                        "object_type": "TABLE",
                    })

    return model_database, model_schema, component_objects



@router.get("/governance/models", response_model=ModelGovernanceResponse)
async def get_model_governance():
    """
    List all dimensional models (dimensions and facts) with their governance status.
    Each model shows aggregated contact assignments from all component objects.
    """
    import logging
    logger = logging.getLogger(__name__)

    try:
        # Load dimensional models config
        dim_config = dimensional_models_loader.get_all()
        dimensions = dim_config.get("dimensions", [])
        facts = dim_config.get("facts", [])

        all_models: List[ModelGovernanceObject] = []

        with SnowflakeClient() as client:
            # Process dimensions
            for dim in dimensions:
                model_id = dim.get("id")
                if not model_id:
                    continue

                model_name = dim.get("name", model_id)
                domain = dim.get("belongs_to", "")
                deployed = dim.get("deployed", False)

                # Skip models that are not deployed
                if not deployed:
                    logger.info(f"Skipping dimension {model_id} - not deployed")
                    continue

                try:
                    # Resolve component objects
                    model_database, model_schema, component_objects = _resolve_model_component_objects(
                        model_id, "dimension", client
                    )

                    # Fetch contacts for all component objects
                    contacts_map = _fetch_contact_assignments(
                        client,
                        model_database,
                        [model_schema],
                        component_objects
                    )

                    # Build component objects with contact info
                    components: List[ComponentObject] = []
                    # Track contact assignments to determine model-level contacts
                    all_stewards = set()
                    all_support = set()
                    all_approvers = set()

                    for obj in component_objects:
                        key = (obj["database_name"], obj["schema_name"], obj["object_name"])
                        assignments = contacts_map.get(key, {})

                        steward = assignments.get('STEWARD')
                        support = assignments.get('SUPPORT')
                        approver = assignments.get('ACCESS_APPROVAL')

                        if steward:
                            all_stewards.add(steward)
                        if support:
                            all_support.add(support)
                        if approver:
                            all_approvers.add(approver)

                        components.append(ComponentObject(
                            database_name=obj["database_name"],
                            schema_name=obj["schema_name"],
                            object_name=obj["object_name"],
                            object_type=obj["object_type"],
                            steward_contact=steward,
                            support_contact=support,
                            approver_contact=approver,
                        ))

                    # Aggregate: if all components have the same contact, show it at model level
                    model_steward = list(all_stewards)[0] if len(all_stewards) == 1 else None
                    model_support = list(all_support)[0] if len(all_support) == 1 else None
                    model_approver = list(all_approvers)[0] if len(all_approvers) == 1 else None

                    all_models.append(ModelGovernanceObject(
                        model_id=model_id,
                        model_name=model_name,
                        model_type="dimension",
                        domain=domain,
                        deployed=deployed,
                        model_database=model_database,
                        model_schema=model_schema,
                        component_objects=components,
                        steward_contact=model_steward,
                        support_contact=model_support,
                        approver_contact=model_approver,
                    ))
                except Exception as e:
                    logger.warning(f"Failed to process dimension {model_id}: {e}")
                    # Add model without component details
                    all_models.append(ModelGovernanceObject(
                        model_id=model_id,
                        model_name=model_name,
                        model_type="dimension",
                        domain=domain,
                        deployed=deployed,
                        component_objects=[],
                    ))

            # Process facts
            for fact in facts:
                model_id = fact.get("id")
                if not model_id:
                    continue

                model_name = fact.get("name", model_id)
                domain = fact.get("belongs_to", "")
                deployed = fact.get("deployed", False)

                # Skip models that are not deployed
                if not deployed:
                    logger.info(f"Skipping fact {model_id} - not deployed")
                    continue

                try:
                    # Resolve component objects
                    model_database, model_schema, component_objects = _resolve_model_component_objects(
                        model_id, "fact", client
                    )

                    # Fetch contacts for all component objects
                    contacts_map = _fetch_contact_assignments(
                        client,
                        model_database,
                        [model_schema],
                        component_objects
                    )

                    # Build component objects with contact info
                    components: List[ComponentObject] = []
                    all_stewards = set()
                    all_support = set()
                    all_approvers = set()

                    for obj in component_objects:
                        key = (obj["database_name"], obj["schema_name"], obj["object_name"])
                        assignments = contacts_map.get(key, {})

                        steward = assignments.get('STEWARD')
                        support = assignments.get('SUPPORT')
                        approver = assignments.get('ACCESS_APPROVAL')

                        if steward:
                            all_stewards.add(steward)
                        if support:
                            all_support.add(support)
                        if approver:
                            all_approvers.add(approver)

                        components.append(ComponentObject(
                            database_name=obj["database_name"],
                            schema_name=obj["schema_name"],
                            object_name=obj["object_name"],
                            object_type=obj["object_type"],
                            steward_contact=steward,
                            support_contact=support,
                            approver_contact=approver,
                        ))

                    # Aggregate contacts
                    model_steward = list(all_stewards)[0] if len(all_stewards) == 1 else None
                    model_support = list(all_support)[0] if len(all_support) == 1 else None
                    model_approver = list(all_approvers)[0] if len(all_approvers) == 1 else None

                    all_models.append(ModelGovernanceObject(
                        model_id=model_id,
                        model_name=model_name,
                        model_type="fact",
                        domain=domain,
                        deployed=deployed,
                        model_database=model_database,
                        model_schema=model_schema,
                        component_objects=components,
                        steward_contact=model_steward,
                        support_contact=model_support,
                        approver_contact=model_approver,
                    ))
                except Exception as e:
                    logger.warning(f"Failed to process fact {model_id}: {e}")
                    # Add model without component details
                    all_models.append(ModelGovernanceObject(
                        model_id=model_id,
                        model_name=model_name,
                        model_type="fact",
                        domain=domain,
                        deployed=deployed,
                        component_objects=[],
                    ))

        return ModelGovernanceResponse(
            message=f"Found {len(all_models)} model(s) ({len(dimensions)} dimensions, {len(facts)} facts)",
            models=all_models,
            total=len(all_models),
        )

    except HTTPException:
        raise
    except Exception as exc:
        import traceback
        logger.error(f"Failed to load model governance: {exc}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Failed to load model governance: {exc}")


@router.post("/governance/models/assign")
async def assign_model_contacts(payload: ModelContactAssignmentRequest):
    """
    Assign contacts to a dimensional model.
    This applies the contacts to ALL component objects (views, tables) that make up the model.
    """
    import logging
    logger = logging.getLogger(__name__)

    if not payload.assignments:
        raise HTTPException(status_code=400, detail="At least one assignment is required")

    try:
        with SnowflakeClient() as client:
            # Resolve all component objects for this model
            model_database, model_schema, component_objects = _resolve_model_component_objects(
                payload.model_id, payload.model_type, client
            )

            if not component_objects:
                raise HTTPException(
                    status_code=404,
                    detail=f"No component objects found for {payload.model_type} '{payload.model_id}'"
                )

            # Build SQL statements to assign contacts to each component object
            all_statements: List[str] = []

            for obj in component_objects:
                identifier = _fully_qualified_name(
                    obj["database_name"],
                    obj["schema_name"],
                    obj["object_name"],
                )
                object_type = obj["object_type"]

                for assignment in payload.assignments:
                    purpose = assignment.purpose.upper()
                    if purpose not in _CONTACT_PURPOSES:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Unsupported contact purpose: {assignment.purpose}"
                        )

                    if assignment.contact_name:
                        all_statements.append(
                            f"ALTER {object_type} {identifier} SET CONTACT {purpose} = {_quote_identifier(assignment.contact_name)}"
                        )
                    else:
                        all_statements.append(
                            f"ALTER {object_type} {identifier} UNSET CONTACT {purpose}"
                        )

            # Execute all statements
            sql = ";\n".join(all_statements)
            logger.info(f"Executing {len(all_statements)} contact assignment statements for model {payload.model_id}")
            client.run(sql)

            return {
                "message": f"Updated contacts for {payload.model_type} '{payload.model_id}' ({len(component_objects)} component objects)",
                "component_count": len(component_objects),
            }

    except HTTPException:
        raise
    except Exception as exc:
        import traceback
        logger.error(f"Failed to assign model contacts: {exc}\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"Failed to assign contacts: {exc}")
