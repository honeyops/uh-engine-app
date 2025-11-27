create application role if not exists app_public;

-- Note: Warehouse usage grant is handled in setup.create_service() grant callback
-- which runs with customer privileges when the app is installed

execute immediate from './services.sql';
execute immediate from './configuration.sql';
-- Database creation is optional - requires CREATE DATABASE privilege
-- If privilege is not granted, customer can create database manually or use setup.create_database()
-- execute immediate from './database.sql';
