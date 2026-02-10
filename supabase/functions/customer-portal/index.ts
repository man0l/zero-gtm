/**
 * Edge Function: customer-portal
 * Creates a Stripe Customer Portal session for managing subscription.
 * Returns portal URL for the mobile app to open.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getSupabaseClient, getUserId, jsonResponse, errorResponse, handleCors } from "../_shared/supabase.ts";
import { isBillingEnabled } from "../_shared/billing.ts";
import Stripe from "https://esm.sh/stripe@14.11.0?target=deno";

Deno.serve(async (req: Request) => {
  const corsResp = handleCors(req);
  if (corsResp) return corsResp;

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  // Check if billing is enabled
  if (!isBillingEnabled()) {
    return errorResponse("Billing not enabled", 404);
  }

  const supabase = getSupabaseClient(req);
  const customerId = getUserId(req);

  try {
    // Get Stripe customer ID
    const { data: subscription, error } = await supabase
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("customer_id", customerId)
      .single();

    if (error || !subscription?.stripe_customer_id) {
      return errorResponse("No Stripe customer found. Please purchase a plan first.", 404);
    }

    // Initialize Stripe
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return errorResponse("Stripe not configured", 500);
    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });

    // Create Customer Portal session
    const session = await stripe.billingPortal.sessions.create({
      customer: subscription.stripe_customer_id,
      return_url: `${Deno.env.get("EXPO_PUBLIC_WEB_URL") || "https://mobile-delta-nine.vercel.app"}/billing`,
    });

    return jsonResponse({
      portal_url: session.url,
    });
  } catch (err) {
    console.error("Customer portal error:", err);
    return errorResponse(String(err), 500);
  }
});
