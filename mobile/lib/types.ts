/**
 * Database types for the ninja schema.
 * Matches the migration definitions.
 */

export interface Campaign {
  id: string;
  name: string;
  service_line: string;
  summarize_prompt: string;
  icebreaker_prompt: string;
  status: "draft" | "active" | "completed" | "archived";
  created_at: string;
  updated_at: string;
  leads?: { count: number }[];
}

export interface Lead {
  id: string;
  campaign_id: string;
  // Production fields
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  company_name: string | null;
  company_website: string | null;
  email: string | null;
  personal_email: string | null;
  linkedin: string | null;
  title: string | null;
  industry: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  ice_breaker: string | null;
  ice_status: "pending" | "queued" | "done" | "error";
  enriched_at: string | null;
  raw: Record<string, unknown> | null;
  created_at: string;
  verification_status: string | null;
  verification_checked_at: string | null;
  // Directive extensions
  domain: string | null;
  place_id: string | null;
  rating: number | null;
  reviews: number | null;
  category: string | null;
  address: string | null;
  zip: string | null;
  phone: string | null;
  decision_maker_name: string | null;
  decision_maker_title: string | null;
  decision_maker_email: string | null;
  decision_maker_linkedin: string | null;
  decision_maker_source: string | null;
  company_name_casual: string | null;
  ice_breaker_cleaned: string | null;
  source: string | null;
  enrichment_status: Record<string, unknown>;
}

export interface BulkJob {
  id: string;
  campaign_id: string | null;
  type: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  config: Record<string, unknown>;
  progress: JobProgress;
  result: Record<string, unknown>;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface JobProgress {
  processed?: number;
  total?: number;
  [key: string]: unknown;
}

export interface EnrichmentJob {
  id: string;
  campaign_id: string;
  lead_id: string;
  status: "queued" | "processing" | "done" | "error";
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiKey {
  id: string;
  service: string;
  api_key: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AppSettings {
  id: number;
  google_drive_folder_id: string | null;
  default_locations_csv: string | null;
  worker_poll_interval_seconds: number;
  settings: Record<string, unknown>;
}

// ==================== AI AGENT ====================

export interface AgentMessage {
  role: "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: AgentToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface AgentToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface AgentToolLogEntry {
  name: string;
  args: Record<string, unknown>;
  result: string;
}

export interface AgentResponse {
  messages: AgentMessage[];
  tool_log: AgentToolLogEntry[];
}

// Supabase Database type for typed client
export interface Database {
  ninja: {
    Tables: {
      campaigns: {
        Row: Campaign;
        Insert: Omit<Campaign, "id" | "created_at" | "updated_at" | "leads">;
        Update: Partial<Omit<Campaign, "id" | "leads">>;
      };
      leads: {
        Row: Lead;
        Insert: Omit<Lead, "id" | "created_at">;
        Update: Partial<Omit<Lead, "id">>;
      };
      bulk_jobs: {
        Row: BulkJob;
        Insert: Omit<BulkJob, "id" | "created_at">;
        Update: Partial<Omit<BulkJob, "id">>;
      };
      enrichment_jobs: {
        Row: EnrichmentJob;
        Insert: Omit<EnrichmentJob, "id" | "created_at" | "updated_at">;
        Update: Partial<Omit<EnrichmentJob, "id">>;
      };
      api_keys: {
        Row: ApiKey;
        Insert: Omit<ApiKey, "id" | "created_at">;
        Update: Partial<Omit<ApiKey, "id">>;
      };
      app_settings: {
        Row: AppSettings;
        Insert: Partial<AppSettings>;
        Update: Partial<AppSettings>;
      };
    };
  };
}
