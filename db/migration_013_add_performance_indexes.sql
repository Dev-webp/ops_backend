-- ============================================================
-- VJC OPS PORTAL
-- Migration 013 - Add performance indexes for frequently queried columns
-- ============================================================
-- Purpose: Add missing indexes for frequently queried columns to improve
-- query performance in dashboard, reports, and data filtering operations.
--
-- EXISTING INDEXES (verified):
-- - leads: idx_leads_status (on current_status)
-- - quality_audits: idx_audits_lead (on lead_id)
-- - case_assignments: idx_cases_stage (on kanban_stage)
--
-- MISSING INDEXES (to be added):
-- - leads.counselor_id (frequently filtered in dashboard)
-- - quality_audits.auditor_id (frequently filtered in dashboard)
-- - case_assignments.case_officer_id (frequently filtered in dashboard)
--
-- SAFETY NOTES:
-- - Uses CREATE INDEX IF NOT EXISTS for idempotency
-- - Partial indexes (WHERE ... IS NOT NULL) minimize storage overhead
-- - No destructive operations
-- - Safe to run multiple times
-- ============================================================

-- Verify column types before creating indexes
DO $$
BEGIN
  -- Verify leads.counselor_id is UUID
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leads' AND column_name = 'counselor_id' AND data_type = 'uuid'
  ) THEN
    RAISE WARNING 'WARNING: leads.counselor_id is not UUID type. Index may not be optimal.';
  ELSE
    RAISE NOTICE '✓ leads.counselor_id is UUID (index will be efficient)';
  END IF;

  -- Verify quality_audits.auditor_id is UUID
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'quality_audits' AND column_name = 'auditor_id' AND data_type = 'uuid'
  ) THEN
    RAISE WARNING 'WARNING: quality_audits.auditor_id is not UUID type. Index may not be optimal.';
  ELSE
    RAISE NOTICE '✓ quality_audits.auditor_id is UUID (index will be efficient)';
  END IF;

  -- Verify case_assignments.case_officer_id is UUID
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'case_assignments' AND column_name = 'case_officer_id' AND data_type = 'uuid'
  ) THEN
    RAISE WARNING 'WARNING: case_assignments.case_officer_id is not UUID type. Index may not be optimal.';
  ELSE
    RAISE NOTICE '✓ case_assignments.case_officer_id is UUID (index will be efficient)';
  END IF;
END $$;

-- Display current indexes before adding new ones
SELECT 'Existing indexes before migration:' as note;
SELECT
  tablename,
  indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('leads', 'quality_audits', 'case_assignments')
ORDER BY tablename, indexname;

-- Add index on leads.counselor_id
-- Frequently filtered in dashboard stats and reports by counselor
-- Partial index to exclude NULL values (unassigned leads)
CREATE INDEX IF NOT EXISTS idx_leads_counselor
ON leads(counselor_id)
WHERE counselor_id IS NOT NULL;

-- Add index on quality_audits.auditor_id
-- Frequently filtered in dashboard stats and reports by auditor
-- Partial index to exclude NULL values (unassigned audits)
CREATE INDEX IF NOT EXISTS idx_audits_auditor
ON quality_audits(auditor_id)
WHERE auditor_id IS NOT NULL;

-- Add index on case_assignments.case_officer_id
-- Frequently filtered in dashboard stats and reports by case officer
-- Partial index to exclude NULL values (unassigned cases)
CREATE INDEX IF NOT EXISTS idx_cases_officer
ON case_assignments(case_officer_id)
WHERE case_officer_id IS NOT NULL;

-- Verify indexes created
DO $$
BEGIN
  RAISE NOTICE '=== MIGRATION 013 VERIFICATION ===';
  RAISE NOTICE 'Performance indexes created/verified:';
  RAISE NOTICE '  - idx_leads_counselor (partial index on leads.counselor_id)';
  RAISE NOTICE '  - idx_audits_auditor (partial index on quality_audits.auditor_id)';
  RAISE NOTICE '  - idx_cases_officer (partial index on case_assignments.case_officer_id)';
END $$;

-- Display all indexes after migration
SELECT 'All indexes after migration:' as note;
SELECT
  tablename,
  indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('leads', 'quality_audits', 'case_assignments')
ORDER BY tablename, indexname;

-- Estimate index size (for planning)
SELECT
  'Index size estimation:' as note;

SELECT
  schemaname,
  tablename,
  indexname,
  pg_size_pretty(pg_relation_size(indexname::regclass)) as size
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN ('idx_leads_counselor', 'idx_audits_auditor', 'idx_cases_officer');

-- ROLLBACK INSTRUCTIONS (if needed):
-- DROP INDEX IF EXISTS idx_leads_counselor;
-- DROP INDEX IF EXISTS idx_audits_auditor;
-- DROP INDEX IF EXISTS idx_cases_officer;
