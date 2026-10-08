-- =====================================================================
-- MIGRATION 001 — Document Repository (ops.vjcoverseas.com spec §3.6)
-- Run this ONLY if your database already exists from the earlier
-- schema.sql (i.e. you have real leads/audits/cases data you don't want
-- to lose). This does NOT drop or touch any existing table's data —
-- it only ADDS two new columns and one new table.
--
-- How to run: open pgAdmin's Query Tool on your `vjc_ops` database,
-- paste this whole file, and Execute (F5). Safe to run more than once.
-- =====================================================================

ALTER TABLE case_assignments
  ADD COLUMN IF NOT EXISTS intake_semester VARCHAR(50),
  ADD COLUMN IF NOT EXISTS visa_submission_date DATE;

CREATE TABLE IF NOT EXISTS case_documents (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT REFERENCES case_assignments(id) ON DELETE CASCADE,
  doc_type VARCHAR(50) NOT NULL,
  file_url TEXT NOT NULL,
  original_filename VARCHAR(255),
  uploaded_by UUID REFERENCES employees(id),
  is_verified BOOLEAN DEFAULT false,
  verified_by UUID REFERENCES employees(id),
  verified_at TIMESTAMPTZ,
  uploaded_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_case_documents_case ON case_documents(case_id);
