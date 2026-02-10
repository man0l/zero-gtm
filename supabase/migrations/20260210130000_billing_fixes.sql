-- ═══════════════════════════════════════════════════════════════════════
-- Billing fixes: add reference tracking to reset_period_credits for idempotency,
-- and add ON CONFLICT guard to welcome bonus transaction.
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Update reset_period_credits to accept reference parameters for idempotency tracking
CREATE OR REPLACE FUNCTION ninja.reset_period_credits(
  p_customer_id UUID,
  p_credits_to_add INT,
  p_period_start TIMESTAMPTZ,
  p_period_end TIMESTAMPTZ,
  p_reference_type TEXT DEFAULT NULL,
  p_reference_id TEXT DEFAULT NULL
)
RETURNS TABLE(success BOOLEAN, balance INT, message TEXT) AS $$
DECLARE
  v_new_balance INT;
  v_already_processed BOOLEAN;
BEGIN
  -- Idempotency check: if reference_id is provided, check for existing transaction
  IF p_reference_id IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM ninja.credit_transactions ct
      WHERE ct.reference_type = p_reference_type
        AND ct.reference_id = p_reference_id
    ) INTO v_already_processed;

    IF v_already_processed THEN
      -- Return current balance without modifying anything
      SELECT cb.balance INTO v_new_balance
      FROM ninja.credit_balances cb
      WHERE cb.customer_id = p_customer_id;

      RETURN QUERY SELECT true, COALESCE(v_new_balance, 0), 'Already processed (idempotent)';
      RETURN;
    END IF;
  END IF;

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

  -- Log the transaction with reference for idempotency
  INSERT INTO ninja.credit_transactions (
    customer_id, amount, balance_after, type, reference_type, reference_id, description
  ) VALUES (
    p_customer_id, 
    p_credits_to_add, 
    v_new_balance, 
    'subscription_renewal', 
    p_reference_type, 
    p_reference_id, 
    format('Monthly renewal: %s credits', p_credits_to_add)
  );

  RETURN QUERY SELECT true, v_new_balance, 'Period credits reset successfully';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-grant execute permission (required after CREATE OR REPLACE with new signature)
GRANT EXECUTE ON FUNCTION ninja.reset_period_credits(UUID, INT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) 
  TO service_role;


-- 2. Update handle_new_user to guard against duplicate welcome transactions
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

  -- Log initial credit grant (with guard to prevent duplicates)
  INSERT INTO ninja.credit_transactions (
    customer_id, amount, balance_after, type, reference_type, reference_id, description
  ) 
  SELECT NEW.id, 100, 100, 'purchase', 'welcome_bonus', NEW.id::text, 'Welcome bonus: 100 free credits'
  WHERE NOT EXISTS (
    SELECT 1 FROM ninja.credit_transactions ct
    WHERE ct.customer_id = NEW.id
      AND ct.reference_type = 'welcome_bonus'
  );

  RETURN NEW;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════════
-- 3. Set Stripe Price IDs on plans
-- ═══════════════════════════════════════════════════════════════════════

UPDATE ninja.plans SET stripe_price_id = 'price_1SzMC63Wq9iEK8SwNGnZ05FQ' WHERE id = 'starter';
UPDATE ninja.plans SET stripe_price_id = 'price_1SzMC83Wq9iEK8Sw6gecY5qC' WHERE id = 'growth';
UPDATE ninja.plans SET stripe_price_id = 'price_1SzMC93Wq9iEK8Swpuj3jd8C' WHERE id = 'scale';


-- ═══════════════════════════════════════════════════════════════════════
-- 4. Backfill existing users with free subscription + credit balance
--    (handle_new_user trigger only fires for NEW users)
-- ═══════════════════════════════════════════════════════════════════════

-- Give every existing user a free subscription (skip if already has one)
INSERT INTO ninja.subscriptions (customer_id, plan_id, status)
SELECT id, 'free', 'active'
FROM auth.users
WHERE id NOT IN (SELECT customer_id FROM ninja.subscriptions)
ON CONFLICT DO NOTHING;

-- Give every existing user 100 free credits (skip if already has balance)
INSERT INTO ninja.credit_balances (customer_id, balance)
SELECT id, 100
FROM auth.users
WHERE id NOT IN (SELECT customer_id FROM ninja.credit_balances)
ON CONFLICT DO NOTHING;

-- Log welcome bonus for backfilled users (skip if already logged)
INSERT INTO ninja.credit_transactions (customer_id, amount, balance_after, type, reference_type, reference_id, description)
SELECT id, 100, 100, 'purchase', 'welcome_bonus', id::text, 'Welcome bonus: 100 free credits'
FROM auth.users
WHERE id NOT IN (
  SELECT customer_id FROM ninja.credit_transactions WHERE reference_type = 'welcome_bonus'
);
