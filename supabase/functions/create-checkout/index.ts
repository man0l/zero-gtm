/**
 * Edge Function: create-checkout
 * Creates a Stripe Checkout Session for subscription purchase.
 * Returns checkout URL for the mobile app to open.
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
    const { plan_id } = await req.json();

    if (!plan_id) return errorResponse("plan_id required");
    if (plan_id === "free") return errorResponse("Cannot checkout for free plan");

    // Get plan details
    const { data: plan, error: planErr } = await supabase
      .from("plans")
      .select("*")
      .eq("id", plan_id)
      .single();

    if (planErr || !plan) return errorResponse("Plan not found", 404);
    if (!plan.stripe_price_id) return errorResponse("Plan does not have a Stripe price configured", 400);

    // Get user email
    const { data: { user }, error: userErr } = await supabase.auth.admin.getUserById(customerId);
    if (userErr || !user?.email) return errorResponse("User not found", 404);

    // Initialize Stripe
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) return errorResponse("Stripe not configured", 500);
    const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });

    // Get or create Stripe customer
    const { data: subscription } = await supabase
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("customer_id", customerId)
      .single();

    let stripeCustomerId = subscription?.stripe_customer_id;

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          supabase_customer_id: customerId,
        },
      });
      stripeCustomerId = customer.id;

      // Update subscription record with Stripe customer ID
      await supabase
        .from("subscriptions")
        .update({ stripe_customer_id: stripeCustomerId })
        .eq("customer_id", customerId);
    }

    // Create Checkout Session
    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        {
          price: plan.stripe_price_id,
          quantity: 1,
        },
      ],
      success_url: `${Deno.env.get("EXPO_PUBLIC_WEB_URL") || "https://mobile-delta-nine.vercel.app"}/billing?success=true`,
      cancel_url: `${Deno.env.get("EXPO_PUBLIC_WEB_URL") || "https://mobile-delta-nine.vercel.app"}/billing?canceled=true`,
      metadata: {
        supabase_customer_id: customerId,
        plan_id: plan_id,
      },
    });

    return jsonResponse({
      checkout_url: session.url,
      session_id: session.id,
    });
  } catch (err) {
    console.error("Create checkout error:", err);
    return errorResponse(String(err), 500);
  }
});
