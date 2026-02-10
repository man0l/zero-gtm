/**
 * Edge Function: trigger-scrape
 * Creates a bulk_job for Google Maps scraping -> Contabo worker picks it up
 * Directive: scrape_google_maps.md
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getSupabaseClient, getUserId, jsonResponse, errorResponse, handleCors } from "../_shared/supabase.ts";
import { isBillingEnabled, checkAndDeductCredits, hasOwnApiKeys, getRequiredServices } from "../_shared/billing.ts";

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
      keywords,
      locations_file,
      max_leads = 1000,
      concurrent = 20,
    } = await req.json();

    if (!campaign_id) return errorResponse("campaign_id required");
    if (!keywords?.length) return errorResponse("keywords required (array of strings)");

    // Verify campaign exists and belongs to this customer
    const { data: campaign, error: campErr } = await supabase
      .from("campaigns")
      .select("id")
      .eq("id", campaign_id)
      .eq("customer_id", customerId)
      .single();
    if (campErr || !campaign) return errorResponse("Campaign not found", 404);

    // Check if billing is enabled and user needs to pay for this operation
    let creditsDeducted = 0;
    if (isBillingEnabled()) {
      const requiredServices = getRequiredServices("scrape_maps");
      const hasByok = await hasOwnApiKeys(supabase, customerId, requiredServices);
      
      if (!hasByok) {
        // User doesn't have their own API key, deduct credits
        const creditCheck = await checkAndDeductCredits(
          supabase,
          customerId,
          max_leads,
          "bulk_job",
          undefined, // job ID not yet created
          `Scrape ${max_leads} leads`
        );

        if (!creditCheck.allowed) {
          return jsonResponse({
            error: "insufficient_credits",
            message: creditCheck.message || "Insufficient credits",
            balance: creditCheck.balance || 0,
            needed: max_leads,
          }, 402);
        }
        creditsDeducted = max_leads;
      }
    }

    // Create bulk job
    const { data: job, error } = await supabase
      .from("bulk_jobs")
      .insert({
        campaign_id,
        customer_id: customerId,
        type: "scrape_maps",
        config: {
          keywords,
          locations_file: locations_file || "data/us_locations.csv",
          max_leads,
          concurrent,
          credits_deducted: creditsDeducted,
        },
      })
      .select()
      .single();

    if (error) return errorResponse(error.message);

    return jsonResponse({
      job,
      message: "Scrape job created. Contabo worker will pick it up.",
    }, 201);
  } catch (err) {
    return errorResponse(String(err), 500);
  }
});
