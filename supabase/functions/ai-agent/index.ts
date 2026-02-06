/**
 * Edge Function: ai-agent
 * AI assistant with OpenAI function calling that orchestrates the enrichment pipeline.
 * Tools map to existing Edge Functions / direct DB queries.
 *
 * Flow:
 *   1. Receive messages[] from frontend
 *   2. Fetch OpenAI key from ninja.api_keys
 *   3. Call OpenAI Chat Completions with tool definitions
 *   4. Execute tool_calls against DB / bulk_jobs
 *   5. Loop until OpenAI returns a plain message
 *   6. Return full conversation to frontend
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  getSupabaseClient,
  jsonResponse,
  errorResponse,
  handleCors,
} from "../_shared/supabase.ts";

// ─── Constants ───────────────────────────────────────────────────────
const OPENAI_MODEL = "gpt-4o-mini";
const MAX_TOOL_ITERATIONS = 10;

// ─── System prompt ───────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are the Cold Email Ninja assistant — an AI that helps users run lead enrichment pipelines.

You have tools to:
- List campaigns and check their stats
- Run pipeline steps: scrape → clean → find emails → find decision makers → casualise names
- Check job progress

Rules:
- Always confirm which campaign to operate on before running tools. Use list_campaigns if unsure.
- Pipeline steps should run in order: scrape_google_maps → clean_and_validate → find_emails → find_decision_makers → casualise_names
- Scrape, clean, find_emails, and find_decision_makers are ASYNC — they create background jobs processed by a worker. Tell the user to check back or ask you for status.
- casualise_names runs inline and completes immediately.
- When creating a scrape job, always ask for keywords if not provided.
- Be concise but helpful. Report job IDs and eligible lead counts after each step.`;

// ─── Tool definitions ────────────────────────────────────────────────
const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "list_campaigns",
      description:
        "List all campaigns with their lead counts. Use this to help the user pick a campaign.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_campaign_stats",
      description:
        "Get enrichment coverage stats for a campaign: total leads, with email, with website, with decision maker, with casual name, validated count.",
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
      description:
        "Scrape business leads from Google Maps for a campaign. Creates an async background job.",
      parameters: {
        type: "object",
        properties: {
          campaign_id: { type: "string", description: "Campaign UUID" },
          keywords: {
            type: "array",
            items: { type: "string" },
            description: "Search keywords, e.g. ['plumber', 'plumbing company']",
          },
          max_leads: {
            type: "number",
            description: "Target number of leads (default 1000)",
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
      description:
        "Clean and validate leads — checks that websites are live, optionally filters by category. Creates an async background job.",
      parameters: {
        type: "object",
        properties: {
          campaign_id: { type: "string", description: "Campaign UUID" },
          categories: {
            type: "array",
            items: { type: "string" },
            description: "Optional category filter (OR logic)",
          },
          max_leads: { type: "number", description: "Max leads to process" },
        },
        required: ["campaign_id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "find_emails",
      description:
        "Find email addresses for leads by scraping their websites. Creates an async background job.",
      parameters: {
        type: "object",
        properties: {
          campaign_id: { type: "string", description: "Campaign UUID" },
          max_leads: {
            type: "number",
            description: "Max leads to process (default 100)",
          },
          include_existing: {
            type: "boolean",
            description: "Re-process leads that already have emails (default false)",
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
      description:
        "Find decision makers (owners, founders, CEOs) for leads via about/contact pages and LinkedIn. Creates an async background job.",
      parameters: {
        type: "object",
        properties: {
          campaign_id: { type: "string", description: "Campaign UUID" },
          max_leads: {
            type: "number",
            description: "Max leads to process (default 100)",
          },
          include_existing: {
            type: "boolean",
            description: "Re-process leads with existing decision makers (default false)",
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
      description:
        "Shorten company names to casual conversational form (removes Inc, LLC, etc.). Runs inline — completes immediately.",
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
      name: "get_active_jobs",
      description:
        "Get the status of active and recent jobs for a campaign (or all campaigns if no campaign_id).",
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

// ─── Tool handlers ───────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

async function handleToolCall(
  toolName: string,
  // deno-lint-ignore no-explicit-any
  args: Record<string, any>,
  supabase: SupabaseClient,
): Promise<string> {
  switch (toolName) {
    case "list_campaigns":
      return await toolListCampaigns(supabase);
    case "get_campaign_stats":
      return await toolGetCampaignStats(supabase, args.campaign_id);
    case "scrape_google_maps":
      return await toolScrapeGoogleMaps(supabase, args);
    case "clean_and_validate":
      return await toolCleanAndValidate(supabase, args);
    case "find_emails":
      return await toolFindEmails(supabase, args);
    case "find_decision_makers":
      return await toolFindDecisionMakers(supabase, args);
    case "casualise_names":
      return await toolCasualiseNames(supabase, args.campaign_id);
    case "get_active_jobs":
      return await toolGetActiveJobs(supabase, args.campaign_id);
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
async function toolScrapeGoogleMaps(supabase: SupabaseClient, args: Record<string, any>): Promise<string> {
  const { campaign_id, keywords, max_leads = 1000 } = args;

  // Verify campaign
  const { error: campErr } = await supabase
    .from("campaigns")
    .select("id")
    .eq("id", campaign_id)
    .single();
  if (campErr) return JSON.stringify({ error: "Campaign not found" });

  const { data: job, error } = await supabase
    .from("bulk_jobs")
    .insert({
      campaign_id,
      type: "scrape_maps",
      config: {
        keywords,
        locations_file: "data/us_locations.csv",
        max_leads,
        concurrent: 20,
      },
    })
    .select()
    .single();

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({
    job_id: job.id,
    type: "scrape_maps",
    keywords,
    max_leads,
    message: "Scrape job created. Contabo worker will process it.",
  });
}

// deno-lint-ignore no-explicit-any
async function toolCleanAndValidate(supabase: SupabaseClient, args: Record<string, any>): Promise<string> {
  const { campaign_id, categories = [], max_leads = 1000 } = args;

  const { error: campErr } = await supabase
    .from("campaigns")
    .select("id")
    .eq("id", campaign_id)
    .single();
  if (campErr) return JSON.stringify({ error: "Campaign not found" });

  const { count } = await supabase
    .from("leads")
    .select("id", { count: "exact" })
    .eq("campaign_id", campaign_id)
    .not("company_website", "is", null);

  const { data: job, error } = await supabase
    .from("bulk_jobs")
    .insert({
      campaign_id,
      type: "clean_leads",
      config: {
        categories,
        max_leads,
        workers: 10,
        total_with_website: count || 0,
      },
    })
    .select()
    .single();

  if (error) return JSON.stringify({ error: error.message });
  return JSON.stringify({
    job_id: job.id,
    type: "clean_leads",
    leads_with_website: count || 0,
    message: "Clean job created. Worker will validate websites.",
  });
}

// deno-lint-ignore no-explicit-any
async function toolFindEmails(supabase: SupabaseClient, args: Record<string, any>): Promise<string> {
  const { campaign_id, max_leads = 100, include_existing = false } = args;

  const { error: campErr } = await supabase
    .from("campaigns")
    .select("id")
    .eq("id", campaign_id)
    .single();
  if (campErr) return JSON.stringify({ error: "Campaign not found" });

  let countQuery = supabase
    .from("leads")
    .select("id", { count: "exact" })
    .eq("campaign_id", campaign_id);
  if (!include_existing) countQuery = countQuery.is("email", null);

  const { count } = await countQuery.limit(max_leads);
  const eligible = Math.min(count || 0, max_leads);

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
    message: `Find-emails job created for ${eligible} leads.`,
  });
}

// deno-lint-ignore no-explicit-any
async function toolFindDecisionMakers(supabase: SupabaseClient, args: Record<string, any>): Promise<string> {
  const { campaign_id, max_leads = 100, include_existing = false } = args;

  const { error: campErr } = await supabase
    .from("campaigns")
    .select("id")
    .eq("id", campaign_id)
    .single();
  if (campErr) return JSON.stringify({ error: "Campaign not found" });

  let countQuery = supabase
    .from("leads")
    .select("id", { count: "exact" })
    .eq("campaign_id", campaign_id);
  if (!include_existing) countQuery = countQuery.is("decision_maker_name", null);

  const { count } = await countQuery.limit(max_leads);
  const eligible = Math.min(count || 0, max_leads);

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
    message: `Find-decision-makers job created for ${eligible} leads.`,
  });
}

async function toolCasualiseNames(
  supabase: SupabaseClient,
  campaignId: string,
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
      r = r.replace(new RegExp(`[,\\s]+${s.replace(/\./g, "\\.")}[\\.\\s]*$`, "i"), "").trim();
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
    .limit(500);

  if (error) return JSON.stringify({ error: error.message });
  if (!leads?.length)
    return JSON.stringify({ processed: 0, message: "No leads need casualisation" });

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

async function toolGetActiveJobs(
  supabase: SupabaseClient,
  campaignId?: string,
): Promise<string> {
  let query = supabase
    .from("bulk_jobs")
    .select("id, campaign_id, type, status, progress, created_at, error")
    .order("created_at", { ascending: false })
    .limit(20);

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
): Promise<{ message: ChatMessage; usage?: { total_tokens: number } }> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      messages,
      tools: TOOLS,
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

    // Fetch OpenAI API key
    const { data: keyRow } = await supabase
      .from("api_keys")
      .select("api_key")
      .eq("service", "openai")
      .single();

    if (!keyRow?.api_key) {
      return errorResponse("OpenAI API key not configured. Add it in Settings.", 422);
    }

    // Build conversation with system prompt
    const conversation: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...incomingMessages,
    ];

    // Agentic loop: call OpenAI, execute tools, repeat
    const toolLog: { name: string; args: Record<string, unknown>; result: string }[] = [];
    let iterations = 0;

    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++;

      const { message: assistantMsg } = await callOpenAI(
        keyRow.api_key,
        conversation,
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

        const result = await handleToolCall(fnName, fnArgs, supabase);

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
