-- =====================================================================
-- VJC OPS PORTAL — PostgreSQL Schema
-- Run this in pgAdmin's Query Tool (or via psql) against your database.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- for gen_random_uuid()

DROP TABLE IF EXISTS case_activity CASCADE;
DROP TABLE IF EXISTS case_assignments CASCADE;
DROP TABLE IF EXISTS quality_audits CASCADE;
DROP TABLE IF EXISTS agreements CASCADE;
DROP TABLE IF EXISTS leads CASCADE;
DROP TABLE IF EXISTS employees CASCADE;
DROP TABLE IF EXISTS branches CASCADE;
DROP TYPE IF EXISTS user_role CASCADE;
DROP TYPE IF EXISTS lead_status CASCADE;
DROP TYPE IF EXISTS audit_status CASCADE;

-- 1. Branches
CREATE TABLE branches (
  id SERIAL PRIMARY KEY,
  branch_name VARCHAR(100) NOT NULL,
  city VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Roles & Employees
CREATE TYPE user_role AS ENUM (
  'MD', 'OPS_MANAGER', 'AUDITOR', 'CASE_OFFICER', 'COUNSELOR'
);

CREATE TABLE employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id INT REFERENCES branches(id),
  name VARCHAR(150) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role user_role NOT NULL,
  designation VARCHAR(100) DEFAULT 'Employee',
  phone VARCHAR(20) NOT NULL,
  specialty VARCHAR(100),          -- e.g. 'UK Specialist', 'USA Specialist' (for case officers)
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Leads (simplified — Counselor stage; feeds the Audit/Ops pipeline)
CREATE TYPE lead_status AS ENUM (
  'PENDING_INVOICE_REVIEW', -- came from Invoice Portal, counselor hasn't confirmed yet
  'AGREEMENT_SIGNED',   -- ready for Quality Audit
  'AUDIT_PENDING',      -- audit in progress
  'AUDIT_FAILED',       -- sent back to counselor
  'AUDIT_APPROVED',     -- passed, ready for Ops assignment
  'CASE_ASSIGNED',      -- handed to a Case Officer
  'CASE_FILED'          -- fully complete (visa outcome resolved)
);

CREATE TABLE leads (
  id BIGSERIAL PRIMARY KEY,
  branch_id INT REFERENCES branches(id),
  counselor_id UUID REFERENCES employees(id),
  student_name VARCHAR(150) NOT NULL,
  email VARCHAR(150) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  target_country VARCHAR(100) NOT NULL,
  visa_category VARCHAR(50) NOT NULL,
  package_amount NUMERIC(10,2) DEFAULT 0,
  current_status lead_status DEFAULT 'AGREEMENT_SIGNED',
  -- Invoice Portal integration (source = 'MANUAL' or 'FROM_INVOICE')
  source VARCHAR(20) DEFAULT 'MANUAL',
  invoice_number VARCHAR(50),
  total_amount NUMERIC(12,2),
  paid_amount NUMERIC(12,2),
  outstanding_amount NUMERIC(12,2),
  payment_status VARCHAR(30),
  agreement_pdf_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Agreements (stub — a real agreement must exist before audit)
CREATE TABLE agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id BIGINT REFERENCES leads(id),
  is_signed BOOLEAN DEFAULT true,
  signed_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Quality Audit
CREATE TYPE audit_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE quality_audits (
  id BIGSERIAL PRIMARY KEY,
  lead_id BIGINT REFERENCES leads(id),
  auditor_id UUID REFERENCES employees(id),
  fees_match_agreement BOOLEAN DEFAULT true,
  no_unauthorized_promises BOOLEAN DEFAULT true,
  student_understands_embassy_discretion BOOLEAN DEFAULT true,
  score INT CHECK (score BETWEEN 1 AND 10),
  audio_url TEXT,
  auditor_remarks TEXT,
  status audit_status DEFAULT 'PENDING',
  audited_at TIMESTAMPTZ DEFAULT now()
);

-- 6. Case Filing Ops — 9-stage Kanban
CREATE TABLE case_assignments (
  id BIGSERIAL PRIMARY KEY,
  lead_id BIGINT UNIQUE REFERENCES leads(id),
  case_officer_id UUID REFERENCES employees(id),
  target_university VARCHAR(250),
  intake_semester VARCHAR(50),
  visa_submission_date DATE,
  kanban_stage VARCHAR(60) DEFAULT 'CHECKLIST_SENT',
  visa_status VARCHAR(30) DEFAULT 'IN_PROGRESS', -- IN_PROGRESS, APPROVED, REJECTED
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE case_activity (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT REFERENCES case_assignments(id),
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 6b. Audit Correction history — what the Counselor changed before resubmitting
-- a rejected lead back to Quality Audit (flow chart "Correction" step).
CREATE TABLE audit_corrections (
  id BIGSERIAL PRIMARY KEY,
  lead_id BIGINT REFERENCES leads(id),
  counselor_id UUID REFERENCES employees(id),
  correction_details TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 7. Document Repository — student documents per case (spec section 3.6)
-- 7 required categories: PASSPORT, TRANSCRIPTS, IELTS_PTE, BANK_LETTER,
-- CAS_I20, PHOTO, OFFER_LETTER. Case Officer uploads; only Ops Manager / MD
-- can mark a document as verified.
CREATE TABLE case_documents (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT REFERENCES case_assignments(id) ON DELETE CASCADE,
  doc_type VARCHAR(50) NOT NULL,
  file_url TEXT NOT NULL,
  original_filename VARCHAR(255),
  uploaded_by UUID REFERENCES employees(id),
  status VARCHAR(20) NOT NULL DEFAULT 'UPLOADED',
  rejection_reason TEXT,
  verified_by UUID REFERENCES employees(id),
  verified_at TIMESTAMPTZ,
  uploaded_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (case_id, doc_type)
);

CREATE INDEX idx_leads_status ON leads(current_status);
CREATE INDEX idx_audits_lead ON quality_audits(lead_id);
CREATE INDEX idx_cases_stage ON case_assignments(kanban_stage);
CREATE INDEX idx_case_documents_case ON case_documents(case_id);

-- 8. Structured stage details (flow chart items #3, #4, #7, #8) — one row per
-- case per table (UNIQUE case_id), edited in place as the case progresses
-- rather than a document upload. Case Officer edits their own case;
-- Ops Manager / MD can edit any case.

CREATE TABLE case_university_applications (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT UNIQUE REFERENCES case_assignments(id) ON DELETE CASCADE,
  university VARCHAR(250),
  course VARCHAR(250),
  intake VARCHAR(50),
  application_number VARCHAR(100),
  application_date DATE,
  status VARCHAR(30) DEFAULT 'SUBMITTED', -- SUBMITTED, UNDER_REVIEW, OFFER_RECEIVED, REJECTED
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE case_offers (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT UNIQUE REFERENCES case_assignments(id) ON DELETE CASCADE,
  university VARCHAR(250),
  course VARCHAR(250),
  intake VARCHAR(50),
  offer_date DATE,
  is_conditional BOOLEAN DEFAULT false,
  conditions TEXT,
  offer_status VARCHAR(30) DEFAULT 'RECEIVED', -- RECEIVED, ACCEPTED, DECLINED
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE case_visa_applications (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT UNIQUE REFERENCES case_assignments(id) ON DELETE CASCADE,
  application_number VARCHAR(100),
  submission_date DATE,
  status VARCHAR(30) DEFAULT 'PREPARING', -- PREPARING, SUBMITTED, UNDER_REVIEW, APPROVED, REJECTED
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE case_appointments (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT UNIQUE REFERENCES case_assignments(id) ON DELETE CASCADE,
  appointment_date DATE,
  appointment_time VARCHAR(20),
  location VARCHAR(250),
  booking_reference VARCHAR(100),
  is_rescheduled BOOLEAN DEFAULT false,
  biometrics_date DATE,
  biometrics_completed BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 9. Notifications — desktop popup + bell icon (e.g. "case assigned to you")
CREATE TABLE notifications (
  id BIGSERIAL PRIMARY KEY,
  employee_id UUID REFERENCES employees(id),
  message TEXT NOT NULL,
  link VARCHAR(255),
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_notifications_employee ON notifications(employee_id, is_read);