-- Rollback for migration 009.
--
-- WARNING: if the tables below already existed in your live database before
-- migration 009 (they must have, or login would not work), DO NOT run this:
-- migration 009 changed nothing in that case, and this would delete real data.
-- It is only meant for a scratch database that was built from the repository.
--
-- Review every statement; this file is never run automatically.

BEGIN;
DROP TABLE IF EXISTS case_embassy_slot;
DROP TABLE IF EXISTS case_financial_documentation;
DROP TABLE IF EXISTS employee_work_profiles;
ALTER TABLE leads DROP COLUMN IF EXISTS sent_to_ops_by_name;
-- employees.phone was relaxed to nullable. Restoring NOT NULL fails if any employee has no
-- phone, so it is deliberately not reverted here.
COMMIT;
