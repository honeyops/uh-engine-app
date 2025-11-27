-- namespace under which our services and their functions will live
create schema if not exists services;

-- namespace for service administration
create or alter versioned schema setup;

-- creates a compute pool, service, and service function
create or replace procedure setup.create_service(privileges ARRAY)
returns varchar
language sql
execute as owner
as $$
    begin
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

-- Procedure to create schemas in an existing UNIFIED_HONEY database
-- Note: The customer must create the UNIFIED_HONEY database manually first
-- This procedure assumes the database already exists and creates schemas within it
-- Native Apps cannot create top-level databases in customer accounts
create or replace procedure setup.create_database()
returns varchar
language sql
execute as owner
as $$
    begin
        create database if not exists UNIFIED_HONEY;

        -- Create schemas in the existing UNIFIED_HONEY database (customer must create DB first)
        create schema if not exists UNIFIED_HONEY.MODELLING
            comment = 'Dimensional models and analytical views';
        create schema if not exists UNIFIED_HONEY.SEMANTIC
            comment = 'Semantic layer and business logic';
        create schema if not exists UNIFIED_HONEY.STORAGE
            comment = 'Storage layer for nodes, edges, and attributes';
        
        -- Create tags (schema-qualified, without database prefix per Snowflake Native App requirements)
        use database UNIFIED_HONEY;
        create tag if not exists MODELLING.Domain comment = 'Unified Honey Business domain classification for data objects (e.g., Procurement, Maintenance, Finance)';
        create tag if not exists MODELLING.Process comment = 'Unified Honey Business process classification for data objects (e.g., Procure to Pay, Asset Management, Accounting)';
        create tag if not exists MODELLING.PII comment = 'Unified Honey personal identifiable information classification for sensitive data elements (e.g., employee identifiers, customer contact details)';
        
        -- Grant privileges to ACCOUNTADMIN
        grant usage on database UNIFIED_HONEY to role ACCOUNTADMIN;
        grant usage on schema UNIFIED_HONEY.MODELLING to role ACCOUNTADMIN;
        grant usage on schema UNIFIED_HONEY.SEMANTIC to role ACCOUNTADMIN;
        grant usage on schema UNIFIED_HONEY.STORAGE to role ACCOUNTADMIN;
        grant all privileges on database UNIFIED_HONEY to role ACCOUNTADMIN;
        grant all privileges on schema UNIFIED_HONEY.MODELLING to role ACCOUNTADMIN;
        grant all privileges on schema UNIFIED_HONEY.SEMANTIC to role ACCOUNTADMIN;
        grant all privileges on schema UNIFIED_HONEY.STORAGE to role ACCOUNTADMIN;
        
        -- Grant privileges to app_public
        grant usage on database UNIFIED_HONEY to application role app_public;
        grant usage on schema UNIFIED_HONEY.MODELLING to application role app_public;
        grant usage on schema UNIFIED_HONEY.SEMANTIC to application role app_public;
        grant usage on schema UNIFIED_HONEY.STORAGE to application role app_public;
        grant all privileges on schema UNIFIED_HONEY.MODELLING to application role app_public;
        grant all privileges on schema UNIFIED_HONEY.SEMANTIC to application role app_public;
        grant all privileges on schema UNIFIED_HONEY.STORAGE to application role app_public;
        
        return 'UNIFIED_HONEY schemas created successfully. Note: Database must be created manually by customer first.';
    end;
$$;
grant usage on procedure setup.create_database()
    to application role app_public;

grant usage on schema setup to application role app_public;
