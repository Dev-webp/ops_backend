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
  employees_without_current_profile INT;
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

  -- Verify that employees have their current work_profile in employee_work_profiles
  SELECT COUNT(*) INTO employees_without_current_profile
  FROM employees e
  WHERE e.work_profile IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM employee_work_profiles ewp
      WHERE ewp.employee_id = e.id
        AND ewp.work_profile = e.work_profile
    );

  RAISE NOTICE '=== SSO DATABASE FIXES VERIFICATION ===';
  RAISE NOTICE 'Total employees with work_profile: %', total_employees;
  RAISE NOTICE 'Employees with work_profiles records: %', employees_with_profiles;
  RAISE NOTICE 'Employees without work_profiles records: %', employees_without_profiles;
  RAISE NOTICE 'Employees without current work_profile in work_profiles: %', employees_without_current_profile;

  IF employees_without_profiles > 0 THEN
    RAISE WARNING 'Migration incomplete: % employees still lack work_profiles records', employees_without_profiles;
  ELSIF employees_without_current_profile > 0 THEN
    RAISE WARNING 'Migration incomplete: % employees lack their current work_profile in work_profiles table', employees_without_current_profile;
  ELSE
    RAISE NOTICE 'All employees now have work_profiles records matching their current work_profile';
  END IF;
END $$;

-- ============================================
-- 2. Change ops_sso_used_tokens.jti from UUID to TEXT
-- ============================================
-- HRMS SSO tokens use string jti (randomUUID() returns string)
-- OPS table must use TEXT to match, not UUID

-- Check if jti is still UUID (if already TEXT, skip)
DO $$
DECLARE
  pk_constraint_name TEXT;
  fk_count INT;
  other_dep_count INT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ops_sso_used_tokens'
      AND column_name = 'jti'
      AND data_type = 'uuid'
  ) THEN
    RAISE NOTICE 'Converting jti from UUID to TEXT...';

    -- Find the primary key constraint name
    SELECT conname INTO pk_constraint_name
    FROM pg_constraint
    WHERE conrelid = 'public.ops_sso_used_tokens'::regclass
      AND contype = 'p'
      AND conkey = (
        SELECT attnum
        FROM pg_attribute
        WHERE attrelid = 'public.ops_sso_used_tokens'::regclass
          AND attname = 'jti'
      );

    IF pk_constraint_name IS NULL THEN
      RAISE EXCEPTION 'No primary key found on jti column. Aborting conversion.';
    END IF;

    RAISE NOTICE 'Found primary key constraint: %', pk_constraint_name;

    -- Check for foreign key dependencies
    SELECT COUNT(*) INTO fk_count
    FROM pg_constraint
    WHERE confrelid = 'public.ops_sso_used_tokens'::regclass;

    IF fk_count > 0 THEN
      RAISE EXCEPTION 'Cannot convert: % foreign key(s) depend on ops_sso_used_tokens. Manual resolution required.', fk_count;
    END IF;

    -- Check for other dependencies (indexes, views, etc.)
    SELECT COUNT(*) INTO other_dep_count
    FROM pg_depend
    WHERE refobjid = 'public.ops_sso_used_tokens'::regclass
      AND deptype = 'i'; -- INTERNAL dependencies

    IF other_dep_count > 0 THEN
      RAISE WARNING 'Found % internal dependency(ies). Review may be required.', other_dep_count;
    END IF;

    -- Drop primary key constraint
    EXECUTE format('ALTER TABLE public.ops_sso_used_tokens DROP CONSTRAINT %I', pk_constraint_name);

    -- Change column type from UUID to TEXT
    ALTER TABLE public.ops_sso_used_tokens ALTER COLUMN jti TYPE TEXT USING jti::TEXT;

    -- Recreate primary key
    ALTER TABLE public.ops_sso_used_tokens ADD PRIMARY KEY (jti);

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
    WHERE table_schema = 'public'
      AND table_name = 'ops_sso_used_tokens'
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
-- IMPORTANT: Rollback should be performed carefully and preferably in a transaction.
-- The work_profiles backfill cannot be reliably rolled back automatically without
-- tracking which records were inserted by this migration. Manual review is recommended.

-- To rollback this migration:

-- 1. Rollback work_profiles backfill (MANUAL REVIEW REQUIRED)
-- WARNING: This query will delete any work_profiles that match the employee's current work_profile.
-- Review the data before executing to ensure you don't delete manually added records.
-- BEGIN;
-- DELETE FROM employee_work_profiles
-- WHERE (employee_id, work_profile) IN (
--   SELECT e.id, e.work_profile
--   FROM employees e
--   WHERE e.work_profile IS NOT NULL
-- );
-- -- Review the count before committing
-- ROLLBACK; -- or COMMIT if satisfied
-- END;

-- 2. Rollback jti type change (NOT RECOMMENDED - breaks SSO)
-- WARNING: This will break SSO integration with HRMS. Only do this if absolutely necessary.
-- The constraint name may vary. Find it first:
-- SELECT conname FROM pg_constraint
-- WHERE conrelid = 'public.ops_sso_used_tokens'::regclass AND contype = 'p';
-- BEGIN;
-- ALTER TABLE public.ops_sso_used_tokens DROP CONSTRAINT ops_sso_used_tokens_pkey; -- replace with actual constraint name
-- ALTER TABLE public.ops_sso_used_tokens ALTER COLUMN jti TYPE UUID USING jti::UUID;
-- ALTER TABLE public.ops_sso_used_tokens ADD PRIMARY KEY (jti);
-- COMMIT;
