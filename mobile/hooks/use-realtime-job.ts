/**
 * Realtime subscription for bulk job progress.
 * Listens to ninja.bulk_jobs table changes via Supabase Realtime,
 * with polling fallback every 3s for running/pending jobs.
 */
import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import type { BulkJob, JobProgress } from "@/lib/types";

const POLL_INTERVAL_MS = 3000;

export function useRealtimeJob(jobId: string | null) {
  const [job, setJob] = useState<BulkJob | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchJob = useCallback(async () => {
    if (!jobId) return;
    const { data } = await supabase
      .from("bulk_jobs")
      .select("*")
      .eq("id", jobId)
      .single();
    if (data) setJob(data as BulkJob);
  }, [jobId]);

  useEffect(() => {
    if (!jobId) return;

    // Fetch initial state
    fetchJob();

    // Subscribe to changes via Realtime
    const channel = supabase
      .channel(`job:${jobId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "ninja",
          table: "bulk_jobs",
          filter: `id=eq.${jobId}`,
        },
        (payload) => {
          setJob(payload.new as BulkJob);
        }
      )
      .subscribe();

    // Polling fallback: fetch every 3s while the job is active.
    // Stops automatically once the job reaches a terminal state.
    pollRef.current = setInterval(() => {
      fetchJob();
    }, POLL_INTERVAL_MS);

    return () => {
      supabase.removeChannel(channel);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [jobId, fetchJob]);

  // Stop polling once the job reaches a terminal state
  useEffect(() => {
    if (
      job &&
      (job.status === "completed" ||
        job.status === "failed" ||
        job.status === "cancelled")
    ) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
  }, [job?.status]);

  return job;
}

/**
 * Subscribe to all active jobs for a campaign.
 * Realtime + polling fallback every 3s while there are active jobs.
 */
export function useRealtimeCampaignJobs(campaignId: string | null) {
  const [jobs, setJobs] = useState<BulkJob[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchJobs = useCallback(async () => {
    if (!campaignId) return;
    const { data } = await supabase
      .from("bulk_jobs")
      .select("*")
      .eq("campaign_id", campaignId)
      .in("status", ["pending", "running"])
      .order("created_at", { ascending: false });
    if (data) setJobs(data as BulkJob[]);
  }, [campaignId]);

  useEffect(() => {
    if (!campaignId) return;

    // Fetch initial state
    fetchJobs();

    // Subscribe to changes via Realtime
    const channel = supabase
      .channel(`campaign_jobs:${campaignId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "ninja",
          table: "bulk_jobs",
          filter: `campaign_id=eq.${campaignId}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setJobs((prev) => [payload.new as BulkJob, ...prev]);
          } else if (payload.eventType === "UPDATE") {
            const updated = payload.new as BulkJob;
            setJobs((prev) =>
              prev
                .map((j) => (j.id === updated.id ? updated : j))
                .filter((j) => ["pending", "running"].includes(j.status))
            );
          }
        }
      )
      .subscribe();

    // Polling fallback every 3s
    pollRef.current = setInterval(() => {
      fetchJobs();
    }, POLL_INTERVAL_MS);

    return () => {
      supabase.removeChannel(channel);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [campaignId, fetchJobs]);

  // Stop polling when there are no active jobs
  useEffect(() => {
    if (jobs.length === 0 && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, [jobs.length]);

  return jobs;
}
