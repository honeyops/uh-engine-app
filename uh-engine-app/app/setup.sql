create application role if not exists app_public;

-- Note: Warehouse usage grant is handled in setup.create_service() grant callback
-- which runs with customer privileges when the app is installed

execute immediate from './references.sql';
execute immediate from './services.sql';
execute immediate from './configuration.sql';
-- Note: UNIFIED_HONEY database and schemas are created by setup.create_service() grant callback
-- which runs automatically when the app is installed and privileges are granted