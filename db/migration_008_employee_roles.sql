-- ============================================================
-- VJC OPS PORTAL
-- Migration 008 - Common Invoice Roles + OPS Work Profile
-- ============================================================

-- Existing technical role values are preserved as work_profile.
CREATE TYPE ops_work_profile AS ENUM (
  'MD',
  'OPS_MANAGER',
  'COUNSELOR',
  'AUDITOR',
  'CASE_OFFICER'
);

-- Add work_profile first.
ALTER TABLE employees
ADD COLUMN IF NOT EXISTS work_profile ops_work_profile;

-- Move existing technical roles into work_profile.
UPDATE employees
SET work_profile = role::text::ops_work_profile
WHERE work_profile IS NULL;

-- Convert role from old OPS enum into normal text.
ALTER TABLE employees
ALTER COLUMN role TYPE VARCHAR(100)
USING role::text;

-- Default common role.
ALTER TABLE employees
ALTER COLUMN role SET DEFAULT 'employee';

-- Map existing OPS technical roles to Invoice-compatible roles.
UPDATE employees
SET role = CASE
  WHEN work_profile = 'MD' THEN 'manager'
  WHEN work_profile = 'OPS_MANAGER' THEN 'manager'
  WHEN work_profile = 'COUNSELOR' THEN 'employee'
  WHEN work_profile = 'AUDITOR' THEN 'mis-executive'
  WHEN work_profile = 'CASE_OFFICER' THEN 'employee'
  ELSE 'employee'
END;

-- Keep designation aligned with the common role where appropriate.
UPDATE employees
SET designation = CASE
  WHEN work_profile = 'MD' THEN 'Manager'
  WHEN work_profile = 'OPS_MANAGER' THEN 'Manager'
  WHEN work_profile = 'AUDITOR' THEN 'MIS Executive'
  ELSE 'Employee'
END
WHERE designation IS NULL
   OR designation = 'Employee';

CREATE INDEX IF NOT EXISTS idx_employees_work_profile
ON employees(work_profile);