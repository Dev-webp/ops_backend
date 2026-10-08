const express = require('express');
const multer = require('multer');
const path = require('path');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// The 7 document categories required per case (matches the flow diagram /
// spec §3.6 "Document Repository"). Badge on the Kanban card shows
// "Documents X/7 verified" against this fixed list.
const DOC_TYPES = [
  'PASSPORT', 'TRANSCRIPTS', 'IELTS_PTE', 'PHOTO', 'OFFER_LETTER', 'CAS_I20',
  'BANK_STATEMENT', 'BANK_LETTER', 'LOAN_DOCUMENT', 'SPONSOR_DOCUMENT', 'INCOME_PROOF',
  'RESUME', 'SOP', 'LOR',
];

const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'uploads', 'case_documents'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.pdf';
    cb(null, `doc_${req.params.caseId}_${req.body.doc_type || 'FILE'}_${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.jpg', '.jpeg', '.png'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('Only PDF, JPG or PNG files are allowed'));
  },
});

// Shared helper: a Case Officer may only touch documents on cases assigned
// to themselves. Ops Manager / MD (chairman) can touch any case's documents.
async function assertCaseAccess(client, caseId, user) {
  const result = await client.query(
    `SELECT case_officer_id FROM case_assignments WHERE id = $1`, [caseId]
  );
  if (result.rows.length === 0) return { ok: false, code: 404, error: 'Case not found' };
  if (user.role === 'CASE_OFFICER' && result.rows[0].case_officer_id !== user.id) {
    return { ok: false, code: 403, error: 'This case is not assigned to you' };
  }
  return { ok: true };
}

// List every document uploaded so far for one case, plus the fixed
// checklist of 7 required types so the UI can show what's still missing.
router.get('/:caseId', requireAuth, requireRole('CASE_OFFICER', 'OPS_MANAGER', 'MD'), async (req, res) => {
  const { caseId } = req.params;
  try {
    const access = await assertCaseAccess(pool, caseId, req.user);
    if (!access.ok) return res.status(access.code).json({ error: access.error });

    const result = await pool.query(
      `SELECT cd.*, u.name AS uploaded_by_name, v.name AS verified_by_name
       FROM case_documents cd
       LEFT JOIN employees u ON u.id = cd.uploaded_by
       LEFT JOIN employees v ON v.id = cd.verified_by
       WHERE cd.case_id = $1
       ORDER BY cd.uploaded_at DESC`,
      [caseId]
    );
    res.json({ docTypes: DOC_TYPES, documents: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load documents' });
  }
});

// Upload one document against a case.
router.post(
  '/:caseId',
  requireAuth,
  requireRole('CASE_OFFICER', 'OPS_MANAGER', 'MD'),
  upload.single('file'),
  async (req, res) => {
       const { caseId } = req.params;
    const { doc_type } = req.body;
    const isAdditional = doc_type === 'ADDITIONAL';
    if (!DOC_TYPES.includes(doc_type) && !isAdditional) {
      return res.status(400).json({ error: 'Invalid doc_type' });
    }
    if (!req.file) return res.status(400).json({ error: 'File is required' });

    try {
      const access = await assertCaseAccess(pool, caseId, req.user);
      if (!access.ok) return res.status(access.code).json({ error: access.error });

            const fileUrl = `/uploads/case_documents/${req.file.filename}`;

      if (isAdditional) {
        const additionalDocType = `ADDITIONAL_${Date.now()}`;
        const result = await pool.query(
          `INSERT INTO case_documents (case_id, doc_type, file_url, original_filename, uploaded_by, status)
           VALUES ($1,$2,$3,$4,$5,'UPLOADED') RETURNING *`,
          [caseId, additionalDocType, fileUrl, req.file.originalname, req.user.id]
        );
        return res.status(201).json({ document: result.rows[0] });
      }

      const result = await pool.query(
        `INSERT INTO case_documents (case_id, doc_type, file_url, original_filename, uploaded_by, status)
         VALUES ($1,$2,$3,$4,$5,'UPLOADED')
         ON CONFLICT (case_id, doc_type) DO UPDATE
           SET file_url = EXCLUDED.file_url,
               original_filename = EXCLUDED.original_filename,
               uploaded_by = EXCLUDED.uploaded_by,
               status = 'UPLOADED',
               rejection_reason = NULL,
               verified_by = NULL,
               verified_at = NULL,
               uploaded_at = now()
         RETURNING *`,
        [caseId, doc_type, fileUrl, req.file.originalname, req.user.id]
      );
      res.status(201).json({ document: result.rows[0] });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Could not upload document' });
    }
  }
);
// Move a document's review status — Ops Manager / MD only.
router.patch('/doc/:docId/status', requireAuth, requireRole('OPS_MANAGER', 'MD'), async (req, res) => {
  const { docId } = req.params;
  const { status, rejection_reason } = req.body;
  const allowed = ['VERIFIED', 'REJECTED', 'NOT_REQUIRED', 'UPLOADED'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  if (status === 'REJECTED' && !rejection_reason?.trim()) {
    return res.status(400).json({ error: 'A rejection reason is required' });
  }
  try {
    const result = await pool.query(
  `UPDATE case_documents
   SET status = $1::varchar,
       rejection_reason = CASE
         WHEN $1::varchar = 'REJECTED' THEN $2::text
         ELSE NULL::text
       END,
       verified_by = $3,
       verified_at = now()
   WHERE id = $4
   RETURNING *`,
  [status, rejection_reason || null, req.user.id, docId]
);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Document not found' });
    res.json({ document: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not update document' });
  }
});

module.exports = router;
