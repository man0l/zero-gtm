/**
 * Edge Function: health
 * System health check - DB connectivity, worker status, table counts
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getSupabaseClient, jsonResponse, errorResponse, handleCors } from "../_shared/supabase.ts";

Deno.serve(async (req: Request) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  const supabase = getSupabaseClient(req);

  try {
    // Check DB connectivity and get counts
    const [campaigns, leads, bulkJobs, enrichmentJobs] = await Promise.all([
      supabase.from("campaigns").select("id", { count: "exact", head: true }),
      supabase.from("leads").select("id", { count: "exact", head: true }),
      supabase.from("bulk_jobs").select("id", { count: "exact", head: true }),
      supabase.from("enrichment_jobs").select("id", { count: "exact", head: true }),
    ]);

    // Check for running/pending jobs
    const { data: activeJobs } = await supabase
      .from("bulk_jobs")
      .select("id, type, status, started_at, progress")
      .in("status", ["pending", "running"])
      .order("created_at", { ascending: false })
      .limit(10);

    // Check last worker heartbeat (most recent completed job)
    const { data: lastCompleted } = await supabase
      .from("bulk_jobs")
      .select("completed_at, type")
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(1)
      .single();

    return jsonResponse({
      status: "ok",
      app_version: "1.2.0",
      schema: "ninja",
      timestamp: new Date().toISOString(),
      counts: {
        campaigns: campaigns.count || 0,
        leads: leads.count || 0,
        bulk_jobs: bulkJobs.count || 0,
        enrichment_jobs: enrichmentJobs.count || 0,
      },
      active_jobs: activeJobs || [],
      worker_last_seen: lastCompleted?.completed_at || null,
    });
  } catch (err) {
    return jsonResponse({
      status: "error",
      error: String(err),
      timestamp: new Date().toISOString(),
    }, 500);
  }
});
