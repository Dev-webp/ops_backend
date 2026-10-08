-- MIGRATION 002 — Document 5-state status
ALTER TABLE case_documents
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'UPLOADED',
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

UPDATE case_documents
SET status = CASE WHEN is_verified THEN 'VERIFIED' ELSE 'UPLOADED' END;

DELETE FROM case_documents a
USING case_documents b
WHERE a.case_id = b.case_id
  AND a.doc_type = b.doc_type
  AND a.id < b.id;

ALTER TABLE case_documents
  ADD CONSTRAINT uq_case_documents_case_type UNIQUE (case_id, doc_type);

ALTER TABLE case_documents DROP COLUMN IF EXISTS is_verified;