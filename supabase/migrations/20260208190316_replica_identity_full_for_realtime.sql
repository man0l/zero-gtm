-- Migration: Set REPLICA IDENTITY FULL on tables in the supabase_realtime publication.
-- Required for Supabase Realtime's postgres_cdc_rls extension to reliably
-- broadcast UPDATE events and perform RLS checks on changed rows.

ALTER TABLE ninja.bulk_jobs REPLICA IDENTITY FULL;
ALTER TABLE ninja.leads REPLICA IDENTITY FULL;
ALTER TABLE ninja.enrichment_jobs REPLICA IDENTITY FULL;
