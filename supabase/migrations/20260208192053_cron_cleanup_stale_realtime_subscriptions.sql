-- Migration: Schedule pg_cron job to clean stale Realtime subscriptions.
-- Supabase Realtime v2 stores channel subscriptions in realtime.subscription.
-- When clients disconnect ungracefully, rows linger with expired JWTs.
-- This job deletes them every 5 minutes based on the JWT exp claim.

SELECT cron.schedule(
  'realtime-cleanup-expired-subscriptions',
  '*/5 * * * *',
  $$DELETE FROM realtime.subscription WHERE (claims->>'exp')::bigint < extract(epoch FROM now())$$
);
