-- The app role doesn't own the tables, so it can't disable triggers (08 §3.3).
-- Runs once, when the Postgres volume is first created.
CREATE ROLE paypure_app LOGIN PASSWORD 'paypure_app';
GRANT CONNECT ON DATABASE paypure TO paypure_app;
GRANT USAGE ON SCHEMA public TO paypure_app;
ALTER DEFAULT PRIVILEGES FOR ROLE paypure IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO paypure_app;
ALTER DEFAULT PRIVILEGES FOR ROLE paypure IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO paypure_app;
