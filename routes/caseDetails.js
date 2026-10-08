const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Same ownership rule as documents/cases: a Case Officer only touches their
// own cases; Ops Manager / MD can touch any case.
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

// One combined GET — returns all 4 detail sections for a case in one call
// so the "Case Details" modal only needs a single round trip.
router.get('/:caseId', requireAuth, requireRole('CASE_OFFICER', 'OPS_MANAGER', 'MD'), async (req, res) => {
  const { caseId } = req.params;
  try {
    const access = await assertCaseAccess(pool, caseId, req.user);
    if (!access.ok) return res.status(access.code).json({ error: access.error });

    const [universityApp, offer, visaApp, appointment] = await Promise.all([
      pool.query(`SELECT * FROM case_university_applications WHERE case_id = $1`, [caseId]),
      pool.query(`SELECT * FROM case_offers WHERE case_id = $1`, [caseId]),
      pool.query(`SELECT * FROM case_visa_applications WHERE case_id = $1`, [caseId]),
      pool.query(`SELECT * FROM case_appointments WHERE case_id = $1`, [caseId]),
    ]);
    res.json({
      universityApplication: universityApp.rows[0] || null,
      offer: offer.rows[0] || null,
      visaApplication: visaApp.rows[0] || null,
      appointment: appointment.rows[0] || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load case details' });
  }
});

// #3 University Application
router.put('/:caseId/university-application', requireAuth, requireRole('CASE_OFFICER', 'OPS_MANAGER', 'MD'), async (req, res) => {
  const { caseId } = req.params;
  const { university, course, intake, application_number, application_date, status } = req.body;
  try {
    const access = await assertCaseAccess(pool, caseId, req.user);
    if (!access.ok) return res.status(access.code).json({ error: access.error });

    const result = await pool.query(
      `INSERT INTO case_university_applications (case_id, university, course, intake, application_number, application_date, status)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'SUBMITTED'))
       ON CONFLICT (case_id) DO UPDATE
         SET university = $2, course = $3, intake = $4, application_number = $5,
             application_date = $6, status = COALESCE($7, case_university_applications.status),
             updated_at = now()
       RETURNING *`,
      [caseId, university || null, course || null, intake || null, application_number || null, application_date || null, status || null]
    );
    res.json({ universityApplication: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save university application' });
  }
});

// #4 Offer Management
router.put('/:caseId/offer', requireAuth, requireRole('CASE_OFFICER', 'OPS_MANAGER', 'MD'), async (req, res) => {
  const { caseId } = req.params;
  const { university, course, intake, offer_date, is_conditional, conditions, offer_status } = req.body;
  try {
    const access = await assertCaseAccess(pool, caseId, req.user);
    if (!access.ok) return res.status(access.code).json({ error: access.error });

    const result = await pool.query(
      `INSERT INTO case_offers (case_id, university, course, intake, offer_date, is_conditional, conditions, offer_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,'RECEIVED'))
       ON CONFLICT (case_id) DO UPDATE
         SET university = $2, course = $3, intake = $4, offer_date = $5,
             is_conditional = $6, conditions = $7,
             offer_status = COALESCE($8, case_offers.offer_status),
             updated_at = now()
       RETURNING *`,
      [caseId, university || null, course || null, intake || null, offer_date || null, !!is_conditional, conditions || null, offer_status || null]
    );
    res.json({ offer: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save offer' });
  }
});

// #7 Visa Application
router.put('/:caseId/visa-application', requireAuth, requireRole('CASE_OFFICER', 'OPS_MANAGER', 'MD'), async (req, res) => {
  const { caseId } = req.params;
  const { application_number, submission_date, status, notes } = req.body;
  try {
    const access = await assertCaseAccess(pool, caseId, req.user);
    if (!access.ok) return res.status(access.code).json({ error: access.error });

    const result = await pool.query(
      `INSERT INTO case_visa_applications (case_id, application_number, submission_date, status, notes)
       VALUES ($1,$2,$3,COALESCE($4,'PREPARING'),$5)
       ON CONFLICT (case_id) DO UPDATE
         SET application_number = $2, submission_date = $3,
             status = COALESCE($4, case_visa_applications.status), notes = $5,
             updated_at = now()
       RETURNING *`,
      [caseId, application_number || null, submission_date || null, status || null, notes || null]
    );
    res.json({ visaApplication: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save visa application' });
  }
});

// #8 Appointment + Biometrics
router.put('/:caseId/appointment', requireAuth, requireRole('CASE_OFFICER', 'OPS_MANAGER', 'MD'), async (req, res) => {
  const { caseId } = req.params;
  const { appointment_date, appointment_time, location, booking_reference, is_rescheduled, biometrics_date, biometrics_completed } = req.body;
  try {
    const access = await assertCaseAccess(pool, caseId, req.user);
    if (!access.ok) return res.status(access.code).json({ error: access.error });

    const result = await pool.query(
      `INSERT INTO case_appointments (case_id, appointment_date, appointment_time, location, booking_reference, is_rescheduled, biometrics_date, biometrics_completed)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (case_id) DO UPDATE
         SET appointment_date = $2, appointment_time = $3, location = $4,
             booking_reference = $5, is_rescheduled = $6, biometrics_date = $7,
             biometrics_completed = $8, updated_at = now()
       RETURNING *`,
      [caseId, appointment_date || null, appointment_time || null, location || null,
       booking_reference || null, !!is_rescheduled, biometrics_date || null, !!biometrics_completed]
    );
    res.json({ appointment: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not save appointment' });
  }
});

module.exports = router;