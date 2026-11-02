// Guards for scripts that wipe or seed data (reset, seed, seed-demo).
//
// These scripts used to run against whatever DATABASE_URL pointed at, with no
// questions asked. Pointed at the wrong database (for example the HRMS one) the
// reset would have truncated it, and the seeds would have planted accounts with
// a well-known password. Every check below must pass before they do anything.

// Tables that exist in the HRMS database and never in the OPS database. If any
// of them is present, this is not an OPS database.
const HRMS_MARKER_TABLES = [
  'users',
  'attendance',
  'attendance_records',
  'leave_requests',
  'leave_balance',
  'payroll',
  'payslip_records',
  'employee_breaks',
];

class UnsafeDatabaseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UnsafeDatabaseError';
    this.code = 'UNSAFE_DB_SCRIPT';
  }
}

// host/database from DATABASE_URL, never the credentials.
function describeTarget(connectionString = process.env.DATABASE_URL) {
  try {
    const u = new URL(connectionString);
    return `${u.hostname}${u.port ? `:${u.port}` : ''}/${u.pathname.replace(/^\//, '')}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

async function assertNotHrmsDatabase(queryable) {
  const { rows } = await queryable.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = current_schema()
       AND table_name = ANY($1::text[])`,
    [HRMS_MARKER_TABLES]
  );
  if (rows.length > 0) {
    throw new UnsafeDatabaseError(
      `Refusing to run: the target database contains HRMS tables (${rows
        .map((r) => r.table_name)
        .join(', ')}). This script is for the OPS database only.`
    );
  }
}

// Data-destroying or account-creating scripts.
async function assertSafeToRunDestructive(queryable, scriptName) {
  if (!process.env.DATABASE_URL) {
    throw new UnsafeDatabaseError('DATABASE_URL is not set.');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new UnsafeDatabaseError(
      `${scriptName} will not run when NODE_ENV=production.`
    );
  }

  const { rows } = await queryable.query('SELECT current_database() AS db');
  const db = rows[0].db;
  console.log(`Target database: ${describeTarget()} (current_database = ${db})`);

  await assertNotHrmsDatabase(queryable);

  if (process.env.OPS_ALLOW_DESTRUCTIVE !== 'yes') {
    throw new UnsafeDatabaseError(
      `${scriptName} changes or erases data. Re-run with OPS_ALLOW_DESTRUCTIVE=yes ` +
        `and OPS_CONFIRM_DB=${db} to confirm you mean this database.`
    );
  }
  if (process.env.OPS_CONFIRM_DB !== db) {
    throw new UnsafeDatabaseError(
      `OPS_CONFIRM_DB must be set to the exact database name (${db}) to confirm the target.`
    );
  }
}

module.exports = {
  assertSafeToRunDestructive,
  assertNotHrmsDatabase,
  describeTarget,
  UnsafeDatabaseError,
  HRMS_MARKER_TABLES,
};
