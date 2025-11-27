"""
API Schema definitions
"""

from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List, Literal, Union

class DatabaseValidateResponse(BaseModel):
    valid: bool = Field(..., example=True, description="Whether the database and all schemas exist")
    database_name: str = Field(..., example="UNIFIED_HONEY", description="Database name")
    database_exists: bool = Field(..., example=True, description="Whether the database exists")
    missing_schemas: List[str] = Field(..., example=[], description="List of missing schema names")
    existing_schemas: List[str] = Field(..., example=["STORAGE", "MODELLING", "SEMANTIC"], description="List of existing schema names")

class BlueprintDeployRequest(BaseModel):
    blueprint_ids: List[str] = Field(..., example=["work_order_master", "work_order_tasks", "ekko"], description="List of blueprint IDs to deploy (blueprint IDs are unique across all sources)")
    replace_objects: bool = Field(True, example=True, description="Whether to replace existing objects")
    run_full_refresh: bool = Field(False, example=False, description="Whether to run full data refresh after deployment")
    database_name: Optional[str] = Field(None, example="unified_honey", description="Target database name (optional override)")

class BlueprintDeployResponse(BaseModel):
    message: str = Field(..., example="Deployed 3 blueprint(s) successfully")
    total_count: int = Field(..., example=3, description="Total number of blueprints attempted")
    successful_count: int = Field(..., example=3, description="Number of successful deployments")
    failed_count: int = Field(..., example=0, description="Number of failed deployments")
    results: List[Dict[str, Any]] = Field(..., example=[
        {
            "blueprint_id": "work_order_master",
            "status": "success",
            "steps_completed": ["source_validation", "stage_view", "stream", "nodes", "edges", "attributes", "mti", "task"],
            "data_summary": {"NODE_WORK_ORDER": 1500}
        }
    ], description="Detailed results for each blueprint deployment")

class BlueprintListResponse(BaseModel):
    message: str = Field(..., example="Found 4 blueprints across 2 sources")
    sources: Dict[str, list[str]] = Field(..., example={
        "s4hana": ["ekko"],
        "pronto": ["work_order_master", "work_order_tasks", "work_order_materials"]
    })

class BlueprintDetail(BaseModel):
    id: str
    name: str
    source: str
    binding_db: Optional[str] = None
    binding_schema: Optional[str] = None
    binding_table: Optional[str] = None
    column_count: int = 0
    mapping_complete: bool = False
    deployed: bool = False

class BlueprintListDetailedResponse(BaseModel):
    message: str = Field(..., example="Found 4 blueprints across 2 sources")
    blueprints: List[BlueprintDetail] = Field(..., description="List of blueprints with detailed information")

class BlueprintGetResponse(BaseModel):
    message: str
    blueprint_name: str
    blueprint: Dict[str, Any]

# Blueprint CRUD Operations
class BlueprintCreateRequest(BaseModel):
    blueprint_data: Dict[str, Any] = Field(..., example={
        "name": "new_blueprint",
        "description": "A new blueprint for testing",
        "table_pk": [
            {
                "name": "id",
                "binding": "ID"
            }
        ],
        "primary_node": {
            "node": "entity",
            "bindings": [
                {
                    "name": "id",
                    "binding": "ID"
                }
            ],
            "load": True
        },
        "secondary_nodes": [],
        "columns": [
            {
                "name": "name",
                "binding": "NAME",
                "alias": "name",
                "data_type": "string",
                "description": "Entity name",
                "type": "attribute"
            }
        ]
    }, description="Complete blueprint configuration")

class BlueprintUpdateRequest(BaseModel):
    blueprint_id: str = Field(..., example="work_order_master", description="ID of the blueprint to update (unique across all sources)")
    blueprint_data: Dict[str, Any] = Field(..., example={
        "name": "work_order_master",
        "description": "Updated description for work order master blueprint",
        "table_pk": [
            {
                "name": "work_order_id",
                "binding": "WORK_ORDER_ID"
            }
        ],
        "primary_node": {
            "node": "work_order",
            "bindings": [
                {
                    "name": "work_order_id",
                    "binding": "WORK_ORDER_ID"
                }
            ],
            "load": True
        },
        "secondary_nodes": [],
        "columns": [
            {
                "name": "work_order_number",
                "binding": "WORK_ORDER_NUMBER",
                "alias": "work_order_number",
                "data_type": "string",
                "description": "Unique work order number",
                "type": "attribute"
            }
        ]
    }, description="Updated blueprint configuration")

class BlueprintDeleteRequest(BaseModel):
    blueprint_id: str = Field(..., example="work_order_master", description="ID of the blueprint to delete (unique across all sources)")

class BlueprintCRUDResponse(BaseModel):
    message: str
    blueprint_id: Optional[str] = None

# Blueprint Bindings
class BlueprintBindingsRequest(BaseModel):
    blueprint_id: str = Field(..., example="work_order_master", description="ID of the blueprint (unique across all sources)")

class BlueprintBindingsUpdateRequest(BaseModel):
    blueprint_id: str = Field(..., example="work_order_master", description="ID of the blueprint (unique across all sources)")
    bindings: Dict[str, Any] = Field(..., example={
        "table_pk": [
            {
                "name": "work_order_id",
                "binding": "WORK_ORDER_ID"
            }
        ],
        "primary_node": {
            "node": "work_order",
            "bindings": [
                {
                    "name": "work_order_id",
                    "binding": "WORK_ORDER_ID"
                }
            ],
            "load": True
        },
        "secondary_nodes": [
            {
                "node": "asset",
                "load": True,
                "bindings": [
                    {
                        "name": "asset_id",
                        "binding": "ASSET_ID"
                    }
                ]
            }
        ],
        "columns": [
            {
                "name": "work_order_number",
                "binding": "WORK_ORDER_NUMBER",
                "alias": "work_order_number",
                "data_type": "string",
                "description": "Unique work order number assigned by PRONTO",
                "type": "attribute"
            },
            {
                "name": "work_order_type",
                "binding": "WORK_ORDER_TYPE",
                "alias": "work_order_type",
                "data_type": "string",
                "description": "Category/type of work order (e.g., corrective, preventive)",
                "type": "reference"
            }
        ]
    }, description="Blueprint bindings configuration")

class BlueprintBindingsResponse(BaseModel):
    message: str = Field(..., example="Blueprint bindings retrieved successfully for 'work_order_master'")
    blueprint_id: str = Field(..., example="work_order_master")
    bindings: Dict[str, Any] = Field(..., example={
        "table_pk": [
            {
                "name": "work_order_id",
                "binding": "WORK_ORDER_ID"
            }
        ],
        "primary_node": {
            "node": "work_order",
            "bindings": [
                {
                    "name": "work_order_id",
                    "binding": "WORK_ORDER_ID"
                }
            ],
            "load": True
        },
        "secondary_nodes": [
            {
                "node": "asset",
                "load": True,
                "bindings": [
                    {
                        "name": "asset_id",
                        "binding": "ASSET_ID"
                    }
                ]
            }
        ],
        "columns": [
            {
                "name": "work_order_number",
                "binding": "WORK_ORDER_NUMBER",
                "alias": "work_order_number",
                "data_type": "string",
                "description": "Unique work order number assigned by PRONTO",
                "type": "attribute"
            },
            {
                "name": "work_order_type",
                "binding": "WORK_ORDER_TYPE",
                "alias": "work_order_type",
                "data_type": "string",
                "description": "Category/type of work order (e.g., corrective, preventive)",
                "type": "reference"
            }
        ]
    })

# Source Metadata
class SourceMetadataResponse(BaseModel):
    message: str
    data: list[Dict[str, Any]]

# Presentation Management
class PresentationCreateRequest(BaseModel):
    presentation_data: Dict[str, Any]

class PresentationUpdateRequest(BaseModel):
    presentation_name: str
    presentation_data: Dict[str, Any]

class PresentationDeleteRequest(BaseModel):
    presentation_name: str

class PresentationResponse(BaseModel):
    message: str
    presentation_name: Optional[str] = None
    presentation: Optional[Dict[str, Any]] = None

class PresentationListResponse(BaseModel):
    message: str
    presentations: list[Dict[str, Any]]

# Full Refresh
class FullRefreshRequest(BaseModel):
    table_name: str = Field(..., example="work_order_master", description="Name of the table/blueprint to refresh")
    options: Optional[Dict[str, Any]] = Field({}, example={"truncate_first": True, "batch_size": 1000}, description="Additional options for the refresh operation")

class FullRefreshResponse(BaseModel):
    message: str = Field(..., example="Full refresh completed successfully for table 'work_order_master'")
    table_name: str = Field(..., example="work_order_master")
    success: bool = Field(..., example=True)

# Snapshot State Management
class SnapshotStateBase(BaseModel):
    database_name: str = Field(..., example="pronto_erp", description="Database name")
    schema_name: str = Field(..., example="informix", description="Schema name")
    table_name: str = Field(..., example="customers", description="Table name")
    enabled: Optional[bool] = Field(False, example=True, description="Whether snapshot is enabled")
    snapshot_request: Optional[bool] = Field(False, example=False, description="Whether a snapshot has been requested")
    table_ddl_initialize: Optional[bool] = Field(False, example=False, description="Whether table DDL has been initialized")
    watermark_column_pattern: Optional[str] = Field(None, example="last_modified", description="Watermark column pattern")
    watermark_column: Optional[str] = Field(None, example="last_modified", description="Watermark column name")
    primary_key_columns: Optional[str] = Field(None, example='["customer_id"]', description="Primary key columns as JSON string")
    chunking_strategy: Optional[str] = Field("primary_key", example="primary_key", description="Chunking strategy")

class SnapshotStateCreateRequest(SnapshotStateBase):
    pass

class SnapshotStateUpdateRequest(BaseModel):
    enabled: Optional[bool] = Field(None, example=True, description="Whether snapshot is enabled")
    snapshot_request: Optional[bool] = Field(None, example=False, description="Whether a snapshot has been requested")
    table_ddl_initialize: Optional[bool] = Field(None, example=False, description="Whether table DDL has been initialized")
    watermark_column_pattern: Optional[str] = Field(None, example="last_modified", description="Watermark column pattern")
    watermark_column: Optional[str] = Field(None, example="last_modified", description="Watermark column name")
    primary_key_columns: Optional[str] = Field(None, example='["customer_id"]', description="Primary key columns as JSON string")
    chunking_strategy: Optional[str] = Field(None, example="primary_key", description="Chunking strategy")

class SnapshotStateResponse(SnapshotStateBase):
    last_snapshot_watermark: Optional[str] = Field(None, example="2025-01-16T10:38:00.047000", description="Last snapshot watermark timestamp")
    last_snapshot_timestamp: Optional[str] = Field(None, example="2025-01-16T10:38:00.047000", description="Last snapshot timestamp")
    snapshot_status: Optional[str] = Field(None, example="completed", description="Snapshot status")
    created_at: Optional[str] = Field(None, example="2025-01-16T10:38:00.047000", description="Creation timestamp")
    updated_at: Optional[str] = Field(None, example="2025-01-16T10:45:00.000000", description="Last update timestamp")

class SnapshotStateListResponse(BaseModel):
    message: str = Field(..., example="Retrieved snapshot states successfully")
    snapshot_states: List[SnapshotStateResponse] = Field(..., description="List of snapshot states")

class SnapshotStateCRUDResponse(BaseModel):
    message: str = Field(..., example="Snapshot state created successfully")
    database_name: Optional[str] = None
    schema_name: Optional[str] = None
    table_name: Optional[str] = None

# Governance & Contacts
class GovernanceObject(BaseModel):
    database_name: str
    schema_name: str
    schema_description: Optional[str] = None
    object_name: str
    object_type: str
    steward_contact: Optional[str] = None
    support_contact: Optional[str] = None
    approver_contact: Optional[str] = None

class GovernanceObjectsResponse(BaseModel):
    message: str
    objects: List[GovernanceObject]
    total: int
    page: int
    page_size: int

class ContactRecord(BaseModel):
    name: str
    communication_type: Optional[str] = None
    communication_value: Optional[str] = None
    created_on: Optional[str] = None
    updated_on: Optional[str] = None
    raw_options: Optional[str] = None

class ContactsResponse(BaseModel):
    message: str
    contacts: List[ContactRecord]

class ContactCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, description="Unique contact identifier")
    method: Literal['URL', 'EMAIL', 'USERS'] = Field(..., description="Communication method")
    value: Union[str, List[str]] = Field(..., description="Communication value (string or list for USERS)")

class ContactAssignment(BaseModel):
    purpose: Literal['STEWARD', 'SUPPORT', 'ACCESS_APPROVAL']
    contact_name: Optional[str] = Field(None, description="Contact to assign; null clears the assignment")

class ContactAssignmentRequest(BaseModel):
    database_name: str
    schema_name: str
    object_name: str
    object_type: Literal['TABLE', 'VIEW', 'MATERIALIZED VIEW', 'DYNAMIC TABLE']
    assignments: List[ContactAssignment]

# Model-Level Governance
class ComponentObject(BaseModel):
    database_name: str
    schema_name: str
    object_name: str
    object_type: str
    steward_contact: Optional[str] = None
    support_contact: Optional[str] = None
    approver_contact: Optional[str] = None

class ModelGovernanceObject(BaseModel):
    model_id: str
    model_name: str
    model_type: Literal['dimension', 'fact']
    domain: str
    process: Optional[str] = None
    deployed: bool
    model_database: Optional[str] = None
    model_schema: Optional[str] = None
    component_objects: List[ComponentObject]
    steward_contact: Optional[str] = None
    support_contact: Optional[str] = None
    approver_contact: Optional[str] = None

class ModelGovernanceResponse(BaseModel):
    message: str
    models: List[ModelGovernanceObject]
    total: int

class ModelContactAssignmentRequest(BaseModel):
    model_id: str
    model_type: Literal['dimension', 'fact']
    assignments: List[ContactAssignment]