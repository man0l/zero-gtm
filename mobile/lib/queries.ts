/**
 * React Query hooks for all data operations.
 * Uses Supabase client with ninja schema.
 */
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase, invokeFunction } from "./supabase";
import type { Campaign, Lead, BulkJob, AgentMessage, AgentResponse, AgentConfig } from "./types";

// Lean field selection for list rendering (10 fields instead of 40+)
const LEAD_LIST_FIELDS =
  "id, company_name, company_name_casual, email, decision_maker_name, " +
  "decision_maker_email, phone, ice_status, enrichment_status, title, created_at";

const PAGE_SIZE = 50;

// ==================== CAMPAIGNS ====================

export function useCampaigns() {
  return useQuery({
    queryKey: ["campaigns"],
    queryFn: async () => {
      // Avoid embedded resource joins (causes 300 on PostgREST v9 with multi-schema)
      const { data: campaigns, error } = await supabase
        .from("campaigns")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;

      // Get lead counts separately
      const { count } = await supabase
        .from("leads")
        .select("id", { count: "exact", head: true });

      return (campaigns || []).map((c) => ({
        ...c,
        leads: [{ count: count || 0 }],
      })) as Campaign[];
    },
  });
}

export function useCampaign(id: string) {
  return useQuery({
    queryKey: ["campaign", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaigns")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;

      const { count } = await supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", id);

      return { ...data, leads: [{ count: count || 0 }] } as Campaign;
    },
    enabled: !!id,
  });
}

export function useCreateCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (campaign: {
      name: string;
      service_line: string;
      summarize_prompt: string;
      icebreaker_prompt: string;
    }) => {
      const { data, error } = await supabase
        .from("campaigns")
        .insert(campaign)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["campaigns"] }),
  });
}

export function useUpdateCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string } & Partial<Campaign>) => {
      const { data, error } = await supabase
        .from("campaigns")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["campaigns"] });
      queryClient.invalidateQueries({ queryKey: ["campaign", vars.id] });
    },
  });
}

// ==================== LEADS ====================

/**
 * Paginated leads with lean field selection.
 * Used by campaign detail screen with offset pagination.
 */
export function useLeads(campaignId: string, options?: {
  search?: string;
  iceStatus?: string;
  offset?: number;
  limit?: number;
}) {
  const { search, iceStatus, offset = 0, limit = PAGE_SIZE } = options || {};

  return useQuery({
    queryKey: ["leads", campaignId, { search, iceStatus, offset, limit }],
    queryFn: async () => {
      let query = supabase
        .from("leads")
        .select(LEAD_LIST_FIELDS, { count: "exact" })
        .eq("campaign_id", campaignId)
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (iceStatus) query = query.eq("ice_status", iceStatus);
      if (search) {
        query = query.or(
          `company_name.ilike.%${search}%,email.ilike.%${search}%,full_name.ilike.%${search}%`
        );
      }

      const { data, error, count } = await query;
      if (error) throw error;
      return { leads: (data || []) as Partial<Lead>[], total: count || 0 };
    },
    enabled: !!campaignId,
  });
}

/**
 * Infinite scroll leads using cursor-based pagination.
 * Loads PAGE_SIZE items at a time, appends on scroll.
 */
export function useInfiniteLeads(campaignId: string, options?: {
  search?: string;
  iceStatus?: string;
}) {
  const { search, iceStatus } = options || {};

  return useInfiniteQuery({
    queryKey: ["infinite_leads", campaignId, { search, iceStatus }],
    queryFn: async ({ pageParam = 0 }) => {
      let query = supabase
        .from("leads")
        .select(LEAD_LIST_FIELDS, { count: "exact" })
        .eq("campaign_id", campaignId)
        .order("created_at", { ascending: false })
        .range(pageParam, pageParam + PAGE_SIZE - 1);

      if (iceStatus) query = query.eq("ice_status", iceStatus);
      if (search) {
        query = query.or(
          `company_name.ilike.%${search}%,email.ilike.%${search}%,full_name.ilike.%${search}%`
        );
      }

      const { data, error, count } = await query;
      if (error) throw error;
      return {
        leads: (data || []) as Partial<Lead>[],
        total: count || 0,
        nextOffset: pageParam + PAGE_SIZE,
      };
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) =>
      lastPage.nextOffset < lastPage.total ? lastPage.nextOffset : undefined,
    enabled: !!campaignId,
  });
}

export function useLead(id: string) {
  return useQuery({
    queryKey: ["lead", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as Lead;
    },
    enabled: !!id,
  });
}

// ==================== DATA QUALITY (Learning #5) ====================
// Server-side aggregation: 7 parallel COUNT queries instead of fetching all leads.
// Memory: ~2KB (HTTP headers) instead of ~5MB (10,000 leads).

export function useDataQuality(campaignId: string) {
  return useQuery({
    queryKey: ["data_quality", campaignId],
    queryFn: async () => {
      const base = () =>
        supabase.from("leads").select("id", { count: "exact", head: true })
          .eq("campaign_id", campaignId);

      // Fire all 7 counts in parallel -- each is a single HEAD request
      const [
        totalRes,
        withEmailRes,
        withWebsiteRes,
        withDMRes,
        withCasualRes,
        withIcebreakerRes,
        // validated needs a JSONB filter -- use text match as approximation
      ] = await Promise.all([
        base(),
        base().not("email", "is", null),
        base().not("company_website", "is", null),
        base().not("decision_maker_name", "is", null),
        base().not("company_name_casual", "is", null),
        base().not("ice_breaker", "is", null),
      ]);

      const total = totalRes.count || 0;
      if (total === 0) return null;

      // For validated count, we need to check enrichment_status JSONB.
      // PostgREST supports -> operator for JSONB:
      const validatedRes = await supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaignId)
        .contains("enrichment_status", { website_validated: true });

      return {
        total,
        withEmail: withEmailRes.count || 0,
        withWebsite: withWebsiteRes.count || 0,
        withDM: withDMRes.count || 0,
        withCategory: 0, // computed by useCategoryBreakdown separately
        withCasual: withCasualRes.count || 0,
        withIcebreaker: withIcebreakerRes.count || 0,
        validated: validatedRes.count || 0,
        categories: [], // populated by useCategoryBreakdown
      };
    },
    enabled: !!campaignId,
  });
}

// Category breakdown via RPC (server-side GROUP BY).
// Returns only category names + counts, no lead data.
export function useCategoryBreakdown(campaignId: string) {
  return useQuery({
    queryKey: ["category_breakdown", campaignId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("lead_category_breakdown", {
        p_campaign_id: campaignId,
      });
      if (error) {
        // Fallback: if RPC not available yet, return empty
        console.warn("lead_category_breakdown RPC failed, returning empty:", error.message);
        return [];
      }
      return (data || []).map((row: { category_name: string; lead_count: number }) => ({
        name: row.category_name,
        count: Number(row.lead_count),
      }));
    },
    enabled: !!campaignId,
  });
}

// ==================== BULK JOBS ====================

export function useBulkJobs(campaignId?: string) {
  return useQuery({
    queryKey: ["bulk_jobs", campaignId],
    queryFn: async () => {
      let query = supabase
        .from("bulk_jobs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);

      if (campaignId) query = query.eq("campaign_id", campaignId);

      const { data, error } = await query;
      if (error) throw error;
      return data as BulkJob[];
    },
    refetchInterval: 5000,
  });
}

// ==================== ACTIONS (Edge Functions) ====================

export function useTriggerScrape() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      campaign_id: string;
      keywords: string[];
      max_leads?: number;
      concurrent?: number;
    }) => invokeFunction("trigger-scrape", params),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bulk_jobs"] }),
  });
}

export function useTriggerEnrichment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      campaign_id: string;
      type: "find_emails" | "find_decision_makers" | "anymail_emails";
      max_leads?: number;
      include_existing?: boolean;
    }) => invokeFunction("trigger-enrichment", params),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bulk_jobs"] }),
  });
}

export function useTriggerClean() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      campaign_id: string;
      categories?: string[];
      max_leads?: number;
    }) => invokeFunction("trigger-clean", params),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["bulk_jobs"] }),
  });
}

export function useCasualiseNames() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      campaign_id: string;
      use_openai?: boolean;
    }) => invokeFunction<{ processed: number; total: number }>("casualise-names", params),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["leads", vars.campaign_id] });
      queryClient.invalidateQueries({ queryKey: ["data_quality", vars.campaign_id] });
    },
  });
}

export function useCleanSpam() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      campaign_id: string;
      use_openai?: boolean;
    }) => invokeFunction<{ processed: number; spam_found: number }>("clean-spam", params),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["leads", vars.campaign_id] });
      queryClient.invalidateQueries({ queryKey: ["data_quality", vars.campaign_id] });
    },
  });
}

export function useFixLocations() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { campaign_id: string }) =>
      invokeFunction<{ processed: number }>("fix-locations", params),
    onSuccess: (_, vars) =>
      queryClient.invalidateQueries({ queryKey: ["leads", vars.campaign_id] }),
  });
}

// ==================== API KEYS ====================

export function useApiKeys() {
  return useQuery({
    queryKey: ["api_keys"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("api_keys")
        .select("id, service, created_at")
        .order("service");
      if (error) throw error;
      return data;
    },
  });
}

export function useSaveApiKey() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { service: string; api_key: string }) => {
      const { data, error } = await supabase
        .from("api_keys")
        .upsert(params, { onConflict: "service" })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["api_keys"] }),
  });
}

// ==================== STATS ====================

export function useDashboardStats() {
  return useQuery({
    queryKey: ["dashboard_stats"],
    queryFn: async () => {
      const [campaigns, leads, activeJobs] = await Promise.all([
        supabase.from("campaigns").select("id", { count: "exact", head: true }),
        supabase.from("leads").select("id", { count: "exact", head: true }),
        supabase
          .from("bulk_jobs")
          .select("*")
          .in("status", ["pending", "running"])
          .order("created_at", { ascending: false }),
      ]);

      return {
        campaignCount: campaigns.count || 0,
        leadCount: leads.count || 0,
        activeJobs: activeJobs.data || [],
      };
    },
    refetchInterval: 10000,
  });
}

// ==================== AGENT CONFIG ====================

export function useAgentConfig() {
  return useQuery({
    queryKey: ["agent_config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("settings")
        .eq("id", 1)
        .single();
      if (error) throw error;
      return (data?.settings as { agent?: AgentConfig })?.agent ?? null;
    },
  });
}

export function useSaveAgentConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (agentConfig: Partial<AgentConfig>) => {
      // Read current settings first to merge
      const { data: current } = await supabase
        .from("app_settings")
        .select("settings")
        .eq("id", 1)
        .single();

      const existingSettings = (current?.settings as Record<string, unknown>) || {};
      const existingAgent = (existingSettings.agent as Record<string, unknown>) || {};

      const merged = {
        ...existingSettings,
        agent: { ...existingAgent, ...agentConfig },
      };

      const { data, error } = await supabase
        .from("app_settings")
        .upsert({ id: 1, settings: merged }, { onConflict: "id" })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agent_config"] }),
  });
}

// ==================== AI AGENT ====================

export function useSendAgentMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: {
      messages: AgentMessage[];
    }) => invokeFunction<AgentResponse>("ai-agent", params),
    onSuccess: () => {
      // Invalidate jobs/leads since tools may have created jobs or modified leads
      queryClient.invalidateQueries({ queryKey: ["bulk_jobs"] });
    },
  });
}
