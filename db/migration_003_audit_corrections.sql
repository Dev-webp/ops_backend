-- MIGRATION 003 — Audit Correction history table
CREATE TABLE IF NOT EXISTS audit_corrections (
  id BIGSERIAL PRIMARY KEY,
  lead_id BIGINT REFERENCES leads(id),
  counselor_id UUID REFERENCES employees(id),
  correction_details TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);