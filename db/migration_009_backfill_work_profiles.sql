-- ============================================================
-- VJC OPS PORTAL
-- Migration 009 - Backfill employee_work_profiles for all employees
-- ============================================================
-- Purpose: Ensure all employees have entries in employee_work_profiles table
-- for authentication compatibility. The authentication query LEFT JOINs
-- this table, so it must be populated for all employees.
--
-- SAFETY NOTES:
-- - Preserves all existing employee_work_profiles records
-- - Uses ON CONFLICT DO NOTHING for idempotency
-- - Only inserts records for employees without any work_profiles
-- - Rollback is safe: only deletes records added by this migration
-- ============================================================

-- Create a temporary marker to track records added by this migration
-- This allows safe rollback without affecting pre-existing data
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'migration_009_temp'
  ) THEN
    CREATE TEMP TABLE migration_009_temp (
      employee_id UUID PRIMARY KEY,
      work_profile VARCHAR(50),
      added_at TIMESTAMPTZ DEFAULT now()
    );
  END IF;
END $$;

-- Insert primary work_profile for employees without any work_profiles records
-- Also track which records we add for safe rollback
WITH new_profiles AS (
  INSERT INTO employee_work_profiles (employee_id, work_profile)
  SELECT e.id, e.work_profile
  FROM employees e
  WHERE e.work_profile IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM employee_work_profiles ewp
      WHERE ewp.employee_id = e.id
    )
  RETURNING employee_id, work_profile
)
INSERT INTO migration_009_temp (employee_id, work_profile)
SELECT employee_id, work_profile FROM new_profiles;

-- Verify backfill
DO $$
DECLARE
  total_employees INT;
  employees_with_profiles INT;
  employees_without_profiles INT;
  records_added INT;
BEGIN
  SELECT COUNT(*) INTO total_employees FROM employees WHERE work_profile IS NOT NULL;
  SELECT COUNT(DISTINCT employee_id) INTO employees_with_profiles FROM employee_work_profiles;
  SELECT COUNT(*) INTO records_added FROM migration_009_temp;

  -- Count employees still without work_profiles
  SELECT COUNT(*) INTO employees_without_profiles
  FROM employees e
  WHERE e.work_profile IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM employee_work_profiles ewp
      WHERE ewp.employee_id = e.id
    );

  RAISE NOTICE '=== MIGRATION 009 VERIFICATION ===';
  RAISE NOTICE 'Total employees with work_profile: %', total_employees;
  RAISE NOTICE 'Employees with work_profiles records: %', employees_with_profiles;
  RAISE NOTICE 'Employees without work_profiles records: %', employees_without_profiles;
  RAISE NOTICE 'Records added by this migration: %', records_added;

  IF employees_without_profiles > 0 THEN
    RAISE WARNING 'Migration incomplete: % employees still lack work_profiles records', employees_without_profiles;
  ELSE
    RAISE NOTICE 'All employees now have work_profiles records';
  END IF;

  IF records_added > 0 THEN
    RAISE NOTICE 'Records added (tracked for rollback): %', records_added;
  ELSE
    RAISE NOTICE 'No new records added (already complete)';
  END IF;
END $$;

-- Display added records for review
SELECT 'Records added by this migration:' as note;
SELECT e.name, e.email, m.work_profile
FROM migration_009_temp m
JOIN employees e ON e.id = m.employee_id
ORDER BY e.name;

-- ROLLBACK INSTRUCTIONS (if needed):
-- DELETE FROM employee_work_profiles
-- WHERE (employee_id, work_profile) IN (
--   SELECT employee_id, work_profile FROM migration_009_temp
-- );
