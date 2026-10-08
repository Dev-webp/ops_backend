// Creates ONLY the login accounts (one per role) + one branch.
// No demo leads, no demo audits, no demo cases.
//
// Run with: npm run seed

require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./pool');

const DEMO_PASSWORD = 'Vjc@2026';

async function seed() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Find existing branch first.
    // If it doesn't exist, create it.
    let branchRes = await client.query(
      `SELECT id
       FROM branches
       WHERE branch_name = 'Hyderabad HQ'
       LIMIT 1`
    );

    let branchId;

    if (branchRes.rows.length > 0) {
      branchId = branchRes.rows[0].id;
      console.log('ℹ️ Hyderabad HQ branch already exists. Using existing branch.');
    } else {
      branchRes = await client.query(
        `INSERT INTO branches (branch_name, city)
         VALUES ('Hyderabad HQ', 'Hyderabad')
         RETURNING id`
      );

      branchId = branchRes.rows[0].id;
      console.log('✅ Hyderabad HQ branch created.');
    }

    const hash = await bcrypt.hash(DEMO_PASSWORD, 10);

    const employees = [
      {
        name: 'Ravi Kumar (MD)',
        email: 'md@vjcoverseas.com',
        role: 'MD'
      },
      {
        name: 'Sunitha Reddy',
        email: 'ops.manager@vjcoverseas.com',
        role: 'OPS_MANAGER'
      },
      {
        name: 'Priya Sharma',
        email: 'auditor@vjcoverseas.com',
        role: 'AUDITOR'
      },
      {
        name: 'Arjun Nair',
        email: 'case.uk@vjcoverseas.com',
        role: 'CASE_OFFICER',
        specialty: 'UK Specialist'
      },
      {
        name: 'Divya Menon',
        email: 'case.usa@vjcoverseas.com',
        role: 'CASE_OFFICER',
        specialty: 'USA Specialist'
      },
      {
        name: 'Kiran Rao',
        email: 'counselor@vjcoverseas.com',
        role: 'COUNSELOR'
      }
    ];

    for (const e of employees) {
      const result = await client.query(
        `INSERT INTO employees
          (branch_id, name, email, password_hash, role, specialty)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (email) DO NOTHING
         RETURNING id`,
        [
          branchId,
          e.name,
          e.email,
          hash,
          e.role,
          e.specialty || null
        ]
      );

      if (result.rows.length > 0) {
        console.log(`✅ Created: ${e.email}`);
      } else {
        console.log(`ℹ️ Already exists: ${e.email}`);
      }
    }

    await client.query('COMMIT');

    console.log('');
    console.log('✅ Setup complete.');
    console.log('Login credentials (password for newly created accounts): ' + DEMO_PASSWORD);
    console.log('');

    employees.forEach(e => {
      console.log(`  - ${e.role.padEnd(13)} ${e.email}`);
    });

    console.log('');
    console.log(
      'Dashboard will show all zeros until you add leads from the "Leads / Agreements" page.'
    );

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