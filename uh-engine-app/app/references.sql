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

grant usage on schema config to application role app_public;
