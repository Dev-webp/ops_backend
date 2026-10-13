-- ============================================================
-- VJC OPS PORTAL
-- Migration 010 - Report unresolved employees requiring HRMS mapping
-- ============================================================
-- Purpose: Identify employees without employee_id values and report
-- them for manual HRMS-to-OPS identity mapping. This migration does NOT
-- assign employee_id values automatically - that requires explicit approval
-- and verified HRMS identity mappings.
--
-- SAFETY NOTES:
-- - READ ONLY - does not modify any data
-- - Requires manual approval and HRMS mapping before assigning employee_id
-- - Existing employee_id values are preserved unchanged
-- - No destructive operations
-- ============================================================

-- Report employees without employee_id
DO $$
BEGIN
  RAISE NOTICE '=== MIGRATION 010: UNRESOLVED EMPLOYEES REPORT ===';
  RAISE NOTICE '';
  RAISE NOTICE 'This migration is READ ONLY. It does not assign employee_id values.';
  RAISE NOTICE 'Manual HRMS-to-OPS identity mapping is required before SSO integration.';
  RAISE NOTICE '';
END $$;

-- Display summary
SELECT
  'EMPLOYEES REQUIRING HRMS IDENTITY MAPPING' as report_title;

SELECT
  COUNT(*) as total_employees_without_id
FROM employees
WHERE employee_id IS NULL;

-- Display detailed list of employees needing employee_id
SELECT
  'UNRESOLVED EMPLOYEES (need employee_id from HRMS):' as section_title;

SELECT
  id as uuid,
  name,
  email,
  role,
  work_profile,
  is_active,
  created_at
FROM employees
WHERE employee_id IS NULL
ORDER BY created_at;

-- Display existing employee_id values for reference
SELECT
  'EXISTING EMPLOYEE_ID VALUES (for reference):' as section_title;

SELECT
  id as uuid,
  name,
  email,
  employee_id,
  work_profile
FROM employees
WHERE employee_id IS NOT NULL
ORDER BY employee_id;

-- Display employee_id format pattern
SELECT
  'EMPLOYEE_ID FORMAT PATTERN:' as section_title;

SELECT
  employee_id,
  SUBSTRING(employee_id FROM 1 FOR 8) as prefix,
  SUBSTRING(employee_id FROM 12 FOR 4) as number
FROM employees
WHERE employee_id IS NOT NULL
ORDER BY employee_id;

-- Check for duplicate or invalid formats
SELECT
  'DATA QUALITY CHECKS:' as section_title;

-- Check for potential duplicates (should not happen due to unique constraint)
SELECT
  'Duplicate employee_id check:' as check_type,
  COUNT(*) as count,
  CASE WHEN COUNT(*) > 0 THEN 'DUPLICATES FOUND' ELSE 'NO DUPLICATES' END as status
FROM (
  SELECT employee_id, COUNT(*)
  FROM employees
  WHERE employee_id IS NOT NULL
  GROUP BY employee_id
  HAVING COUNT(*) > 1
) dupes;

-- Check for format consistency
SELECT
  'Format consistency check (VJC-1009-XXXX):' as check_type,
  COUNT(*) as count,
  CASE WHEN COUNT(*) = 0 THEN 'ALL MATCH EXPECTED FORMAT' ELSE 'FORMAT INCONSISTENCIES FOUND' END as status
FROM employees
WHERE employee_id IS NOT NULL
  AND employee_id !~ '^VJC-1009-[0-9]{4}$';

-- HRMS MAPPING REQUIREMENTS
SELECT
  'ACTION REQUIRED:' as action_title;

SELECT
  '1. Obtain HRMS employee_code for each unresolved employee above' as step_1,
  '2. Verify HRMS department equals "Process Team" (case-insensitive)' as step_2,
  '3. Verify HRMS ops_access is true' as step_3,
  '4. Create mapping table or update employee_id manually after approval' as step_4,
  '5. Format: VJC-1009-XXXX (matches existing pattern)' as step_5;

-- IMPORTANT NOTES
SELECT
  'CRITICAL NOTES:' as notes_title;

SELECT
  'DO NOT auto-generate employee_id values' as note_1,
  'DO NOT guess or invent employee codes' as note_2,
  'Each employee_id must come from verified HRMS data' as note_3,
  'Email matching alone is insufficient for security' as note_4,
  'Both email AND employee_code must match for SSO' as note_5;

-- NEXT STEPS
SELECT
  'NEXT STEPS AFTER MAPPING:' as next_steps;

SELECT
  '1. Share this report with HRMS team' as step_1,
  '2. Obtain verified employee_code mappings' as step_2,
  '3. Create Migration 010b to update employee_id values' as step_3,
  '4. Execute Migration 010b after explicit approval' as step_4,
  '5. Verify mappings in staging before production' as step_5;
