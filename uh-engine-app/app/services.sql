-- namespace under which our services and their functions will live
create schema if not exists services;

-- namespace for service administration
create or alter versioned schema setup;

-- creates a compute pool, service, and service function
-- Also creates UNIFIED_HONEY database and schemas (runs with owner privileges via EXECUTE AS OWNER)
create or replace procedure setup.create_service(privileges ARRAY)
returns varchar
language sql
execute as owner
as $$
    begin
        -- Create UNIFIED_HONEY database if it doesn't exist
        -- This runs with owner privileges (EXECUTE AS OWNER) - requires CREATE DATABASE privilege
        create database if not exists UNIFIED_HONEY
            comment = 'Unified Honey Engine - Data Modeling and Analytics Platform';

        -- Create schemas in UNIFIED_HONEY database
        create schema if not exists UNIFIED_HONEY.MODELLING
            comment = 'Dimensional models and analytical views';
        create schema if not exists UNIFIED_HONEY.SEMANTIC
            comment = 'Semantic layer and business logic';
        create schema if not exists UNIFIED_HONEY.STORAGE
            comment = 'Storage layer for nodes, edges, and attributes';
        
        -- Create tags in MODELLING schema (fully qualified names required in stored procedures)
        create tag if not exists UNIFIED_HONEY.MODELLING.Domain comment = 'Unified Honey Business domain classification for data objects (e.g., Procurement, Maintenance, Finance)';
        create tag if not exists UNIFIED_HONEY.MODELLING.Process comment = 'Unified Honey Business process classification for data objects (e.g., Procure to Pay, Asset Management, Accounting)';
        create tag if not exists UNIFIED_HONEY.MODELLING.PII comment = 'Unified Honey personal identifiable information classification for sensitive data elements (e.g., employee identifiers, customer contact details)';
        
        -- Grant privileges on UNIFIED_HONEY database and schemas to app_public
        -- This runs with owner privileges (EXECUTE AS OWNER) so it can grant on objects it creates
        -- If grants fail, the customer can call setup.grant_unified_honey_privileges() manually
        begin
            grant usage on database UNIFIED_HONEY to application role app_public;
            grant usage on schema UNIFIED_HONEY.MODELLING to application role app_public;
            grant usage on schema UNIFIED_HONEY.SEMANTIC to application role app_public;
            grant usage on schema UNIFIED_HONEY.STORAGE to application role app_public;
            grant all privileges on schema UNIFIED_HONEY.MODELLING to application role app_public;
            grant all privileges on schema UNIFIED_HONEY.SEMANTIC to application role app_public;
            grant all privileges on schema UNIFIED_HONEY.STORAGE to application role app_public;
        exception
            when other then
                -- If grants fail, continue anyway (may already exist or have permission issues)
                -- Customer can call setup.grant_unified_honey_privileges() manually if needed
                null;
        end;
        
        -- Create STAGE schema in application database for staging views and streams
        -- This schema is used by the app to create temporary staging objects
        let app_db_name varchar := current_database();
        let stage_schema_name varchar := :app_db_name || '.STAGE';
        create schema if not exists identifier(:stage_schema_name)
            comment = 'Staging area for views, streams, and temporary objects';
        
        -- Grant privileges on application database STAGE schema to app_public
        begin
            grant usage on schema identifier(:stage_schema_name) to application role app_public;
            grant create view, create stream, create table, create temporary table, create task
                on schema identifier(:stage_schema_name) to application role app_public;
            grant execute task on schema identifier(:stage_schema_name) to application role app_public;
        exception
            when other then
                -- If grants fail, continue anyway (may already exist or have permission issues)
                null;
        end;
        
        let pool_name := (select current_database()) || '_app_pool';

        create compute pool if not exists identifier(:pool_name)
            MIN_NODES = 1
            MAX_NODES = 1
            INSTANCE_FAMILY = 'CPU_X64_XS';

        create service if not exists services.uh_engine_app_service
            in compute pool identifier(:pool_name)
            from spec='service_spec.yml';

        grant usage on service services.uh_engine_app_service
            to application role app_public;

        create or replace function services.echo(payload varchar)
            returns varchar
            service = services.uh_engine_app_service
            endpoint = 'my-endpoint'
            max_batch_rows = 50
            AS '/echo';

        grant usage on function services.echo(varchar)
            to application role app_public;

        return 'Done';
    end;
$$;
grant usage on procedure setup.create_service(ARRAY)
    to application role app_public;

create or replace procedure setup.suspend_service()
returns varchar
language sql
execute as owner
as $$
    begin
        alter service services.uh_engine_app_service suspend;
        return 'Done';
    end;
$$;
grant usage on procedure setup.suspend_service()
    to application role app_public;

create or replace procedure setup.resume_service()
returns varchar
language sql
execute as owner
as $$
    begin
        alter service services.uh_engine_app_service resume;
        return 'Done';
    end;
$$;
grant usage on procedure setup.resume_service()
    to application role app_public;

create or replace procedure setup.drop_service_and_pool()
returns varchar
language sql
execute as owner
as $$
    begin
        let pool_name := (select current_database()) || '_app_pool';
        drop service if exists services.uh_engine_app_service;
        drop compute pool if exists identifier(:pool_name);
        return 'Done';
    end;
$$;
grant usage on procedure setup.drop_service_and_pool()
    to application role app_public;

create or replace procedure setup.service_status()
returns varchar
language sql
execute as owner
as $$
    declare
        service_status varchar;
    begin
        call system$get_service_status('services.uh_engine_app_service') into :service_status;
        return parse_json(:service_status)[0]['status']::varchar;
    end;
$$;
grant usage on procedure setup.service_status()
    to application role app_public;

-- Procedure to grant privileges on UNIFIED_HONEY database to app_public
-- This must be called by the customer after activation to grant access to the database
-- The procedure uses EXECUTE AS OWNER to grant privileges on objects created by the application
create or replace procedure setup.grant_unified_honey_privileges()
returns varchar
language sql
execute as owner
as $$
    begin
        -- Grant privileges on UNIFIED_HONEY database and schemas to app_public
        grant usage on database UNIFIED_HONEY to application role app_public;
        grant usage on schema UNIFIED_HONEY.MODELLING to application role app_public;
        grant usage on schema UNIFIED_HONEY.SEMANTIC to application role app_public;
        grant usage on schema UNIFIED_HONEY.STORAGE to application role app_public;
        grant all privileges on schema UNIFIED_HONEY.MODELLING to application role app_public;
        grant all privileges on schema UNIFIED_HONEY.SEMANTIC to application role app_public;
        grant all privileges on schema UNIFIED_HONEY.STORAGE to application role app_public;
        
        return 'Privileges granted successfully on UNIFIED_HONEY database and schemas to app_public';
    end;
$$;
grant usage on procedure setup.grant_unified_honey_privileges()
    to application role app_public;

grant usage on schema setup to application role app_public;
