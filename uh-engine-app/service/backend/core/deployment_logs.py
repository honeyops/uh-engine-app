import json
import logging
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Union

from core.config import deployment_logs_table
from core.snowflake import SnowflakeClient

logger = logging.getLogger(__name__)


def _json_default(value: Any) -> Any:
    """
    Fallback serializer for values that are not JSON serializable by default.
    Converts datetimes to ISO strings and sets to lists. Falls back to str().
    """
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, set):
        return list(value)
    return str(value)


def _to_json_param(value: Any, fallback: Any) -> str:
    """
    Serialize to JSON for Snowflake PARSE_JSON parameters.
    Ensures we never return an invalid JSON string.
    """
    target = value if value is not None else fallback
    try:
        return json.dumps(target, default=_json_default)
    except TypeError as exc:
        logger.warning("Failed to serialize deployment log payload; coercing to string: %s", exc)
        return json.dumps(str(target))


def _get_deployment_logs_table_name() -> Optional[str]:
    """
    Return fully-qualified deployment logs table name if configured.
    """
    database = deployment_logs_table.get("database_name")
    schema = deployment_logs_table.get("schema_name")
    table = deployment_logs_table.get("table_name")

    if not database or not schema or not table:
        logger.warning(
            "deployment_logs_table configuration is incomplete; skipping log persistence. "
            f"Got: database={database}, schema={schema}, table={table}"
        )
        return None

    table_name = f"{database}.{schema}.{table}"
    logger.debug(f"Built deployment logs table name: {table_name}")
    return table_name


def persist_deployment_log(
    *,
    deployment_type: str,
    model_ids: Union[List[str], Dict[str, Any]],
    events: List[Dict[str, Any]],
    summary: Dict[str, Any],
    status: str,
    success_count: int,
    error_count: int,
    total_count: int
) -> None:
    """
    Write deployment execution details to Snowflake for auditing.
    Combines all deployment information into a single JSON log entry.
    """
    table_name = _get_deployment_logs_table_name()
    if not table_name:
        logger.warning(
            "Skipping deployment log persistence: table name not configured. "
            "Check deployment_logs_table config in core/config.py"
        )
        return

    logger.info(f"Attempting to persist deployment log to {table_name}")

    # Combine all deployment info into a single log object
    deployment_log_data = {
        "deployment_type": deployment_type,
        "model_ids": model_ids,
        "events": events,
        "summary": summary,
        "status": status,
        "success_count": success_count,
        "error_count": error_count,
        "total_count": total_count
    }
    
    deployment_log_json = _to_json_param(deployment_log_data, {})

    insert_sql = f"""
        INSERT INTO {table_name} (
            deployment_log
        ) VALUES (
            PARSE_JSON(%s)
        )
    """

    payload = (deployment_log_json,)

    try:
        logger.info(f"Executing INSERT to {table_name} with deployment_type={deployment_type}, status={status}")
        print(f"[DEPLOYMENT_LOG] Attempting to write to {table_name}")
        with SnowflakeClient() as client:
            # Execute the INSERT
            result = client.run(insert_sql, payload)
            print(f"[DEPLOYMENT_LOG] INSERT executed successfully, result: {result}")
        logger.info(f"Successfully persisted deployment log to {table_name} (type={deployment_type}, status={status})")
        print(f"[DEPLOYMENT_LOG] Successfully persisted log to {table_name}")
    except Exception as exc:
        error_msg = f"Failed to persist deployment log to {table_name}: {exc}"
        logger.error(
            f"{error_msg}\n"
            f"SQL: {insert_sql}\n"
            f"Payload length: {len(deployment_log_json)} chars",
            exc_info=True
        )
        print(f"[DEPLOYMENT_LOG] ERROR: {error_msg}")
        print(f"[DEPLOYMENT_LOG] Exception type: {type(exc).__name__}")
        print(f"[DEPLOYMENT_LOG] Exception details: {str(exc)}")


