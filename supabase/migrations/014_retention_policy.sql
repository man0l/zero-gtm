-- Migration 014: Tighten retention policy for logs and system data
--
-- Retention tiers:
--   Logs (high-frequency, low-value): 3 hours
--     - cron.job_run_details  (~10K rows/day from 7 cron jobs every minute)
--     - net._http_response    (~8K rows/day from cron HTTP dispatches)
--     - pgmq.a_lead_enrichment (archived queue messages)
--
--   System/operational data: 1 week
--     - ninja.bulk_jobs (completed/failed)
--     - public.enrichment_jobs (completed/errored — legacy salonease)
--     - ninja.agent_conversations (configurable, default 7 days)
--
--   Application data: never purged
--     - campaigns, leads, api_keys, app_settings

CREATE OR REPLACE FUNCTION public.cleanup_system_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  retention_days int;
BEGIN
  -- ═══════════════════════════════════════════
  -- TIER 1: Logs — 3 hour retention
  -- High-frequency internal data, not useful beyond debugging
  -- ═══════════════════════════════════════════

  -- pg_cron job run history (~10K rows/day)
  DELETE FROM cron.job_run_details WHERE end_time < now() - interval '3 hours';

  -- pg_net HTTP responses (cron dispatcher logs)
  DELETE FROM net._http_response WHERE created < now() - interval '3 hours';

  -- pgmq archived messages
  BEGIN
    DELETE FROM pgmq.a_lead_enrichment WHERE archived_at < now() - interval '3 hours';
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  -- ═══════════════════════════════════════════
  -- TIER 2: System/operational data — 1 week retention
  -- Useful for debugging but not permanent
  -- ═══════════════════════════════════════════

  -- Completed/failed bulk jobs older than 1 week
  DELETE FROM ninja.bulk_jobs
  WHERE status IN ('completed', 'failed')
    AND completed_at < now() - interval '1 week';

  -- Legacy salonease enrichment jobs (queued/done/error)
  BEGIN
    DELETE FROM public.enrichment_jobs
    WHERE status IN ('done', 'error') AND updated_at < now() - interval '1 week';
    -- Also clean stale queued jobs older than 1 week (orphaned)
    DELETE FROM public.enrichment_jobs
    WHERE status = 'queued' AND created_at < now() - interval '1 week';
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  -- Agent conversations: configurable retention (default 7 days)
  SELECT COALESCE(
    (settings->'agent'->'defaults'->>'conversation_retention_days')::int,
    7
  ) INTO retention_days
  FROM ninja.app_settings WHERE id = 1;

  DELETE FROM ninja.agent_conversations
  WHERE updated_at < now() - (retention_days || ' days')::interval;
END;
$$;

-- Run cleanup every 30 minutes instead of hourly (to stay closer to 3h target)
DO $$ BEGIN PERFORM cron.unschedule('system_data_cleanup'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('system_data_cleanup', '*/30 * * * *', $$SELECT public.cleanup_system_data();$$);
