-- MIGRATION 007 — Notifications (bell icon + desktop popup)
CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  employee_id UUID REFERENCES employees(id),
  message TEXT NOT NULL,
  link VARCHAR(255),
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_employee ON notifications(employee_id, is_read);