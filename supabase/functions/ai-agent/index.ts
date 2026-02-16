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
  getUserId,
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

const DEFAULT_SYSTEM_PROMPT = `You are the Cold Email Ninja assistant — an AI that helps users run lead enrichment pipelines from their phone.

You have tools to:
- Create new campaigns and list existing ones with their stats
- Run pipeline steps: scrape → clean → find emails → find decision makers → casualise names
- Check job progress

## Response Style (Mobile-First — ALWAYS follow these)

1. **NEVER show UUIDs** — No campaign IDs, job IDs, or any internal identifiers in your messages. You track them internally for tool calls; the user never sees them.
2. **NEVER show raw timestamps** — Convert to relative time ("2 hours ago") or friendly format ("today at 7:06 PM"). Never ISO 8601.
3. **Be ultra-concise** — This is a mobile chat app. Keep responses to 2-5 lines for actions. No multi-section reports, no headers, no bullet-point essays.
4. **No internal jargon** — Never mention parameter names (test_only, dry_run, config), tool names, modes, or technical details. Use plain language: "quick test scrape" not "scrape_google_maps with test_only=true".
5. **Don't call tools that will obviously return empty** — After creating a job, do NOT immediately call get_sample_leads or get_active_jobs. The job was just created — you already know its status. Just confirm it's running and stop.
6. **Omit empty fields** — When showing leads, skip any field that is null/empty. Never write "email: none" or "website: N/A".
7. **Minimal lead display** — Show leads as: **Name** — City, ST — ★ rating. Skip URLs, phone numbers, and verbose details unless the user specifically asks.
8. **One action, one response** — After completing an action, give a short confirmation and stop. Don't pad with "What would you like me to do now?" or list options unprompted.
9. **Campaigns list** — Show as: name (X leads). Skip service_line if it matches the name. Skip status unless it's not "active".

## Confirmation Flow

You MUST follow these confirmation rules for every pipeline step. NEVER skip them.

### 1. Scrape Google Maps
- If the user asks to SEE or SHOW existing leads/categories, use get_sample_leads directly — do NOT start a new scrape.
- When STARTING a scrape, IMMEDIATELY call scrape_google_maps with test_only=true. Do NOT ask for confirmation before the test — the test IS the safe first step (only ~20 leads). Just run it.
- After the test job completes, call get_sample_leads to show results.
- Present the category breakdown as a numbered list with counts.
- The user picks categories (or "all") for the full scrape. Their selection becomes the keywords.
- Only after explicit confirmation, run the full scrape.

### 2. Clean & Validate
- ALWAYS run with dry_run=true FIRST to get a preview.
- Tell the user how many leads have websites and are ready to validate.
- Only after confirmation, run the actual job.

### 3. Find Emails (PAID — costs credits)
- ALWAYS run with dry_run=true FIRST.
- Tell the user: X leads will be processed at ~X credits.
- Only after confirmation, run the actual job.

### 4. Find Decision Makers (PAID — costs money)
- ALWAYS run with dry_run=true FIRST.
- Tell the user: X leads, uses OpenAI + DataForSEO.
- Only after confirmation, run the actual job.

### 5. Casualise Names
- No confirmation needed. Runs instantly.

## General Rules
- To work with a NEW campaign, create it first via create_campaign.
- Confirm which campaign to operate on before running tools. Use list_campaigns if unsure.
- "show", "see", "review" = read-only tools only (get_sample_leads, get_campaign_stats, get_active_jobs). Do NOT start pipeline jobs.
- Pipeline order: scrape → clean → find emails → find decision makers → casualise names
- Clean & Validate is a PREREQUISITE for Find Emails and Find Decision Makers.
- Scrape, clean, find_emails, find_decision_makers are ASYNC background jobs.
- When creating a scrape, ask for keywords if not provided.`;

const DEFAULT_TOOL_DESCRIPTIONS: Record<string, string> = {
  create_campaign:
    "Create a new campaign. Use this when the user wants to start fresh with a new campaign for scraping. Requires a name; service_line is optional.",
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

async function loadAgentConfig(supabase: SupabaseClient, customerId: string): Promise<AgentConfig> {
  try {
    const { data, error } = await supabase
      .from("app_settings")
      .select("settings")
      .eq("customer_id", customerId)
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
        name: "create_campaign",
        description: desc.create_campaign,
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Name of the campaign (e.g. 'Beauty Salons US')",
            },
            service_line: {
              type: "string",
              description:
                "The service/industry line (e.g. 'Beauty Salons'). Defaults to the campaign name.",
            },
          },
          required: ["name"],
        },
      },
    },
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
              description:
                "Optional cap. If omitted or 0, ALL leads with websites are processed. Set a number only to limit (e.g. for a small test).",
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
  customerId: string,
): Promise<string> {
  switch (toolName) {
    case "create_campaign":
      return await toolCreateCampaign(supabase, args, customerId);
    case "list_campaigns":
      return await toolListCampaigns(supabase, customerId);
    case "get_campaign_stats":
      return await toolGetCampaignStats(supabase, args.campaign_id, customerId);
    case "scrape_google_maps":
      return await toolScrapeGoogleMaps(supabase, args, defaults, customerId);
    case "clean_and_validate":
      return await toolCleanAndValidate(supabase, args, defaults, customerId);
    case "find_emails":
      return await toolFindEmails(supabase, args, defaults, customerId);
    case "find_decision_makers":
      return await toolFindDecisionMakers(supabase, args, defaults, customerId);
    case "casualise_names":
      return await toolCasualiseNames(supabase, args.campaign_id, defaults, customerId);
    case "get_sample_leads":
      return await toolGetSampleLeads(supabase, args.campaign_id, args.limit, defaults, customerId);
    case "get_active_jobs":
      return await toolGetActiveJobs(supabase, args.campaign_id, defaults, customerId);
    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}

// deno-lint-ignore no-explicit-any
async function toolCreateCampaign(
  supabase: SupabaseClient,
  args: Record<string, any>,
  customerId: string,
): Promise<string> {
  const { name, service_line } = args;

  if (!name) return JSON.stringify({ error: "Campaign name is required" });

  const svcLine = service_line || name;

  const { data: campaign, error } = await supabase
    .from("campaigns")
    .insert({
      name,
      service_line: svcLine,
      summarize_prompt:
        "Summarize the company and what they do in 1-2 sentences.",
      icebreaker_prompt:
        "Write a casual, friendly icebreaker line mentioning something specific about the company.",
      status: "active",
      customer_id: customerId,
    })
    .select()
    .single();

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({
    campaign_id: campaign.id,
    name: campaign.name,
    service_line: campaign.service_line,
    status: campaign.status,
    message: `Campaign "${campaign.name}" created successfully with ID ${campaign.id}.`,
  });
}

async function toolListCampaigns(supabase: SupabaseClient, customerId: string): Promise<string> {
  // Use join-based count instead of N+1 queries for scalability
  // Explicit FK hint avoids PostgREST ambiguity when multiple relations exist
  const { data: campaigns, error } = await supabase
    .from("campaigns")
    .select("id, name, service_line, status, created_at, leads:leads!campaign_id(count)")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });
  if (error) return JSON.stringify({ error: error.message });

  // Flatten the count from the join
  // deno-lint-ignore no-explicit-any
  const results = (campaigns || []).map((c: any) => ({
    id: c.id,
    name: c.name,
    service_line: c.service_line,
    status: c.status,
    created_at: c.created_at,
    lead_count: c.leads?.[0]?.count ?? 0,
  }));
  return JSON.stringify(results);
}

async function toolGetCampaignStats(
  supabase: SupabaseClient,
  campaignId: string,
  customerId: string,
): Promise<string> {
  const base = () =>
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("customer_id", customerId);

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
    .eq("customer_id", customerId)
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
  customerId: string,
): Promise<string> {
  const {
    campaign_id,
    keywords,
    max_leads = defaults.scrape_max_leads,
    test_only = true,
  } = args;

  // Verify campaign belongs to this customer
  const { data: campaign, error: campErr } = await supabase
    .from("campaigns")
    .select("id, name")
    .eq("id", campaign_id)
    .eq("customer_id", customerId)
    .single();
  if (campErr) return JSON.stringify({ error: "Campaign not found" });

  const scrapeLimit = test_only ? defaults.scrape_qa_limit : max_leads;

  // When starting a full scrape, delete the QA sample leads first.
  // QA leads are unenriched (no email, no DM, no validated website) — safe to remove.
  if (!test_only) {
    // Delete leads that have no enrichment at all (raw QA scrape data)
    const { count: deleted, error: delErr } = await supabase
      .from("leads")
      .delete({ count: "exact" })
      .eq("campaign_id", campaign_id)
      .eq("customer_id", customerId)
      .is("email", null)
      .is("decision_maker_name", null)
      .not("enrichment_status", "cs", '{"website_validated":true}');

    if (delErr) {
      console.error("Error deleting QA leads:", delErr.message);
    } else {
      console.log(`Deleted ${deleted} QA sample leads before full scrape`);
    }
  }

  const { data: job, error } = await supabase
    .from("bulk_jobs")
    .insert({
      campaign_id,
      customer_id: customerId,
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
  customerId: string,
): Promise<string> {
  const {
    campaign_id,
    categories = [],
    max_leads: maxLeadsArg,
    dry_run = true,
  } = args;

  const { data: campaign, error: campErr } = await supabase
    .from("campaigns")
    .select("id, name")
    .eq("id", campaign_id)
    .eq("customer_id", customerId)
    .single();
  if (campErr) return JSON.stringify({ error: "Campaign not found" });

  // Count leads with websites
  const { count: totalLeads } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign_id)
    .eq("customer_id", customerId);

  const { count: withWebsite } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign_id)
    .eq("customer_id", customerId)
    .not("company_website", "is", null);

  const { count: alreadyValidated } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign_id)
    .eq("customer_id", customerId)
    .contains("enrichment_status", { website_validated: true });

  const withWebsiteCount = withWebsite || 0;
  const maxLeads = maxLeadsArg != null && maxLeadsArg > 0 ? maxLeadsArg : withWebsiteCount;
  const willProcess = Math.min(withWebsiteCount, maxLeads);

  if (dry_run) {
    return JSON.stringify({
      mode: "PREVIEW",
      campaign_name: campaign.name,
      total_leads: totalLeads || 0,
      leads_with_website: withWebsiteCount,
      already_validated: alreadyValidated || 0,
      will_process: willProcess,
      categories: categories.length > 0 ? categories : "all (no filter)",
      message: `Preview: ${withWebsiteCount} leads have websites. ${alreadyValidated || 0} already validated. Will validate ${willProcess} leads.`,
    });
  }

  const { data: job, error } = await supabase
    .from("bulk_jobs")
    .insert({
      campaign_id,
      customer_id: customerId,
      type: "clean_leads",
      config: {
        categories,
        max_leads: maxLeads,
        workers: defaults.clean_workers,
        total_with_website: withWebsiteCount,
      },
    })
    .select()
    .single();

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({
    job_id: job.id,
    type: "clean_leads",
    leads_with_website: withWebsiteCount,
    message: `Clean job created for campaign "${campaign.name}". Worker will validate ${willProcess} websites.`,
  });
}

// deno-lint-ignore no-explicit-any
async function toolFindEmails(
  supabase: SupabaseClient,
  args: Record<string, any>,
  defaults: AgentDefaults,
  customerId: string,
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
    .eq("customer_id", customerId)
    .single();
  if (campErr) return JSON.stringify({ error: "Campaign not found" });

  // Count total leads and validated (cleaned) leads
  const { count: totalLeads } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign_id)
    .eq("customer_id", customerId);

  // Only consider validated leads — must pass clean step first
  const { count: validatedLeads } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign_id)
    .eq("customer_id", customerId)
    .contains("enrichment_status", { website_validated: true });

  const { count: validatedWithEmail } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign_id)
    .eq("customer_id", customerId)
    .contains("enrichment_status", { website_validated: true })
    .not("email", "is", null);

  const { count: validatedWithoutEmail } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign_id)
    .eq("customer_id", customerId)
    .contains("enrichment_status", { website_validated: true })
    .is("email", null);

  const eligible = include_existing
    ? Math.min(validatedLeads || 0, max_leads)
    : Math.min(validatedWithoutEmail || 0, max_leads);

  if ((validatedLeads || 0) === 0) {
    return JSON.stringify({
      mode: "PREVIEW",
      campaign_name: campaign.name,
      total_leads: totalLeads || 0,
      validated_leads: 0,
      will_process: 0,
      message: `No validated leads found. Run "Clean & Validate" first to validate websites before finding emails.`,
    });
  }

  if (dry_run) {
    return JSON.stringify({
      mode: "PREVIEW",
      campaign_name: campaign.name,
      total_leads: totalLeads || 0,
      validated_leads: validatedLeads || 0,
      already_have_email: validatedWithEmail || 0,
      without_email: validatedWithoutEmail || 0,
      will_process: eligible,
      include_existing,
      estimated_api_credits: eligible,
      max_leads_limit: max_leads,
      message: `Preview: ${validatedLeads || 0} validated leads (out of ${totalLeads || 0} total). ${validatedWithEmail || 0} already have emails, ${validatedWithoutEmail || 0} need emails. Will process ${eligible} leads at ~${eligible} API credits.`,
    });
  }

  const { data: job, error } = await supabase
    .from("bulk_jobs")
    .insert({
      campaign_id,
      customer_id: customerId,
      type: "find_emails",
      config: { max_leads, include_existing, estimated_leads: eligible, validated_only: true },
    })
    .select()
    .single();

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({
    job_id: job.id,
    type: "find_emails",
    eligible_leads: eligible,
    message: `Find-emails job created for ${eligible} validated leads in campaign "${campaign.name}".`,
  });
}

// deno-lint-ignore no-explicit-any
async function toolFindDecisionMakers(
  supabase: SupabaseClient,
  args: Record<string, any>,
  defaults: AgentDefaults,
  customerId: string,
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
    .eq("customer_id", customerId)
    .single();
  if (campErr) return JSON.stringify({ error: "Campaign not found" });

  // Count total leads and validated (cleaned) leads
  const { count: totalLeads } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign_id)
    .eq("customer_id", customerId);

  // Only consider validated leads — must pass clean step first
  const { count: validatedLeads } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign_id)
    .eq("customer_id", customerId)
    .contains("enrichment_status", { website_validated: true });

  const { count: validatedWithDM } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign_id)
    .eq("customer_id", customerId)
    .contains("enrichment_status", { website_validated: true })
    .not("decision_maker_name", "is", null);

  const { count: validatedWithoutDM } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaign_id)
    .eq("customer_id", customerId)
    .contains("enrichment_status", { website_validated: true })
    .is("decision_maker_name", null);

  const eligible = include_existing
    ? Math.min(validatedLeads || 0, max_leads)
    : Math.min(validatedWithoutDM || 0, max_leads);

  if ((validatedLeads || 0) === 0) {
    return JSON.stringify({
      mode: "PREVIEW",
      campaign_name: campaign.name,
      total_leads: totalLeads || 0,
      validated_leads: 0,
      will_process: 0,
      message: `No validated leads found. Run "Clean & Validate" first to validate websites before finding decision makers.`,
    });
  }

  if (dry_run) {
    return JSON.stringify({
      mode: "PREVIEW",
      campaign_name: campaign.name,
      total_leads: totalLeads || 0,
      validated_leads: validatedLeads || 0,
      already_have_dm: validatedWithDM || 0,
      without_dm: validatedWithoutDM || 0,
      will_process: eligible,
      include_existing,
      estimated_cost: `~${eligible} OpenAI calls + DataForSEO lookups`,
      max_leads_limit: max_leads,
      message: `Preview: ${validatedLeads || 0} validated leads (out of ${totalLeads || 0} total). ${validatedWithDM || 0} already have DMs, ${validatedWithoutDM || 0} need enrichment. Will process ${eligible} leads using OpenAI + DataForSEO.`,
    });
  }

  const { data: job, error } = await supabase
    .from("bulk_jobs")
    .insert({
      campaign_id,
      customer_id: customerId,
      type: "find_decision_makers",
      config: { max_leads, include_existing, estimated_leads: eligible, validated_only: true },
    })
    .select()
    .single();

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({
    job_id: job.id,
    type: "find_decision_makers",
    eligible_leads: eligible,
    message: `Find-decision-makers job created for ${eligible} validated leads in campaign "${campaign.name}".`,
  });
}

async function toolCasualiseNames(
  supabase: SupabaseClient,
  campaignId: string,
  defaults: AgentDefaults,
  customerId: string,
): Promise<string> {
  // Same prompt as execution/casualise_company_name.py → openai_casualise_name()
  const CASUALISE_SYSTEM =
    "You shorten company names for casual outreach. " +
    "Return JSON with key 'names' containing an array of shortened names in the same order as the input.";
  const CASUALISE_USER_PREFIX =
    "Rules:\n" +
    "- Shorten the company name to its core brand identity — what people actually call the business.\n" +
    "- Remove legal suffixes (Inc, LLC, Ltd, Corp, Company, Co, LP, PLLC, GmbH).\n" +
    "- Remove descriptors and service words (Agency, Services, Group, Partners, Consulting, " +
    "Solutions, Technologies, Media, Studio, Productions, Digital, Builders, Construction, " +
    "Custom, Managed, Provider, Support, Repair, Professional).\n" +
    "- For long names with dashes, taglines, or service descriptions (e.g. 'Acme Corp - Full Service IT Support'), " +
    "keep ONLY the brand part before the dash/description.\n" +
    "- Strip location qualifiers when the brand stands alone (e.g. 'Avantel Plumber of Chicago IL' -> 'Avantel').\n" +
    "- Preserve the core brand (e.g., 'Love AMS' stays 'Love AMS').\n" +
    "- If shortening makes it too short (<2 chars) or removes the brand, keep original.\n" +
    "\nExamples:\n" +
    "AARON FLINT BUILDERS -> Aaron Flint\n" +
    "Westview Construction -> Westview\n" +
    "Redemption Custom Builders LLC -> Redemption\n" +
    "XYZ Agency -> XYZ\n" +
    "Love AMS Professional Services -> Love AMS\n" +
    "Love Mayo Inc. -> Love Mayo\n" +
    "AJ Technology Company - Managed IT support & Services Phoenix -> AJ Technology\n" +
    "Best IT Guru Managed IT Services Provider -> Best IT Guru\n" +
    "Avantel Plumber of Chicago IL -> Avantel\n" +
    "24/7 Quick Fix Plumbers NYC -> Quick Fix Plumbers\n" +
    "Andres Plumbing and Repair -> Andres Plumbing\n" +
    "\nCompany names (return shortened versions in same order as JSON array):\n";

  const OPENAI_BATCH = 25;
  const DB_CONCURRENCY = 25;

  // Get OpenAI key for this customer
  const { data: keyRow } = await supabase
    .from("api_keys")
    .select("api_key")
    .eq("service", "openai")
    .eq("customer_id", customerId)
    .single();

  if (!keyRow?.api_key) {
    return JSON.stringify({ error: "OpenAI API key not configured" });
  }

  const { data: leads, error } = await supabase
    .from("leads")
    .select("id, company_name")
    .eq("campaign_id", campaignId)
    .eq("customer_id", customerId)
    .not("company_name", "is", null)
    .is("company_name_casual", null)
    .limit(defaults.casualise_batch_size);

  if (error) return JSON.stringify({ error: error.message });
  if (!leads?.length)
    return JSON.stringify({
      processed: 0,
      message: "No leads need casualisation",
    });

  // Fire all OpenAI batch requests concurrently
  const allUpdates: { id: string; casual: string }[] = [];
  const batchPromises: Promise<void>[] = [];

  for (let i = 0; i < leads.length; i += OPENAI_BATCH) {
    const chunk = leads.slice(i, i + OPENAI_BATCH);
    const names = chunk.map((l: { company_name: string }) => l.company_name);

    const promise = (async () => {
      try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${keyRow.api_key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4.1-nano",
            messages: [
              { role: "system", content: CASUALISE_SYSTEM },
              { role: "user", content: CASUALISE_USER_PREFIX + JSON.stringify(names) },
            ],
            response_format: { type: "json_object" },
            temperature: 0.2,
          }),
        });

        const result = await response.json();
        const content = JSON.parse(result.choices[0].message.content);
        const casualNames: string[] = content.names || content.result || Object.values(content);

        for (let j = 0; j < chunk.length && j < casualNames.length; j++) {
          const casual = (casualNames[j] || "").trim();
          allUpdates.push({
            id: chunk[j].id,
            casual: casual.length >= 2 ? casual : chunk[j].company_name,
          });
        }
      } catch (err) {
        console.error(`OpenAI casualise batch error: ${err}`);
        for (const lead of chunk) {
          allUpdates.push({ id: lead.id, casual: lead.company_name });
        }
      }
    })();
    batchPromises.push(promise);
  }

  await Promise.all(batchPromises);

  // Write DB updates 25-concurrent
  let processed = 0;
  for (let i = 0; i < allUpdates.length; i += DB_CONCURRENCY) {
    const batch = allUpdates.slice(i, i + DB_CONCURRENCY);
    await Promise.all(
      batch.map((item) =>
        supabase
          .from("leads")
          .update({ company_name_casual: item.casual })
          .eq("id", item.id)
      )
    );
    processed += batch.length;
  }

  return JSON.stringify({
    processed,
    total: leads.length,
    message: `Casualised ${processed} company names using OpenAI.`,
  });
}

async function toolGetSampleLeads(
  supabase: SupabaseClient,
  campaignId: string,
  limit: number | undefined,
  defaults: AgentDefaults,
  customerId: string,
): Promise<string> {
  const sampleSize = Math.min(
    limit || defaults.sample_leads_default,
    defaults.sample_leads_max,
  );

  // Fetch sample leads for display (scoped to customer)
  const { data: leads, error } = await supabase
    .from("leads")
    .select(
      "company_name, company_website, category, city, state, phone, email, rating, reviews",
    )
    .eq("campaign_id", campaignId)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(sampleSize);

  if (error) return JSON.stringify({ error: error.message });
  if (!leads?.length)
    return JSON.stringify({
      leads: [],
      message: "No leads found for this campaign.",
    });

  // Get category breakdown from all leads (category column, comma-separated).
  // Fetches only the category column to minimise data transfer even at 100k+ leads.
  // TODO: Switch to RPC get_lead_category_counts once schema resolution is verified.
  const { data: allCats, error: catErr } = await supabase
    .from("leads")
    .select("category")
    .eq("campaign_id", campaignId)
    .eq("customer_id", customerId)
    .not("category", "is", null);

  const categoryBreakdown: Record<string, number> = {};
  if (!catErr && allCats) {
    for (const row of allCats) {
      // Split comma-separated categories and count each individually
      const cats = (row.category as string).split(",").map((c: string) => c.trim()).filter(Boolean);
      for (const cat of cats) {
        categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + 1;
      }
    }
  }

  const sortedCategories = Object.entries(categoryBreakdown)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name, count }));

  // Total lead count
  const { count: totalCount } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("customer_id", customerId);

  return JSON.stringify({
    total_leads_in_campaign: totalCount || 0,
    sample_count: leads.length,
    leads: leads.map((l: Record<string, unknown>) => ({
      company: l.company_name,
      website: l.company_website,
      category: l.category,
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
  customerId: string,
): Promise<string> {
  let query = supabase
    .from("bulk_jobs")
    .select("id, campaign_id, type, status, progress, created_at, error")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(defaults.active_jobs_limit);

  if (campaignId) query = query.eq("campaign_id", campaignId);

  const { data, error } = await query;
  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify(data || []);
}

// ─── OpenAI API callers ──────────────────────────────────────────────

/** Codex models only support /v1/responses, not /v1/chat/completions */
function isResponsesModel(model: string): boolean {
  return model.includes("codex");
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  // deno-lint-ignore no-explicit-any
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
}

// ── Chat Completions API (/v1/chat/completions) ──

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

// ── Responses API (/v1/responses) for codex models ──

function buildResponsesTools(config: AgentConfig) {
  // Responses API uses a flatter tool format: { type, name, description, parameters }
  return buildTools(config).map((t) => ({
    type: "function" as const,
    name: t.function.name,
    description: t.function.description,
    parameters: t.function.parameters,
  }));
}

// deno-lint-ignore no-explicit-any
interface ResponsesResult {
  // deno-lint-ignore no-explicit-any
  output: any[];
  id: string;
  // deno-lint-ignore no-explicit-any
  usage?: any;
}

async function callOpenAIResponses(
  apiKey: string,
  // deno-lint-ignore no-explicit-any
  input: any,
  config: AgentConfig,
  instructions: string,
  previousResponseId?: string,
): Promise<ResponsesResult> {
  const tools = buildResponsesTools(config);

  // deno-lint-ignore no-explicit-any
  const body: Record<string, any> = {
    model: config.model,
    input,
    tools,
  };
  // Only set instructions on the first call; subsequent calls use previous_response_id
  if (!previousResponseId) {
    body.instructions = instructions;
  } else {
    body.previous_response_id = previousResponseId;
  }

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI Responses API error ${res.status}: ${text}`);
  }

  return await res.json();
}

/**
 * Run the agentic loop using the Responses API.
 * Returns { messages, toolLog } in the same shape as the chat completions path
 * so the caller doesn't need to care which API was used.
 */
async function runResponsesLoop(
  apiKey: string,
  incomingMessages: ChatMessage[],
  config: AgentConfig,
  supabase: SupabaseClient,
  customerId: string,
): Promise<{
  messages: ChatMessage[];
  toolLog: { name: string; args: Record<string, unknown>; result: string }[];
}> {
  const toolLog: { name: string; args: Record<string, unknown>; result: string }[] = [];

  // Build the initial user input from incoming messages
  // The Responses API takes a plain string or array of content items
  const userMessages = incomingMessages.filter((m) => m.role === "user");
  const lastUserMsg = userMessages[userMessages.length - 1]?.content || "";

  // First call
  let resp = await callOpenAIResponses(
    apiKey,
    lastUserMsg,
    config,
    config.system_prompt,
  );

  let iterations = 0;

  while (iterations < config.max_iterations) {
    iterations++;

    // Check if there are function_call items in the output
    // deno-lint-ignore no-explicit-any
    const fnCalls = resp.output.filter((item: any) => item.type === "function_call");

    if (fnCalls.length === 0) {
      // No tool calls — we're done
      break;
    }

    // Execute each function call and build tool results
    // deno-lint-ignore no-explicit-any
    const toolResults: any[] = [];
    for (const fc of fnCalls) {
      let fnArgs: Record<string, unknown> = {};
      try {
        fnArgs = JSON.parse(fc.arguments || "{}");
      } catch {
        fnArgs = {};
      }

      const result = await handleToolCall(fc.name, fnArgs, supabase, config.defaults, customerId);
      toolLog.push({ name: fc.name, args: fnArgs, result });

      toolResults.push({
        type: "function_call_output",
        call_id: fc.call_id,
        output: result,
      });
    }

    // Continue the conversation with tool results
    resp = await callOpenAIResponses(
      apiKey,
      toolResults,
      config,
      config.system_prompt,
      resp.id,
    );
  }

  // Extract the final assistant text from output
  let assistantText = "";
  for (const item of resp.output) {
    if (item.type === "message" && item.content) {
      for (const part of item.content) {
        if (part.type === "output_text" || part.type === "text") {
          assistantText += part.text || "";
        }
      }
    }
  }

  // Build a messages array compatible with the chat completions response format
  const messages: ChatMessage[] = [
    ...incomingMessages,
    { role: "assistant", content: assistantText || null },
  ];

  // Insert tool call / tool result messages for transparency
  for (const entry of toolLog) {
    messages.splice(messages.length - 1, 0, {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: `responses_${entry.name}`,
          type: "function",
          function: { name: entry.name, arguments: JSON.stringify(entry.args) },
        },
      ],
    });
    messages.splice(messages.length - 1, 0, {
      role: "tool",
      tool_call_id: `responses_${entry.name}`,
      content: entry.result,
    });
  }

  return { messages, toolLog };
}

// ─── Main handler ────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  const supabase = getSupabaseClient(req);
  const customerId = getUserId(req);

  try {
    const { messages: incomingMessages } = await req.json();

    if (!Array.isArray(incomingMessages) || incomingMessages.length === 0) {
      return errorResponse("messages array required");
    }

    // Load agent config from app_settings (or use defaults)
    const config = await loadAgentConfig(supabase, customerId);

    // Fetch OpenAI API key (scoped to customer)
    const { data: keyRow } = await supabase
      .from("api_keys")
      .select("api_key")
      .eq("service", "openai")
      .eq("customer_id", customerId)
      .single();

    if (!keyRow?.api_key) {
      return errorResponse(
        "OpenAI API key not configured. Add it in Settings.",
        422,
      );
    }

    // Route to the correct API based on model type
    if (isResponsesModel(config.model)) {
      // ── Responses API path (codex models) ──
      const { messages: responseMessages, toolLog } = await runResponsesLoop(
        keyRow.api_key,
        incomingMessages,
        config,
        supabase,
        customerId,
      );

      return jsonResponse({
        messages: responseMessages,
        tool_log: toolLog,
      });
    }

    // ── Chat Completions API path (default) ──

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
          customerId,
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
    const msg = err instanceof Error ? err.message : String(err);
    console.error("ai-agent error:", err);
    // Return user-friendly message for known OpenAI errors (e.g. quota)
    if (msg.includes("429") || /quota|billing|rate limit/i.test(msg)) {
      return errorResponse(
        "OpenAI quota exceeded or rate limited. Check your OpenAI plan and billing, or try again later.",
        503,
      );
    }
    if (msg.includes("OpenAI API key not configured")) {
      return errorResponse(msg, 422);
    }
    return errorResponse(msg, 500);
  }
});
