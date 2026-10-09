const express = require('express');
const multer = require('multer');
const path = require('path');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();


const isVercel = Boolean(process.env.VERCEL);

const storage = isVercel
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: path.join(__dirname, '..', 'uploads', 'audits'),
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.mp3';
        cb(null, `audit_${req.params.leadId}_${Date.now()}${ext}`);
      },
    });

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.mp3', '.wav', '.m4a', '.ogg'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files (mp3, wav, m4a, ogg) are allowed'));
    }
  },
});


// Leads waiting for audit — this is a shared work queue (no auditor assigned
// yet), so every Auditor / Ops Manager / MD can see it. Counselors and Case
// Officers have no reason to see this page at all.
router.get('/pending', requireAuth, requireRole('AUDITOR', 'OPS_MANAGER', 'MD'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT l.*, e.name AS counselor_name
       FROM leads l LEFT JOIN employees e ON e.id = l.counselor_id
              WHERE l.current_status = 'AGREEMENT_SIGNED'
       ORDER BY l.created_at ASC`
    );
    res.json({ leads: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load audit queue' });
  }
});

// Full audit history / log
// An Auditor only sees the calls THEY personally conducted.
// Ops Manager / MD (chairman) see every auditor's history.
router.get('/history', requireAuth, requireRole('AUDITOR', 'OPS_MANAGER', 'MD'), async (req, res) => {
  try {
    const conditions = [];
    const params = [];
    if (req.user.role === 'AUDITOR') {
      params.push(req.user.id);
      conditions.push(`qa.auditor_id = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

       const result = await pool.query(
      `SELECT qa.*, l.student_name, l.target_country, l.visa_category,
              l.phone, l.email, l.invoice_number, l.total_amount,
              l.paid_amount, l.outstanding_amount, l.payment_status,
              l.agreement_pdf_url, l.sent_to_ops_by_name,
              ce.name AS counselor_name,
              e.name AS auditor_name
       FROM quality_audits qa
       JOIN leads l ON l.id = qa.lead_id
       LEFT JOIN employees e ON e.id = qa.auditor_id
       LEFT JOIN employees ce ON ce.id = l.counselor_id
       ${where}
       ORDER BY qa.audited_at DESC`,
      params
    );
    res.json({ audits: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load audit history' });
  }
});

// Submit a verification scorecard for a lead
router.post(
  '/:leadId',
  requireAuth,
  requireRole('AUDITOR', 'OPS_MANAGER', 'MD'),
  upload.single('audio'),
  async (req, res) => {
    const { leadId } = req.params;
    const {
      fees_match_agreement,
      no_unauthorized_promises,
      student_understands_embassy_discretion,
      score,
      auditor_remarks,
    } = req.body;

       const numericScore = Number(score);
    if (!numericScore || numericScore < 1 || numericScore > 10) {
      return res.status(400).json({ error: 'Score must be between 1 and 10' });
    }

    const status = numericScore >= 7 ? 'APPROVED' : 'REJECTED';
    if (status === 'REJECTED' && !auditor_remarks?.trim()) {
      return res.status(400).json({ error: 'A rejection reason (remarks) is required when the score is below 7' });
    }
    const audioUrl = req.file ? `/uploads/audits/${req.file.filename}` : null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const leadCheck = await client.query(`SELECT * FROM leads WHERE id = $1`, [leadId]);
      if (leadCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Lead not found' });
      }

      await client.query(
        `INSERT INTO quality_audits
          (lead_id, auditor_id, fees_match_agreement, no_unauthorized_promises,
           student_understands_embassy_discretion, score, audio_url, auditor_remarks, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          leadId, req.user.id,
          fees_match_agreement === 'true' || fees_match_agreement === true,
          no_unauthorized_promises === 'true' || no_unauthorized_promises === true,
          student_understands_embassy_discretion === 'true' || student_understands_embassy_discretion === true,
          numericScore, audioUrl, auditor_remarks || null, status,
        ]
      );

      const newLeadStatus = status === 'APPROVED' ? 'AUDIT_APPROVED' : 'AUDIT_FAILED';
      await client.query(`UPDATE leads SET current_status = $1 WHERE id = $2`, [newLeadStatus, leadId]);

      await client.query('COMMIT');
      res.json({ status, message: status === 'APPROVED' ? 'Audit passed — ready for Ops assignment.' : 'Audit failed — sent back to counselor for correction.' });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error(err);
      res.status(500).json({ error: 'Could not submit audit' });
    } finally {
      client.release();
    }
  }
);

module.exports = router;
