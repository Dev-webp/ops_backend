const express = require('express');
const pool = require('../db/pool');
const { requireAuth, isManagement } = require('../middleware/auth');

const router = express.Router();

function buildDateFilter(column, dateFrom, dateTo, params) {
  const conditions = [];
  if (dateFrom) {
    params.push(dateFrom);
    conditions.push(`${column} >= $${params.length}::date`);
  }
  if (dateTo) {
    params.push(dateTo);
    conditions.push(`${column} < ($${params.length}::date + INTERVAL '1 day')`);
  }
  return conditions.length ? conditions.join(' AND ') : 'TRUE';
}

function n(v) {
  const num = Number(v);
  return Number.isFinite(num) ? num : 0;
}

// Employee dropdown — management only.
router.get('/employees', requireAuth, async (req, res) => {
  if (!isManagement(req.user.work_profile)) {
    return res.status(403).json({ error: 'You do not have permission to view employee reports' });
  }
  try {
    const result = await pool.query(`
      SELECT id, name, work_profile, designation
      FROM employees
      WHERE is_active = true AND work_profile <> 'MD'
      ORDER BY name ASC
    `);
    res.json({ employees: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not load employees' });
  }
});

// Main report — everything the Reports page needs, in one call.
router.get('/summary', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    const management = isManagement(user.work_profile);
    const { date_from, date_to, employee_id } = req.query;

    const targetEmployeeId = management ? (employee_id || null) : user.id;

    // ---------------- LEADS ----------------
    const leadParams = [];
    const leadConditions = [buildDateFilter('l.created_at', date_from, date_to, leadParams)];
    if (targetEmployeeId) {
      leadParams.push(targetEmployeeId);
      leadConditions.push(`l.counselor_id = $${leadParams.length}`);
    }
    const leadsResult = await pool.query(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE l.current_status = 'AGREEMENT_SIGNED') AS agreement_signed,
         COUNT(*) FILTER (WHERE l.current_status <> 'AGREEMENT_SIGNED') AS agreement_pending,
         COALESCE(SUM(l.package_amount), 0) AS total_package_amount
       FROM leads l
       WHERE ${leadConditions.join(' AND ')}`,
      leadParams
    );

    // ---------------- AUDITS ----------------
    const auditParams = [];
    const auditConditions = [buildDateFilter('qa.audited_at', date_from, date_to, auditParams)];
    if (targetEmployeeId) {
      auditParams.push(targetEmployeeId);
      auditConditions.push(`qa.auditor_id = $${auditParams.length}`);
    }
    const auditsResult = await pool.query(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE qa.status = 'APPROVED') AS approved,
         COUNT(*) FILTER (WHERE qa.status = 'REJECTED') AS rejected,
         COUNT(*) FILTER (WHERE qa.status NOT IN ('APPROVED','REJECTED')) AS pending,
         ROUND(AVG(qa.score), 1) AS avg_score
       FROM quality_audits qa
       WHERE ${auditConditions.join(' AND ')}`,
      auditParams
    );

    // ---------------- CASES ----------------
    const caseParams = [];
    const caseConditions = [buildDateFilter('ca.created_at', date_from, date_to, caseParams)];
    if (targetEmployeeId) {
      caseParams.push(targetEmployeeId);
      caseConditions.push(`ca.case_officer_id = $${caseParams.length}`);
    }
    const casesResult = await pool.query(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE ca.visa_status = 'IN_PROGRESS') AS in_progress,
         COUNT(*) FILTER (WHERE ca.visa_status = 'APPROVED') AS visa_approved,
         COUNT(*) FILTER (WHERE ca.visa_status = 'REJECTED') AS visa_rejected
       FROM case_assignments ca
       WHERE ${caseConditions.join(' AND ')}`,
      caseParams
    );

    // ---------------- DAILY ACTIVITY TREND (last 14 days by default) ----------------
    const trendResult = await pool.query(
      `WITH dates AS (
         SELECT generate_series(
           COALESCE($1::date, CURRENT_DATE - INTERVAL '13 days'),
           COALESCE($2::date, CURRENT_DATE),
           INTERVAL '1 day'
         )::date AS report_date
       ),
       lead_daily AS (
         SELECT l.created_at::date AS report_date, COUNT(*) AS leads
         FROM leads l
         ${targetEmployeeId ? 'WHERE l.counselor_id = $3' : ''}
         GROUP BY l.created_at::date
       ),
       audit_daily AS (
         SELECT qa.audited_at::date AS report_date, COUNT(*) AS audits
         FROM quality_audits qa
         ${targetEmployeeId ? 'WHERE qa.auditor_id = $3' : ''}
         GROUP BY qa.audited_at::date
       ),
       case_daily AS (
         SELECT ca.created_at::date AS report_date, COUNT(*) AS cases
         FROM case_assignments ca
         ${targetEmployeeId ? 'WHERE ca.case_officer_id = $3' : ''}
         GROUP BY ca.created_at::date
       )
       SELECT
         d.report_date,
         COALESCE(ld.leads, 0) AS leads,
         COALESCE(ad.audits, 0) AS audits,
         COALESCE(cd.cases, 0) AS cases
       FROM dates d
       LEFT JOIN lead_daily ld ON ld.report_date = d.report_date
       LEFT JOIN audit_daily ad ON ad.report_date = d.report_date
       LEFT JOIN case_daily cd ON cd.report_date = d.report_date
       ORDER BY d.report_date ASC`,
      [date_from || null, date_to || null, ...(targetEmployeeId ? [targetEmployeeId] : [])]
    );

    // ---------------- TOP DESTINATION COUNTRIES ----------------
    const countryParams = [];
    const countryConditions = [buildDateFilter('l.created_at', date_from, date_to, countryParams)];
    if (targetEmployeeId) {
      countryParams.push(targetEmployeeId);
      countryConditions.push(`l.counselor_id = $${countryParams.length}`);
    }
        const countryResult = await pool.query(
      `SELECT l.target_country AS country, COUNT(*) AS total
       FROM leads l
       WHERE ${countryConditions.join(' AND ')}
       GROUP BY l.target_country
       ORDER BY total DESC`,
      countryParams
    );

    const allCountryRows = countryResult.rows.map((r) => ({
      country: r.country || 'Unspecified',
      total: n(r.total),
    }));
    const countryGrandTotal = allCountryRows.reduce((sum, r) => sum + r.total, 0);
    const top5Countries = allCountryRows.slice(0, 5);
    const remainingCountries = allCountryRows.slice(5);
    const remainingTotal = remainingCountries.reduce((sum, r) => sum + r.total, 0);

    const topCountries = top5Countries.map((r) => ({
      country: r.country,
      total: r.total,
      pct: countryGrandTotal > 0 ? Math.round((r.total / countryGrandTotal) * 100) : 0,
    }));
    if (remainingCountries.length > 0) {
      topCountries.push({
        country: `Other (${remainingCountries.length} types)`,
        total: remainingTotal,
        pct: countryGrandTotal > 0 ? Math.round((remainingTotal / countryGrandTotal) * 100) : 0,
      });
    }
    // ---------------- EMPLOYEE-WISE REPORT (management only) ----------------
    let employeeReport = [];
    if (management) {
      const employeeParams = [];
      const employeeConditions = [`e.is_active = true`, `e.work_profile <> 'MD'`];
      if (employee_id) {
        employeeParams.push(employee_id);
        employeeConditions.push(`e.id = $${employeeParams.length}`);
      }
      const employeeResult = await pool.query(
        `SELECT
           e.id, e.name, e.work_profile, e.designation,
           (SELECT COUNT(*) FROM leads l WHERE l.counselor_id = e.id) AS leads,
           (SELECT COUNT(*) FROM quality_audits qa WHERE qa.auditor_id = e.id) AS audits,
           (SELECT ROUND(AVG(qa.score), 1) FROM quality_audits qa WHERE qa.auditor_id = e.id) AS avg_score,
           (SELECT COUNT(*) FROM case_assignments ca WHERE ca.case_officer_id = e.id) AS cases,
           (SELECT COUNT(*) FROM case_assignments ca WHERE ca.case_officer_id = e.id AND ca.visa_status = 'APPROVED') AS visa_approved
         FROM employees e
         WHERE ${employeeConditions.join(' AND ')}
         ORDER BY e.name ASC`,
        employeeParams
      );
      employeeReport = employeeResult.rows.map((r) => ({
        id: r.id,
        name: r.name,
        work_profile: r.work_profile,
        designation: r.designation,
        leads: n(r.leads),
        audits: n(r.audits),
        avg_score: r.avg_score === null || r.avg_score === undefined ? null : Number(r.avg_score),
        cases: n(r.cases),
        visa_approved: n(r.visa_approved),
      }));
    }

    // ---------------- BRANCH-WISE REPORT (management only, all-time) ----------------
    let branchReport = [];
    if (management) {
      const branchResult = await pool.query(
        `SELECT
           b.id, b.branch_name, b.city,
           (SELECT COUNT(*) FROM leads l WHERE l.branch_id = b.id) AS leads,
           (SELECT COUNT(*) FROM case_assignments ca JOIN leads l2 ON l2.id = ca.lead_id WHERE l2.branch_id = b.id) AS cases,
           (SELECT COUNT(*) FROM case_assignments ca JOIN leads l2 ON l2.id = ca.lead_id WHERE l2.branch_id = b.id AND ca.visa_status = 'APPROVED') AS visa_approved
         FROM branches b
         ORDER BY leads DESC`
      );
      branchReport = branchResult.rows.map((r) => ({
        id: r.id,
        branch_name: r.branch_name,
        city: r.city,
        leads: n(r.leads),
        cases: n(r.cases),
        visa_approved: n(r.visa_approved),
      }));
    }

    const leadRow = leadsResult.rows[0] || {};
    const auditRow = auditsResult.rows[0] || {};
    const caseRow = casesResult.rows[0] || {};

    const visaApproved = n(caseRow.visa_approved);
    const visaRejected = n(caseRow.visa_rejected);
    const visaDecided = visaApproved + visaRejected;
    const visaSuccessRate = visaDecided > 0 ? Math.round((visaApproved / visaDecided) * 100) : 0;

    res.json({
      isManagement: management,
      kpis: {
        totalLeads: n(leadRow.total),
        totalAudits: n(auditRow.total),
        totalCases: n(caseRow.total),
        totalBusinessValue: n(leadRow.total_package_amount),
        visaSuccessRate: n(visaSuccessRate),
      },
      leadBreakdown: {
        signed: n(leadRow.agreement_signed),
        pending: n(leadRow.agreement_pending),
      },
      auditBreakdown: {
        approved: n(auditRow.approved),
        rejected: n(auditRow.rejected),
        pending: n(auditRow.pending),
        avgScore: auditRow.avg_score === null || auditRow.avg_score === undefined ? null : Number(auditRow.avg_score),
      },
      caseBreakdown: {
        inProgress: n(caseRow.in_progress),
        visaApproved,
        visaRejected,
      },
      dailyTrend: trendResult.rows.map((r) => ({
        report_date: r.report_date,
        leads: n(r.leads),
        audits: n(r.audits),
        cases: n(r.cases),
      })),
      topCountries,      employeeReport,
      branchReport,
    });
  } catch (err) {
    console.error('REPORT ERROR:', err);
    res.status(500).json({ error: 'Could not generate reports' });
  }
});

module.exports = router;