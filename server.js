require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const { requireAuth } = require('./middleware/auth');
const pool = require('./db/pool');
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const leadRoutes = require('./routes/leads');
const auditRoutes = require('./routes/audits');
const caseRoutes = require('./routes/cases');
const documentRoutes = require('./routes/documents');
const caseDetailsRoutes = require('./routes/caseDetails');
const notificationRoutes = require('./routes/notifications');
const employeeRoutes = require('./routes/employees');
const reportsRoutes = require('./routes/reports');

const app = express();
const PORT = process.env.PORT || 4000;

// Frontend origin(s) allowed to call this API (comma-separated for several).
const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // allow same-origin / curl / server-to-server calls (no Origin header)
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(Object.assign(new Error('Origin not allowed'), { code: 'ORIGIN_NOT_ALLOWED' }));
    },
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());


/*
 * Local development: create upload folders on disk.
 * Vercel serverless: skip local folder creation.
 */
const isProduction = process.env.NODE_ENV === 'production';

if (!isProduction) {
  ['audits', 'case_documents'].forEach((dir) => {
    fs.mkdirSync(path.join(__dirname, 'uploads', dir), {
      recursive: true,
    });
  });

  // Uploaded audit audio and case documents hold personal data, so they are
  // only served to a signed-in user (cookie or Bearer token).
  app.use('/uploads', requireAuth, express.static(path.join(__dirname, 'uploads')));
}

app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/audits', auditRoutes);
app.use('/api/cases', caseRoutes);
app.use('/api/case-documents', documentRoutes);
app.use('/api/case-details', caseDetailsRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/admin', employeeRoutes);
app.use('/api/reports', reportsRoutes);
app.get('/health', (req, res) => res.json({ ok: true }));

// Fallback errors. Only errors that are meant for the client (bad upload,
// bad JSON, rejected origin) show their message; anything else is logged on the
// server and answered with a generic message so internals never leak.
app.use((err, req, res, next) => {
  if (err && err.code === 'ORIGIN_NOT_ALLOWED') {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  if (err && err.name === 'MulterError') {
    return res.status(400).json({ error: err.message });
  }
  // Body-parser errors also set expose=true, so they must be matched before the
  // generic expose branch or the parser's own message (which quotes the body)
  // would be sent to the client.
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large' });
  }
  if (err && err.expose === true && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

// Only listen when run directly (npm start). When the file is imported, for
// example by the test suite or a serverless runtime, the caller owns the server.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  VJC Ops API running → http://localhost:${PORT}\n`);
  });

  // Remove expired single-use SSO token ids (hourly).
  setInterval(() => {
    pool
      .query('DELETE FROM public.ops_sso_used_tokens WHERE expires_at < now()')
      .catch((e) => console.error('[OPS_SSO] cleanup failed:', e.message));
  }, 60 * 60 * 1000).unref();
}
module.exports = app;