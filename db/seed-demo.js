// Seeds demo data: 1 branch, one employee per role, and sample leads
// spread across every stage of the Audit -> Case Filing pipeline.
// Run with: npm run seed
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./pool');

const DEMO_PASSWORD = 'Vjc@2026';

const KANBAN_STAGES = [
  'CHECKLIST_SENT', 'DOCUMENT_COLLECTION', 'SOP_LOR_REVIEW',
  'UNIVERSITY_APPLICATION_SUBMITTED', 'OFFER_RECEIVED', 'FINANCIAL_DOCUMENTATION',
  'EMBASSY_SLOT_BOOKED', 'BIOMETRICS_DONE', 'VISA_OUTCOME'
];

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const branchRes = await client.query(
      `INSERT INTO branches (branch_name, city) VALUES ('Hyderabad HQ', 'Hyderabad') RETURNING id`
    );
    const branchId = branchRes.rows[0].id;

    const hash = await bcrypt.hash(DEMO_PASSWORD, 10);

    const employees = [
      { name: 'Ravi Kumar (MD)', email: 'md@vjcoverseas.com', role: 'MD' },
      { name: 'Sunitha Reddy', email: 'ops.manager@vjcoverseas.com', role: 'OPS_MANAGER' },
      { name: 'Priya Sharma', email: 'auditor@vjcoverseas.com', role: 'AUDITOR' },
      { name: 'Arjun Nair', email: 'case.uk@vjcoverseas.com', role: 'CASE_OFFICER', specialty: 'UK Specialist' },
      { name: 'Divya Menon', email: 'case.usa@vjcoverseas.com', role: 'CASE_OFFICER', specialty: 'USA Specialist' },
      { name: 'Kiran Rao', email: 'counselor@vjcoverseas.com', role: 'COUNSELOR' },
    ];

    const empIds = {};
    for (const e of employees) {
      const r = await client.query(
        `INSERT INTO employees (branch_id, name, email, password_hash, role, specialty)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, role, email`,
        [branchId, e.name, e.email, hash, e.role, e.specialty || null]
      );
      empIds[e.email] = r.rows[0].id;
    }

    const auditorId = empIds['auditor@vjcoverseas.com'];
    const opsManagerId = empIds['ops.manager@vjcoverseas.com'];
    const counselorId = empIds['counselor@vjcoverseas.com'];
    const caseOfficerUK = empIds['case.uk@vjcoverseas.com'];
    const caseOfficerUSA = empIds['case.usa@vjcoverseas.com'];

    async function makeLead(name, email, phone, country, visa, amount) {
      const r = await client.query(
        `INSERT INTO leads (branch_id, counselor_id, student_name, email, phone, target_country, visa_category, package_amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [branchId, counselorId, name, email, phone, country, visa, amount]
      );
      const leadId = r.rows[0].id;
      await client.query(`INSERT INTO agreements (lead_id) VALUES ($1)`, [leadId]);
      return leadId;
    }

    // 1. Lead ready for audit (agreement signed, nothing else done)
    const l1 = await makeLead('Rahul Varma', 'rahul.varma@example.com', '+919988776655', 'Canada', 'Student Visa (PG)', 480000);

    // 2. Lead that FAILED audit and is back with counselor
    const l2 = await makeLead('Sneha Iyer', 'sneha.iyer@example.com', '+919876543210', 'UK', 'Student Visa', 350000);
    await client.query(
      `UPDATE leads SET current_status='AUDIT_FAILED' WHERE id=$1`, [l2]
    );
    await client.query(
      `INSERT INTO quality_audits (lead_id, auditor_id, score, auditor_remarks, status)
       VALUES ($1,$2,$3,$4,'REJECTED')`,
      [l2, auditorId, 5, 'Counselor promised guaranteed visa approval — needs correction call.']
    );

    // 3. Lead APPROVED by audit, waiting for Ops assignment
    const l3 = await makeLead('Farhan Ali', 'farhan.ali@example.com', '+919000011122', 'Australia', 'PR Visa', 620000);
    await client.query(`UPDATE leads SET current_status='AUDIT_APPROVED' WHERE id=$1`, [l3]);
    await client.query(
      `INSERT INTO quality_audits (lead_id, auditor_id, score, auditor_remarks, status)
       VALUES ($1,$2,$3,$4,'APPROVED')`,
      [l3, auditorId, 9, 'Clean call. Student fully understands terms.']
    );

    // 4-7. Leads at various Case Filing kanban stages
    const caseSeed = [
      ['Meera Pillai', 'meera.pillai@example.com', '+919123456780', 'USA', 'F1 Student Visa', 700000, caseOfficerUSA, 'University of Texas', 'DOCUMENT_COLLECTION'],
      ['Vikram Desai', 'vikram.desai@example.com', '+919234567891', 'UK', 'Student Visa', 400000, caseOfficerUK, 'University of Manchester', 'SOP_LOR_REVIEW'],
      ['Ananya Rao', 'ananya.rao@example.com', '+919345678912', 'UK', 'Dependent Visa', 150000, caseOfficerUK, 'University of Leeds', 'EMBASSY_SLOT_BOOKED'],
      ['Rohit Sharma', 'rohit.sharma@example.com', '+919456789123', 'USA', 'F1 Student Visa', 750000, caseOfficerUSA, 'Arizona State University', 'VISA_OUTCOME'],
    ];

    for (const [name, email, phone, country, visa, amt, officer, uni, stage] of caseSeed) {
      const lid = await makeLead(name, email, phone, country, visa, amt);
      await client.query(`UPDATE leads SET current_status='CASE_ASSIGNED' WHERE id=$1`, [lid]);
      await client.query(
        `INSERT INTO quality_audits (lead_id, auditor_id, score, auditor_remarks, status)
         VALUES ($1,$2,8,'Verified OK.','APPROVED')`,
        [lid, auditorId]
      );
      const visaStatus = stage === 'VISA_OUTCOME' ? 'APPROVED' : 'IN_PROGRESS';
      const caseRes = await client.query(
        `INSERT INTO case_assignments (lead_id, case_officer_id, target_university, kanban_stage, visa_status)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [lid, officer, uni, stage, visaStatus]
      );
      await client.query(
        `INSERT INTO case_activity (case_id, note) VALUES ($1, $2)`,
        [caseRes.rows[0].id, `Case assigned to officer, currently at ${stage.replaceAll('_',' ')}.`]
      );
      if (stage === 'VISA_OUTCOME') {
        await client.query(`UPDATE leads SET current_status='CASE_FILED' WHERE id=$1`, [lid]);
      }
    }

    await client.query('COMMIT');
    console.log('✅ Seed complete.');
    console.log('');
    console.log('Demo login credentials (password for ALL accounts): ' + DEMO_PASSWORD);
    employees.forEach(e => console.log(`  - ${e.role.padEnd(13)} ${e.email}`));
    console.log('');
    console.log('Lead ready for audit id=' + l1 + ' (Rahul Varma)');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
