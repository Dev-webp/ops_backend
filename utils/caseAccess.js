const { isManagementUser } = require('../middleware/auth');

// One rule for every route that reads or writes a single case:
//   * MD and OPS_MANAGER (management) can open any case.
//   * Everyone else who reaches the route (the routes already restrict who
//     that is, to Case Officers) can open only the cases assigned to them.
//
// This is based on the person's work profiles, not on employees.role. That
// column holds values such as "employee" or "manager", so comparing it with
// "CASE_OFFICER" never matched and left every case open to every officer.
async function assertCaseAccess(client, caseId, user) {
  const result = await client.query(
    `SELECT case_officer_id FROM case_assignments WHERE id = $1`,
    [caseId]
  );
  if (result.rows.length === 0) {
    return { ok: false, code: 404, error: 'Case not found' };
  }
  if (!isManagementUser(user) && result.rows[0].case_officer_id !== user.id) {
    return { ok: false, code: 403, error: 'This case is not assigned to you' };
  }
  return { ok: true };
}

module.exports = { assertCaseAccess };
