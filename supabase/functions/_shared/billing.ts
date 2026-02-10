/**
 * Billing module for credit-based subscription system.
 * When BILLING_ENABLED is not set (self-hosted), all checks return unlimited/allowed.
 */
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Check if billing is enabled (hosted SaaS mode).
 * Self-hosted instances should not set this env var.
 */
export function isBillingEnabled(): boolean {
  return Deno.env.get("BILLING_ENABLED") === "true";
}

/**
 * Map job types to required API key services.
 * Used to determine if user is using BYOK (their own keys) or platform keys.
 */
export function getRequiredServices(jobType: string): string[] {
  const serviceMap: Record<string, string[]> = {
    scrape_maps: ["rapidapi_maps"],
    find_emails: ["openwebninja"],
    find_decision_makers: ["dataforseo", "openai"],
    anymail_emails: ["anymail"],
    casualise_names: ["openai"],
    clean_spam: [], // No external API
    clean_leads: [], // No external API
  };
  return serviceMap[jobType] || [];
}

/**
 * Check if user has all required API keys for a given list of services.
 * Returns true if all keys exist, false otherwise.
 * Throws on DB errors to avoid silently charging BYOK users.
 */
export async function hasOwnApiKeys(
  supabase: SupabaseClient,
  customerId: string,
  services: string[]
): Promise<boolean> {
  if (services.length === 0) return true; // No keys required

  const { data, error } = await supabase
    .from("api_keys")
    .select("service")
    .eq("customer_id", customerId)
    .in("service", services);

  if (error) {
    console.error("Failed to check API keys:", error);
    throw new Error(`Failed to check API keys: ${error.message}`);
  }
  
  // Check if user has all required services
  const userServices = new Set(data?.map((k) => k.service) || []);
  return services.every((s) => userServices.has(s));
}

/**
 * Check if user has sufficient credits and deduct them atomically.
 * Returns { allowed: true, balance } on success, { allowed: false, balance, message } on failure.
 * When billing is disabled, always returns { allowed: true }.
 */
export async function checkAndDeductCredits(
  supabase: SupabaseClient,
  customerId: string,
  amount: number,
  referenceType?: string,
  referenceId?: string,
  description?: string
): Promise<{ allowed: boolean; balance?: number; message?: string }> {
  // Billing disabled = unlimited credits
  if (!isBillingEnabled()) {
    return { allowed: true };
  }

  // Call the deduct_credits RPC
  const { data, error } = await supabase.rpc("deduct_credits", {
    p_customer_id: customerId,
    p_amount: amount,
    p_reference_type: referenceType || null,
    p_reference_id: referenceId || null,
    p_description: description || null,
  });

  if (error) {
    console.error("Failed to deduct credits:", error);
    return { allowed: false, message: "Failed to check credits" };
  }

  const result = data?.[0] || data;
  return {
    allowed: result.success,
    balance: result.balance,
    message: result.message,
  };
}

/**
 * Get full billing status for a customer: plan, subscription, credit balance, usage.
 * Returns { billing_enabled: false, plan: "self_hosted" } when billing is disabled.
 */
export async function getBillingStatus(
  supabase: SupabaseClient,
  customerId: string
): Promise<{
  billing_enabled: boolean;
  plan?: string;
  plan_name?: string;
  subscription?: any;
  credits?: {
    balance: number;
    used_this_period: number;
    period_start?: string;
    period_end?: string;
  };
  limits?: {
    max_campaigns?: number;
    max_shares?: number;
  };
}> {
  if (!isBillingEnabled()) {
    return {
      billing_enabled: false,
      plan: "self_hosted",
    };
  }

  // Fetch subscription with plan details
  const { data: subscription, error: subError } = await supabase
    .from("subscriptions")
    .select(`
      *,
      plan:plans(*)
    `)
    .eq("customer_id", customerId)
    .single();

  if (subError) {
    console.error("Failed to fetch subscription:", subError);
    return { billing_enabled: true };
  }

  // Fetch credit balance
  const { data: balance, error: balError } = await supabase
    .from("credit_balances")
    .select("*")
    .eq("customer_id", customerId)
    .single();

  if (balError) {
    console.error("Failed to fetch credit balance:", balError);
  }

  return {
    billing_enabled: true,
    plan: subscription?.plan_id,
    plan_name: subscription?.plan?.name,
    subscription,
    credits: balance
      ? {
          balance: balance.balance,
          used_this_period: balance.credits_used_this_period,
          period_start: balance.period_start,
          period_end: balance.period_end,
        }
      : undefined,
    limits: {
      max_campaigns: subscription?.plan?.max_campaigns,
      max_shares: subscription?.plan?.max_shares,
    },
  };
}

/**
 * Check if user is within their plan limits for a given resource.
 * Returns { allowed: true } if within limits, { allowed: false, message } if exceeded.
 * When billing is disabled, always returns { allowed: true }.
 */
export async function checkPlanLimit(
  supabase: SupabaseClient,
  customerId: string,
  resource: "campaigns" | "shares",
  currentCount: number
): Promise<{ allowed: boolean; limit?: number; message?: string }> {
  if (!isBillingEnabled()) {
    return { allowed: true };
  }

  // Fetch subscription with plan limits
  const { data: subscription, error } = await supabase
    .from("subscriptions")
    .select(`
      plan:plans(max_campaigns, max_shares)
    `)
    .eq("customer_id", customerId)
    .single();

  if (error) {
    console.error("Failed to fetch subscription:", error);
    return { allowed: false, message: "Failed to check plan limits" };
  }

  const limit =
    resource === "campaigns"
      ? subscription?.plan?.max_campaigns
      : subscription?.plan?.max_shares;

  // NULL limit = unlimited
  if (limit === null || limit === undefined) {
    return { allowed: true };
  }

  if (currentCount >= limit) {
    return {
      allowed: false,
      limit,
      message: `Plan limit reached: ${limit} ${resource} maximum`,
    };
  }

  return { allowed: true, limit };
}
