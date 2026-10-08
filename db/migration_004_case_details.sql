-- MIGRATION 004 — Case Detail tables (flow chart items #3, #4, #7, #8)
CREATE TABLE IF NOT EXISTS case_university_applications (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT UNIQUE REFERENCES case_assignments(id) ON DELETE CASCADE,
  university VARCHAR(250),
  course VARCHAR(250),
  intake VARCHAR(50),
  application_number VARCHAR(100),
  application_date DATE,
  status VARCHAR(30) DEFAULT 'SUBMITTED',
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS case_offers (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT UNIQUE REFERENCES case_assignments(id) ON DELETE CASCADE,
  university VARCHAR(250),
  course VARCHAR(250),
  intake VARCHAR(50),
  offer_date DATE,
  is_conditional BOOLEAN DEFAULT false,
  conditions TEXT,
  offer_status VARCHAR(30) DEFAULT 'RECEIVED',
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS case_visa_applications (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT UNIQUE REFERENCES case_assignments(id) ON DELETE CASCADE,
  application_number VARCHAR(100),
  submission_date DATE,
  status VARCHAR(30) DEFAULT 'PREPARING',
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS case_appointments (
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