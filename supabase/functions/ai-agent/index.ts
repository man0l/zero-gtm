/**
 * Edge Function: ai-agent
 * AI assistant with OpenAI function calling that orchestrates the enrichment pipeline.
 * Tools map to existing Edge Functions / direct DB queries.
 *
 * All prompts, tool descriptions, and defaults are loaded from ninja.app_settings
 * and can be configured from the mobile Settings screen.
 *
 * Flow:
 *   1. Receive messages[] from frontend
 *   2. Fetch OpenAI key from ninja.api_keys
 *   3. Load agent config from ninja.app_settings (or use built-in defaults)
 *   4. Call OpenAI Chat Completions with tool definitions
 *   5. Execute tool_calls against DB / bulk_jobs
 *   6. Loop until OpenAI returns a plain message
 *   7. Return full conversation to frontend
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  getSupabaseClient,
  jsonResponse,
  errorResponse,
  handleCors,
} from "../_shared/supabase.ts";

// ─── Types ────────────────────────────────────────────────────────────

interface AgentDefaults {
  scrape_max_leads: number;
  scrape_qa_limit: number;
  scrape_qa_concurrent: number;
  scrape_full_concurrent: number;
  locations_file: string;
  clean_max_leads: number;
  clean_workers: number;
  find_emails_max_leads: number;
  find_dm_max_leads: number;
  casualise_batch_size: number;
  sample_leads_default: number;
  sample_leads_max: number;
  active_jobs_limit: number;
}

interface AgentConfig {
  model: string;
  max_iterations: number;
  system_prompt: string;
  tool_descriptions: Record<string, string>;
  defaults: AgentDefaults;
}

// ─── Default configuration (used when no overrides in DB) ─────────────

const DEFAULT_SYSTEM_PROMPT = `You are the Cold Email Ninja assistant — an AI that helps users run lead enrichment pipelines.

You have tools to:
- List campaigns and check their stats
- Run pipeline steps: scrape → clean → find emails → find decision makers → casualise names
- Check job progress

## CRITICAL: Confirmation Flow

You MUST follow these confirmation rules for every pipeline step. NEVER skip them.

### 1. Scrape Google Maps
- ALWAYS run with test_only=true FIRST. This scrapes only 20 leads as a quality check.
- After the QA job completes, call get_sample_leads to fetch the results.
- Present the sample leads AND the category breakdown to the user.
- The category breakdown shows Google Maps categories found (e.g. "Plumber: 12", "Plumbing supply store: 3", "Water heater installer: 5").
- Suggest the user can run the full scrape for ALL categories, or pick specific ones. Present each category with its count as a numbered list.
- Example: "Here are the categories found:\\n1. Plumber (12 leads)\\n2. Plumbing supply store (3 leads)\\n3. Water heater installer (5 leads)\\nWould you like to scrape all categories, or only specific ones? (e.g. '1 and 3' or 'all')"
- The user's category selection becomes the keywords for the full scrape. If they say "all", use the original keywords.
- Only after explicit confirmation, run with test_only=false for the full scrape.

### 2. Clean & Validate
- ALWAYS run with dry_run=true FIRST. This returns a summary without starting the job.
- Present the summary: total leads, leads with websites, categories breakdown if available.
- Ask: "I found X leads with websites ready to validate. Want me to start the cleaning job?"
- Only after confirmation, run with dry_run=false.

### 3. Find Emails (PAID API — costs credits)
- ALWAYS run with dry_run=true FIRST.
- Present the summary: total leads, leads WITHOUT emails that will be processed, estimated API cost (~1 credit per lead).
- Ask: "This will process X leads at ~X API credits. Want me to proceed?"
- Only after confirmation, run with dry_run=false.

### 4. Find Decision Makers (PAID API — costs money)
- ALWAYS run with dry_run=true FIRST.
- Present the summary: total leads, leads WITHOUT decision makers, estimated cost.
- Ask: "This will process X leads using OpenAI + DataForSEO. Want me to proceed?"
- Only after confirmation, run with dry_run=false.

### 5. Casualise Names
- No confirmation needed. Runs inline, free, completes immediately.

## General Rules
- Always confirm which campaign to operate on before running tools. Use list_campaigns if unsure.
- Pipeline steps should run in order: scrape → clean → find emails → find decision makers → casualise names
- Scrape, clean, find_emails, and find_decision_makers are ASYNC — they create background jobs. Tell the user to check the Jobs tab or ask you for status.
- When creating a scrape job, always ask for keywords if not provided.
- Be concise but helpful. Report job IDs and eligible lead counts after each step.`;

const DEFAULT_TOOL_DESCRIPTIONS: Record<string, string> = {
  list_campaigns:
    "List all campaigns with their lead counts. Use this to help the user pick a campaign.",
  get_campaign_stats:
    "Get enrichment coverage stats for a campaign: total leads, with email, with website, with decision maker, with casual name, validated count.",
  scrape_google_maps:
    "Scrape business leads from Google Maps for a campaign. Set test_only=true for a QA test (20 leads) before committing to a full scrape. After QA, the user may choose to scrape ALL original keywords or only specific categories discovered during QA. Pass the user-selected categories as keywords for the full scrape.",
  clean_and_validate:
    "Clean and validate leads — checks that websites are live, optionally filters by category. Set dry_run=true to get a preview summary without creating a job. Set dry_run=false to actually start the job after user confirms.",
  find_emails:
    "Find email addresses for leads by scraping their websites. PAID API (~1 credit per lead). Set dry_run=true to get a cost preview without creating a job. Set dry_run=false to start after user confirms.",
  find_decision_makers:
    "Find decision makers (owners, founders, CEOs) for leads via about/contact pages and LinkedIn. PAID API (OpenAI + DataForSEO). Set dry_run=true to get a cost preview without creating a job. Set dry_run=false to start after user confirms.",
  casualise_names:
    "Shorten company names to casual conversational form (removes Inc, LLC, etc.). Runs inline — completes immediately.",
  get_sample_leads:
    "Fetch a sample of recent leads for a campaign to review quality (e.g. after a QA test scrape). Returns up to 10 leads with key fields.",
  get_active_jobs:
    "Get the status of active and recent jobs for a campaign (or all campaigns if no campaign_id).",
};

const DEFAULT_DEFAULTS: AgentDefaults = {
  scrape_max_leads: 1000,
  scrape_qa_limit: 20,
  scrape_qa_concurrent: 5,
  scrape_full_concurrent: 20,
  locations_file: "data/us_locations.csv",
  clean_max_leads: 1000,
  clean_workers: 10,
  find_emails_max_leads: 100,
  find_dm_max_leads: 100,
  casualise_batch_size: 500,
  sample_leads_default: 10,
  sample_leads_max: 20,
  active_jobs_limit: 20,
};

const DEFAULT_CONFIG: AgentConfig = {
  model: "gpt-4o-mini",
  max_iterations: 10,
  system_prompt: DEFAULT_SYSTEM_PROMPT,
  tool_descriptions: DEFAULT_TOOL_DESCRIPTIONS,
  defaults: DEFAULT_DEFAULTS,
};

// ─── Load config from DB ──────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

async function loadAgentConfig(supabase: SupabaseClient): Promise<AgentConfig> {
  try {
    const { data, error } = await supabase
      .from("app_settings")
      .select("settings")
      .eq("id", 1)
      .single();

    if (error || !data?.settings?.agent) {
      return DEFAULT_CONFIG;
    }

    const stored = data.settings.agent as Partial<AgentConfig>;

    // Deep merge: stored overrides defaults
    return {
      model: stored.model ?? DEFAULT_CONFIG.model,
      max_iterations: stored.max_iterations ?? DEFAULT_CONFIG.max_iterations,
      system_prompt: stored.system_prompt ?? DEFAULT_CONFIG.system_prompt,
      tool_descriptions: {
        ...DEFAULT_CONFIG.tool_descriptions,
        ...(stored.tool_descriptions || {}),
      },
      defaults: {
        ...DEFAULT_CONFIG.defaults,
        ...(stored.defaults || {}),
      },
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

// ─── Build tool definitions dynamically ───────────────────────────────

function buildTools(config: AgentConfig) {
  const desc = config.tool_descriptions;
  const defs = config.defaults;

  return [
    {
      type: "function" as const,
      function: {
        name: "list_campaigns",
        description: desc.list_campaigns,
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "get_campaign_stats",
        description: desc.get_campaign_stats,
        parameters: {
          type: "object",
          properties: {
            campaign_id: { type: "string", description: "Campaign UUID" },
          },
          required: ["campaign_id"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "scrape_google_maps",
        description: desc.scrape_google_maps,
        parameters: {
          type: "object",
          properties: {
            campaign_id: { type: "string", description: "Campaign UUID" },
            keywords: {
              type: "array",
              items: { type: "string" },
              description:
                "Search keywords for QA test, OR user-selected categories from QA results for the full scrape.",
            },
            max_leads: {
              type: "number",
              description: `Target number of leads for full scrape (default ${defs.scrape_max_leads}). Ignored when test_only=true.`,
            },
            test_only: {
              type: "boolean",
              description: `If true, scrape only ${defs.scrape_qa_limit} leads as a QA quality check. ALWAYS call with test_only=true first.`,
            },
          },
          required: ["campaign_id", "keywords"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "clean_and_validate",
        description: desc.clean_and_validate,
        parameters: {
          type: "object",
          properties: {
            campaign_id: { type: "string", description: "Campaign UUID" },
            categories: {
              type: "array",
              items: { type: "string" },
              description: "Optional category filter (OR logic)",
            },
            max_leads: {
              type: "number",
              description: `Max leads to process (default ${defs.clean_max_leads})`,
            },
            dry_run: {
              type: "boolean",
              description:
                "If true, return a preview summary without creating a job. ALWAYS call with dry_run=true first.",
            },
          },
          required: ["campaign_id"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "find_emails",
        description: desc.find_emails,
        parameters: {
          type: "object",
          properties: {
            campaign_id: { type: "string", description: "Campaign UUID" },
            max_leads: {
              type: "number",
              description: `Max leads to process (default ${defs.find_emails_max_leads})`,
            },
            include_existing: {
              type: "boolean",
              description: "Re-process leads that already have emails (default false)",
            },
            dry_run: {
              type: "boolean",
              description:
                "If true, return a cost/eligibility preview without creating a job. ALWAYS call with dry_run=true first.",
            },
          },
          required: ["campaign_id"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "find_decision_makers",
        description: desc.find_decision_makers,
        parameters: {
          type: "object",
          properties: {
            campaign_id: { type: "string", description: "Campaign UUID" },
            max_leads: {
              type: "number",
              description: `Max leads to process (default ${defs.find_dm_max_leads})`,
            },
            include_existing: {
              type: "boolean",
              description:
                "Re-process leads with existing decision makers (default false)",
            },
            dry_run: {
              type: "boolean",
              description:
                "If true, return a cost/eligibility preview without creating a job. ALWAYS call with dry_run=true first.",
            },
          },
          required: ["campaign_id"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "casualise_names",
        description: desc.casualise_names,
        parameters: {
          type: "object",
          properties: {
            campaign_id: { type: "string", description: "Campaign UUID" },
          },
          required: ["campaign_id"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "get_sample_leads",
        description: desc.get_sample_leads,
        parameters: {
          type: "object",
          properties: {
            campaign_id: { type: "string", description: "Campaign UUID" },
            limit: {
              type: "number",
              description: `Number of sample leads (default ${defs.sample_leads_default}, max ${defs.sample_leads_max})`,
            },
          },
          required: ["campaign_id"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "get_active_jobs",
        description: desc.get_active_jobs,
        parameters: {
          type: "object",
          properties: {
            campaign_id: {
              type: "string",
              description: "Optional campaign UUID to filter by",
            },
          },
          required: [],
        },
      },
    },
  ];
}

// ─── Tool handlers ───────────────────────────────────────────────────

async function handleToolCall(
  toolName: string,
  // deno-lint-ignore no-explicit-any
  args: Record<string, any>,
  supabase: SupabaseClient,
  defaults: AgentDefaults,
): Promise<string> {
  switch (toolName) {
    case "list_campaigns":
      return await toolListCampaigns(supabase);
    case "get_campaign_stats":
      return await toolGetCampaignStats(supabase, args.campaign_id);
    case "scrape_google_maps":
      return await toolScrapeGoogleMaps(supabase, args, defaults);
    case "clean_and_validate":
      return await toolCleanAndValidate(supabase, args, defaults);
    case "find_emails":
      return await toolFindEmails(supabase, args, defaults);
    case "find_decision_makers":
      return await toolFindDecisionMakers(supabase, args, defaults);
    case "casualise_names":
      return await toolCasualiseNames(supabase, args.campaign_id, defaults);
    case "get_sample_leads":
      return await toolGetSampleLeads(supabase, args.campaign_id, args.limit, defaults);
    case "get_active_jobs":
      return await toolGetActiveJobs(supabase, args.campaign_id, defaults);
    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}

async function toolListCampaigns(supabase: SupabaseClient): Promise<string> {
  const { data: campaigns, error } = await supabase
    .from("campaigns")
    .select("id, name, service_line, status, created_at")
    .order("created_at", { ascending: false });
  if (error) return JSON.stringify({ error: error.message });

  // Get lead counts per campaign
  const results = [];
  for (const c of campaigns || []) {
    const { count } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", c.id);
    results.push({ ...c, lead_count: count || 0 });
  }
  return JSON.stringify(results);
}

async function toolGetCampaignStats(
  supabase: SupabaseClient,
  campaignId: string,
): Promise<string> {
  const base = () =>
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId);

  const [totalRes, emailRes, websiteRes, dmRes, casualRes, icebreakerRes] =
    await Promise.all([
      base(),
      base().not("email", "is", null),
      base().not("company_website", "is", null),
      base().not("decision_maker_name", "is", null),
      base().not("company_name_casual", "is", null),
      base().not("ice_breaker", "is", null),
    ]);

  const validatedRes = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .contains("enrichment_status", { website_validated: true });

  const total = totalRes.count || 0;
  return JSON.stringify({
    total_leads: total,
    with_email: emailRes.count || 0,
    with_website: websiteRes.count || 0,
    with_decision_maker: dmRes.count || 0,
    with_casual_name: casualRes.count || 0,
    with_icebreaker: icebreakerRes.count || 0,
    validated: validatedRes.count || 0,
  });
}

// deno-lint-ignore no-explicit-any
async function toolScrapeGoogleMaps(
  supabase: SupabaseClient,
  args: Record<string, any>,
  defaults: AgentDefaults,
): Promise<string> {
  const {
    campaign_id,
    keywords,
    max_leads = defaults.scrape_max_leads,
    test_only = true,
  } = args;

  // Verify campaign
  const { data: campaign, error: campErr } = await supabase
    .from("campaigns")
    .select("id, name")
    .eq("id", campaign_id)
    .single();
  if (campErr) return JSON.stringify({ error: "Campaign not found" });

  const scrapeLimit = test_only ? defaults.scrape_qa_limit : max_leads;

  const { data: job, error } = await supabase
    .from("bulk_jobs")
    .insert({
      campaign_id,
      type: "scrape_maps",
      config: {
        keywords,
        locations_file: defaults.locations_file,
        max_leads: scrapeLimit,
        concurrent: test_only
          ? defaults.scrape_qa_concurrent
          : defaults.scrape_full_concurrent,
        test_only,
      },
    })
    .select()
    .single();

  if (error) return JSON.stringify({ error: error.message });

  if (test_only) {
    return JSON.stringify({
      job_id: job.id,
      type: "scrape_maps",
      mode: "QA_TEST",
      keywords,
      max_leads: defaults.scrape_qa_limit,
      campaign_name: campaign.name,
      message: `QA test scrape started for campaign "${campaign.name}". Will scrape ~${defaults.scrape_qa_limit} leads to verify keyword quality. Once done, I'll show you sample results for review.`,
    });
  }

  return JSON.stringify({
    job_id: job.id,
    type: "scrape_maps",
    mode: "FULL_SCRAPE",
    keywords,
    max_leads,
    campaign_name: campaign.name,
    message: `Full scrape job created for campaign "${campaign.name}". Will scrape up to ${max_leads} leads for keywords: ${keywords.join(", ")}. Contabo worker will process it.`,
  });
}

// deno-lint-ignore no-explicit-any
async function toolCleanAndValidate(
  supabase: SupabaseClient,
  args: Record<string, any>,
  defaults: AgentDefaults,
): Promise<string> {
  const {
    campaign_id,
    categories = [],
    max_leads = defaults.clean_max_leads,
    dry_run = true,
  } = args;

  const { data: campaign, error: campErr } = await supabase
    .from("campaigns")
    .select("id, name")
    .eq("id", campaign_id)
    .single();
  if (campErr) return JSON.stringify({ error: "Campaign not found" });

  // Count leads with websites
  const { count: totalLeads } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign_id);

  const { count: withWebsite } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign_id)
    .not("company_website", "is", null);

  const { count: alreadyValidated } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign_id)
    .contains("enrichment_status", { website_validated: true });

  if (dry_run) {
    return JSON.stringify({
      mode: "PREVIEW",
      campaign_name: campaign.name,
      total_leads: totalLeads || 0,
      leads_with_website: withWebsite || 0,
      already_validated: alreadyValidated || 0,
      will_process: Math.min(withWebsite || 0, max_leads),
      categories: categories.length > 0 ? categories : "all (no filter)",
      message: `Preview: ${withWebsite || 0} leads have websites. ${alreadyValidated || 0} already validated. Will validate up to ${Math.min(withWebsite || 0, max_leads)} leads.`,
    });
  }

  const { data: job, error } = await supabase
    .from("bulk_jobs")
    .insert({
      campaign_id,
      type: "clean_leads",
      config: {
        categories,
        max_leads,
        workers: defaults.clean_workers,
        total_with_website: withWebsite || 0,
      },
    })
    .select()
    .single();

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({
    job_id: job.id,
    type: "clean_leads",
    leads_with_website: withWebsite || 0,
    message: `Clean job created for campaign "${campaign.name}". Worker will validate ${withWebsite || 0} websites.`,
  });
}

// deno-lint-ignore no-explicit-any
async function toolFindEmails(
  supabase: SupabaseClient,
  args: Record<string, any>,
  defaults: AgentDefaults,
): Promise<string> {
  const {
    campaign_id,
    max_leads = defaults.find_emails_max_leads,
    include_existing = false,
    dry_run = true,
  } = args;

  const { data: campaign, error: campErr } = await supabase
    .from("campaigns")
    .select("id, name")
    .eq("id", campaign_id)
    .single();
  if (campErr) return JSON.stringify({ error: "Campaign not found" });

  // Count total and eligible leads
  const { count: totalLeads } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign_id);

  const { count: withEmail } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign_id)
    .not("email", "is", null);

  const { count: withoutEmail } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign_id)
    .is("email", null);

  const eligible = include_existing
    ? Math.min(totalLeads || 0, max_leads)
    : Math.min(withoutEmail || 0, max_leads);

  if (dry_run) {
    return JSON.stringify({
      mode: "PREVIEW",
      campaign_name: campaign.name,
      total_leads: totalLeads || 0,
      already_have_email: withEmail || 0,
      without_email: withoutEmail || 0,
      will_process: eligible,
      include_existing,
      estimated_api_credits: eligible,
      max_leads_limit: max_leads,
      message: `Preview: ${totalLeads || 0} total leads. ${withEmail || 0} already have emails, ${withoutEmail || 0} need emails. Will process ${eligible} leads at ~${eligible} API credits.`,
    });
  }

  const { data: job, error } = await supabase
    .from("bulk_jobs")
    .insert({
      campaign_id,
      type: "find_emails",
      config: { max_leads, include_existing, estimated_leads: eligible },
    })
    .select()
    .single();

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({
    job_id: job.id,
    type: "find_emails",
    eligible_leads: eligible,
    message: `Find-emails job created for ${eligible} leads in campaign "${campaign.name}".`,
  });
}

// deno-lint-ignore no-explicit-any
async function toolFindDecisionMakers(
  supabase: SupabaseClient,
  args: Record<string, any>,
  defaults: AgentDefaults,
): Promise<string> {
  const {
    campaign_id,
    max_leads = defaults.find_dm_max_leads,
    include_existing = false,
    dry_run = true,
  } = args;

  const { data: campaign, error: campErr } = await supabase
    .from("campaigns")
    .select("id, name")
    .eq("id", campaign_id)
    .single();
  if (campErr) return JSON.stringify({ error: "Campaign not found" });

  // Count total and eligible leads
  const { count: totalLeads } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign_id);

  const { count: withDM } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign_id)
    .not("decision_maker_name", "is", null);

  const { count: withoutDM } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign_id)
    .is("decision_maker_name", null);

  const eligible = include_existing
    ? Math.min(totalLeads || 0, max_leads)
    : Math.min(withoutDM || 0, max_leads);

  if (dry_run) {
    return JSON.stringify({
      mode: "PREVIEW",
      campaign_name: campaign.name,
      total_leads: totalLeads || 0,
      already_have_dm: withDM || 0,
      without_dm: withoutDM || 0,
      will_process: eligible,
      include_existing,
      estimated_cost: `~${eligible} OpenAI calls + DataForSEO lookups`,
      max_leads_limit: max_leads,
      message: `Preview: ${totalLeads || 0} total leads. ${withDM || 0} already have decision makers, ${withoutDM || 0} need enrichment. Will process ${eligible} leads using OpenAI + DataForSEO.`,
    });
  }

  const { data: job, error } = await supabase
    .from("bulk_jobs")
    .insert({
      campaign_id,
      type: "find_decision_makers",
      config: { max_leads, include_existing, estimated_leads: eligible },
    })
    .select()
    .single();

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({
    job_id: job.id,
    type: "find_decision_makers",
    eligible_leads: eligible,
    message: `Find-decision-makers job created for ${eligible} leads in campaign "${campaign.name}".`,
  });
}

async function toolCasualiseNames(
  supabase: SupabaseClient,
  campaignId: string,
  defaults: AgentDefaults,
): Promise<string> {
  // Heuristic suffix/descriptor removal (same as casualise-names Edge Function)
  const LEGAL_SUFFIXES = [
    "inc", "incorporated", "llc", "l.l.c", "ltd", "limited", "corp",
    "corporation", "co", "company", "pllc", "plc", "lp", "llp",
    "p.c", "p.a", "gmbh", "ag", "sa", "srl", "bv", "nv",
  ];
  const DESCRIPTORS = [
    "agency", "professional services", "services", "solutions", "technologies",
    "technology", "consulting", "consultants", "group", "partners",
    "associates", "enterprises", "international", "global", "digital",
    "marketing", "management", "advisors", "advisory", "studio",
    "labs", "lab", "systems", "network", "networks",
  ];

  function casualise(name: string): string {
    if (!name) return name;
    let r = name.trim();
    for (const s of LEGAL_SUFFIXES) {
      r = r.replace(
        new RegExp(`[,\\s]+${s.replace(/\./g, "\\.")}[\\.\\s]*$`, "i"),
        "",
      ).trim();
    }
    for (const d of DESCRIPTORS) {
      r = r.replace(new RegExp(`\\s+${d}\\s*$`, "i"), "").trim();
    }
    return r.length < 2 ? name.trim() : r;
  }

  const { data: leads, error } = await supabase
    .from("leads")
    .select("id, company_name")
    .eq("campaign_id", campaignId)
    .not("company_name", "is", null)
    .is("company_name_casual", null)
    .limit(defaults.casualise_batch_size);

  if (error) return JSON.stringify({ error: error.message });
  if (!leads?.length)
    return JSON.stringify({
      processed: 0,
      message: "No leads need casualisation",
    });

  let processed = 0;
  for (const lead of leads) {
    const casual = casualise(lead.company_name);
    await supabase
      .from("leads")
      .update({ company_name_casual: casual })
      .eq("id", lead.id);
    processed++;
  }

  return JSON.stringify({
    processed,
    total: leads.length,
    message: `Casualised ${processed} company names.`,
  });
}

async function toolGetSampleLeads(
  supabase: SupabaseClient,
  campaignId: string,
  limit: number | undefined,
  defaults: AgentDefaults,
): Promise<string> {
  const sampleSize = Math.min(
    limit || defaults.sample_leads_default,
    defaults.sample_leads_max,
  );

  // Fetch sample leads for display
  const { data: leads, error } = await supabase
    .from("leads")
    .select(
      "company_name, company_website, title, city, state, phone, email, rating, reviews",
    )
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false })
    .limit(sampleSize);

  if (error) return JSON.stringify({ error: error.message });
  if (!leads?.length)
    return JSON.stringify({
      leads: [],
      message: "No leads found for this campaign.",
    });

  // Get full category breakdown from ALL leads in the campaign (not just the sample)
  const { data: allLeads, error: catErr } = await supabase
    .from("leads")
    .select("title")
    .eq("campaign_id", campaignId)
    .not("title", "is", null);

  const categoryBreakdown: Record<string, number> = {};
  if (!catErr && allLeads) {
    for (const l of allLeads) {
      const cat = l.title || "Unknown";
      categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + 1;
    }
  }

  // Sort categories by count descending
  const sortedCategories = Object.entries(categoryBreakdown)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  // Total lead count
  const { count: totalCount } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId);

  return JSON.stringify({
    total_leads_in_campaign: totalCount || 0,
    sample_count: leads.length,
    leads: leads.map((l: Record<string, unknown>) => ({
      company: l.company_name,
      website: l.company_website,
      category: l.title,
      location: [l.city, l.state].filter(Boolean).join(", "),
      phone: l.phone,
      email: l.email,
      rating: l.rating,
      reviews: l.reviews,
    })),
    categories: sortedCategories,
    category_count: sortedCategories.length,
    message: `Showing ${leads.length} sample leads out of ${totalCount || 0} total. Found ${sortedCategories.length} distinct categories.`,
  });
}

async function toolGetActiveJobs(
  supabase: SupabaseClient,
  campaignId: string | undefined,
  defaults: AgentDefaults,
): Promise<string> {
  let query = supabase
    .from("bulk_jobs")
    .select("id, campaign_id, type, status, progress, created_at, error")
    .order("created_at", { ascending: false })
    .limit(defaults.active_jobs_limit);

  if (campaignId) query = query.eq("campaign_id", campaignId);

  const { data, error } = await query;
  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify(data || []);
}

// ─── OpenAI Chat Completions caller ──────────────────────────────────

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  // deno-lint-ignore no-explicit-any
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
}

async function callOpenAI(
  apiKey: string,
  messages: ChatMessage[],
  config: AgentConfig,
): Promise<{ message: ChatMessage; usage?: { total_tokens: number } }> {
  const tools = buildTools(config);

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      tools,
      tool_choice: "auto",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${body}`);
  }

  const data = await res.json();
  return {
    message: data.choices[0].message,
    usage: data.usage,
  };
}

// ─── Main handler ────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  const supabase = getSupabaseClient(req);

  try {
    const { messages: incomingMessages } = await req.json();

    if (!Array.isArray(incomingMessages) || incomingMessages.length === 0) {
      return errorResponse("messages array required");
    }

    // Load agent config from app_settings (or use defaults)
    const config = await loadAgentConfig(supabase);

    // Fetch OpenAI API key
    const { data: keyRow } = await supabase
      .from("api_keys")
      .select("api_key")
      .eq("service", "openai")
      .single();

    if (!keyRow?.api_key) {
      return errorResponse(
        "OpenAI API key not configured. Add it in Settings.",
        422,
      );
    }

    // Build conversation with system prompt
    const conversation: ChatMessage[] = [
      { role: "system", content: config.system_prompt },
      ...incomingMessages,
    ];

    // Agentic loop: call OpenAI, execute tools, repeat
    const toolLog: {
      name: string;
      args: Record<string, unknown>;
      result: string;
    }[] = [];
    let iterations = 0;

    while (iterations < config.max_iterations) {
      iterations++;

      const { message: assistantMsg } = await callOpenAI(
        keyRow.api_key,
        conversation,
        config,
      );

      // Add assistant message to conversation
      conversation.push(assistantMsg);

      // If no tool calls, we're done
      if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
        break;
      }

      // Execute each tool call
      for (const toolCall of assistantMsg.tool_calls) {
        const fnName = toolCall.function.name;
        let fnArgs: Record<string, unknown> = {};
        try {
          fnArgs = JSON.parse(toolCall.function.arguments || "{}");
        } catch {
          fnArgs = {};
        }

        const result = await handleToolCall(
          fnName,
          fnArgs,
          supabase,
          config.defaults,
        );

        toolLog.push({ name: fnName, args: fnArgs, result });

        // Add tool result to conversation
        conversation.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        });
      }
    }

    // Strip system prompt from response
    const responseMessages = conversation.filter((m) => m.role !== "system");

    return jsonResponse({
      messages: responseMessages,
      tool_log: toolLog,
    });
  } catch (err) {
    console.error("ai-agent error:", err);
    return errorResponse(String(err), 500);
  }
});
