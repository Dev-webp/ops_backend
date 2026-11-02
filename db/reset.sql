-- =====================================================================
-- VJC OPS PORTAL — RESET DATA
-- Wipes ALL data from every table but keeps the table structure intact.
-- Run this in pgAdmin's Query Tool whenever you want a clean slate.
-- After running this, run "npm run seed" again from your terminal
-- to repopulate fresh demo data.
-- =====================================================================

-- ---------------------------------------------------------------------
-- SAFETY GUARD. This script ERASES all OPS data.
-- It refuses to run in a database that contains HRMS tables, and it only runs
-- if you deliberately opt in first, in the SAME session, with:
--     SET ops.confirm_destroy = 'yes';
-- (pgAdmin Query Tool: run that line first, then run this file.)
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name IN ('users', 'attendance', 'leave_requests', 'payroll', 'payslip_records')
  ) THEN
    RAISE EXCEPTION 'Refusing to run: this looks like the HRMS database, not the OPS database';
  END IF;
  IF COALESCE(current_setting('ops.confirm_destroy', true), '') <> 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this script %. Run  SET ops.confirm_destroy = ''yes'';  first if you really mean it', 'erases data';
  END IF;
END $$;

TRUNCATE TABLE
  case_activity,
  case_assignments,
  quality_audits,
  agreements,
  leads,
  employees,
  branches
RESTART IDENTITY CASCADE;
