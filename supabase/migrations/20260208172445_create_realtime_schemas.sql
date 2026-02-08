-- Migration: Create schemas required by Supabase Realtime v2
-- The _realtime schema is used by Realtime v2 (v2.34.47+) for its internal tables.
-- The realtime schema is used by the legacy Realtime v0.x (kept for backward compat).

CREATE SCHEMA IF NOT EXISTS _realtime;
GRANT ALL ON SCHEMA _realtime TO postgres;

CREATE SCHEMA IF NOT EXISTS realtime;
GRANT ALL ON SCHEMA realtime TO postgres;
