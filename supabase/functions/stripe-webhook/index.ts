/**
 * Edge Function: stripe-webhook
 * Handles Stripe webhook events for subscription lifecycle.
 * No JWT required - validates via Stripe webhook signature.
 *
 * Events handled:
 * - checkout.session.completed: Create/update subscription, add credits
 * - invoice.paid: Monthly renewal, reset period credits
 * - customer.subscription.updated: Plan change (upgrade/downgrade)
 * - customer.subscription.deleted: Downgrade to free plan
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { getSupabaseClient, jsonResponse, errorResponse } from "../_shared/supabase.ts";
import { isBillingEnabled } from "../_shared/billing.ts";
import Stripe from "https://esm.sh/stripe@14.11.0?target=deno";

/**
 * Check if a credit transaction with the given reference already exists.
 * Used to prevent double-crediting on webhook retries.
 */
async function isAlreadyProcessed(
  supabase: ReturnType<typeof getSupabaseClient>,
  referenceType: string,
  referenceId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("credit_transactions")
    .select("id")
    .eq("reference_type", referenceType)
    .eq("reference_id", referenceId)
    .limit(1);

  if (error) {
    console.error(`[stripe-webhook] Idempotency check failed: ${error.message}`);
    return false; // Proceed cautiously -- the RPC may still catch duplicates
  }
  return (data?.length ?? 0) > 0;
}

Deno.serve(async (req: Request) => {
  // Stripe webhooks are POST only, no CORS needed
  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  // Check if billing is enabled
  if (!isBillingEnabled()) {
    return errorResponse("Billing not enabled", 404);
  }

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  
  if (!stripeKey || !webhookSecret) {
    return errorResponse("Stripe not configured", 500);
  }

  const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });
  const supabase = getSupabaseClient();

  try {
    // Verify webhook signature
    const body = await req.text();
    const signature = req.headers.get("stripe-signature");
    
    if (!signature) {
      return errorResponse("No signature", 400);
    }

    const event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      webhookSecret
    );

    console.log(`[stripe-webhook] Event: ${event.type}, ID: ${event.id}`);

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const customerId = session.metadata?.supabase_customer_id;
        const planId = session.metadata?.plan_id;

        if (!customerId || !planId) {
          console.error("[stripe-webhook] Missing metadata in checkout session");
          break;
        }

        // Get plan details
        const { data: plan } = await supabase
          .from("plans")
          .select("*")
          .eq("id", planId)
          .single();

        if (!plan) {
          console.error(`[stripe-webhook] Plan not found: ${planId}`);
          break;
        }

        // Get subscription details from Stripe
        const stripeSubscription = session.subscription as string;
        const subscription = await stripe.subscriptions.retrieve(stripeSubscription);

        // Update subscription record
        await supabase
          .from("subscriptions")
          .update({
            plan_id: planId,
            status: "active",
            stripe_subscription_id: subscription.id,
            stripe_customer_id: session.customer as string,
            current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("customer_id", customerId);

        // Idempotency: skip if this session was already processed
        if (await isAlreadyProcessed(supabase, "stripe_session", session.id)) {
          console.log(`[stripe-webhook] Session ${session.id} already processed, skipping`);
          break;
        }

        // Add credits for the new subscription
        await supabase.rpc("add_credits", {
          p_customer_id: customerId,
          p_amount: plan.credits_per_month,
          p_type: "subscription_renewal",
          p_reference_type: "stripe_session",
          p_reference_id: session.id,
          p_description: `${plan.name} plan activated: ${plan.credits_per_month} credits`,
        });

        // Update credit balance period
        await supabase
          .from("credit_balances")
          .update({
            period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          })
          .eq("customer_id", customerId);

        console.log(`[stripe-webhook] Checkout completed for customer ${customerId}, plan ${planId}`);
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        
        // Skip if not a subscription invoice
        if (!invoice.subscription) break;

        // Idempotency: skip if this invoice was already processed
        if (await isAlreadyProcessed(supabase, "stripe_invoice", invoice.id)) {
          console.log(`[stripe-webhook] Invoice ${invoice.id} already processed, skipping`);
          break;
        }

        const stripeCustomerId = invoice.customer as string;

        // Find customer by Stripe customer ID
        const { data: subscription } = await supabase
          .from("subscriptions")
          .select("customer_id, plan_id, plan:plans(*)")
          .eq("stripe_customer_id", stripeCustomerId)
          .single();

        if (!subscription) {
          console.error(`[stripe-webhook] Subscription not found for Stripe customer ${stripeCustomerId}`);
          break;
        }

        const customerId = subscription.customer_id;
        const plan = subscription.plan;

        // Get Stripe subscription to get period dates
        const stripeSubscription = await stripe.subscriptions.retrieve(invoice.subscription as string);

        // Reset period credits (monthly renewal) with idempotency reference
        await supabase.rpc("reset_period_credits", {
          p_customer_id: customerId,
          p_credits_to_add: plan.credits_per_month,
          p_period_start: new Date(stripeSubscription.current_period_start * 1000).toISOString(),
          p_period_end: new Date(stripeSubscription.current_period_end * 1000).toISOString(),
          p_reference_type: "stripe_invoice",
          p_reference_id: invoice.id,
        });

        console.log(`[stripe-webhook] Invoice paid for customer ${customerId}, ${plan.credits_per_month} credits added`);
        break;
      }

      case "customer.subscription.updated": {
        const stripeSubscription = event.data.object as Stripe.Subscription;
        const stripeCustomerId = stripeSubscription.customer as string;

        // Find customer by Stripe customer ID
        const { data: subscription } = await supabase
          .from("subscriptions")
          .select("customer_id, plan_id")
          .eq("stripe_customer_id", stripeCustomerId)
          .single();

        if (!subscription) {
          console.error(`[stripe-webhook] Subscription not found for Stripe customer ${stripeCustomerId}`);
          break;
        }

        const customerId = subscription.customer_id;

        // Determine new plan from price ID
        const priceId = stripeSubscription.items.data[0]?.price.id;
        const { data: newPlan } = await supabase
          .from("plans")
          .select("*")
          .eq("stripe_price_id", priceId)
          .single();

        if (!newPlan) {
          console.error(`[stripe-webhook] Plan not found for price ${priceId}`);
          break;
        }

        // Update subscription
        await supabase
          .from("subscriptions")
          .update({
            plan_id: newPlan.id,
            status: stripeSubscription.status,
            current_period_start: new Date(stripeSubscription.current_period_start * 1000).toISOString(),
            current_period_end: new Date(stripeSubscription.current_period_end * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("customer_id", customerId);

        console.log(`[stripe-webhook] Subscription updated for customer ${customerId} to plan ${newPlan.id}`);
        break;
      }

      case "customer.subscription.deleted": {
        const stripeSubscription = event.data.object as Stripe.Subscription;
        const stripeCustomerId = stripeSubscription.customer as string;

        // Find customer by Stripe customer ID
        const { data: subscription } = await supabase
          .from("subscriptions")
          .select("customer_id")
          .eq("stripe_customer_id", stripeCustomerId)
          .single();

        if (!subscription) {
          console.error(`[stripe-webhook] Subscription not found for Stripe customer ${stripeCustomerId}`);
          break;
        }

        const customerId = subscription.customer_id;

        // Downgrade to free plan
        await supabase
          .from("subscriptions")
          .update({
            plan_id: "free",
            status: "canceled",
            stripe_subscription_id: null,
            current_period_start: null,
            current_period_end: null,
            updated_at: new Date().toISOString(),
          })
          .eq("customer_id", customerId);

        // Cap credits at free tier limit (100)
        const { data: balance } = await supabase
          .from("credit_balances")
          .select("balance")
          .eq("customer_id", customerId)
          .single();

        if (balance && balance.balance > 100) {
          await supabase
            .from("credit_balances")
            .update({ balance: 100 })
            .eq("customer_id", customerId);
        }

        console.log(`[stripe-webhook] Subscription canceled for customer ${customerId}, downgraded to free`);
        break;
      }

      default:
        console.log(`[stripe-webhook] Unhandled event type: ${event.type}`);
    }

    return jsonResponse({ received: true });
  } catch (err) {
    console.error("[stripe-webhook] Error:", err);
    return errorResponse(String(err), 400);
  }
});
