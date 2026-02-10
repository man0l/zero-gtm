/**
 * Edge Function: billing-status
 * Returns current billing status for authenticated user:
 * plan, subscription, credit balance, usage, limits
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getSupabaseClient, getUserId, jsonResponse, errorResponse, handleCors } from "../_shared/supabase.ts";
import { getBillingStatus } from "../_shared/billing.ts";

Deno.serve(async (req: Request) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  const supabase = getSupabaseClient(req);
  const customerId = getUserId(req);

  try {
    const status = await getBillingStatus(supabase, customerId);
    return jsonResponse(status);
  } catch (err) {
    return errorResponse(String(err), 500);
  }
});
