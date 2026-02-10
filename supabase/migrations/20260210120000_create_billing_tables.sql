-- Migration: Create billing tables and functions
-- Implements credit-based subscription billing with Stripe integration.
-- Safe for self-hosted: when BILLING_ENABLED is not set, billing checks are no-ops.

-- ═══════════════════════════════════════════════════════════════════════
-- 1. CREATE PLANS TABLE (static reference data)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ninja.plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  price_cents INT NOT NULL,
  credits_per_month INT NOT NULL,
  max_campaigns INT, -- NULL = unlimited
  max_shares INT,    -- NULL = unlimited
  stripe_price_id TEXT, -- Stripe Price ID (e.g. price_xxx)
  features JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed plan data
INSERT INTO ninja.plans (id, name, description, price_cents, credits_per_month, max_campaigns, max_shares, features) VALUES
  ('free', 'Free', '100 leads to get started', 0, 100, 2, 1, '{"export": false, "priority": false, "api_access": false}'),
  ('starter', 'Starter', 'For small teams', 4900, 1000, 10, 5, '{"export": "csv", "priority": false, "api_access": false}'),
  ('growth', 'Growth', 'For growing businesses', 9900, 3000, NULL, NULL, '{"export": "csv+sheets", "priority": true, "api_access": false}'),
  ('scale', 'Scale', 'For high-volume operations', 19900, 10000, NULL, NULL, '{"export": "csv+sheets+api", "priority": true, "api_access": true}')
ON CONFLICT (id) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════
-- 2. CREATE SUBSCRIPTIONS TABLE (per-customer subscription state)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ninja.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES ninja.plans(id),
  status TEXT NOT NULL DEFAULT 'active', -- active, canceled, past_due
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for customer lookups
CREATE INDEX IF NOT EXISTS ninja_subscriptions_customer_idx 
  ON ninja.subscriptions(customer_id);

-- Enable RLS
ALTER TABLE ninja.subscriptions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS customer_isolation_select ON ninja.subscriptions;
CREATE POLICY customer_isolation_select ON ninja.subscriptions
  FOR SELECT USING (auth.uid() = customer_id);

DROP POLICY IF EXISTS customer_isolation_modify ON ninja.subscriptions;
CREATE POLICY customer_isolation_modify ON ninja.subscriptions
  FOR ALL USING (auth.uid() = customer_id)
  WITH CHECK (auth.uid() = customer_id);


-- ═══════════════════════════════════════════════════════════════════════
-- 3. CREATE CREDIT_BALANCES TABLE (per-customer credit balance)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ninja.credit_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  balance INT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  credits_used_this_period INT NOT NULL DEFAULT 0,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for customer lookups
CREATE INDEX IF NOT EXISTS ninja_credit_balances_customer_idx 
  ON ninja.credit_balances(customer_id);

-- Enable RLS
ALTER TABLE ninja.credit_balances ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS customer_isolation_select ON ninja.credit_balances;
CREATE POLICY customer_isolation_select ON ninja.credit_balances
  FOR SELECT USING (auth.uid() = customer_id);

DROP POLICY IF EXISTS customer_isolation_modify ON ninja.credit_balances;
CREATE POLICY customer_isolation_modify ON ninja.credit_balances
  FOR ALL USING (auth.uid() = customer_id)
  WITH CHECK (auth.uid() = customer_id);

-- Enable realtime for live credit updates
ALTER TABLE ninja.credit_balances REPLICA IDENTITY FULL;


-- ═══════════════════════════════════════════════════════════════════════
-- 4. CREATE CREDIT_TRANSACTIONS TABLE (audit log)
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ninja.credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount INT NOT NULL, -- positive for additions, negative for deductions
  balance_after INT NOT NULL,
  type TEXT NOT NULL, -- 'purchase', 'subscription_renewal', 'deduction', 'refund', 'adjustment'
  reference_type TEXT, -- 'bulk_job', 'stripe_session', 'stripe_invoice', etc.
  reference_id TEXT,   -- job ID, session ID, invoice ID, etc.
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS ninja_credit_transactions_customer_idx 
  ON ninja.credit_transactions(customer_id);

CREATE INDEX IF NOT EXISTS ninja_credit_transactions_created_idx 
  ON ninja.credit_transactions(customer_id, created_at DESC);

-- Enable RLS
ALTER TABLE ninja.credit_transactions ENABLE ROW LEVEL SECURITY;

-- RLS Policies (read-only for customers)
DROP POLICY IF EXISTS customer_isolation_select ON ninja.credit_transactions;
CREATE POLICY customer_isolation_select ON ninja.credit_transactions
  FOR SELECT USING (auth.uid() = customer_id);


-- ═══════════════════════════════════════════════════════════════════════
-- 5. RPC: deduct_credits (atomic deduction with balance check)
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION ninja.deduct_credits(
  p_customer_id UUID,
  p_amount INT,
  p_reference_type TEXT DEFAULT NULL,
  p_reference_id TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, balance INT, message TEXT) AS $$
DECLARE
  v_current_balance INT;
  v_new_balance INT;
BEGIN
  -- Lock the row to prevent race conditions
  SELECT cb.balance INTO v_current_balance
  FROM ninja.credit_balances cb
  WHERE cb.customer_id = p_customer_id
  FOR UPDATE;

  -- Check if customer has enough credits
  IF v_current_balance IS NULL THEN
    RETURN QUERY SELECT false, 0, 'Customer credit balance not found';
    RETURN;
  END IF;

  IF v_current_balance < p_amount THEN
    RETURN QUERY SELECT false, v_current_balance, 'Insufficient credits';
    RETURN;
  END IF;

  -- Deduct credits and increment period usage
  v_new_balance := v_current_balance - p_amount;
  
  UPDATE ninja.credit_balances
  SET balance = v_new_balance,
      credits_used_this_period = credits_used_this_period + p_amount,
      updated_at = now()
  WHERE customer_id = p_customer_id;

  -- Log the transaction
  INSERT INTO ninja.credit_transactions (
    customer_id, amount, balance_after, type, reference_type, reference_id, description
  ) VALUES (
    p_customer_id, -p_amount, v_new_balance, 'deduction', p_reference_type, p_reference_id, p_description
  );

  RETURN QUERY SELECT true, v_new_balance, 'Credits deducted successfully';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ═══════════════════════════════════════════════════════════════════════
-- 6. RPC: add_credits (atomic addition)
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION ninja.add_credits(
  p_customer_id UUID,
  p_amount INT,
  p_type TEXT DEFAULT 'purchase',
  p_reference_type TEXT DEFAULT NULL,
  p_reference_id TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, balance INT, message TEXT) AS $$
DECLARE
  v_new_balance INT;
BEGIN
  -- Upsert credit balance (in case it doesn't exist yet)
  INSERT INTO ninja.credit_balances (customer_id, balance, updated_at)
  VALUES (p_customer_id, p_amount, now())
  ON CONFLICT (customer_id) DO UPDATE
  SET balance = ninja.credit_balances.balance + p_amount,
      updated_at = now()
  RETURNING balance INTO v_new_balance;

  -- Log the transaction
  INSERT INTO ninja.credit_transactions (
    customer_id, amount, balance_after, type, reference_type, reference_id, description
  ) VALUES (
    p_customer_id, p_amount, v_new_balance, p_type, p_reference_type, p_reference_id, p_description
  );

  RETURN QUERY SELECT true, v_new_balance, 'Credits added successfully';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ═══════════════════════════════════════════════════════════════════════
-- 7. RPC: reset_period_credits (called on subscription renewal)
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION ninja.reset_period_credits(
  p_customer_id UUID,
  p_credits_to_add INT,
  p_period_start TIMESTAMPTZ,
  p_period_end TIMESTAMPTZ
)
RETURNS TABLE(success BOOLEAN, balance INT, message TEXT) AS $$
DECLARE
  v_new_balance INT;
BEGIN
  -- Add monthly allocation and reset period counter
  UPDATE ninja.credit_balances
  SET balance = balance + p_credits_to_add,
      credits_used_this_period = 0,
      period_start = p_period_start,
      period_end = p_period_end,
      updated_at = now()
  WHERE customer_id = p_customer_id
  RETURNING balance INTO v_new_balance;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 0, 'Customer credit balance not found';
    RETURN;
  END IF;

  -- Log the transaction
  INSERT INTO ninja.credit_transactions (
    customer_id, amount, balance_after, type, reference_type, reference_id, description
  ) VALUES (
    p_customer_id, 
    p_credits_to_add, 
    v_new_balance, 
    'subscription_renewal', 
    NULL, 
    NULL, 
    format('Monthly renewal: %s credits', p_credits_to_add)
  );

  RETURN QUERY SELECT true, v_new_balance, 'Period credits reset successfully';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ═══════════════════════════════════════════════════════════════════════
-- 8. UPDATE handle_new_user TRIGGER (add subscription + credit balance)
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION ninja.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ninja
AS $$
BEGIN
  -- Create app_settings row
  INSERT INTO ninja.app_settings (customer_id, settings)
  VALUES (NEW.id, '{}'::jsonb)
  ON CONFLICT DO NOTHING;

  -- Create free subscription
  INSERT INTO ninja.subscriptions (customer_id, plan_id, status)
  VALUES (NEW.id, 'free', 'active')
  ON CONFLICT DO NOTHING;

  -- Create credit balance with 100 free credits
  INSERT INTO ninja.credit_balances (customer_id, balance)
  VALUES (NEW.id, 100)
  ON CONFLICT DO NOTHING;

  -- Log initial credit grant
  INSERT INTO ninja.credit_transactions (
    customer_id, amount, balance_after, type, description
  ) VALUES (
    NEW.id, 100, 100, 'purchase', 'Welcome bonus: 100 free credits'
  );

  RETURN NEW;
END;
$$;

-- Trigger already exists from migration 016, function is replaced above


-- ═══════════════════════════════════════════════════════════════════════
-- 9. GRANT PERMISSIONS
-- ═══════════════════════════════════════════════════════════════════════

GRANT SELECT ON ninja.plans TO anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION ninja.deduct_credits(UUID, INT, TEXT, TEXT, TEXT) 
  TO service_role;

GRANT EXECUTE ON FUNCTION ninja.add_credits(UUID, INT, TEXT, TEXT, TEXT, TEXT) 
  TO service_role;

GRANT EXECUTE ON FUNCTION ninja.reset_period_credits(UUID, INT, TIMESTAMPTZ, TIMESTAMPTZ) 
  TO service_role;
