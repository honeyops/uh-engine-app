import os

# Output database configuration (customer's UNIFIED_HONEY database)
output_database = {
    "database_name": os.getenv("OUTPUT_DATABASE_NAME", "unified_honey"),
    "storage_schema_name": os.getenv("STORAGE_SCHEMA_NAME", "storage"),
    "modelling_schema_name": os.getenv("MODELLING_SCHEMA_NAME", "modelling"),
    "semantic_schema_name": os.getenv("SEMANTIC_SCHEMA_NAME", "semantic"),
}

# Config database configuration (application database where config tables are stored)
# In Native Apps, this is the application database (set via SNOWFLAKE_DATABASE env var)
# Fallback to application database name for Native Apps
config_database_name = os.getenv("CONFIG_DATABASE_NAME") or os.getenv("SNOWFLAKE_DATABASE") or "UNIFIED_HONEY_APPLICATION"

config_database = {
    "database_name": config_database_name,
    "schema_name": os.getenv("CONFIG_SCHEMA_NAME", "core"),
    "blueprints": "config_blueprints",
    "blueprint_columns": "config_blueprint_columns",
    "dimensions": "config_dimensions",
    "dimension_columns": "config_dimension_columns",
    "facts": "config_facts",
    "fact_columns": "config_fact_columns"
}

# Snowflake data table configuration for Openflow page
snowflake_data_table = {
    "database_name": os.getenv("SNOWFLAKE_DATA_DATABASE_NAME", "LANDING_ZONE"),
    "schema_name": os.getenv("SNOWFLAKE_DATA_SCHEMA_NAME", "CDC_METADATA"),
    "table_name": os.getenv("SNOWFLAKE_DATA_TABLE_NAME", "CDC_STATE_METADATA")
}

# Deployment logs table configuration (in application database, same as config)
deployment_logs_database_name = os.getenv("DEPLOYMENT_LOGS_DATABASE_NAME") or os.getenv("SNOWFLAKE_DATABASE") or "UNIFIED_HONEY_APPLICATION"

deployment_logs_table = {
    "database_name": deployment_logs_database_name,
    "schema_name": os.getenv("DEPLOYMENT_LOGS_SCHEMA_NAME", "CORE"),
    "table_name": os.getenv("DEPLOYMENT_LOGS_TABLE_NAME", "DEPLOYMENT_LOGS")
}