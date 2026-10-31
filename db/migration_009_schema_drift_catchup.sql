-- =====================================================================
-- MIGRATION 009 — Schema drift catch-up
--
-- The running code already uses the objects below, but no SQL file in this
-- repository created them (they were added to the live database by hand).
-- A database built from schema.sql + migrations 001-008 therefore could not
-- log anyone in. This file records them so a fresh database matches the code.
--
-- SAFE FOR AN EXISTING DATABASE:
--   * everything is CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS, so
--     objects that already exist are left exactly as they are;
--   * no data is read, changed or deleted;
--   * runs in one transaction, so it applies completely or not at all.
--
-- Column definitions were reconstructed from how routes/*.js read and write
-- them. If your live tables differ, the live definitions win (IF NOT EXISTS)
-- — compare them with `\d table_name` in psql afterwards.
--
-- Run (after taking a backup) against the OPS database only:
--   psql "$OPS_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migration_009_schema_drift_catchup.sql
--
-- Roll back: db/rollback/migration_009_down.sql
-- =====================================================================

BEGIN;

-- Refuse to run in the HRMS database by mistake.
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

-- One row per work profile an employee holds (an employee can hold several;
-- employees.work_profile is only the primary one).
CREATE TABLE IF NOT EXISTS employee_work_profiles (
  employee_id  UUID        NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_profile VARCHAR(50) NOT NULL,
  PRIMARY KEY (employee_id, work_profile)
);

CREATE INDEX IF NOT EXISTS idx_employee_work_profiles_employee
  ON employee_work_profiles (employee_id);

CREATE TABLE IF NOT EXISTS case_financial_documentation (
  id                    BIGSERIAL PRIMARY KEY,
  case_id               BIGINT UNIQUE NOT NULL REFERENCES case_assignments(id) ON DELETE CASCADE,
  financial_institution VARCHAR(250),
  funds_amount          NUMERIC(14,2),
  currency              VARCHAR(10)  DEFAULT 'INR',
  document_type         VARCHAR(100),
  document_date         DATE,
  verification_status   VARCHAR(30)  DEFAULT 'PENDING',
  notes                 TEXT,
  created_at            TIMESTAMPTZ  DEFAULT now(),
  updated_at            TIMESTAMPTZ  DEFAULT now()
);

CREATE TABLE IF NOT EXISTS case_embassy_slot (
  id                 BIGSERIAL PRIMARY KEY,
  case_id            BIGINT UNIQUE NOT NULL REFERENCES case_assignments(id) ON DELETE CASCADE,
  embassy_vfs_center VARCHAR(250),
  appointment_date   DATE,
  appointment_time   TIME,
  location           VARCHAR(250),
  reference_number   VARCHAR(100),
  appointment_status VARCHAR(30) DEFAULT 'PENDING',
  notes              TEXT,
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now()
);

-- Name of the Invoice-side person who pushed the lead (routes/leads.js).
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS sent_to_ops_by_name VARCHAR(150);

-- schema.sql declares employees.phone NOT NULL, but nothing in the API, the
-- scripts or the UI ever supplies an employee phone number, so creating any
-- employee fails on a database built from this repository. Relaxing the
-- constraint matches how the code behaves; it removes no data and is a no-op
-- if the live column is already nullable.
ALTER TABLE employees
  ALTER COLUMN phone DROP NOT NULL;

COMMIT;
