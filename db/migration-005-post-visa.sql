-- MIGRATION 005 — Post Visa Workflow

CREATE TABLE IF NOT EXISTS case_pre_departure (
    id BIGSERIAL PRIMARY KEY,
    case_id BIGINT UNIQUE NOT NULL
        REFERENCES case_assignments(id)
        ON DELETE CASCADE,

    briefing_completed BOOLEAN DEFAULT false,
    documents_confirmed BOOLEAN DEFAULT false,
    accommodation_confirmed BOOLEAN DEFAULT false,
    travel_guidance_completed BOOLEAN DEFAULT false,

    departure_date DATE,
    notes TEXT,

    status VARCHAR(30) DEFAULT 'PENDING',

    completed_by UUID REFERENCES employees(id),
    completed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS case_travel_arrival (
    id BIGSERIAL PRIMARY KEY,
    case_id BIGINT UNIQUE NOT NULL
        REFERENCES case_assignments(id)
        ON DELETE CASCADE,

    flight_number VARCHAR(100),
    departure_date DATE,
    arrival_date DATE,
    departure_city VARCHAR(150),
    arrival_city VARCHAR(150),

    travel_confirmed BOOLEAN DEFAULT false,
    arrival_confirmed BOOLEAN DEFAULT false,

    notes TEXT,

    status VARCHAR(30) DEFAULT 'PENDING',

    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS case_student_onboarding (
    id BIGSERIAL PRIMARY KEY,
    case_id BIGINT UNIQUE NOT NULL
        REFERENCES case_assignments(id)
        ON DELETE CASCADE,

    student_arrived BOOLEAN DEFAULT false,
    university_joined BOOLEAN DEFAULT false,
    accommodation_confirmed BOOLEAN DEFAULT false,
    onboarding_completed BOOLEAN DEFAULT false,

    joining_date DATE,
    notes TEXT,

    status VARCHAR(30) DEFAULT 'PENDING',

    completed_by UUID REFERENCES employees(id),
    completed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS case_closures (
    id BIGSERIAL PRIMARY KEY,
    case_id BIGINT UNIQUE NOT NULL
        REFERENCES case_assignments(id)
        ON DELETE CASCADE,

    closure_status VARCHAR(30) DEFAULT 'READY',
    closure_reason TEXT,
    closed_by UUID REFERENCES employees(id),
    closed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_case_pre_departure_case
ON case_pre_departure(case_id);

CREATE INDEX IF NOT EXISTS idx_case_travel_arrival_case
ON case_travel_arrival(case_id);

CREATE INDEX IF NOT EXISTS idx_case_student_onboarding_case
ON case_student_onboarding(case_id);

CREATE INDEX IF NOT EXISTS idx_case_closures_case
ON case_closures(case_id);