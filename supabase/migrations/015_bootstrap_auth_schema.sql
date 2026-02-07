-- Migration 015: Bootstrap auth schema for GoTrue
-- GoTrue (supabase-auth) requires the auth schema and base tables to exist
-- before it can run its own ALTER migrations. On the standard Supabase image
-- this is handled by init scripts, but when using a separate DB (supabase-db17)
-- the auth schema must be created explicitly.
--
-- This migration is idempotent — safe to run on databases that already have
-- the auth schema (all statements use IF NOT EXISTS / DO $$ guards).

-- 1. Schemas & extensions
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN
    CREATE EXTENSION pgcrypto SCHEMA extensions;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'uuid-ossp') THEN
    CREATE EXTENSION "uuid-ossp" SCHEMA extensions;
  END IF;
END
$$;

-- 2. Base auth tables (GoTrue's built-in migrations ALTER these)
CREATE TABLE IF NOT EXISTS auth.users (
  instance_id uuid NULL,
  id uuid NOT NULL UNIQUE DEFAULT extensions.uuid_generate_v4(),
  aud varchar(255) NULL,
  role varchar(255) NULL,
  email varchar(255) NULL UNIQUE,
  encrypted_password varchar(255) NULL,
  confirmed_at timestamptz NULL,
  invited_at timestamptz NULL,
  confirmation_token varchar(255) NULL,
  confirmation_sent_at timestamptz NULL,
  recovery_token varchar(255) NULL,
  recovery_sent_at timestamptz NULL,
  email_change_token varchar(255) NULL,
  email_change varchar(255) NULL,
  email_change_sent_at timestamptz NULL,
  last_sign_in_at timestamptz NULL,
  raw_app_meta_data jsonb NULL,
  raw_user_meta_data jsonb NULL,
  is_super_admin bool NULL,
  created_at timestamptz NULL,
  updated_at timestamptz NULL,
  CONSTRAINT users_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS auth.refresh_tokens (
  instance_id uuid NULL,
  id bigserial NOT NULL,
  token varchar(255) NULL,
  user_id varchar(255) NULL,
  revoked bool NULL,
  created_at timestamptz NULL,
  updated_at timestamptz NULL,
  CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS auth.instances (
  id uuid NOT NULL,
  uuid uuid NULL,
  raw_base_config text NULL,
  created_at timestamptz NULL,
  updated_at timestamptz NULL,
  CONSTRAINT instances_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS auth.audit_log_entries (
  instance_id uuid NULL,
  id uuid NOT NULL,
  payload json NULL,
  created_at timestamptz NULL,
  CONSTRAINT audit_log_entries_pkey PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS auth.schema_migrations (
  version varchar(255) NOT NULL,
  CONSTRAINT schema_migrations_pkey PRIMARY KEY (version)
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS users_instance_id_idx ON auth.users USING btree (instance_id);
CREATE INDEX IF NOT EXISTS users_instance_id_email_idx ON auth.users USING btree (instance_id, lower(email));
CREATE INDEX IF NOT EXISTS refresh_tokens_instance_id_idx ON auth.refresh_tokens USING btree (instance_id);
CREATE INDEX IF NOT EXISTS refresh_tokens_instance_id_user_id_idx ON auth.refresh_tokens USING btree (instance_id, user_id);
CREATE INDEX IF NOT EXISTS refresh_tokens_token_idx ON auth.refresh_tokens USING btree (token);
CREATE INDEX IF NOT EXISTS audit_logs_instance_id_idx ON auth.audit_log_entries USING btree (instance_id);

-- 4. Seed initial migration versions so GoTrue skips CREATE migrations
INSERT INTO auth.schema_migrations (version)
VALUES ('20171026211738'),
       ('20171026211808'),
       ('20171026211834'),
       ('20180103212743'),
       ('20180108183307'),
       ('20180119214651'),
       ('20180125194653')
ON CONFLICT DO NOTHING;

-- 5. Helper functions used by RLS policies & PostgREST
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT
    COALESCE(
      current_setting('request.jwt.claim.sub', true),
      (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')
    )::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT
    COALESCE(
      current_setting('request.jwt.claim.role', true),
      (current_setting('request.jwt.claims', true)::jsonb ->> 'role')
    )::text
$$;

CREATE OR REPLACE FUNCTION auth.email()
RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT
    COALESCE(
      current_setting('request.jwt.claim.email', true),
      (current_setting('request.jwt.claims', true)::jsonb ->> 'email')
    )::text
$$;

-- 6. Permissions
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    CREATE USER supabase_auth_admin NOINHERIT CREATEROLE LOGIN NOREPLICATION;
  END IF;
END
$$;

GRANT ALL PRIVILEGES ON SCHEMA auth TO supabase_auth_admin;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA auth TO supabase_auth_admin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA auth TO supabase_auth_admin;
ALTER USER supabase_auth_admin SET search_path = 'auth';

ALTER TABLE auth.users OWNER TO supabase_auth_admin;
ALTER TABLE auth.refresh_tokens OWNER TO supabase_auth_admin;
ALTER TABLE auth.audit_log_entries OWNER TO supabase_auth_admin;
ALTER TABLE auth.instances OWNER TO supabase_auth_admin;
ALTER TABLE auth.schema_migrations OWNER TO supabase_auth_admin;

GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC;
GRANT EXECUTE ON FUNCTION auth.role() TO PUBLIC;
GRANT EXECUTE ON FUNCTION auth.email() TO PUBLIC;
