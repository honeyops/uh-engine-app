-- Schema for managing references (warehouses, databases, etc.)
create schema if not exists config;

-- Procedure to register warehouse reference
-- This is called when consumers bind a warehouse to the application
-- Automatically grants USAGE and OPERATE privileges when warehouse is bound
create or replace procedure config.register_warehouse(ref_name STRING, operation STRING, ref_or_alias STRING)
returns string
language sql
execute as owner
as $$
    declare
        warehouse_name string;
        app_name string;
        grant_result string;
    begin
        case (operation)
            when 'ADD' then
                -- Set the warehouse reference first
                select system$set_reference(:ref_name, :ref_or_alias);
                
                -- Get the actual warehouse name from the reference
                select system$get_reference(:ref_name) into :warehouse_name;
                
                -- Get the current application name
                select current_application() into :app_name;
                
                -- Automatically grant USAGE and OPERATE privileges to the application
                -- This runs with owner's privileges (ACCOUNTADMIN if they install)
                begin
                    execute immediate 'GRANT USAGE, OPERATE ON WAREHOUSE ' || :warehouse_name || ' TO APPLICATION ' || :app_name;
                    set grant_result := 'Grants applied successfully';
                exception
                    when other then
                        -- If grants already exist or other error, log but continue
                        -- Grants are idempotent, so this is safe
                        set grant_result := 'Grant attempt completed (may already exist): ' || sqlcode || ' - ' || sqlerrm;
                end;
                
                return 'Success. Reference set. ' || :grant_result;
            when 'REMOVE' then
                select system$remove_reference(:ref_name);
                return 'Success. Reference removed.';
            when 'CLEAR' then
                select system$remove_reference(:ref_name);
                return 'Success. Reference cleared.';
        else
            return 'Unknown operation: ' || operation;
        end case;
    end;
$$;

grant usage on procedure config.register_warehouse(STRING, STRING, STRING)
    to application role app_public;

grant usage on schema config to application role app_public;
