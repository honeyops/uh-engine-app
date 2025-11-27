-- Snowflake Container Services setup for Unified Honey
-- Replace <values> with your account-specific names

-- 1) Create an image repository
-- CREATE IMAGE REPOSITORY IF NOT EXISTS <DB>.<SCHEMA>.UH_REPO COMMENT='Images for Unified Honey';

-- 2) Create secrets for Snowflake key-pair auth (if using keypair mode)
-- Store base64-encoded private key without PEM header/footer
-- CREATE SECRET IF NOT EXISTS <DB>.<SCHEMA>.UH_PK SECRET_TYPE = GENERIC_STRING SECRET_STRING = '<base64-encoded-key>';
-- Optional passphrase
-- CREATE SECRET IF NOT EXISTS <DB>.<SCHEMA>.UH_PK_PASSPHRASE SECRET_TYPE = GENERIC_STRING SECRET_STRING = '<passphrase>';

-- 3) Create a compute pool (admin step, once per account/region)
-- CREATE COMPUTE POOL IF NOT EXISTS UH_POOL 
--     MIN_NODES=1 MAX_NODES=2 AUTO_SUSPEND_SECS=300 INSTANCE_FAMILY='CPU_X64_XS';

-- 4) Create the backend service
-- CREATE SERVICE IF NOT EXISTS <DB>.<SCHEMA>.UH_BACKEND
--   IN COMPUTE POOL UH_POOL
--   EXTERNAL_ACCESS_INTEGRATIONS = () -- add if backend calls out to internet
--   FROM SPECIFICATION
-- $$
-- spec:
--   containers:
--     - name: backend
--       image: <DB>.<SCHEMA>.UH_REPO/engine-backend:<tag>
--       env:
--         SNOWFLAKE_ACCOUNT: <account_name>
--         SNOWFLAKE_USER: <service_user>
--         SNOWFLAKE_ROLE: <role>
--         SNOWFLAKE_WAREHOUSE: <warehouse>
--         SNOWFLAKE_DATABASE: <database>
--         SNOWFLAKE_SCHEMA: <schema>
--         SNOWFLAKE_AUTH: keypair
--       secrets:
--         - name: SNOWFLAKE_PRIVATE_KEY
--           secret: <DB>.<SCHEMA>.UH_PK
--         - name: SNOWFLAKE_PRIVATE_KEY_PASSPHRASE
--           secret: <DB>.<SCHEMA>.UH_PK_PASSPHRASE
--   endpoints:
--     - name: http
--       port: 8000
--       public: true
-- $$;

-- 5) Create the frontend service (static nginx)
-- CREATE SERVICE IF NOT EXISTS <DB>.<SCHEMA>.UH_FRONTEND
--   IN COMPUTE POOL UH_POOL
--   FROM SPECIFICATION
-- $$
-- spec:
--   containers:
--     - name: web
--       image: <DB>.<SCHEMA>.UH_REPO/frontend:<tag>
--       env:
--         # Point frontend to backend service URL
--         REACT_APP_API_BASE: "https://$(system$reference('UH_BACKEND').endpoints.http.url)"
--   endpoints:
--     - name: http
--       port: 80
--       public: true
-- $$;

-- 6) Inspect service URLs
-- CALL SYSTEM$GET_SERVICE_STATUS('<DB>.<SCHEMA>.UH_BACKEND');
-- CALL SYSTEM$GET_SERVICE_STATUS('<DB>.<SCHEMA>.UH_FRONTEND');


