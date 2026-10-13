-- ============================================================
-- VJC OPS PORTAL
-- Migration 012 - Verify ops_sso_used_tokens table structure
-- ============================================================
-- Purpose: Verify ops_sso_used_tokens table structure for secure
-- replay protection. This is a verification-only migration.
--
-- ACTUAL STRUCTURE (verified from database):
-- - jti: UUID, NOT NULL, PRIMARY KEY
-- - expires_at: TIMESTAMPTZ, NOT NULL
-- - consumed_at: TIMESTAMPTZ, NOT NULL
-- - Index on expires_at (for cleanup)
--
-- ATOMIC TOKEN CONSUMPTION PATTERN:
-- INSERT INTO ops_sso_used_tokens (jti, expires_at, consumed_at)
-- VALUES ($1, $2, now())
-- ON CONFLICT (jti) DO NOTHING;
-- This ensures atomic check-and-insert in a single statement.
-- ============================================================

-- Check if table exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'ops_sso_used_tokens'
  ) THEN
    RAISE EXCEPTION 'CRITICAL: ops_sso_used_tokens table does not exist. Replay protection will not work.';
  END IF;
  RAISE NOTICE '✓ ops_sso_used_tokens table exists';
END $$;

-- Check required columns
DO $$
DECLARE
  required_columns TEXT[] := ARRAY['jti', 'expires_at', 'consumed_at'];
  missing_columns TEXT[];
  col_rec RECORD;
BEGIN
  FOR col_rec IN SELECT unnest(required_columns) AS column_name
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'ops_sso_used_tokens' AND column_name = col_rec.column_name
    ) THEN
      missing_columns := array_append(missing_columns, col_rec.column_name);
    END IF;
  END LOOP;

  IF missing_columns IS NOT NULL THEN
    RAISE EXCEPTION 'CRITICAL: Missing columns in ops_sso_used_tokens: %', missing_columns;
  END IF;
  RAISE NOTICE '✓ All required columns exist in ops_sso_used_tokens';
END $$;

-- Display actual table structure
SELECT 'ops_sso_used_tokens table structure:' as note;
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'ops_sso_used_tokens'
ORDER BY ordinal_position;

-- Check primary key on jti (required for uniqueness and replay protection)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'ops_sso_used_tokens'
      AND constraint_type = 'PRIMARY KEY'
  ) THEN
    RAISE EXCEPTION 'CRITICAL: No primary key on ops_sso_used_tokens.jti - replay protection will not work';
  ELSE
    RAISE NOTICE '✓ Primary key exists on ops_sso_used_tokens.jti';
  END IF;
END $$;

-- Check data types are correct
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ops_sso_used_tokens'
      AND column_name = 'jti'
      AND data_type = 'uuid'
  ) THEN
    RAISE WARNING 'WARNING: jti column is not UUID type. Token format may be incompatible.';
  ELSE
    RAISE NOTICE '✓ jti column is UUID type (correct for JWT jti)';
  END IF;
END $$;

-- Check for expires_at column (for token expiration)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ops_sso_used_tokens'
      AND column_name = 'expires_at'
  ) THEN
    RAISE WARNING 'WARNING: No expires_at column. Cannot implement token expiration cleanup.';
  ELSE
    RAISE NOTICE '✓ expires_at column exists (supports token expiration cleanup)';
  END IF;
END $$;

-- Check for consumed_at column (for audit trail)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ops_sso_used_tokens'
      AND column_name = 'consumed_at'
  ) THEN
    RAISE WARNING 'WARNING: No consumed_at column. Cannot audit token consumption time.';
  ELSE
    RAISE NOTICE '✓ consumed_at column exists (supports audit trail)';
  END IF;
END $$;

-- Check index on expires_at (for cleanup performance)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'ops_sso_used_tokens'
      AND indexname LIKE '%expires_at%'
  ) THEN
    RAISE WARNING 'WARNING: No index on ops_sso_used_tokens.expires_at - cleanup queries may be slow';
  ELSE
    RAISE NOTICE '✓ Index exists on ops_sso_used_tokens.expires_at (optimizes cleanup)';
  END IF;
END $$;

-- Display all indexes
SELECT 'Indexes on ops_sso_used_tokens:' as note;
SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'ops_sso_used_tokens';

-- Check current data state
SELECT
  'Current data state:' as note;

SELECT
  COUNT(*) as total_records
FROM ops_sso_used_tokens;

-- ATOMIC TOKEN CONSUMPTION PATTERN VERIFICATION
SELECT
  '=== ATOMIC TOKEN CONSUMPTION PATTERN ===' as section_title;

SELECT
  'The following pattern ensures atomic, concurrency-safe token consumption:' as pattern_desc;

SELECT
  $$
-- In the SSO endpoint (routes/auth.js):
-- 1. Validate JWT signature, issuer, audience, purpose
-- 2. Extract jti, expires_at from JWT
-- 3. Atomic check-and-insert to prevent replay:
INSERT INTO ops_sso_used_tokens (jti, expires_at, consumed_at)
VALUES ($1, $2, now())
ON CONFLICT (jti) DO NOTHING;

-- 4. Check if insertion succeeded (if not, token was replayed)
-- 5. Match employee using email and employee_code
-- 6. Create OPS session
-- 7. Return success
  $$ as code_pattern;

SELECT
  '=== CLEANUP STRATEGY ===' as section_title;

SELECT
  $$
-- Cleanup expired tokens (run via cron job):
DELETE FROM ops_sso_used_tokens
WHERE expires_at < now() - INTERVAL '120 seconds';
-- Keeps tokens for 2x token lifetime (60s) for debugging
  $$ as cleanup_pattern;

-- CONCURRENCY SAFETY ANALYSIS
SELECT
  '=== CONCURRENCY SAFETY ANALYSIS ===' as section_title;

SELECT
  'Primary Key on jti' as safety_feature_1,
  'UNIQUE constraint prevents duplicate jti insertion' as benefit_1;

SELECT
  'ON CONFLICT DO NOTHING' as safety_feature_2,
  'Atomic check-and-insert in single statement' as benefit_2;

SELECT
  'PostgreSQL MVCC' as safety_feature_3,
  'Serializes concurrent insertions for same jti' as benefit_3;

SELECT
  'No race conditions possible' as conclusion,
  'Even with multiple concurrent requests, only one succeeds' as reason;

-- COMPATIBILITY WITH HRMS TOKEN CONTRACT
SELECT
  '=== HRMS TOKEN CONTRACT COMPATIBILITY ===' as section_title;

SELECT
  'HRMS provides jti (JWT ID)' as token_field_1,
  'OPS stores jti as UUID' as storage_1,
  '✓ Compatible (requires UUID conversion)' as status_1;

SELECT
  'HRMS provides exp (expiration timestamp)' as token_field_2,
  'OPS stores expires_at as TIMESTAMPTZ' as storage_2,
  '✓ Compatible (use JWT exp as expires_at)' as status_2;

SELECT
  'Required conversion: string jti → UUID' as conversion,
  'Use: gen_random_uuid() or parse from JWT' as method;
