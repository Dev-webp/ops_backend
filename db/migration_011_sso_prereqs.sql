-- OPS SSO prerequisites. Idempotent. Run on the OPS database only.
-- Note: employee_id column already exists in database, skipping ADD COLUMN
BEGIN;
CREATE TABLE IF NOT EXISTS public.ops_sso_used_tokens (
  jti        text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ops_sso_used_exp ON public.ops_sso_used_tokens (expires_at);
COMMIT;

-- Then set the HRMS employee code on each person who will use OPS, e.g.:
-- UPDATE employees SET employee_id = 'VJC-1009-0007'
--  WHERE LOWER(email) = 'process.immigration@vjcoverseas.com';
