const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { safeEqual } = require('../middleware/auth');

test.before(h.start);
test.after(h.stop);

const md = { id: 'md-1', role: 'manager', work_profile: 'MD', work_profiles: ['MD'] };

// ---------------------------------------------------------------- passwords
test('employee list never selects or returns a stored/readable password', async () => {
  h.setDb(async () => ({
    rows: [{ id: 'e1', name: 'A', email: 'a@x.com', role: 'employee', work_profile: 'COUNSELOR', work_profiles: ['COUNSELOR'] }],
    rowCount: 1,
  }));
  const res = await h.call('GET', '/api/employees', { token: h.sessionToken(md) });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  for (const q of h.queries) {
    assert.doesNotMatch(q.sql, /display_password/, 'no query reads display_password');
    assert.doesNotMatch(q.sql, /password_hash/, 'password hashes are not listed either');
  }
  assert.doesNotMatch(JSON.stringify(res.body), /password/i);
});

test('creating an employee stores only a hash and does not echo the password', async () => {
  const plain = 'S3cretPlain!';
  h.setDb(async (sql) => {
    if (/SELECT id\s+FROM employees/.test(sql)) return { rows: [], rowCount: 0 };
    if (/INSERT INTO employees/.test(sql)) {
      return { rows: [{ id: 'new-1', name: 'N', email: 'n@x.com', role: 'employee', work_profile: 'COUNSELOR' }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  const res = await h.call('POST', '/api/employees', {
    token: h.sessionToken(md),
    body: {
      name: 'N', email: 'N@x.com', password: plain, role: 'employee',
      work_profiles: ['COUNSELOR'],
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.temporary_password, undefined);
  assert.ok(!JSON.stringify(res.body).includes(plain));

  const insert = h.queries.find((q) => /INSERT INTO employees/.test(q.sql));
  assert.doesNotMatch(insert.sql, /display_password/);
  assert.ok(!insert.params.includes(plain), 'plaintext password is never a query parameter');
  assert.ok(insert.params.some((p) => typeof p === 'string' && p.startsWith('$2')), 'a bcrypt hash is stored');
});

test('updating a password does not write a readable copy', async () => {
  h.setDb(async (sql) => {
    if (/UPDATE employees/.test(sql)) return { rows: [{ id: 'e1' }], rowCount: 1 };
    return { rows: [{ id: 'e1', role: 'employee', work_profile: 'COUNSELOR' }], rowCount: 1 };
  });
  await h.call('PATCH', '/api/employees/e1', {
    token: h.sessionToken(md),
    body: { password: 'AnotherPlain1!' },
  });
  for (const q of h.queries) {
    assert.doesNotMatch(q.sql, /display_password/);
    assert.ok(!(q.params || []).includes('AnotherPlain1!'));
  }
});

// ------------------------------------------------------------- internal key
const invoicePush = (headers) =>
  h.call('POST', '/api/leads/from-invoice', { headers, body: {} });

test('internal endpoint: missing, wrong and empty keys are rejected', async () => {
  assert.equal((await invoicePush({})).status, 401);
  assert.equal((await invoicePush({ 'x-internal-key': 'wrong' })).status, 401);
  assert.equal((await invoicePush({ 'x-internal-key': '' })).status, 401);
  assert.equal((await invoicePush({ 'x-internal-key': process.env.OPS_INTERNAL_API_KEY + 'x' })).status, 401);
});

test('internal endpoint: a user session is not an internal key', async () => {
  const res = await h.call('POST', '/api/leads/from-invoice', {
    token: h.sessionToken(md),
    body: { student_name: 'S', phone: '1' },
  });
  assert.equal(res.status, 401);
});

test('internal endpoint: the correct key passes authentication', async () => {
  const res = await invoicePush({ 'x-internal-key': process.env.OPS_INTERNAL_API_KEY });
  assert.equal(res.status, 400, 'reaches validation, which asks for student_name and phone');
});

test('internal endpoint fails closed (503) when no key is configured', async () => {
  const saved = process.env.OPS_INTERNAL_API_KEY;
  delete process.env.OPS_INTERNAL_API_KEY;
  try {
    assert.equal((await invoicePush({ 'x-internal-key': 'anything' })).status, 503);
    assert.equal((await invoicePush({})).status, 503);
  } finally {
    process.env.OPS_INTERNAL_API_KEY = saved;
  }
});

test('safeEqual compares correctly regardless of length', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual('', 'abc'), false);
});

// ------------------------------------------------------------ error handler
test('malformed JSON gets a clean 400 without internals', async () => {
  const res = await fetch(`${h.url()}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not json',
  });
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.deepEqual(body, { error: 'Invalid JSON body' });
});

test('a disallowed browser origin gets a clean 403, not a 500 with details', async () => {
  const res = await fetch(`${h.url()}/health`, { headers: { Origin: 'https://evil.example' } });
  const body = await res.json();
  assert.equal(res.status, 403);
  assert.deepEqual(body, { error: 'Origin not allowed' });
});

test('an allowed origin still works', async () => {
  const res = await fetch(`${h.url()}/health`, { headers: { Origin: 'http://localhost:5173' } });
  assert.equal(res.status, 200);
});

test('a rejected upload type is reported to the client as a 400', async () => {
  h.setDb(async () => ({ rows: [{ case_officer_id: 'md-1' }], rowCount: 1 }));
  const form = new FormData();
  form.append('doc_type', 'PASSPORT');
  form.append('file', new Blob(['x'], { type: 'text/plain' }), 'evil.exe');
  const res = await fetch(`${h.url()}/api/case-documents/7`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${h.sessionToken(md)}` },
    body: form,
  });
  assert.equal(res.status, 400);
});
