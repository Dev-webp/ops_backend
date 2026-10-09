require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');

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
      return callback(new Error(`Origin ${origin} is not allowed by CORS`));
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
const isVercel = Boolean(process.env.VERCEL);

if (!isVercel) {
  ['audits', 'case_documents'].forEach((dir) => {
    fs.mkdirSync(path.join(__dirname, 'uploads', dir), {
      recursive: true,
    });
  });

  app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
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
app.use('/api/reports', reportsRoutes);
app.get('/health', (req, res) => res.json({ ok: true }));

// Fallback errors from multer etc.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Something went wrong' });
});

app.listen(PORT, () => {
  console.log(`\n  VJC Ops API running → http://localhost:${PORT}\n`);
});
