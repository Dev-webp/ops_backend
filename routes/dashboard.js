const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/stats', requireAuth, async (req, res) => {
  try {
const { role, work_profile, id: userId } = req.user;

// Chairman and Manager see the whole company.
// Employees see only the work belonging to their own OPS profile.
const ownLeadsOnly = work_profile === 'COUNSELOR' && role !== 'manager';
const ownAuditsOnly = work_profile === 'AUDITOR' && role !== 'manager';
const ownCasesOnly = work_profile === 'CASE_OFFICER' && role !== 'manager';
    const [pendingAudit, approvedAudit, rejectedAudit, totalLeads] = await Promise.all([
      ownLeadsOnly
        ? pool.query(`SELECT COUNT(*) FROM leads WHERE current_status = 'AGREEMENT_SIGNED' AND counselor_id = $1`, [userId])
        : pool.query(`SELECT COUNT(*) FROM leads WHERE current_status = 'AGREEMENT_SIGNED'`),
      ownAuditsOnly
        ? pool.query(`SELECT COUNT(*) FROM quality_audits WHERE status = 'APPROVED' AND auditor_id = $1`, [userId])
        : pool.query(`SELECT COUNT(*) FROM quality_audits WHERE status = 'APPROVED'`),
      ownAuditsOnly
        ? pool.query(`SELECT COUNT(*) FROM quality_audits WHERE status = 'REJECTED' AND auditor_id = $1`, [userId])
        : pool.query(`SELECT COUNT(*) FROM quality_audits WHERE status = 'REJECTED'`),
      ownLeadsOnly
        ? pool.query(`SELECT COUNT(*) FROM leads WHERE counselor_id = $1`, [userId])
        : pool.query(`SELECT COUNT(*) FROM leads`),
    ]);

    const caseStageCounts = ownCasesOnly
      ? await pool.query(`SELECT kanban_stage, COUNT(*) FROM case_assignments WHERE case_officer_id = $1 GROUP BY kanban_stage`, [userId])
      : await pool.query(`SELECT kanban_stage, COUNT(*) FROM case_assignments GROUP BY kanban_stage`);

    const totalCases = ownCasesOnly
      ? await pool.query(`SELECT COUNT(*) FROM case_assignments WHERE case_officer_id = $1`, [userId])
      : await pool.query(`SELECT COUNT(*) FROM case_assignments`);

    const completedCases = ownCasesOnly
      ? await pool.query(`SELECT COUNT(*) FROM case_assignments WHERE kanban_stage = 'VISA_OUTCOME' AND visa_status = 'APPROVED' AND case_officer_id = $1`, [userId])
      : await pool.query(`SELECT COUNT(*) FROM case_assignments WHERE kanban_stage = 'VISA_OUTCOME' AND visa_status = 'APPROVED'`);

    const rejectedCases = ownCasesOnly
      ? await pool.query(`SELECT COUNT(*) FROM case_assignments WHERE visa_status = 'REJECTED' AND case_officer_id = $1`, [userId])
      : await pool.query(`SELECT COUNT(*) FROM case_assignments WHERE visa_status = 'REJECTED'`);

    const inProgressCases = ownCasesOnly
      ? await pool.query(`SELECT COUNT(*) FROM case_assignments WHERE visa_status = 'IN_PROGRESS' AND case_officer_id = $1`, [userId])
      : await pool.query(`SELECT COUNT(*) FROM case_assignments WHERE visa_status = 'IN_PROGRESS'`);

    const recentAudits = ownAuditsOnly
      ? await pool.query(
          `SELECT qa.id, l.student_name, qa.score, qa.status, qa.audited_at
           FROM quality_audits qa JOIN leads l ON l.id = qa.lead_id
           WHERE qa.auditor_id = $1
           ORDER BY qa.audited_at DESC LIMIT 6`, [userId]
        )
      : await pool.query(
          `SELECT qa.id, l.student_name, qa.score, qa.status, qa.audited_at
           FROM quality_audits qa JOIN leads l ON l.id = qa.lead_id
           ORDER BY qa.audited_at DESC LIMIT 6`
        );

    res.json({
      audits: {
        pending: Number(pendingAudit.rows[0].count),
        approved: Number(approvedAudit.rows[0].count),
        rejected: Number(rejectedAudit.rows[0].count),
      },
      leads: { total: Number(totalLeads.rows[0].count) },
      cases: {
        total: Number(totalCases.rows[0].count),
        completed: Number(completedCases.rows[0].count),
        rejected: Number(rejectedCases.rows[0].count),
        inProgress: Number(inProgressCases.rows[0].count),
        byStage: caseStageCounts.rows.reduce((acc, r) => {
          acc[r.kanban_stage] = Number(r.count);
          return acc;
        }, {}),
      },
      recentAudits: recentAudits.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load dashboard stats' });
  }
});

module.exports = router;
