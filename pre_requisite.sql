# From tutorial 2 :: https://docs.snowflake.com/en/developer-guide/native-apps/tutorials/na-spcs-tutorial
## Initial SQL
```sql
CREATE ROLE IF NOT EXISTS uh_engine_app_role;
GRANT ROLE uh_engine_app_role TO USER "PETER.CARLSSON@UNIFIEDHONEY.COM";
GRANT CREATE INTEGRATION ON ACCOUNT TO ROLE uh_engine_app_role;
GRANT CREATE WAREHOUSE ON ACCOUNT TO ROLE uh_engine_app_role;
GRANT CREATE DATABASE ON ACCOUNT TO ROLE uh_engine_app_role;
GRANT CREATE APPLICATION PACKAGE ON ACCOUNT TO ROLE uh_engine_app_role;
GRANT CREATE APPLICATION ON ACCOUNT TO ROLE uh_engine_app_role;
GRANT CREATE COMPUTE POOL ON ACCOUNT TO ROLE uh_engine_app_role WITH GRANT OPTION;
GRANT BIND SERVICE ENDPOINT ON ACCOUNT TO ROLE uh_engine_app_role WITH GRANT OPTION;

USE ROLE uh_engine_app_role;
CREATE OR REPLACE WAREHOUSE NATIVE_APP_WH WITH
  WAREHOUSE_SIZE = 'X-SMALL'
  AUTO_SUSPEND = 180
  AUTO_RESUME = true
  INITIALLY_SUSPENDED = false;
  
CREATE DATABASE IF NOT EXISTS uh_engine_app_database;
CREATE SCHEMA IF NOT EXISTS uh_engine_app_schema;
CREATE IMAGE REPOSITORY IF NOT EXISTS uh_engine_app_image_repo;
```

## Set up connection for snow cli to use this role
`snow connection add`
`snow connection test -c app_poc`
`snow connection set-default app_poc`

## Create template using snow cli
`snow init --template app_spcs_basic`

## Build and push
Start docker desktop
`docker build --rm --platform=linux/amd64 -t spcs_na_service:latest .`
`REPO_URL=$(snow spcs image-repository url uh_engine_app_database.uh_engine_app_schema.uh_engine_app_image_repo)`
`docker tag spcs_na_service:latest $REPO_URL/spcs_na_service:latest`
`snow spcs image-registry login`
`docker push $REPO_URL/spcs_na_service:latest`
`snow spcs image-repository list-images uh_engine_app_database.uh_engine_app_schema.uh_engine_app_image_repo`
