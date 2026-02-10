/**
 * Edge Function: trigger-enrichment
 * Creates a bulk_job for batch enrichment -> Contabo worker
 * Supports: find_emails, find_decision_makers, anymail_emails
 * Directives: find_emails.md, find_decision_makers.md, anymail_find_emails.md
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getSupabaseClient, getUserId, jsonResponse, errorResponse, handleCors } from "../_shared/supabase.ts";
import { isBillingEnabled, checkAndDeductCredits, hasOwnApiKeys, getRequiredServices } from "../_shared/billing.ts";

const VALID_TYPES = [
  "find_emails",          // OpenWeb Ninja -> emails, phones, socials
  "find_decision_makers", // Waterfall: about pages -> ToS -> LinkedIn
  "anymail_emails",       // Anymail Finder -> decision_maker_email
];

Deno.serve(async (req: Request) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  const supabase = getSupabaseClient(req);
  const customerId = getUserId(req);

  try {
    const {
      campaign_id,
      type,
      max_leads = 100,
      include_existing = false,
      config = {},
    } = await req.json();

    if (!campaign_id) return errorResponse("campaign_id required");
    if (!type || !VALID_TYPES.includes(type)) {
      return errorResponse(`type must be one of: ${VALID_TYPES.join(", ")}`);
    }

    // Verify campaign exists and belongs to this customer
    const { data: campaign, error: campErr } = await supabase
      .from("campaigns")
      .select("id")
      .eq("id", campaign_id)
      .eq("customer_id", customerId)
      .single();
    if (campErr || !campaign) return errorResponse("Campaign not found", 404);

    // Estimate cost by counting eligible leads
    let countQuery = supabase
      .from("leads")
      .select("id", { count: "exact" })
      .eq("campaign_id", campaign_id)
      .eq("customer_id", customerId);

    // Filter based on enrichment type
    if (type === "find_emails" && !include_existing) {
      countQuery = countQuery.is("email", null);
    } else if (type === "find_decision_makers" && !include_existing) {
      countQuery = countQuery.is("decision_maker_name", null);
    } else if (type === "anymail_emails" && !include_existing) {
      countQuery = countQuery.is("decision_maker_email", null);
    }

    const { count } = await countQuery.limit(max_leads);
    const eligibleCount = Math.min(count || 0, max_leads);

    // Check if billing is enabled and user needs to pay for this operation
    let creditsDeducted = 0;
    if (isBillingEnabled()) {
      const requiredServices = getRequiredServices(type);
      const hasByok = await hasOwnApiKeys(supabase, customerId, requiredServices);
      
      if (!hasByok) {
        // User doesn't have their own API keys, deduct credits
        const creditCheck = await checkAndDeductCredits(
          supabase,
          customerId,
          eligibleCount,
          "bulk_job",
          undefined, // job ID not yet created
          `${type}: ${eligibleCount} leads`
        );

        if (!creditCheck.allowed) {
          return jsonResponse({
            error: "insufficient_credits",
            message: creditCheck.message || "Insufficient credits",
            balance: creditCheck.balance || 0,
            needed: eligibleCount,
          }, 402);
        }
        creditsDeducted = eligibleCount;
      }
    }

    // Create bulk job
    const { data: job, error } = await supabase
      .from("bulk_jobs")
      .insert({
        campaign_id,
        customer_id: customerId,
        type,
        config: {
          max_leads,
          include_existing,
          estimated_leads: eligibleCount,
          credits_deducted: creditsDeducted,
          ...config,
        },
      })
      .select()
      .single();

    if (error) return errorResponse(error.message);

    return jsonResponse({
      job,
      eligible_leads: eligibleCount,
      message: `${type} job created. Contabo worker will process ${eligibleCount} leads.`,
    }, 201);
  } catch (err) {
    return errorResponse(String(err), 500);
  }
});
