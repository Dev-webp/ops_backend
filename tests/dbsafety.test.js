const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const h = require('./helpers');
const { assertSafeToRunDestructive, assertNotHrmsDatabase, describeTarget, HRMS_MARKER_TABLES } = require('../db/safety');

function fakeDb({ db = 'ops_scratch', tables = [] } = {}) {
  return {
    query: async (sql) => {
      if (/current_database/.test(sql)) return { rows: [{ db }] };
      return { rows: tables.map((t) => ({ table_name: t })) };
    },
  };
}

function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  return Promise.resolve(fn()).finally(() => {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
}

const base = {
  DATABASE_URL: 'postgresql://u:secret@db.example:5432/ops_scratch',
  NODE_ENV: 'development',
  OPS_ALLOW_DESTRUCTIVE: 'yes',
  OPS_CONFIRM_DB: 'ops_scratch',
};

test('passes only when every condition is met', async () => {
  await withEnv(base, async () => {
    await assertSafeToRunDestructive(fakeDb(), 'reset');
  });
});

test('refuses without DATABASE_URL', async () => {
  await withEnv({ ...base, DATABASE_URL: undefined }, async () => {
    await assert.rejects(assertSafeToRunDestructive(fakeDb(), 'reset'), /DATABASE_URL/);
  });
});

test('refuses in production', async () => {
  await withEnv({ ...base, NODE_ENV: 'production' }, async () => {
    await assert.rejects(assertSafeToRunDestructive(fakeDb(), 'reset'), /production/);
  });
});

test('refuses without explicit opt-in', async () => {
  await withEnv({ ...base, OPS_ALLOW_DESTRUCTIVE: undefined }, async () => {
    await assert.rejects(assertSafeToRunDestructive(fakeDb(), 'reset'), /OPS_ALLOW_DESTRUCTIVE=yes/);
  });
});

test('refuses when the confirmed database name is wrong or missing', async () => {
  await withEnv({ ...base, OPS_CONFIRM_DB: 'something_else' }, async () => {
    await assert.rejects(assertSafeToRunDestructive(fakeDb(), 'reset'), /exact database name/);
  });
  await withEnv({ ...base, OPS_CONFIRM_DB: undefined }, async () => {
    await assert.rejects(assertSafeToRunDestructive(fakeDb(), 'reset'), /exact database name/);
  });
});

test('refuses an HRMS-shaped database even with the full opt-in', async () => {
  await withEnv(base, async () => {
    await assert.rejects(
      assertSafeToRunDestructive(fakeDb({ tables: ['users', 'attendance'] }), 'reset'),
      /HRMS tables \(users, attendance\)/
    );
  });
  await assert.rejects(assertNotHrmsDatabase(fakeDb({ tables: ['payroll'] })), /HRMS tables/);
});

test('HRMS marker tables never include a table OPS itself owns', () => {
  const opsTables = ['employees', 'branches', 'leads', 'agreements', 'quality_audits', 'case_assignments',
    'case_activity', 'case_documents', 'notifications', 'employee_work_profiles'];
  for (const t of opsTables) assert.ok(!HRMS_MARKER_TABLES.includes(t), `${t} would block OPS itself`);
});

test('the target description never contains the password', () => {
  const d = describeTarget('postgresql://user:hunter2@db.example:5432/ops_scratch');
  assert.equal(d, 'db.example:5432/ops_scratch');
  assert.ok(!d.includes('hunter2'));
});

test('every destructive script and SQL file carries the guard', () => {
  const root = path.join(__dirname, '..');
  for (const f of ['db/reset.js', 'db/seed.js', 'db/seed-demo.js']) {
    assert.match(fs.readFileSync(path.join(root, f), 'utf8'), /assertSafeToRunDestructive\(/, f);
  }
  for (const f of ['db/reset.sql', 'db/schema.sql']) {
    const sql = fs.readFileSync(path.join(root, f), 'utf8');
    assert.match(sql, /SAFETY GUARD/, f);
    assert.match(sql, /ops\.confirm_destroy/, f);
    assert.ok(sql.indexOf('SAFETY GUARD') < sql.search(/DROP TABLE|TRUNCATE/), `${f}: guard comes before the first destructive statement`);
  }
});

test('create-md.js has no hard-coded credentials', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'create-md.js'), 'utf8');
  assert.match(src, /process\.env\.MD_PASSWORD/);
  assert.doesNotMatch(src, /password\s*=\s*['"][^'"]{4,}['"]/);
  assert.doesNotMatch(src, /console\.log\([^)]*password/i);
});

// ------------------------------------------------------------------ uploads
test.describe('/uploads', () => {
  test.before(h.start);
  test.after(h.stop);

  test('uploaded files are not served to anonymous callers', async () => {
    const res = await fetch(`${h.url()}/uploads/case_documents/anything.pdf`);
    assert.equal(res.status, 401);
  });

  test('uploaded files need a valid session (Bearer or cookie)', async () => {
    const bearer = await fetch(`${h.url()}/uploads/case_documents/missing.pdf`, {
      headers: { Authorization: `Bearer ${h.sessionToken()}` },
    });
    assert.equal(bearer.status, 404, 'authenticated, then simply not found');
    const cookie = await fetch(`${h.url()}/uploads/case_documents/missing.pdf`, {
      headers: { Cookie: `vjc_token=${h.sessionToken()}` },
    });
    assert.equal(cookie.status, 404);
  });

  test('path traversal does not escape the uploads folder', async () => {
    const res = await fetch(`${h.url()}/uploads/..%2f..%2fpackage.json`, {
      headers: { Authorization: `Bearer ${h.sessionToken()}` },
    });
    assert.ok([400, 403, 404].includes(res.status), `status ${res.status}`);
  });
});
