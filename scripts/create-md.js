// Creates the Managing Director account for a new OPS database.
//
//   MD_EMAIL=md@example.com MD_PASSWORD='a-long-unique-password' node scripts/create-md.js
//
// The credentials come from the environment so they never live in the repository
// (an earlier version of this file hard-coded them). The password is never
// printed. An existing account is left alone unless MD_RESET_EXISTING=yes.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { assertNotHrmsDatabase, describeTarget } = require('../db/safety');

const MIN_PASSWORD_LENGTH = 12;

async function createMD() {
  const email = (process.env.MD_EMAIL || '').trim().toLowerCase();
  const password = process.env.MD_PASSWORD || '';
  const resetExisting = process.env.MD_RESET_EXISTING === 'yes';

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error('Set MD_EMAIL to the MD\'s email address.');
    process.exitCode = 1;
    return;
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(`Set MD_PASSWORD (at least ${MIN_PASSWORD_LENGTH} characters).`);
    process.exitCode = 1;
    return;
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set.');
    process.exitCode = 1;
    return;
  }

  try {
    console.log(`Target database: ${describeTarget()}`);
    await assertNotHrmsDatabase(pool);

    const hash = await bcrypt.hash(password, 10);

    const branchResult = await pool.query(
      `SELECT id
       FROM branches
       WHERE branch_name = 'Hyderabad HQ'
       LIMIT 1`
    );
    const branchId = branchResult.rows[0]?.id || null;

    const existing = await pool.query(
      `SELECT id FROM employees WHERE LOWER(TRIM(email)) = $1`,
      [email]
    );

    if (existing.rows.length > 1) {
      console.error('More than one employee matches this email; resolve the duplicate first.');
      process.exitCode = 1;
      return;
    }

    if (existing.rows.length === 1) {
      if (!resetExisting) {
        console.error(
          'An employee with this email already exists. Nothing was changed. ' +
            'Set MD_RESET_EXISTING=yes to reset its password and make it the MD account.'
        );
        process.exitCode = 1;
        return;
      }
      await pool.query(
        `UPDATE employees
         SET
           name = 'MD',
           password_hash = $1,
           role = 'manager',
           work_profile = 'MD',
           designation = 'Managing Director',
           branch_id = $2,
           is_active = true
         WHERE id = $3`,
        [hash, branchId, existing.rows[0].id]
      );
      console.log('MD account updated.');
    } else {
      await pool.query(
        `INSERT INTO employees (
           branch_id, name, email, password_hash, role, work_profile, designation, is_active
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,true)`,
        [branchId, 'MD', email, hash, 'manager', 'MD', 'Managing Director']
      );
      console.log('MD account created.');
    }

    console.log(`Email: ${email}`);
    console.log('Work Profile: MD');
  } catch (err) {
    console.error(err.code === 'UNSAFE_DB_SCRIPT' ? `Blocked: ${err.message}` : `Failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

createMD();
