const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Only management work profiles can manage employees.
const MANAGE_WORK_PROFILES = ['MD', 'OPS_MANAGER'];

// EXACT SAME ROLE LIST USED BY INVOICE.
const VALID_ROLES = [
  'employee',
  'manager',
  'mis-executive',
  'Full-Stack-Developer',
  'Study/Visit Process Consultant',
  'Immigration Process Consultant',
];

// Existing OPS work identities.
// These control the actual OPS workflow/permissions.
const VALID_WORK_PROFILES = [
  'MD',
  'OPS_MANAGER',
  'COUNSELOR',
  'AUDITOR',
  'CASE_OFFICER',
];

// ------------------------------------------------------------
// META
// ------------------------------------------------------------
router.get(
  '/meta',
  requireAuth,
  requireRole(...MANAGE_WORK_PROFILES),
  async (req, res) => {
    try {
      const branches = await pool.query(
        `SELECT id, branch_name, city
         FROM branches
         ORDER BY branch_name`
      );

      res.json({
        branches: branches.rows,
        roles: VALID_ROLES,
        work_profiles: VALID_WORK_PROFILES,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({
        error: 'Could not load form options',
      });
    }
  }
);

// ------------------------------------------------------------
// LIST EMPLOYEES
// ------------------------------------------------------------
router.get(
  '/',
  requireAuth,
  requireRole(...MANAGE_WORK_PROFILES),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT
           e.id,
           e.name,
           e.email,
           e.display_password,
           e.role,
           e.work_profile,
           e.designation,
           e.specialty,
           e.is_active,
           e.created_at,
           b.branch_name
                  FROM employees e
         LEFT JOIN branches b ON b.id = e.branch_id
        WHERE e.work_profile <> 'MD'
         ORDER BY e.created_at DESC`
      );

      res.json({
        employees: result.rows,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({
        error: 'Could not load employees',
      });
    }
  }
);

// ------------------------------------------------------------
// CREATE EMPLOYEE
// ------------------------------------------------------------
router.post(
  '/',
  requireAuth,
  requireRole(...MANAGE_WORK_PROFILES),
  async (req, res) => {
const {
  name,
  email,
  password,
  role,
  work_profile,
  work_profiles,
  designation,
  specialty,
  branch_id,
} = req.body;
if (
  !name ||
  !email ||
  !password ||
  !role ||
  !work_profiles ||
  !Array.isArray(work_profiles) ||
  work_profiles.length === 0
) {      return res.status(400).json({
        error:
          'Name, email, password, role and work profile are required',
      });
    }

    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({
        error: 'Invalid role',
      });
    }

if (
  work_profiles.some(
    profile => !VALID_WORK_PROFILES.includes(profile)
  )
) {
  return res.status(400).json({
    error: 'Invalid work profile',
  });
}

    if (password.length < 6) {
      return res.status(400).json({
        error: 'Password must be at least 6 characters',
      });
    }

    try {
      const existing = await pool.query(
        `SELECT id
         FROM employees
         WHERE email = $1`,
        [email.toLowerCase().trim()]
      );

      if (existing.rows.length > 0) {
        return res.status(409).json({
          error: 'An employee with this email already exists',
        });
      }

      const hash = await bcrypt.hash(password, 10);
      const primaryWorkProfile = work_profiles[0];
      const result = await pool.query(
        `INSERT INTO employees (
  branch_id,
  name,
  email,
  password_hash,
  role,
  work_profile,
  designation,
  specialty,
  display_password
)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING
           id,
           name,
           email,
           role,
           work_profile,
           designation,
           specialty,
           is_active,
           created_at`,
        [
  branch_id || null,
  name.trim(),
  email.toLowerCase().trim(),
  hash,
  role,
  primaryWorkProfile,
  designation || role,
  specialty || null,
  password,
]
      );

      await pool.query(
        `INSERT INTO employee_work_profiles (
          employee_id,
          work_profile
        )
        SELECT $1, UNNEST($2::VARCHAR[])`,
        [
          result.rows[0].id,
          work_profiles,
        ]
      );

      res.status(201).json({
        employee: result.rows[0],
        temporary_password: password,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({
        error: 'Could not create employee',
      });
    }
  }
);

// ------------------------------------------------------------
// EDIT EMPLOYEE
// ------------------------------------------------------------
router.patch(
  '/:id',
  requireAuth,
  requireRole(...MANAGE_WORK_PROFILES),
  async (req, res) => {
    const { id } = req.params;

const {
  name,
  role,
  work_profile,
  work_profiles,
  designation,
  specialty,
  branch_id,
  is_active,
  password,
} = req.body;

    if (role && !VALID_ROLES.includes(role)) {
      return res.status(400).json({
        error: 'Invalid role',
      });
    }

if (
  work_profiles !== undefined &&
  (
    !Array.isArray(work_profiles) ||
    work_profiles.length === 0 ||
    work_profiles.some(
      profile => !VALID_WORK_PROFILES.includes(profile)
    )
  )
) {
  return res.status(400).json({
    error: 'Invalid work profile',
  });
}

    if (password && password.length < 6) {
      return res.status(400).json({
        error: 'Password must be at least 6 characters',
      });
    }

    try {
      const fields = [];
      const params = [];

      if (name !== undefined) {
        params.push(name.trim());
        fields.push(`name = $${params.length}`);
      }

      if (role !== undefined) {
        params.push(role);
        fields.push(`role = $${params.length}`);
      }

      if (work_profiles !== undefined) {
  const primaryWorkProfile = work_profiles[0];

  params.push(primaryWorkProfile);
  fields.push(`work_profile = $${params.length}`);
}

      if (designation !== undefined) {
        params.push(designation || null);
        fields.push(`designation = $${params.length}`);
      }

      if (specialty !== undefined) {
        params.push(specialty || null);
        fields.push(`specialty = $${params.length}`);
      }

      if (branch_id !== undefined) {
        params.push(branch_id || null);
        fields.push(`branch_id = $${params.length}`);
      }

      if (is_active !== undefined) {
        params.push(is_active);
        fields.push(`is_active = $${params.length}`);
      }

if (password) {
  const hash = await bcrypt.hash(password, 10);

  params.push(hash);
  fields.push(`password_hash = $${params.length}`);

  params.push(password);
  fields.push(`display_password = $${params.length}`);
}
if (work_profiles !== undefined) {
  await pool.query(
    `DELETE FROM employee_work_profiles
     WHERE employee_id = $1`,
    [id]
  );

  await pool.query(
    `INSERT INTO employee_work_profiles (
      employee_id,
      work_profile
    )
    SELECT $1, UNNEST($2::VARCHAR[])`,
    [
      id,
      work_profiles,
    ]
  );
}
      if (
  fields.length === 0 &&
  work_profiles === undefined
) {
  return res.status(400).json({
    error: 'Nothing to update',
  });
}

      params.push(id);

      const result = await pool.query(
        `UPDATE employees
         SET ${fields.join(', ')}
         WHERE id = $${params.length}
        RETURNING
  id,
  name,
  email,
  display_password,
  role,
  work_profile,
  designation,
  specialty,
  is_active,
  created_at`,
        params
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          error: 'Employee not found',
        });
      }

      res.json({
        employee: result.rows[0],
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({
        error: 'Could not update employee',
      });
    }
  }
);

module.exports = router;