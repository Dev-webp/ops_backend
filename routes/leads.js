const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireRole, requireInternalKey } = require('../middleware/auth');
const router = express.Router();

// List leads, optional ?status=
// Only Counselor / Ops Manager / MD can see the Leads page at all.
// A Counselor only ever sees the leads THEY created — not every counselor's leads.
// Ops Manager / MD (chairman) see every lead, from every counselor.
router.get('/', requireAuth, requireRole('COUNSELOR', 'OPS_MANAGER', 'MD'), async (req, res) => {
  try {
    const { status } = req.query;
    const conditions = [];
    const params = [];

    if (status) {
      params.push(status);
      conditions.push(`l.current_status = $${params.length}`);
    }

if (req.user.work_profile === 'COUNSELOR') {
        params.push(req.user.id);
      conditions.push(`l.counselor_id = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const result = await pool.query(
      `SELECT l.*, e.name AS counselor_name,
              la.score AS last_audit_score, la.auditor_remarks AS last_audit_remarks
       FROM leads l
       LEFT JOIN employees e ON e.id = l.counselor_id
       LEFT JOIN LATERAL (
         SELECT score, auditor_remarks FROM quality_audits
         WHERE lead_id = l.id ORDER BY audited_at DESC LIMIT 1
       ) la ON true
       ${where}
       ORDER BY l.created_at DESC`,
      params
    );
    res.json({ leads: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load leads' });
  }
});

// Create a new lead + auto-stub a signed agreement (Counselor stage, simplified)
router.post('/', requireAuth, requireRole('COUNSELOR', 'OPS_MANAGER', 'MD'), async (req, res) => {
  const { student_name, email, phone, target_country, visa_category, package_amount } = req.body;
  if (!student_name || !phone || !target_country || !visa_category) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const branchRes = await client.query(
      `SELECT branch_id FROM employees WHERE id = $1`, [req.user.id]
    );
    const branchId = branchRes.rows[0]?.branch_id || null;

    const leadRes = await client.query(
      `INSERT INTO leads (branch_id, counselor_id, student_name, email, phone, target_country, visa_category, package_amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [branchId, req.user.id, student_name, email || null, phone, target_country, visa_category, package_amount || 0]
    );
    await client.query(`INSERT INTO agreements (lead_id) VALUES ($1)`, [leadRes.rows[0].id]);
    await client.query('COMMIT');
    res.status(201).json({ lead: leadRes.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Could not create lead' });
  } finally {
    client.release();
  }
});

router.patch('/:leadId/resubmit', requireAuth, requireRole('COUNSELOR'), async (req, res) => {
  const { leadId } = req.params;
  const { correction_details } = req.body;

  if (!correction_details || !correction_details.trim()) {
    return res.status(400).json({
      error: 'Correction details are required'
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Make sure this lead belongs to this counselor and is Audit Failed
    const leadResult = await client.query(
      `SELECT *
       FROM leads
       WHERE id = $1
         AND counselor_id = $2
         AND current_status = 'AUDIT_FAILED'`,
      [leadId, req.user.id]
    );

    if (leadResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: 'Lead not found, not yours, or not in Audit Failed state'
      });
    }

    // Save counselor correction
    await client.query(
      `INSERT INTO audit_corrections
       (lead_id, counselor_id, correction_details)
       VALUES ($1, $2, $3)`,
      [leadId, req.user.id, correction_details.trim()]
    );

    // Send the lead back to Quality Audit
    const updateResult = await client.query(
      `UPDATE leads
       SET current_status = 'AGREEMENT_SIGNED'
       WHERE id = $1
       RETURNING *`,
      [leadId]
    );

    await client.query('COMMIT');

    res.json({
      message: 'Correction saved and lead resubmitted for Quality Audit',
      lead: updateResult.rows[0]
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({
      error: 'Could not save correction and resubmit lead'
    });
  } finally {
    client.release();
  }
});

// ── Invoice Portal integration ─────────────────────────────────────────

// Called by the Invoice Portal's backend when "Send to Ops" is clicked.
// No user is logged in on this request — authenticated with a shared
// internal key instead. Creates a PENDING_INVOICE_REVIEW lead that the
// matched counselor must explicitly confirm before it becomes a real lead.
router.post('/from-invoice', requireInternalKey, async (req, res) => {
  const {
  student_name, phone, email, service_type,
  invoice_number, total_amount, paid_amount, outstanding_amount,
  payment_status, agreement_pdf_url, created_by_email,
  sent_to_ops_by_name,
} = req.body;

  if (!student_name || !phone) {
    return res.status(400).json({ error: 'student_name and phone are required' });
  }

  try {
    // Match the counselor by email; fall back to the default counselor
    // account if no match (e.g. the invoice-side sales person has no
    // Ops Portal login).
    let counselor = null;
    if (created_by_email) {
      const match = await pool.query(
`SELECT id, branch_id FROM employees WHERE email = $1 AND work_profile = 'COUNSELOR'`,
        [created_by_email]
      );
      counselor = match.rows[0] || null;
    }
    if (!counselor) {
  const fallback = await pool.query(
    `SELECT id, branch_id
     FROM employees
     WHERE work_profile = 'COUNSELOR'
       AND is_active = true
     ORDER BY created_at ASC
     LIMIT 1`
  );

  counselor = fallback.rows[0] || null;
}

    const result = await pool.query(
      `INSERT INTO leads
       (branch_id, counselor_id, student_name, email, phone, target_country, visa_category,
 package_amount, current_status, source, invoice_number, total_amount, paid_amount,
 outstanding_amount, payment_status, agreement_pdf_url, sent_to_ops_by_name)
VALUES ($1,$2,$3,$4,$5,$6,'From Invoice',$7,'PENDING_INVOICE_REVIEW','FROM_INVOICE',$8,$9,$10,$11,$12,$13,$14)       RETURNING *`,
      [
        counselor?.branch_id || null, counselor?.id || null, student_name, email || null, phone,
        service_type || 'Unspecified', total_amount || 0,
invoice_number || null, total_amount || null, paid_amount || null,
outstanding_amount || null, payment_status || null, agreement_pdf_url || null,
sent_to_ops_by_name || null,
      ]
    );
    res.status(201).json({ lead: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not create lead from invoice' });
  }
});

// Counselor reviews a PENDING_INVOICE_REVIEW lead and confirms it — from
// here on it behaves exactly like a manually-added lead (auto-stub a signed
// agreement, moves into the Quality Audit queue).
router.patch('/:leadId/confirm-from-invoice', requireAuth, requireRole('COUNSELOR', 'OPS_MANAGER', 'MD'), async (req, res) => {
  const { leadId } = req.params;
  // Counselors can only confirm their OWN leads; MD / Ops Manager can confirm any.
  const profiles = Array.isArray(req.user.work_profiles) && req.user.work_profiles.length
    ? req.user.work_profiles
    : [req.user.work_profile];
  const isMgmt = profiles.includes('MD') || profiles.includes('OPS_MANAGER');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const leadRes = await client.query(
      `UPDATE leads
       SET current_status = 'AGREEMENT_SIGNED'
       WHERE id = $1 AND ($3::boolean OR counselor_id = $2) AND current_status = 'PENDING_INVOICE_REVIEW'
       RETURNING *`,
      [leadId, req.user.id, isMgmt]
    );
    if (leadRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Lead not found, not yours, or not pending review' });
    }
    await client.query(`INSERT INTO agreements (lead_id) VALUES ($1)`, [leadId]);
    await client.query('COMMIT');
    res.json({ lead: leadRes.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Could not confirm lead' });
    } finally {
    client.release();
  }
});

// ── Invoice Portal payment sync ─────────────────────────────────
// Called by the Invoice Portal when a payment is recorded against
// an invoice that has ALREADY been sent to Ops.
// IMPORTANT: This updates the existing FROM_INVOICE lead.
// It does NOT create a new lead.
router.patch('/from-invoice/payment-sync', requireInternalKey, async (req, res) => {
const {
  invoice_number,
  total_amount,
  paid_amount,
  outstanding_amount,
  payment_status,
  agreement_pdf_url,
} = req.body;
  if (!invoice_number) {
    return res.status(400).json({ error: 'invoice_number is required' });
  }

  try {
const result = await pool.query(
  `UPDATE leads
   SET total_amount = $1,
       paid_amount = $2,
       outstanding_amount = $3,
       payment_status = $4,
       agreement_pdf_url = COALESCE($5, agreement_pdf_url)
   WHERE invoice_number = $6
     AND source = 'FROM_INVOICE'
   RETURNING *`,
  [
    total_amount ?? 0,
    paid_amount ?? 0,
    outstanding_amount ?? 0,
    payment_status || 'Pending',
    agreement_pdf_url || null,
    invoice_number,
  ]
);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Invoice lead not found in Ops',
      });
    }

    res.json({
      success: true,
      message: 'Invoice payment details updated in Ops',
      lead: result.rows[0],
    });
  } catch (err) {
    console.error('Invoice payment sync error:', err);
    res.status(500).json({
      error: 'Could not update invoice payment details in Ops',
    });
  }
});

module.exports = router;