-- =====================================================================
-- VJC OPS PORTAL — RESET DATA
-- Wipes ALL data from every table but keeps the table structure intact.
-- Run this in pgAdmin's Query Tool whenever you want a clean slate.
-- After running this, run "npm run seed" again from your terminal
-- to repopulate fresh demo data.
-- =====================================================================

TRUNCATE TABLE
  case_activity,
  case_assignments,
  quality_audits,
  agreements,
  leads,
  employees,
  branches
RESTART IDENTITY CASCADE;
