const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const STAGES = [
  'CHECKLIST_SENT', 'DOCUMENT_COLLECTION', 'SOP_LOR_REVIEW',
  'UNIVERSITY_APPLICATION_SUBMITTED', 'OFFER_RECEIVED', 'FINANCIAL_DOCUMENTATION',
  'EMBASSY_SLOT_BOOKED', 'BIOMETRICS_DONE', 'VISA_OUTCOME',
  'PRE_DEPARTURE', 'TRAVEL_ARRIVAL', 'STUDENT_ONBOARDING', 'CASE_CLOSED',
];

// Leads that passed audit but aren't assigned to a case officer yet.
// Only Ops Manager / MD assign case officers, so only they need this list.
router.get('/unassigned', requireAuth, requireRole('OPS_MANAGER', 'MD'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT l.* FROM leads l
       WHERE l.current_status = 'AUDIT_APPROVED'
       ORDER BY l.created_at ASC`
    );
    res.json({ leads: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load unassigned leads' });
  }
});

// Kanban board data grouped by stage.
// A Case Officer only sees the cards assigned to THEM.
// Ops Manager / MD (chairman) see every officer's cards.
router.get('/board', requireAuth, requireRole('CASE_OFFICER', 'OPS_MANAGER', 'MD'), async (req, res) => {
  try {
    const conditions = [];
    const params = [];
if (req.user.work_profile === 'CASE_OFFICER') {
        params.push(req.user.id);
      conditions.push(`ca.case_officer_id = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(
  `SELECT ca.*,
          l.student_name,
          l.target_country,
          l.visa_category,
          l.phone,
          l.email,
          l.invoice_number,
          l.total_amount,
          l.paid_amount,
          l.outstanding_amount,
        l.payment_status,
l.agreement_pdf_url,
l.sent_to_ops_by_name,
e.name AS officer_name,
COALESCE(doc.verified_count, 0) AS documents_verified,
COALESCE(doc.rejected_count, 0) AS rejected_count,
COALESCE(doc.rejected_documents, '[]'::json) AS rejected_documents   FROM case_assignments ca
   JOIN leads l ON l.id = ca.lead_id
   LEFT JOIN employees e ON e.id = ca.case_officer_id
   LEFT JOIN (
  SELECT
    case_id,

    COUNT(*) FILTER (
      WHERE status IN ('VERIFIED', 'NOT_REQUIRED')
      AND doc_type NOT LIKE 'ADDITIONAL_%'
    ) AS verified_count,

    COUNT(*) FILTER (
      WHERE status = 'REJECTED'
      AND doc_type NOT LIKE 'ADDITIONAL_%'
    ) AS rejected_count,

    COALESCE(
      json_agg(
        json_build_object(
          'doc_type', doc_type,
          'rejection_reason', rejection_reason,
          'rejected_at', verified_at
        )
        ORDER BY verified_at DESC
      ) FILTER (
        WHERE status = 'REJECTED'
        AND doc_type NOT LIKE 'ADDITIONAL_%'
      ),
      '[]'::json
    ) AS rejected_documents

  FROM case_documents
  GROUP BY case_id
) doc ON doc.case_id = ca.id
   ${where}
   ORDER BY ca.updated_at DESC`,
  params
);
    const board = STAGES.reduce((acc, s) => ({ ...acc, [s]: [] }), {});
    result.rows.forEach((row) => {
      if (board[row.kanban_stage]) board[row.kanban_stage].push(row);
    });
    res.json({ stages: STAGES, board });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load case board' });
  }
});

// Case officers available for assignment — only Ops Manager / MD assign, so
// only they need to see this dropdown list.
router.get('/officers', requireAuth, requireRole('OPS_MANAGER', 'MD'), async (req, res) => {
  const result = await pool.query(
`SELECT id, name, specialty FROM employees WHERE work_profile = 'CASE_OFFICER' AND is_active = true`  );
  res.json({ officers: result.rows });
});

// Assign a case officer to an audit-approved lead
router.post('/:leadId/assign', requireAuth, requireRole('OPS_MANAGER', 'MD'), async (req, res) => {
  const { leadId } = req.params;
  const { case_officer_id, target_university } = req.body;
  if (!case_officer_id) return res.status(400).json({ error: 'case_officer_id is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const caseRes = await client.query(
      `INSERT INTO case_assignments (lead_id, case_officer_id, target_university, kanban_stage)
       VALUES ($1,$2,$3,'CHECKLIST_SENT') RETURNING id`,
      [leadId, case_officer_id, target_university || null]
    );
    const caseId = caseRes.rows[0].id;
    await client.query(`UPDATE leads SET current_status = 'CASE_ASSIGNED' WHERE id = $1`, [leadId]);
    await client.query(
      `INSERT INTO case_activity (case_id, note) VALUES ($1, 'Case assigned to officer.')`,
      [caseId]
    );

    // CAS/I-20 country logic (spec item #6): UK -> CAS required, USA -> I-20
    // required, everything else -> mark NOT_REQUIRED automatically so the
    // Case Officer isn't blocked waiting on a document that will never come.
    const leadRes = await client.query(`SELECT student_name, target_country FROM leads WHERE id = $1`, [leadId]);
    const country = (leadRes.rows[0]?.target_country || '').toUpperCase();
    const needsCasOrI20 = country.includes('UK') || country.includes('UNITED KINGDOM')
      || country.includes('USA') || country.includes('UNITED STATES') || country === 'US';
    if (!needsCasOrI20) {
      await client.query(
        `INSERT INTO case_documents (case_id, doc_type, file_url, status)
         VALUES ($1, 'CAS_I20', '', 'NOT_REQUIRED')
         ON CONFLICT (case_id, doc_type) DO NOTHING`,
        [caseId]
      );
    }

    // Desktop notification (bell icon + popup) for the Case Officer this
    // case was just assigned to.
    await client.query(
      `INSERT INTO notifications (employee_id, message, link)
       VALUES ($1, $2, '/cases.html')`,
      [case_officer_id, `New case assigned: ${leadRes.rows[0]?.student_name || 'a student'}`]
    );

    await client.query('COMMIT');
    res.status(201).json({ ok: true, caseId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Could not assign case' });
  } finally {
    client.release();
  }
});

// Move a case forward/back a stage
router.patch('/:caseId/stage', requireAuth, requireRole('CASE_OFFICER', 'OPS_MANAGER', 'MD'), async (req, res) => {
  const { caseId } = req.params;
  const { stage, visa_status, note } = req.body;
  if (!STAGES.includes(stage)) return res.status(400).json({ error: 'Invalid stage' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // A Case Officer may only move stages on cases assigned to themselves.
    // Ops Manager / MD (chairman) can move any case.
if (req.user.work_profile === 'CASE_OFFICER') {
        const ownerCheck = await client.query(
        `SELECT case_officer_id FROM case_assignments WHERE id = $1`, [caseId]
      );
      if (ownerCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Case not found' });
      }
      if (ownerCheck.rows[0].case_officer_id !== req.user.id) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'This case is not assigned to you' });
      }
    }

        const updates = ['kanban_stage = $1', 'updated_at = now()'];
    const params = [stage];
    let idx = 2;
    if (visa_status) {
      updates.push(`visa_status = $${idx}`);
      params.push(visa_status);
      idx++;
    }

    // Post-visa stages (Pre-Departure onward) only make sense for an
    // APPROVED visa — a rejected case has nowhere further to go.
    const postVisaStages = ['PRE_DEPARTURE', 'TRAVEL_ARRIVAL', 'STUDENT_ONBOARDING', 'CASE_CLOSED'];
    if (postVisaStages.includes(stage)) {
      const current = await client.query(`SELECT visa_status FROM case_assignments WHERE id = $1`, [caseId]);
      const effectiveVisaStatus = visa_status || current.rows[0]?.visa_status;
      if (effectiveVisaStatus !== 'APPROVED') {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Only an APPROVED visa can move to post-visa stages' });
      }
    }

    params.push(caseId);
    const caseRes = await client.query(
      `UPDATE case_assignments SET ${updates.join(', ')} WHERE id = $${idx} RETURNING lead_id`,
      params
    );
    if (caseRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Case not found' });
    }
    await client.query(
      `INSERT INTO case_activity (case_id, note) VALUES ($1, $2)`,
      [caseId, note || `Moved to ${stage.replaceAll('_', ' ')}`]
    );
    if (stage === 'VISA_OUTCOME' && visa_status && visa_status !== 'IN_PROGRESS') {
      await client.query(`UPDATE leads SET current_status = 'CASE_FILED' WHERE id = $1`, [caseRes.rows[0].lead_id]);
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Could not update stage' });
  } finally {
    client.release();
  }
});
// =========================================================
// Financial Documentation
// =========================================================

router.put(
  '/:caseId/financial-documentation',
  requireAuth,
  requireRole('CASE_OFFICER', 'OPS_MANAGER', 'MD'),
  async (req, res) => {

    const { caseId } = req.params;

    const {
      financial_institution,
      funds_amount,
      currency,
      document_type,
      document_date,
      verification_status,
      notes
    } = req.body;

    try {

      const caseResult = await pool.query(
        `SELECT id, case_officer_id
         FROM case_assignments
         WHERE id = $1`,
        [caseId]
      );

      if (caseResult.rows.length === 0) {
        return res.status(404).json({
          error: 'Case not found'
        });
      }

      if (
        req.user.work_profile === 'CASE_OFFICER' &&
        caseResult.rows[0].case_officer_id !== req.user.id
      ) {
        return res.status(403).json({
          error: 'This case is not assigned to you'
        });
      }

      const result = await pool.query(
        `INSERT INTO case_financial_documentation
         (
           case_id,
           financial_institution,
           funds_amount,
           currency,
           document_type,
           document_date,
           verification_status,
           notes
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)

         ON CONFLICT (case_id)
         DO UPDATE SET
           financial_institution = EXCLUDED.financial_institution,
           funds_amount = EXCLUDED.funds_amount,
           currency = EXCLUDED.currency,
           document_type = EXCLUDED.document_type,
           document_date = EXCLUDED.document_date,
           verification_status = EXCLUDED.verification_status,
           notes = EXCLUDED.notes,
           updated_at = now()

         RETURNING *`,
        [
          caseId,
          financial_institution || null,
          funds_amount || null,
          currency || 'INR',
          document_type || null,
          document_date || null,
          verification_status || 'PENDING',
          notes || null
        ]
      );

      res.json({
        message: 'Financial Documentation saved successfully.',
        financialDocumentation: result.rows[0]
      });

    } catch (err) {

      console.error(err);

      res.status(500).json({
        error: 'Could not save Financial Documentation'
      });

    }
  }
);


// Get Financial Documentation

router.get(
  '/:caseId/financial-documentation',
  requireAuth,
  requireRole('CASE_OFFICER', 'OPS_MANAGER', 'MD'),
  async (req, res) => {

    const { caseId } = req.params;

    try {

      const result = await pool.query(
        `SELECT *
         FROM case_financial_documentation
         WHERE case_id = $1`,
        [caseId]
      );

      res.json({
        financialDocumentation: result.rows[0] || null
      });

    } catch (err) {

      console.error(err);

      res.status(500).json({
        error: 'Could not load Financial Documentation'
      });

    }
  }
);


// =========================================================
// Embassy Slot
// =========================================================

router.put(
  '/:caseId/embassy-slot',
  requireAuth,
  requireRole('CASE_OFFICER', 'OPS_MANAGER', 'MD'),
  async (req, res) => {

    const { caseId } = req.params;

    const {
      embassy_vfs_center,
      appointment_date,
      appointment_time,
      location,
      reference_number,
      appointment_status,
      notes
    } = req.body;

    try {

      const caseResult = await pool.query(
        `SELECT id, case_officer_id
         FROM case_assignments
         WHERE id = $1`,
        [caseId]
      );

      if (caseResult.rows.length === 0) {
        return res.status(404).json({
          error: 'Case not found'
        });
      }

      if (
        req.user.work_profile === 'CASE_OFFICER' &&
        caseResult.rows[0].case_officer_id !== req.user.id
      ) {
        return res.status(403).json({
          error: 'This case is not assigned to you'
        });
      }

      const result = await pool.query(
        `INSERT INTO case_embassy_slot
         (
           case_id,
           embassy_vfs_center,
           appointment_date,
           appointment_time,
           location,
           reference_number,
           appointment_status,
           notes
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)

         ON CONFLICT (case_id)
         DO UPDATE SET
           embassy_vfs_center = EXCLUDED.embassy_vfs_center,
           appointment_date = EXCLUDED.appointment_date,
           appointment_time = EXCLUDED.appointment_time,
           location = EXCLUDED.location,
           reference_number = EXCLUDED.reference_number,
           appointment_status = EXCLUDED.appointment_status,
           notes = EXCLUDED.notes,
           updated_at = now()

         RETURNING *`,
        [
          caseId,
          embassy_vfs_center || null,
          appointment_date || null,
          appointment_time || null,
          location || null,
          reference_number || null,
          appointment_status || 'PENDING',
          notes || null
        ]
      );

      res.json({
        message: 'Embassy Slot saved successfully.',
        embassySlot: result.rows[0]
      });

    } catch (err) {

      console.error(err);

      res.status(500).json({
        error: 'Could not save Embassy Slot'
      });

    }
  }
);


// Get Embassy Slot

router.get(
  '/:caseId/embassy-slot',
  requireAuth,
  requireRole('CASE_OFFICER', 'OPS_MANAGER', 'MD'),
  async (req, res) => {

    const { caseId } = req.params;

    try {

      const result = await pool.query(
        `SELECT *
         FROM case_embassy_slot
         WHERE case_id = $1`,
        [caseId]
      );

      res.json({
        embassySlot: result.rows[0] || null
      });

    } catch (err) {

      console.error(err);

      res.status(500).json({
        error: 'Could not load Embassy Slot'
      });

    }
  }
);
// Save Pre-Departure details
router.put('/:caseId/pre-departure', requireAuth, requireRole('CASE_OFFICER', 'OPS_MANAGER', 'MD'), async (req, res) => {
  const { caseId } = req.params;

  const {
    briefing_completed,
    documents_confirmed,
    accommodation_confirmed,
    travel_guidance_completed,
    departure_date,
    notes
  } = req.body;

  try {
    // Case exists check
    const caseResult = await pool.query(
      `SELECT id, case_officer_id
       FROM case_assignments
       WHERE id = $1`,
      [caseId]
    );

    if (caseResult.rows.length === 0) {
      return res.status(404).json({ error: 'Case not found' });
    }

    // Case Officer can update only their own case
    if (
req.user.work_profile === 'CASE_OFFICER' &&
      caseResult.rows[0].case_officer_id !== req.user.id
    ) {
      return res.status(403).json({ error: 'This case is not assigned to you' });
    }

    const briefing = !!briefing_completed;
    const documents = !!documents_confirmed;
    const accommodation = !!accommodation_confirmed;
    const travelGuidance = !!travel_guidance_completed;

    const completed =
      briefing &&
      documents &&
      accommodation &&
      travelGuidance &&
      departure_date;

    const result = await pool.query(
      `INSERT INTO case_pre_departure
       (
         case_id,
         briefing_completed,
         documents_confirmed,
         accommodation_confirmed,
         travel_guidance_completed,
         departure_date,
         notes,
         status,
         completed_by,
         completed_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (case_id)
       DO UPDATE SET
         briefing_completed = EXCLUDED.briefing_completed,
         documents_confirmed = EXCLUDED.documents_confirmed,
         accommodation_confirmed = EXCLUDED.accommodation_confirmed,
         travel_guidance_completed = EXCLUDED.travel_guidance_completed,
         departure_date = EXCLUDED.departure_date,
         notes = EXCLUDED.notes,
         status = EXCLUDED.status,
         completed_by = EXCLUDED.completed_by,
         completed_at = EXCLUDED.completed_at,
         updated_at = now()
       RETURNING *`,
      [
        caseId,
        briefing,
        documents,
        accommodation,
        travelGuidance,
        departure_date || null,
        notes || null,
        completed ? 'COMPLETED' : 'IN_PROGRESS',
        completed ? req.user.id : null,
        completed ? new Date() : null
      ]
    );

    res.json({
      message: completed
        ? 'Pre-Departure completed successfully.'
        : 'Pre-Departure details saved.',
      preDeparture: result.rows[0]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save Pre-Departure details' });
  }
});
// Get Pre-Departure details
router.get('/:caseId/pre-departure', requireAuth, requireRole('CASE_OFFICER', 'OPS_MANAGER', 'MD'), async (req, res) => {
  const { caseId } = req.params;

  try {
    const result = await pool.query(
      `SELECT *
       FROM case_pre_departure
       WHERE case_id = $1`,
      [caseId]
    );

    res.json({
      preDeparture: result.rows[0] || null
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load Pre-Departure details' });
  }
});
// Save Travel / Arrival details
router.put('/:caseId/travel-arrival', requireAuth, requireRole('CASE_OFFICER', 'OPS_MANAGER', 'MD'), async (req, res) => {
  const { caseId } = req.params;

  const {
    flight_number,
    departure_date,
    arrival_date,
    departure_city,
    arrival_city,
    travel_confirmed,
    arrival_confirmed,
    notes
  } = req.body;

  try {
    const caseResult = await pool.query(
      `SELECT id, case_officer_id
       FROM case_assignments
       WHERE id = $1`,
      [caseId]
    );

    if (caseResult.rows.length === 0) {
      return res.status(404).json({ error: 'Case not found' });
    }

    if (
req.user.work_profile === 'CASE_OFFICER' &&
      caseResult.rows[0].case_officer_id !== req.user.id
    ) {
      return res.status(403).json({ error: 'This case is not assigned to you' });
    }

    const result = await pool.query(
      `INSERT INTO case_travel_arrival
       (
         case_id,
         flight_number,
         departure_date,
         arrival_date,
         departure_city,
         arrival_city,
         travel_confirmed,
         arrival_confirmed,
         notes,
         status,
         updated_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
       ON CONFLICT (case_id)
       DO UPDATE SET
         flight_number = EXCLUDED.flight_number,
         departure_date = EXCLUDED.departure_date,
         arrival_date = EXCLUDED.arrival_date,
         departure_city = EXCLUDED.departure_city,
         arrival_city = EXCLUDED.arrival_city,
         travel_confirmed = EXCLUDED.travel_confirmed,
         arrival_confirmed = EXCLUDED.arrival_confirmed,
         notes = EXCLUDED.notes,
         status = EXCLUDED.status,
         updated_at = now()
       RETURNING *`,
      [
        caseId,
        flight_number || null,
        departure_date || null,
        arrival_date || null,
        departure_city || null,
        arrival_city || null,
        !!travel_confirmed,
        !!arrival_confirmed,
        notes || null,
        travel_confirmed && arrival_confirmed ? 'COMPLETED' : 'IN_PROGRESS'
      ]
    );

    res.json({
      message: 'Travel / Arrival details saved.',
      travelArrival: result.rows[0]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save Travel / Arrival details' });
  }
});
// Get Travel / Arrival details
router.get('/:caseId/travel-arrival', requireAuth, requireRole('CASE_OFFICER', 'OPS_MANAGER', 'MD'), async (req, res) => {
  const { caseId } = req.params;

  try {
    const result = await pool.query(
      `SELECT *
       FROM case_travel_arrival
       WHERE case_id = $1`,
      [caseId]
    );

    res.json({
      travelArrival: result.rows[0] || null
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load Travel / Arrival details' });
  }
});
// Save Student Onboarding details
router.put('/:caseId/student-onboarding', requireAuth, requireRole('CASE_OFFICER', 'OPS_MANAGER', 'MD'), async (req, res) => {
  const { caseId } = req.params;

  const {
    student_arrived,
    university_joined,
    accommodation_confirmed,
    onboarding_completed,
    joining_date,
    notes
  } = req.body;

  try {
    const caseResult = await pool.query(
      `SELECT id, case_officer_id
       FROM case_assignments
       WHERE id = $1`,
      [caseId]
    );

    if (caseResult.rows.length === 0) {
      return res.status(404).json({ error: 'Case not found' });
    }

    if (
req.user.work_profile === 'CASE_OFFICER' &&
      caseResult.rows[0].case_officer_id !== req.user.id
    ) {
      return res.status(403).json({ error: 'This case is not assigned to you' });
    }

    const arrived = !!student_arrived;
    const joined = !!university_joined;
    const accommodation = !!accommodation_confirmed;
    const onboarding = !!onboarding_completed;

    const completed =
      arrived &&
      joined &&
      accommodation &&
      onboarding &&
      joining_date;

    const result = await pool.query(
      `INSERT INTO case_student_onboarding
       (
         case_id,
         student_arrived,
         university_joined,
         accommodation_confirmed,
         onboarding_completed,
         joining_date,
         notes,
         status,
         completed_by,
         completed_at,
         updated_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
       ON CONFLICT (case_id)
       DO UPDATE SET
         student_arrived = EXCLUDED.student_arrived,
         university_joined = EXCLUDED.university_joined,
         accommodation_confirmed = EXCLUDED.accommodation_confirmed,
         onboarding_completed = EXCLUDED.onboarding_completed,
         joining_date = EXCLUDED.joining_date,
         notes = EXCLUDED.notes,
         status = EXCLUDED.status,
         completed_by = EXCLUDED.completed_by,
         completed_at = EXCLUDED.completed_at,
         updated_at = now()
       RETURNING *`,
      [
        caseId,
        arrived,
        joined,
        accommodation,
        onboarding,
        joining_date || null,
        notes || null,
        completed ? 'COMPLETED' : 'IN_PROGRESS',
        completed ? req.user.id : null,
        completed ? new Date() : null
      ]
    );

    res.json({
      message: completed
        ? 'Student Onboarding completed successfully.'
        : 'Student Onboarding details saved.',
      studentOnboarding: result.rows[0]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save Student Onboarding details' });
  }
});


// Get Student Onboarding details
router.get('/:caseId/student-onboarding', requireAuth, requireRole('CASE_OFFICER', 'OPS_MANAGER', 'MD'), async (req, res) => {
  const { caseId } = req.params;

  try {
    const result = await pool.query(
      `SELECT *
       FROM case_student_onboarding
       WHERE case_id = $1`,
      [caseId]
    );

    res.json({
      studentOnboarding: result.rows[0] || null
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load Student Onboarding details' });
  }
});
module.exports = router;
