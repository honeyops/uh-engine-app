"""
Helper module for working with Snowflake Native App references.
Provides utilities to discover bound databases and other references.
"""
import logging
from typing import List, Dict
from .snowflake import SnowflakeClient

logger = logging.getLogger(__name__)


def get_bound_databases() -> List[Dict[str, str]]:
    """
    Get list of databases that have been bound to the application.

    Returns:
        List of dictionaries with 'database_name' and 'bound_at' keys
    """
    try:
        with SnowflakeClient() as client:
            rows = client.run("SELECT * FROM config.get_bound_databases()")

            databases = [
                {
                    "database_name": row[0],
                    "bound_at": str(row[1])
                }
                for row in rows
            ]

            logger.info(f"Found {len(databases)} bound databases")
            return databases

    except Exception as e:
        logger.error(f"Failed to get bound databases: {e}")
        return []


def get_database_schemas(database_name: str) -> List[str]:
    """
    Get list of schemas in a bound database.

    Args:
        database_name: Name of the database

    Returns:
        List of schema names
    """
    try:
        with SnowflakeClient() as client:
            rows = client.run(f"SHOW SCHEMAS IN DATABASE {database_name}")
            schemas = [row[1] for row in rows]  # Schema name is in second column

            logger.info(f"Found {len(schemas)} schemas in database {database_name}")
            return schemas

    except Exception as e:
        logger.error(f"Failed to get schemas for database {database_name}: {e}")
        return []


def get_database_tables(database_name: str, schema_name: str) -> List[Dict[str, str]]:
    """
    Get list of tables in a database schema.

    Args:
        database_name: Name of the database
        schema_name: Name of the schema

    Returns:
        List of dictionaries with table metadata
    """
    try:
        with SnowflakeClient() as client:
            rows = client.run(f"SHOW TABLES IN {database_name}.{schema_name}")

            tables = [
                {
                    "database_name": row[2],
                    "schema_name": row[3],
                    "table_name": row[1],
                    "table_type": row[4]
                }
                for row in rows
            ]

            logger.info(f"Found {len(tables)} tables in {database_name}.{schema_name}")
            return tables

    except Exception as e:
        logger.error(f"Failed to get tables for {database_name}.{schema_name}: {e}")
        return []
