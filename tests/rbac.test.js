const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

test.before(h.start);
test.after(h.stop);

// The people below all have employees.role = 'employee' (as real OPS staff do
// after migration 008). Before the fix, ownership checks compared that column
// with 'CASE_OFFICER'/'AUDITOR', which never matched, so nothing was enforced.
const officerA = { id: 'officer-A', role: 'employee', work_profile: 'CASE_OFFICER', work_profiles: ['CASE_OFFICER'] };
const officerB = { id: 'officer-B', role: 'employee', work_profile: 'CASE_OFFICER', work_profiles: ['CASE_OFFICER'] };
const manager = { id: 'mgr-1', role: 'employee', work_profile: 'OPS_MANAGER', work_profiles: ['OPS_MANAGER'] };
const md = { id: 'md-1', role: 'manager', work_profile: 'MD', work_profiles: ['MD'] };
const counselor = { id: 'cs-1', role: 'employee', work_profile: 'COUNSELOR', work_profiles: ['COUNSELOR'] };
const auditor = { id: 'au-1', role: 'employee', work_profile: 'AUDITOR', work_profiles: ['AUDITOR'] };

// Case 7 belongs to officer-A. Every other query returns no rows.
function seedDb() {
  h.setDb(async (sql) => {
    if (/FROM case_assignments WHERE id = \$1/.test(sql) && /case_officer_id/.test(sql)) {
      return { rows: [{ case_officer_id: 'officer-A' }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
}

const caseReadEndpoints = [
  '/api/case-documents/7',
  '/api/case-details/7',
  '/api/cases/7/financial-documentation',
  '/api/cases/7/embassy-slot',
  '/api/cases/7/pre-departure',
  '/api/cases/7/travel-arrival',
  '/api/cases/7/student-onboarding',
];

for (const url of caseReadEndpoints) {
  test(`GET ${url}: another officer is refused`, async () => {
    seedDb();
    const res = await h.call('GET', url, { token: h.sessionToken(officerB) });
    assert.equal(res.status, 403, JSON.stringify(res.body));
  });

  test(`GET ${url}: the assigned officer is allowed`, async () => {
    seedDb();
    const res = await h.call('GET', url, { token: h.sessionToken(officerA) });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  });

  test(`GET ${url}: OPS_MANAGER and MD are allowed`, async () => {
    seedDb();
    assert.equal((await h.call('GET', url, { token: h.sessionToken(manager) })).status, 200);
    assert.equal((await h.call('GET', url, { token: h.sessionToken(md) })).status, 200);
  });

  test(`GET ${url}: other work profiles and anonymous callers are refused`, async () => {
    seedDb();
    assert.equal((await h.call('GET', url, { token: h.sessionToken(counselor) })).status, 403);
    assert.equal((await h.call('GET', url, { token: h.sessionToken(auditor) })).status, 403);
    assert.equal((await h.call('GET', url)).status, 401);
  });
}

test('PUT on another officer\'s case is refused', async () => {
  seedDb();
  const res = await h.call('PUT', '/api/case-details/7/offer', {
    token: h.sessionToken(officerB),
    body: { university: 'X' },
  });
  assert.equal(res.status, 403);
});

test('document upload status change stays restricted to management', async () => {
  seedDb();
  const res = await h.call('PATCH', '/api/case-documents/doc/1/status', {
    token: h.sessionToken(officerA),
    body: { status: 'APPROVED' },
  });
  assert.equal(res.status, 403);
});

test('missing case is a 404, not a leak of other data', async () => {
  h.setDb(async () => ({ rows: [], rowCount: 0 }));
  const res = await h.call('GET', '/api/case-documents/999', { token: h.sessionToken(officerA) });
  assert.equal(res.status, 404);
});

test('case board: an officer only gets their own cases, management gets all', async () => {
  seedDb();
  await h.call('GET', '/api/cases/board', { token: h.sessionToken(officerA) });
  const own = h.queries.find((q) => /case_officer_id = \$1/.test(q.sql) && /case_assignments/.test(q.sql));
  assert.ok(own, 'officer query is scoped to the officer');
  assert.ok(own.params.includes('officer-A'));

  seedDb();
  await h.call('GET', '/api/cases/board', { token: h.sessionToken(md) });
  const scoped = h.queries.some((q) => /ca\.case_officer_id = \$/.test(q.sql));
  assert.equal(scoped, false, 'MD query is not scoped');
});

test('audit history: an auditor only sees audits they conducted', async () => {
  seedDb();
  await h.call('GET', '/api/audits/history', { token: h.sessionToken(auditor) });
  const q = h.queries.find((x) => /quality_audits/.test(x.sql));
  assert.ok(q);
  assert.match(q.sql, /qa\.auditor_id = \$1/);
  assert.deepEqual(q.params.slice(0, 1), ['au-1']);
});

test('audit history: management sees everything', async () => {
  seedDb();
  await h.call('GET', '/api/audits/history', { token: h.sessionToken(md) });
  const q = h.queries.find((x) => /quality_audits/.test(x.sql));
  assert.ok(q);
  assert.doesNotMatch(q.sql, /qa\.auditor_id = \$/);
});

test('audit history: other profiles are refused', async () => {
  seedDb();
  assert.equal((await h.call('GET', '/api/audits/history', { token: h.sessionToken(counselor) })).status, 403);
  assert.equal((await h.call('GET', '/api/audits/history', { token: h.sessionToken(officerA) })).status, 403);
});

test('leads: a counselor only gets their own leads', async () => {
  seedDb();
  await h.call('GET', '/api/leads', { token: h.sessionToken(counselor) });
  const q = h.queries.find((x) => /FROM leads l/.test(x.sql));
  assert.ok(q);
  assert.match(q.sql, /l\.counselor_id = \$/);
  assert.ok(q.params.includes('cs-1'));
});

test('leads: management gets all leads, other profiles are refused', async () => {
  seedDb();
  await h.call('GET', '/api/leads', { token: h.sessionToken(md) });
  const q = h.queries.find((x) => /FROM leads l/.test(x.sql));
  assert.doesNotMatch(q.sql, /l\.counselor_id = \$/);
  assert.equal((await h.call('GET', '/api/leads', { token: h.sessionToken(auditor) })).status, 403);
});

test('employee management stays management-only', async () => {
  seedDb();
  assert.equal((await h.call('GET', '/api/employees', { token: h.sessionToken(counselor) })).status, 403);
  assert.equal((await h.call('GET', '/api/employees', { token: h.sessionToken(officerA) })).status, 403);
  assert.equal((await h.call('GET', '/api/employees')).status, 401);
});

test('reports employee list stays management-only', async () => {
  seedDb();
  assert.equal((await h.call('GET', '/api/reports/employees', { token: h.sessionToken(counselor) })).status, 403);
});
