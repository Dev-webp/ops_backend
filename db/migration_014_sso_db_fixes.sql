-- ============================================================
-- VJC OPS PORTAL
-- Migration 014 - SSO Database Fixes
-- ============================================================
-- Purpose: Apply actual database changes required for SSO integration
-- These changes were made manually during setup and need to be
-- reproducible for production deployment.
--
-- Changes:
-- 1. Backfill employee_work_profiles for employees without any profiles
-- 2. Change ops_sso_used_tokens.jti from UUID to TEXT (matches HRMS)
-- ============================================================

BEGIN;

-- ============================================
-- 1. Backfill employee_work_profiles
-- ============================================
-- Ensure all employees with work_profile have entries in employee_work_profiles
-- This is required for SSO authentication (authentication query LEFT JOINs this table)

INSERT INTO employee_work_profiles (employee_id, work_profile)
SELECT e.id, e.work_profile
FROM employees e
WHERE e.work_profile IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM employee_work_profiles ewp
    WHERE ewp.employee_id = e.id
  )
ON CONFLICT (employee_id, work_profile) DO NOTHING;

-- Verify backfill
DO $$
DECLARE
  total_employees INT;
  employees_with_profiles INT;
  employees_without_profiles INT;
BEGIN
  SELECT COUNT(*) INTO total_employees FROM employees WHERE work_profile IS NOT NULL;
  SELECT COUNT(DISTINCT employee_id) INTO employees_with_profiles FROM employee_work_profiles;

  SELECT COUNT(*) INTO employees_without_profiles
  FROM employees e
  WHERE e.work_profile IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM employee_work_profiles ewp
      WHERE ewp.employee_id = e.id
    );

  RAISE NOTICE '=== SSO DATABASE FIXES VERIFICATION ===';
  RAISE NOTICE 'Total employees with work_profile: %', total_employees;
  RAISE NOTICE 'Employees with work_profiles records: %', employees_with_profiles;
  RAISE NOTICE 'Employees without work_profiles records: %', employees_without_profiles;

  IF employees_without_profiles > 0 THEN
    RAISE WARNING 'Migration incomplete: % employees still lack work_profiles records', employees_without_profiles;
  ELSE
    RAISE NOTICE 'All employees now have work_profiles records';
  END IF;
END $$;

-- ============================================
-- 2. Change ops_sso_used_tokens.jti from UUID to TEXT
-- ============================================
-- HRMS SSO tokens use string jti (randomUUID() returns string)
-- OPS table must use TEXT to match, not UUID

-- Check if jti is still UUID (if already TEXT, skip)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ops_sso_used_tokens'
      AND column_name = 'jti'
      AND data_type = 'uuid'
  ) THEN
    RAISE NOTICE 'Converting jti from UUID to TEXT...';

    -- Drop primary key constraint
    ALTER TABLE ops_sso_used_tokens DROP CONSTRAINT IF EXISTS ops_sso_used_tokens_pkey;

    -- Change column type from UUID to TEXT
    ALTER TABLE ops_sso_used_tokens ALTER COLUMN jti TYPE TEXT USING jti::TEXT;

    -- Recreate primary key
    ALTER TABLE ops_sso_used_tokens ADD PRIMARY KEY (jti);

    RAISE NOTICE '✓ jti converted to TEXT';
  ELSE
    RAISE NOTICE 'jti is already TEXT, skipping conversion';
  END IF;
END $$;

-- Verify jti type
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ops_sso_used_tokens'
      AND column_name = 'jti'
      AND data_type = 'text'
  ) THEN
    RAISE NOTICE '✓ jti is TEXT (correct for HRMS SSO)';
  ELSE
    RAISE WARNING 'WARNING: jti is not TEXT type. SSO may fail.';
  END IF;
END $$;

COMMIT;

-- ============================================================
-- ROLLBACK INSTRUCTIONS (if needed)
-- ============================================================
-- To rollback this migration:

-- 1. Rollback work_profiles backfill
-- DELETE FROM employee_work_profiles
-- WHERE (employee_id, work_profile) IN (
--   SELECT employee_id, work_profile FROM (
--     SELECT e.id as employee_id, e.work_profile
--     FROM employees e
--     WHERE e.work_profile IS NOT NULL
--       AND NOT EXISTS (
--         SELECT 1 FROM employee_work_profiles ewp
--         WHERE ewp.employee_id = e.id
--       )
--   ) backfilled
-- );

-- 2. Rollback jti type change (NOT RECOMMENDED - breaks SSO)
-- ALTER TABLE ops_sso_used_tokens DROP CONSTRAINT ops_sso_used_tokens_pkey;
-- ALTER TABLE ops_sso_used_tokens ALTER COLUMN jti TYPE UUID USING jti::UUID;
-- ALTER TABLE ops_sso_used_tokens ADD PRIMARY KEY (jti);
