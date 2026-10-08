require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');

async function createMD() {
  const email = 'admin@vjcops.com';
  const password = 'admin@2009';

  try {
    const hash = await bcrypt.hash(password, 10);

    const branchResult = await pool.query(
      `SELECT id
       FROM branches
       WHERE branch_name = 'Hyderabad HQ'
       LIMIT 1`
    );

    const branchId = branchResult.rows[0]?.id || null;

    const existing = await pool.query(
      `SELECT id
       FROM employees
       WHERE email = $1`,
      [email]
    );

    if (existing.rows.length > 0) {
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
         WHERE email = $3`,
        [hash, branchId, email]
      );

      console.log('MD account updated successfully.');
    } else {
      await pool.query(
        `INSERT INTO employees (
           branch_id,
           name,
           email,
           password_hash,
           role,
           work_profile,
           designation,
           is_active
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,true)`,
        [
          branchId,
          'MD',
          email,
          hash,
          'manager',
          'MD',
          'Managing Director',
        ]
      );

      console.log('MD account created successfully.');
    }

    console.log('Email:', email);
    console.log('Password:', password);
    console.log('Role: manager');
    console.log('Work Profile: MD');

  } catch (err) {
    console.error('Failed:', err);
  } finally {
    await pool.end();
  }
}

createMD();