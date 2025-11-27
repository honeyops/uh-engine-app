import os
import logging
from pathlib import Path
import snowflake.connector
from threading import Lock
from typing import Optional

logger = logging.getLogger(__name__)

# Global connection pool
_connection_pool_lock = Lock()
_connection_pool: Optional[snowflake.connector.SnowflakeConnection] = None
_pool_initialized = False


def _get_default_private_key_path():
    """Get the default private key path relative to project root."""
    # Get the project root (uh-engine directory)
    # This file is in backend/core/snowflake.py, so go up 2 levels
    project_root = Path(__file__).parent.parent.parent
    default_key_path = project_root / "secrets" / "rsa_key.p8"
    return str(default_key_path)


def _get_pooled_connection() -> snowflake.connector.SnowflakeConnection:
    """Get a connection from the pool, creating one if needed. Thread-safe."""
    global _connection_pool, _pool_initialized

    with _connection_pool_lock:
        # Check if connection exists and is valid
        if _connection_pool is not None:
            try:
                # Quick ping to verify connection is alive and warehouse is active
                with _connection_pool.cursor() as cur:
                    cur.execute("SELECT 1")
                logger.debug("Reusing existing pooled connection")
                return _connection_pool
            except Exception as e:
                logger.warning(f"Pooled connection is stale, creating new one: {e}")
                try:
                    _connection_pool.close()
                except:
                    pass
                _connection_pool = None

        # Create new connection
        logger.info("Creating new pooled Snowflake connection")
        token_path = "/snowflake/session/token"

        if os.path.isfile(token_path):
            creds = {
                "host": os.getenv("SNOWFLAKE_HOST"),
                "port": os.getenv("SNOWFLAKE_PORT"),
                "protocol": "https",
                "account": os.getenv("SNOWFLAKE_ACCOUNT"),
                "authenticator": "oauth",
                "token": open(token_path, "r").read(),
                "warehouse": os.getenv("SNOWFLAKE_WAREHOUSE"),
                "database": os.getenv("SNOWFLAKE_DATABASE"),
                "schema": os.getenv("SNOWFLAKE_SCHEMA"),
                "client_session_keep_alive": True,
                "client_store_temporary_credential": True,
            }
        else:
            # Local authentication using RSA key pair
            private_key_path = os.getenv("SNOWFLAKE_PRIVATE_KEY_PATH") or _get_default_private_key_path()
            private_key_passphrase = os.getenv("SNOWFLAKE_PRIVATE_KEY_PASSPHRASE")

            creds = {
                "account": os.getenv("SNOWFLAKE_ACCOUNT", "GOISTMO-USWEST"),
                "user": os.getenv("SNOWFLAKE_USER", "PETER.CARLSSON@UNIFIEDHONEY.COM"),
                "authenticator": "SNOWFLAKE_JWT",
                "private_key_file": private_key_path,
                "role": os.getenv("SNOWFLAKE_ROLE", "ACCOUNTADMIN"),
                "warehouse": os.getenv("SNOWFLAKE_WAREHOUSE", "DEVELOPER_WH"),
                "database": os.getenv("SNOWFLAKE_DATABASE", "ENTITY_MANAGER_DEV"),
                "schema": os.getenv("SNOWFLAKE_SCHEMA", "_1_SOURCE_DATA"),
                "client_session_keep_alive": True,
                "client_store_temporary_credential": True,
            }

            if private_key_passphrase:
                creds["private_key_file_pwd"] = private_key_passphrase

        _connection_pool = snowflake.connector.connect(**creds)
        # Warehouse is set via connection parameters - Snowflake should handle activation automatically
        # If queries fail with warehouse errors, customer needs to grant: GRANT USAGE ON WAREHOUSE <name> TO APPLICATION ROLE app_public;
        _pool_initialized = True
        logger.info("Pooled connection established successfully")
        return _connection_pool


class SnowflakeClient:
    """Snowflake helper for SPCS and local/dev."""

    def __init__(self, token_path: str = "/snowflake/session/token", use_pool: bool = True) -> None:
        self._token_path = token_path
        self._use_pool = use_pool
        self._conn = None
        self._owns_connection = False  # Track if we created the connection

    def __enter__(self):
        self.connect()
        # Warehouse and role are set via connection parameters, no need for extra queries
        return self

    def __exit__(self, exc_type, exc, tb):
        # Only close if we own the connection (not pooled)
        if not self._use_pool and self._owns_connection:
            self.close()

    def connection(self):
        """Return an active Snowflake connection (connect if needed)."""
        if self._conn is None:
            self.connect()
        return self._conn

    def connect(self) -> None:
        if self._conn is not None:
            return

        if self._use_pool:
            # Use the global connection pool for maximum speed
            self._conn = _get_pooled_connection()
            self._owns_connection = False
        else:
            # Create a dedicated connection (for special cases)
            if os.path.isfile(self._token_path):
                creds = {
                    "host": os.getenv("SNOWFLAKE_HOST"),
                    "port": os.getenv("SNOWFLAKE_PORT"),
                    "protocol": "https",
                    "account": os.getenv("SNOWFLAKE_ACCOUNT"),
                    "authenticator": "oauth",
                    "token": open(self._token_path, "r").read(),
                    "warehouse": os.getenv("SNOWFLAKE_WAREHOUSE"),
                    "database": os.getenv("SNOWFLAKE_DATABASE"),
                    "schema": os.getenv("SNOWFLAKE_SCHEMA"),
                    "client_session_keep_alive": True,
                    "client_store_temporary_credential": True,
                }
            else:
                private_key_path = os.getenv("SNOWFLAKE_PRIVATE_KEY_PATH") or _get_default_private_key_path()
                private_key_passphrase = os.getenv("SNOWFLAKE_PRIVATE_KEY_PASSPHRASE")

                creds = {
                    "account": os.getenv("SNOWFLAKE_ACCOUNT", "GOISTMO-USWEST"),
                    "user": os.getenv("SNOWFLAKE_USER", "PETER.CARLSSON@UNIFIEDHONEY.COM"),
                    "authenticator": "SNOWFLAKE_JWT",
                    "private_key_file": private_key_path,
                    "role": os.getenv("SNOWFLAKE_ROLE", "ACCOUNTADMIN"),
                    "warehouse": os.getenv("SNOWFLAKE_WAREHOUSE", "DEVELOPER_WH"),
                    "database": os.getenv("SNOWFLAKE_DATABASE", "ENTITY_MANAGER_DEV"),
                    "schema": os.getenv("SNOWFLAKE_SCHEMA", "_1_SOURCE_DATA"),
                    "client_session_keep_alive": True,
                    "client_store_temporary_credential": True,
                }

                if private_key_passphrase:
                    creds["private_key_file_pwd"] = private_key_passphrase

            self._conn = snowflake.connector.connect(**creds)
            # Warehouse is set via connection parameters - Snowflake should handle activation automatically
            self._owns_connection = True

    def close(self) -> None:
        if self._conn is not None:
            try:
                self._conn.close()
            finally:
                self._conn = None

    def run(self, sql: str, params=None):
        """
        Run single or multi-statement SQL. Returns last statement's rows (if any), else [].
        Raises exceptions if SQL execution fails.
        """
        if self._conn is None:
            self.connect()

        # Warehouse is set via connection params - no need for redundant checks
        sql_trimmed = sql.strip()
        multi = ";" in sql_trimmed.rstrip(";")

        if multi and params is None:
            last_rows = []
            try:
                for c in self._conn.execute_string(sql_trimmed):
                    if c and c.description is not None:
                        last_rows = c.fetchall()
                return last_rows
            except Exception as e:
                error_str = str(e)
                # If warehouse error, try to activate warehouse and retry once
                if "No active warehouse" in error_str or "000606" in error_str:
                    warehouse = os.getenv("SNOWFLAKE_WAREHOUSE")
                    if warehouse:
                        try:
                            logger.warning(f"Warehouse not active, activating {warehouse} and retrying")
                            with self._conn.cursor() as cur:
                                cur.execute(f"USE WAREHOUSE {warehouse}")
                            # Retry the original query
                            for c in self._conn.execute_string(sql_trimmed):
                                if c and c.description is not None:
                                    last_rows = c.fetchall()
                            return last_rows
                        except Exception as retry_error:
                            truncated_sql = sql_trimmed.replace("\n", " ")[:500]
                            logger.exception("Snowflake SQL execution failed after warehouse retry", extra={"sql": truncated_sql})
                            raise Exception(f"SQL execution failed ({truncated_sql}): {str(retry_error)}")
                
                truncated_sql = sql_trimmed.replace("\n", " ")[:500]
                logger.exception("Snowflake SQL execution failed", extra={"sql": truncated_sql})
                raise Exception(f"SQL execution failed ({truncated_sql}): {str(e)}")

        with self._conn.cursor() as cur:
            try:
                cur.execute(sql_trimmed, params)
                if cur.description is not None:
                    return cur.fetchall()
                return []
            except Exception as e:
                error_str = str(e)
                # If warehouse error, try to activate warehouse and retry once
                if "No active warehouse" in error_str or "000606" in error_str:
                    warehouse = os.getenv("SNOWFLAKE_WAREHOUSE")
                    logger.error(f"Warehouse error detected. Attempting to activate warehouse: '{warehouse}'")
                    if warehouse:
                        try:
                            logger.warning(f"Warehouse '{warehouse}' not active, attempting to activate and retry")
                            cur.execute(f"USE WAREHOUSE {warehouse}")
                            # Retry the original query
                            cur.execute(sql_trimmed, params)
                            if cur.description is not None:
                                return cur.fetchall()
                            return []
                        except Exception as retry_error:
                            truncated_sql = sql_trimmed.replace("\n", " ")[:500]
                            logger.exception("Snowflake SQL execution failed after warehouse retry", extra={"sql": truncated_sql})
                            raise Exception(f"SQL execution failed ({truncated_sql}): {str(retry_error)}")
                
                truncated_sql = sql_trimmed.replace("\n", " ")[:500]
                logger.exception("Snowflake SQL execution failed", extra={"sql": truncated_sql})
                raise Exception(f"SQL execution failed ({truncated_sql}): {str(e)}")

    def deploy(self, ddl_sql: str) -> None:
        self.run(ddl_sql)


