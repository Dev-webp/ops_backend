-- PENDING APPROVAL — NOT PART OF ANY AUTOMATIC STEP.
--
-- Older versions of the OPS API stored each employee's password in readable
-- form in employees.display_password. The API no longer reads or writes that
-- column, but values written earlier are still in the database.
--
-- This permanently erases them. It changes production data, so run it only
-- once the owner has approved it, after a backup, and after confirming that
-- nobody still depends on seeing those passwords (staff should then be asked
-- to set new ones).
--
--   psql "$OPS_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/pending-approval/010_remove_display_password.sql
--
-- There is no way back: the plaintext values cannot be restored from this file.

BEGIN;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name IN ('users', 'attendance', 'leave_requests', 'payroll', 'payslip_records')
  ) THEN
    RAISE EXCEPTION 'Refusing to run: this looks like the HRMS database, not the OPS database';
  END IF;
END $$;

ALTER TABLE employees DROP COLUMN IF EXISTS display_password;
COMMIT;
