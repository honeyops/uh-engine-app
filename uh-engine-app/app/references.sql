-- Schema for managing references (warehouses, databases, etc.)
create schema if not exists config;

-- Procedure to register warehouse reference
-- This is called when consumers bind a warehouse to the application
create or replace procedure config.register_warehouse(ref_name STRING, operation STRING, ref_or_alias STRING)
returns string
language sql
execute as owner
as $$
    begin
        case (operation)
            when 'ADD' then
                select system$set_reference(:ref_name, :ref_or_alias);
            when 'REMOVE' then
                select system$remove_reference(:ref_name);
            when 'CLEAR' then
                select system$remove_reference(:ref_name);
        else
            return 'Unknown operation: ' || operation;
        end case;
        return 'Success';
    end;
$$;

grant usage on procedure config.register_warehouse(STRING, STRING, STRING)
    to application role app_public;

-- Table to track bound database references
create table if not exists config.bound_databases (
    reference_name STRING,
    database_name STRING,
    bound_at TIMESTAMP_LTZ DEFAULT CURRENT_TIMESTAMP(),
    PRIMARY KEY (reference_name, database_name)
);

grant select on table config.bound_databases to application role app_public;

-- Procedure to register database references (multi-valued)
-- This is called when consumers bind databases to the application
create or replace procedure config.register_databases(ref_name STRING, operation STRING, ref_or_alias STRING)
returns string
language sql
execute as owner
as $$
    declare
        result STRING;
    begin
        case (operation)
            when 'ADD' then
                -- Set the reference
                call system$set_reference(:ref_name, :ref_or_alias);

                -- Store the database name for the application to query
                insert into config.bound_databases (reference_name, database_name)
                values (:ref_name, :ref_or_alias)
                on conflict (reference_name, database_name) do nothing;

                result := 'Added database reference: ' || ref_or_alias;

            when 'REMOVE' then
                -- Remove from tracking table
                delete from config.bound_databases
                where reference_name = :ref_name and database_name = :ref_or_alias;

                -- Remove the reference
                call system$remove_reference(:ref_name, :ref_or_alias);

                result := 'Removed database reference: ' || ref_or_alias;

            when 'CLEAR' then
                -- Clear all for this reference
                delete from config.bound_databases where reference_name = :ref_name;
                call system$remove_reference(:ref_name);

                result := 'Cleared all database references for: ' || ref_name;
        else
            result := 'Unknown operation: ' || operation;
        end case;

        return result;
    end;
$$;

grant usage on procedure config.register_databases(STRING, STRING, STRING)
    to application role app_public;

-- Helper function to get list of bound databases
create or replace function config.get_bound_databases()
returns table (database_name STRING, bound_at TIMESTAMP_LTZ)
language sql
as $$
    select database_name, bound_at
    from config.bound_databases
    order by bound_at
$$;

grant usage on function config.get_bound_databases()
    to application role app_public;

grant usage on schema config to application role app_public;
