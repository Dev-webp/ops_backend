// Wipes ALL data (keeps table structure) then optionally reseeds.
// Run with: npm run reset          -> just clears data
//           npm run reset:seed     -> clears data AND reseeds fresh demo data
require('dotenv').config();
const pool = require('./pool');

async function reset() {
  const client = await pool.connect();
  try {
    console.log('Clearing all data...');
    await client.query(`
      TRUNCATE TABLE
        case_activity, case_assignments, quality_audits,
        agreements, leads, employees, branches
      RESTART IDENTITY CASCADE;
    `);
    console.log('✅ All data cleared. Tables are empty but structure is intact.');
  } catch (err) {
    console.error('Reset failed:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

reset();
