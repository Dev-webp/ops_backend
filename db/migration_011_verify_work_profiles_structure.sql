-- ============================================================
-- VJC OPS PORTAL
-- Migration 011 - Verify employee_work_profiles table structure
-- ============================================================
-- Purpose: Verify employee_work_profiles table structure matches
-- authentication code expectations. This is a verification-only migration.
--
-- EXPECTED STRUCTURE (based on authentication code in routes/auth.js):
-- - employee_id: UUID, NOT NULL, REFERENCES employees(id)
-- - work_profile: VARCHAR, NOT NULL
-- - created_at: TIMESTAMPTZ, DEFAULT now()
-- - UNIQUE constraint on (employee_id, work_profile)
-- ============================================================

-- Check if table exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'employee_work_profiles'
  ) THEN
    RAISE EXCEPTION 'CRITICAL: employee_work_profiles table does not exist. Authentication will fail.';
  END IF;
  RAISE NOTICE '✓ employee_work_profiles table exists';
END $$;

-- Check required columns
DO $$
DECLARE
  required_columns TEXT[] := ARRAY['employee_id', 'work_profile', 'created_at'];
  missing_columns TEXT[];
  col_rec RECORD;
BEGIN
  FOR col_rec IN SELECT column_name FROM required_columns
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'employee_work_profiles' AND column_name = col_rec.column_name
    ) THEN
      missing_columns := array_append(missing_columns, col_rec.column_name);
    END IF;
  END LOOP;

  IF missing_columns IS NOT NULL THEN
    RAISE EXCEPTION 'CRITICAL: Missing columns in employee_work_profiles: %', missing_columns;
  END IF;
  RAISE NOTICE '✓ All required columns exist in employee_work_profiles';
END $$;

-- Display actual table structure
SELECT 'employee_work_profiles table structure:' as note;
SELECT
  column_name,
  data_type,
  character_maximum_length,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'employee_work_profiles'
ORDER BY ordinal_position;

-- Check foreign key constraint on employee_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    WHERE tc.table_name = 'employee_work_profiles'
      AND tc.constraint_type = 'FOREIGN KEY'
      AND kcu.column_name = 'employee_id'
  ) THEN
    RAISE WARNING 'WARNING: No foreign key constraint on employee_work_profiles.employee_id → employees.id';
    RAISE WARNING 'This could allow orphaned records if employees are deleted.';
  ELSE
    RAISE NOTICE '✓ Foreign key constraint exists on employee_work_profiles.employee_id → employees.id';
  END IF;
END $$;

-- Check unique constraint (required for preventing duplicate profiles)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    WHERE tc.table_name = 'employee_work_profiles'
      AND tc.constraint_type IN ('UNIQUE', 'PRIMARY KEY')
  ) THEN
    RAISE WARNING 'WARNING: No unique constraint on employee_work_profiles';
    RAISE WARNING 'This could allow duplicate (employee_id, work_profile) combinations.';
  ELSE
    RAISE NOTICE '✓ Unique constraint exists on employee_work_profiles';
  END IF;
END $$;

-- Check current data state
SELECT
  'Current data state:' as note;

SELECT
  COUNT(*) as total_records,
  COUNT(DISTINCT employee_id) as unique_employees
FROM employee_work_profiles;

-- Display employees with multiple work profiles
SELECT
  'Employees with multiple work profiles:' as note;

SELECT
  e.name,
  e.email,
  COUNT(ewp.work_profile) as profile_count,
  ARRAY_AGG(ewp.work_profile ORDER BY ewp.work_profile) as profiles
FROM employee_work_profiles ewp
JOIN employees e ON e.id = ewp.employee_id
GROUP BY e.id, e.name, e.email
HAVING COUNT(ewp.work_profile) > 1
ORDER BY e.name;

-- Display employees without any work_profiles
SELECT
  'Employees without work_profiles (will be fixed by Migration 009):' as note;

SELECT
  e.name,
  e.email,
  e.work_profile as primary_work_profile
FROM employees e
WHERE e.work_profile IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM employee_work_profiles ewp
    WHERE ewp.employee_id = e.id
  )
ORDER BY e.name;

-- Authentication code compatibility check
SELECT
  'Authentication code compatibility check:' as note;

SELECT
  CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'employee_work_profiles' AND column_name = 'employee_id'
    )
    THEN '✓ employee_id column exists (required for JOIN)'
    ELSE '✗ employee_id column missing (authentication will fail)'
  END as check_1,

  CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'employee_work_profiles' AND column_name = 'work_profile'
    )
    THEN '✓ work_profile column exists (required for permissions)'
    ELSE '✗ work_profile column missing (permissions will fail)'
  END as check_2;
