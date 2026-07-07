const express = require('express');
const cors = require('cors');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5001;
const startTime = Date.now();

const formatLocalDate = (d) => {
  if (!d) return '';
  if (typeof d === 'string') return d.split('T')[0];
  if (!(d instanceof Date)) return '';
  return d.getFullYear() + '-' + 
         String(d.getMonth() + 1).padStart(2, '0') + '-' + 
         String(d.getDate()).padStart(2, '0');
};

// ============================================================
// MIDDLEWARE
// ============================================================

// Path rewrite middleware for subfolder deployments (e.g. /attendance)
app.use((req, res, next) => {
  if (req.url.startsWith('/attendance')) {
    req.url = req.url.substring('/attendance'.length);
    if (!req.url.startsWith('/')) {
      req.url = '/' + req.url;
    }
  }
  next();
});

// CORS — allow dashboard origin
app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request Logger
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logLevel = res.statusCode >= 400 ? 'WARN' : 'INFO';
    console.log(`[${logLevel}] ${req.method} ${req.originalUrl} → ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// Ensure uploads folder exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

// Serve frontend static files from parent directory
const frontendDir = path.join(__dirname, '..');
app.use('/css', express.static(path.join(frontendDir, 'css')));
app.use('/js', express.static(path.join(frontendDir, 'js')));
app.use('/cubiccode_logo.png', express.static(path.join(frontendDir, 'cubiccode_logo.png')));

// SQLite Session Store
const sessionDbName = process.env.SESSION_DB_FILE ? path.basename(process.env.SESSION_DB_FILE) : 'sessions.db';
const sessionDbDir = process.env.SESSION_DB_FILE ? path.dirname(process.env.SESSION_DB_FILE) : './';

app.use(session({
  store: new SQLiteStore({ db: sessionDbName, dir: sessionDbDir }),
  secret: process.env.SESSION_SECRET || 'quantumclk_secret_key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    secure: false, // Set to true behind HTTPS reverse proxy
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// ============================================================
// AUTH MIDDLEWARE
// ============================================================

const requireAdmin = (req, res, next) => {
  if (req.session && req.session.isAdmin) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized: Admin session required' });
  }
};

// ============================================================
// DB INIT ON BOOT
// ============================================================
db.initializeDb();

// ============================================================
// PUBLIC ENDPOINTS
// ============================================================

// Health Check (public — for monitoring & load balancers)
app.get('/api/health', async (req, res) => {
  const health = await db.checkHealth();
  health.uptime = Math.floor((Date.now() - startTime) / 1000);
  health.version = '2.0.0';
  health.environment = process.env.NODE_ENV || 'development';
  res.status(health.status === 'healthy' ? 200 : 503).json(health);
});

// Serve frontend HTML
app.get(['/', '/FingerTrack_Enterprise_Demo.html', '/index.html'], (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.sendFile(path.join(frontendDir, 'FingerTrack_Enterprise_Demo.html'));
});

// ============================================================
// AUTH ENDPOINTS
// ============================================================

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    // Check admin_credentials table first
    const result = await db.query(
      'SELECT * FROM admin_credentials WHERE username = $1 AND password = $2',
      [username, password]
    );

    if (result.rows.length > 0) {
      req.session.isAdmin = true;
      req.session.username = username;
      console.log(`[AUTH] Login success: ${username}`);
      return res.json({ success: true, user: { username } });
    }

    console.log(`[AUTH] Login failed: invalid credentials for "${username}"`);
    res.status(400).json({ error: 'Invalid admin credentials' });
  } catch (err) {
    console.error('[AUTH] Login error:', err.message);
    res.status(500).json({ error: 'Internal server error during authentication' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ error: 'Could not log out' });
    }
    res.json({ success: true });
  });
});

app.get('/api/auth/session', (req, res) => {
  if (req.session && req.session.isAdmin) {
    res.json({ loggedIn: true, user: { username: req.session.username } });
  } else {
    res.json({ loggedIn: false });
  }
});

// Change Admin Password (requires current session)
app.post('/api/auth/change-password', requireAdmin, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }

  if (newPassword.length < 4) {
    return res.status(400).json({ error: 'New password must be at least 4 characters' });
  }

  try {
    const username = req.session.username;
    const check = await db.query(
      'SELECT * FROM admin_credentials WHERE username = $1 AND password = $2',
      [username, currentPassword]
    );

    if (check.rows.length === 0) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    await db.query(
      'UPDATE admin_credentials SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE username = $2',
      [newPassword, username]
    );

    console.log(`[AUTH] Password changed for: ${username}`);
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    console.error('[AUTH] Password change error:', err.message);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// ============================================================
// EMPLOYEES CRUD (Protected)
// ============================================================

// GET: All Employees
app.get('/api/employees', requireAdmin, async (req, res) => {
  try {
    const employeesResult = await db.query('SELECT * FROM employees ORDER BY created_at DESC');
    const docsResult = await db.query(`
      SELECT 
        employee_id, 
        COUNT(*) as count,
        SUM(CASE WHEN status = 'Rejected' THEN 1 ELSE 0 END) as rejected_count,
        SUM(CASE WHEN status IN ('Uploaded', 'Pending', 'Pending Verification') THEN 1 ELSE 0 END) as pending_count
      FROM documents 
      GROUP BY employee_id
    `);

    const docCounts = {};
    const docRejected = {};
    const docPending = {};

    docsResult.rows.forEach(row => {
      docCounts[row.employee_id] = parseInt(row.count);
      docRejected[row.employee_id] = parseInt(row.rejected_count || 0);
      docPending[row.employee_id] = parseInt(row.pending_count || 0);
    });

    const employees = employeesResult.rows.map(emp => ({
      id: emp.id,
      fingerprintId: emp.fingerprint_id,
      firstName: emp.first_name,
      lastName: emp.last_name,
      email: emp.email,
      phone: emp.phone,
      dateOfBirth: formatLocalDate(emp.dob),
      joiningDate: formatLocalDate(emp.joining_date),
      designation: emp.designation,
      department: emp.department,
      reportingManager: emp.reporting_manager,
      shiftStart: emp.shift_start ? emp.shift_start.slice(0, 5) : '09:00',
      shiftEnd: emp.shift_end ? emp.shift_end.slice(0, 5) : '18:00',
      salaryType: emp.salary_type,
      monthlyRate: parseFloat(emp.monthly_rate || 0),
      hourlyRate: parseFloat(emp.hourly_rate || 0),
      lifecycleStatus: emp.lifecycle_status,
      probationMonths: emp.probation_months,
      probationEndDate: formatLocalDate(emp.probation_end_date),
      confirmationDate: formatLocalDate(emp.confirmation_date),
      noticePeriodEndDate: formatLocalDate(emp.notice_period_end_date),
      exitDate: formatLocalDate(emp.exit_date),
      exitReason: emp.exit_reason,
      enrolled: emp.enrolled,
      leavesTaken: parseFloat(emp.leaves_taken || 0),
      payrollStartDate: formatLocalDate(emp.payroll_start_date),
      documentCount: docCounts[emp.id] || 0,
      hasRejectedDocuments: (docRejected[emp.id] || 0) > 0,
      hasPendingDocuments: (docPending[emp.id] || 0) > 0
    }));

    res.json(employees);
  } catch (err) {
    console.error('[EMPLOYEES] Fetch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST: Add Employee
app.post('/api/employees', requireAdmin, async (req, res) => {
  const emp = req.body;
  try {
    await db.query(`
      INSERT INTO employees (
        id, fingerprint_id, first_name, last_name, email, phone, dob, joining_date,
        designation, department, reporting_manager, shift_start, shift_end, salary_type,
        monthly_rate, hourly_rate, lifecycle_status, probation_months, probation_end_date, confirmation_date,
        notice_period_end_date, exit_date, exit_reason, enrolled, leaves_taken, payroll_start_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
    `, [
      emp.id, emp.fingerprintId || null, emp.firstName, emp.lastName || '', emp.email, emp.phone || '',
      emp.dateOfBirth || null, emp.joiningDate, emp.designation || '', emp.department || '',
      emp.reportingManager || '', emp.shiftStart, emp.shiftEnd, emp.salaryType || 'monthly',
      emp.monthlyRate || 0, emp.hourlyRate || 0, emp.lifecycleStatus || 'Probation',
      emp.probationMonths || 6, emp.probationEndDate || null, emp.confirmationDate || null,
      emp.noticePeriodEndDate || null, emp.exitDate || null, emp.exitReason || '',
      emp.enrolled ? 1 : 0, emp.leavesTaken || 0, emp.payrollStartDate || emp.joiningDate
    ]);
    console.log(`[EMPLOYEES] Added: ${emp.id} (${emp.firstName} ${emp.lastName || ''})`);
    res.status(201).json({ success: true, message: 'Employee added successfully' });
  } catch (err) {
    console.error('[EMPLOYEES] Add error:', err.message);
    if (err.code === 'ER_DUP_ENTRY' && err.message.includes('PRIMARY')) {
      res.status(409).json({ error: `Employee ID "${emp.id}" already exists. Please refresh the page and try again.` });
    } else if (err.code === 'ER_DUP_ENTRY' && err.message.includes('email')) {
      res.status(409).json({ error: `An employee with email "${emp.email}" already exists.` });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// PUT: Edit Employee
app.put('/api/employees/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const emp = req.body;
  try {
    // Preserve existing fingerprint_id if not provided in the request
    let fpId = emp.fingerprintId;
    if (fpId === undefined || fpId === null || fpId === '') {
      const existing = await db.query('SELECT fingerprint_id FROM employees WHERE id = $1', [id]);
      if (existing.rows.length > 0) {
        fpId = existing.rows[0].fingerprint_id;
      }
    }

    await db.query(`
      UPDATE employees SET
        fingerprint_id = $1, first_name = $2, last_name = $3, email = $4, phone = $5,
        dob = $6, joining_date = $7, designation = $8, department = $9, reporting_manager = $10,
        shift_start = $11, shift_end = $12, salary_type = $13, monthly_rate = $14, hourly_rate = $15,
        lifecycle_status = $16, probation_months = $17, probation_end_date = $18, confirmation_date = $19,
        notice_period_end_date = $20, exit_date = $21, exit_reason = $22, enrolled = $23, leaves_taken = $24,
        payroll_start_date = $25, updated_at = CURRENT_TIMESTAMP
      WHERE id = $26
    `, [
      fpId || null, emp.firstName, emp.lastName || '', emp.email, emp.phone || '',
      emp.dateOfBirth || null, emp.joiningDate, emp.designation || '', emp.department || '',
      emp.reportingManager || '', emp.shiftStart, emp.shiftEnd, emp.salaryType || 'monthly',
      emp.monthlyRate || 0, emp.hourlyRate || 0, emp.lifecycleStatus, emp.probationMonths || 6,
      emp.probationEndDate || null, emp.confirmationDate || null, emp.noticePeriodEndDate || null,
      emp.exitDate || null, emp.exitReason || '', emp.enrolled ? 1 : 0, emp.leavesTaken || 0,
      emp.payrollStartDate || emp.joiningDate, id
    ]);
    console.log(`[EMPLOYEES] Updated: ${id}`);
    res.json({ success: true, message: 'Employee updated successfully' });
  } catch (err) {
    console.error('[EMPLOYEES] Update error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE: Remove Employee
app.delete('/api/employees/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    // Delete associated document files physically
    const docs = await db.query('SELECT file_path FROM documents WHERE employee_id = $1', [id]);
    for (const doc of docs.rows) {
      const fullPath = path.join(__dirname, doc.file_path);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    }

    await db.query('DELETE FROM employees WHERE id = $1', [id]);
    console.log(`[EMPLOYEES] Deleted: ${id}`);
    res.json({ success: true, message: 'Employee removed successfully' });
  } catch (err) {
    console.error('[EMPLOYEES] Delete error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST: Pay Salary / Reset Payroll Cycle for Employee
app.post('/api/employees/:id/pay', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { 
    paymentDate, employeeName, startDate, baseSalary, daysPresent, 
    weeklyOffs, holidays, absentDays, earnings, deductions, net 
  } = req.body; // format: YYYY-MM-DD for dates
  
  if (!paymentDate) {
    return res.status(400).json({ error: 'paymentDate parameter is required' });
  }

  try {
    // 1. Calculate next payroll start date (paymentDate + 1 day)
    const payDate = new Date(paymentDate);
    payDate.setDate(payDate.getDate() + 1);
    const nextPayrollStartDate = payDate.getFullYear() + '-' +
                                 String(payDate.getMonth() + 1).padStart(2, '0') + '-' +
                                 String(payDate.getDate()).padStart(2, '0');

    // 2. Insert record into salary_payments table
    await db.query(
      `INSERT INTO salary_payments (
        employee_id, employee_name, payment_date, start_date, end_date, 
        present_days, weekly_offs, holidays, absent_days, 
        base_salary, earnings, deductions, net_salary, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Paid')`,
      [
        id,
        employeeName || 'Employee',
        paymentDate,
        startDate || paymentDate,
        paymentDate,
        daysPresent || 0,
        weeklyOffs || 0,
        holidays || 0,
        absentDays || 0,
        baseSalary || 0,
        earnings || 0,
        deductions || 0,
        net || 0
      ]
    );

    // 3. Update employee payroll start date to next cycle
    await db.query(
      'UPDATE employees SET payroll_start_date = ? WHERE id = ?',
      [nextPayrollStartDate, id]
    );

    console.log(`[PAYROLL] Paid employee: ${id} up to ${paymentDate}. Record stored in salary_payments. Next cycle starts on ${nextPayrollStartDate}`);
    res.json({ success: true, message: `Salary payment registered. Next cycle starts on ${nextPayrollStartDate}`, nextStartDate: nextPayrollStartDate });
  } catch (err) {
    console.error('[PAYROLL] Pay error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ATTENDANCE LOGS (Protected)
// ============================================================

app.get('/api/attendance', requireAdmin, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM attendance_logs ORDER BY timestamp DESC LIMIT 500');
    res.json(result.rows);
  } catch (err) {
    console.error('[ATTENDANCE] Fetch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// FINGERPRINT HARDWARE INTEGRATION (ESP32 — no session auth)
// ============================================================

// POST: ESP32 Attendance Logging
app.post('/api/hardware/log', async (req, res) => {
  const { device, employee_id, employee_name, fingerprint_id, action } = req.body;

  if ((!employee_id && !fingerprint_id) || !action) {
    return res.status(400).json({ error: 'Missing employee_id/fingerprint_id or action parameter' });
  }

  if (!['IN', 'OUT'].includes(action.toUpperCase())) {
    return res.status(400).json({ error: 'Action must be IN or OUT' });
  }

  let empId = employee_id;
  let empName = employee_name;
  let isLate = false;
  let delayMinutes = 0;

  try {
    if (!empId && fingerprint_id) {
      const findRes = await db.query(`
        SELECT id, first_name, last_name, shift_start FROM employees 
        WHERE fingerprint_id = $1 
        LIMIT 1
      `, [fingerprint_id]);
      if (findRes.rows.length > 0) {
        empId = findRes.rows[0].id;
        empName = `${findRes.rows[0].first_name} ${findRes.rows[0].last_name}`;
        
        const shiftStartStr = findRes.rows[0].shift_start ? findRes.rows[0].shift_start.slice(0, 5) : '09:00';
        const [shiftH, shiftM] = shiftStartStr.split(':').map(Number);
        const now = new Date();
        const checkInMin = now.getHours() * 60 + now.getMinutes();
        const shiftStartMin = shiftH * 60 + shiftM;
        delayMinutes = checkInMin - shiftStartMin;
        if (action.toUpperCase() === 'IN' && delayMinutes > 15) {
          isLate = true;
        }
      } else if (employee_name) {
        // Self-healing: fingerprint link broken, try matching by name and auto-relink
        const cleanName = employee_name.trim().toLowerCase();
        const nameRes = await db.query(`
          SELECT id, first_name, last_name, shift_start FROM employees 
          WHERE LOWER(TRIM(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, '')))) = $1
             OR LOWER(TRIM(COALESCE(first_name, ''))) = $2
          LIMIT 1
        `, [cleanName, cleanName]);
        
        if (nameRes.rows.length > 0) {
          empId = nameRes.rows[0].id;
          empName = `${nameRes.rows[0].first_name} ${nameRes.rows[0].last_name}`;
          
          // Auto-relink: restore the broken fingerprint_id
          await db.query(`UPDATE employees SET fingerprint_id = $1, enrolled = true WHERE id = $2`, [fingerprint_id, empId]);
          console.log(`[HARDWARE] Auto-relinked fingerprint #${fingerprint_id} → ${empId} (${empName})`);
          
          const shiftStartStr = nameRes.rows[0].shift_start ? nameRes.rows[0].shift_start.slice(0, 5) : '09:00';
          const [shiftH, shiftM] = shiftStartStr.split(':').map(Number);
          const now = new Date();
          const checkInMin = now.getHours() * 60 + now.getMinutes();
          const shiftStartMin = shiftH * 60 + shiftM;
          delayMinutes = checkInMin - shiftStartMin;
          if (action.toUpperCase() === 'IN' && delayMinutes > 15) {
            isLate = true;
          }
        } else {
          return res.status(404).json({ error: `No employee found with fingerprint ID: ${fingerprint_id} or name: ${employee_name}` });
        }
      } else {
        return res.status(404).json({ error: `No employee found with fingerprint ID: ${fingerprint_id}` });
      }
    } else if (empId) {
      const findRes = await db.query(`
        SELECT first_name, last_name, shift_start FROM employees 
        WHERE id = $1 
        LIMIT 1
      `, [empId]);
      if (findRes.rows.length > 0) {
        empName = `${findRes.rows[0].first_name} ${findRes.rows[0].last_name}`;
        const shiftStartStr = findRes.rows[0].shift_start ? findRes.rows[0].shift_start.slice(0, 5) : '09:00';
        const [shiftH, shiftM] = shiftStartStr.split(':').map(Number);
        const now = new Date();
        const checkInMin = now.getHours() * 60 + now.getMinutes();
        const shiftStartMin = shiftH * 60 + shiftM;
        delayMinutes = checkInMin - shiftStartMin;
        if (action.toUpperCase() === 'IN' && delayMinutes > 15) {
          isLate = true;
        }
      }
    }

    await db.query(`
      INSERT INTO attendance_logs (employee_id, employee_name, action, device)
      VALUES ($1, $2, $3, $4)
    `, [empId, empName || 'UNKNOWN', action.toUpperCase(), device || 'GATE_1']);

    console.log(`[HARDWARE] ${action.toUpperCase()} logged for ${empId} via ${device || 'GATE_1'} (Late: ${isLate}, Delay: ${delayMinutes} mins)`);
    res.status(201).json({ 
      success: true, 
      message: isLate ? 'Attendance logged (LATE)' : 'Attendance log recorded',
      late: isLate,
      delay: delayMinutes
    });
  } catch (err) {
    console.error('[HARDWARE] Log error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST: ESP32 Enrollment Confirmation
app.post('/api/hardware/enroll', async (req, res) => {
  const { employee_id, fingerprint_id, device, employee_name } = req.body;

  if ((!employee_id && !employee_name) || !fingerprint_id) {
    return res.status(400).json({ error: 'Missing employee_id/employee_name or fingerprint_id' });
  }

  let empId = employee_id;
  let isNew = false;

  try {
    if (!empId && employee_name) {
      // Look up employee by matching first_name + last_name case-insensitively
      const cleanName = employee_name.trim().toLowerCase();
      const findRes = await db.query(`
        SELECT id FROM employees 
        WHERE LOWER(TRIM(CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, '')))) = $1 
           OR LOWER(TRIM(COALESCE(first_name, ''))) = $2
        LIMIT 1
      `, [cleanName, cleanName]);

      if (findRes.rows.length > 0) {
        empId = findRes.rows[0].id;
      } else {
        // Automatically create a new employee profile if not found
        isNew = true;

        // Generate unique employee ID suffix in backend
        const maxIdRes = await db.query("SELECT id FROM employees WHERE id LIKE 'EMP-%'");
        let nextNum = 1030; // Start suffix range
        maxIdRes.rows.forEach(row => {
          const parts = row.id.split('-');
          if (parts.length >= 3) {
            const num = parseInt(parts[2], 10);
            if (!isNaN(num) && num >= nextNum) {
              nextNum = num + 1;
            }
          }
        });
        empId = `EMP-GEN-${nextNum}`;

        // Split name into first and last name components
        const nameParts = employee_name.trim().split(/\s+/);
        const firstName = nameParts[0] || 'Unknown';
        const lastName = nameParts.slice(1).join(' ') || '';
        
        const placeholderEmail = `setup-${nextNum}@cubiccode.io`;
        const tzOffset = new Date().getTimezoneOffset() * 60000;
        const todayDate = new Date(Date.now() - tzOffset).toISOString().split('T')[0];

        // Insert placeholder profile
        await db.query(`
          INSERT INTO employees (
            id, fingerprint_id, first_name, last_name, email, phone, dob, joining_date,
            designation, department, reporting_manager, shift_start, shift_end, salary_type,
            monthly_rate, hourly_rate, lifecycle_status, enrolled, leaves_taken
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        `, [
          empId, fingerprint_id, firstName, lastName, placeholderEmail, '', null, todayDate,
          'Pending Setup', 'General', 'System Admin', '09:00', '18:00', 'monthly',
          0, 0, 'Probation', 1, 0
        ]);

        console.log(`[HARDWARE] Auto-created new employee: ${empId} for name: ${employee_name}`);
      }
    }

    // Clear slot from any other employee first to prevent UNIQUE constraint violation
    await db.query(`
      UPDATE employees 
      SET fingerprint_id = NULL, enrolled = false 
      WHERE fingerprint_id = $1 AND id != $2
    `, [fingerprint_id, empId]);

    if (!isNew) {
      const result = await db.query(`
        UPDATE employees
        SET enrolled = true, fingerprint_id = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `, [fingerprint_id, empId]);

      if (result.rowCount === 0) {
        return res.status(404).json({ error: 'Employee not found' });
      }
    }

    await db.query(`
      INSERT INTO attendance_logs (employee_id, employee_name, action, device)
      VALUES ($1, $2, $3, $4)
    `, [empId, employee_name || 'System Update', 'ENROLL', device || 'GATE_1']);

    console.log(`[HARDWARE] Enrolled: ${empId} → fingerprint #${fingerprint_id}`);
    res.json({ success: true, message: isNew ? 'New employee profile auto-created' : 'Employee enrollment saved', employee_id: empId });
  } catch (err) {
    console.error('[HARDWARE] Enroll error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST: Hardware delete endpoint (triggered by ESP32 delete options)
app.post('/api/hardware/delete', async (req, res) => {
  const { fingerprint_id } = req.body;
  try {
    if (!fingerprint_id) {
      return res.status(400).json({ error: 'fingerprint_id is required' });
    }
    
    // 1. Fetch employee to log deletion info
    const findRes = await db.query('SELECT id, first_name, last_name FROM employees WHERE fingerprint_id = $1', [fingerprint_id]);
    
    if (findRes.rows.length === 0) {
      console.log(`[HARDWARE] Delete: No employee found with fingerprint slot #${fingerprint_id}`);
      return res.json({ success: true, message: 'No employee matched this fingerprint slot in database' });
    }
    
    const empId = findRes.rows[0].id;
    const empName = `${findRes.rows[0].first_name} ${findRes.rows[0].last_name}`;
    
    // 2. Delete employee from database
    await db.query('DELETE FROM employees WHERE id = $1', [empId]);
    
    // 3. Log the deletion in attendance_logs for audit
    await db.query(`
      INSERT INTO attendance_logs (employee_id, employee_name, action, device)
      VALUES (NULL, $1, $2, $3)
    `, [empName, 'DELETE', 'ESP32_READER_1']);
    
    console.log(`[HARDWARE] Deleted employee ${empName} (ID: ${empId}) via ESP32 deletion of slot #${fingerprint_id}`);
    res.json({ success: true, message: `Employee ${empName} successfully deleted from website database` });
  } catch (err) {
    console.error('[HARDWARE] Delete error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// DOCUMENT MANAGEMENT (Protected)
// ============================================================

// Allowed file types
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/jpg',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
];

const MAX_FILE_SIZE = parseInt(process.env.MAX_UPLOAD_SIZE_MB || '10') * 1024 * 1024;

// Multer Disk Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const safeName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9]/g, '_');
    cb(null, `${Date.now()}_${safeName}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.mimetype}. Allowed: PDF, JPG, PNG, DOC, DOCX`));
    }
  }
});

// POST: Upload Document
app.post('/api/documents/upload', requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const { employee_id, type } = req.body;
  if (!employee_id || !type) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Missing employee_id or document type' });
  }

  const relativePath = `uploads/${req.file.filename}`;

  try {
    await db.query(`
      INSERT INTO documents (employee_id, type, file_name, file_path, status)
      VALUES ($1, $2, $3, $4, 'Verified')
    `, [employee_id, type, req.file.originalname, relativePath]);

    // MySQL doesn't support RETURNING * — fetch the inserted row
    const inserted = await db.query('SELECT * FROM documents WHERE employee_id = $1 ORDER BY id DESC LIMIT 1', [employee_id]);

    console.log(`[DOCUMENTS] Uploaded: ${req.file.originalname} for ${employee_id}`);
    res.status(201).json(inserted.rows[0]);
  } catch (err) {
    fs.unlinkSync(req.file.path);
    console.error('[DOCUMENTS] Upload error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Multer error handler
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: `File too large. Maximum size: ${process.env.MAX_UPLOAD_SIZE_MB || 10}MB` });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err.message && err.message.includes('File type not allowed')) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

// GET: Fetch Employee Documents
app.get('/api/documents/employee/:empId', requireAdmin, async (req, res) => {
  const { empId } = req.params;
  try {
    const result = await db.query('SELECT * FROM documents WHERE employee_id = $1 ORDER BY id DESC', [empId]);
    const documents = result.rows.map(row => ({
      ...row,
      upload_date: formatLocalDate(row.upload_date)
    }));
    res.json(documents);
  } catch (err) {
    console.error('[DOCUMENTS] Fetch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH: Verify or Reject Document
app.patch('/api/documents/:id/status', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['Verified', 'Rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid document status. Must be: Verified or Rejected' });
  }

  try {
    const result = await db.query(`
      UPDATE documents
      SET status = $1
      WHERE id = $2
    `, [status, id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // Fetch the updated row (MySQL doesn't support RETURNING *)
    const updated = await db.query('SELECT * FROM documents WHERE id = $1', [id]);

    console.log(`[DOCUMENTS] Status updated: doc #${id} → ${status}`);
    res.json(updated.rows[0]);
  } catch (err) {
    console.error('[DOCUMENTS] Status update error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE: Remove Document
app.delete('/api/documents/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const docResult = await db.query('SELECT * FROM documents WHERE id = $1', [id]);
    if (docResult.rows.length === 0) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const doc = docResult.rows[0];
    const fullPath = path.join(__dirname, doc.file_path);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }

    await db.query('DELETE FROM documents WHERE id = $1', [id]);
    console.log(`[DOCUMENTS] Deleted: doc #${id}`);
    res.json({ success: true, message: 'Document deleted' });
  } catch (err) {
    console.error('[DOCUMENTS] Delete error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// HOLIDAYS ENDPOINTS
// ============================================================

// GET: Fetch all holidays
app.get('/api/holidays', requireAdmin, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM holidays ORDER BY holiday_date ASC');
    const holidays = result.rows.map(row => ({
      ...row,
      holiday_date: formatLocalDate(row.holiday_date)
    }));
    res.json(holidays);
  } catch (err) {
    console.error('[HOLIDAYS] Fetch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST: Add a holiday
app.post('/api/holidays', requireAdmin, async (req, res) => {
  const { holiday_date, name } = req.body;
  if (!holiday_date || !name) {
    return res.status(400).json({ error: 'holiday_date and name are required' });
  }

  try {
    await db.query(`
      INSERT INTO holidays (holiday_date, name)
      VALUES ($1, $2)
      ON DUPLICATE KEY UPDATE name = VALUES(name)
    `, [holiday_date, name.trim()]);
    
    // Fetch the inserted/updated row (MySQL doesn't support RETURNING *)
    const fetchResult = await db.query('SELECT * FROM holidays WHERE holiday_date = $1', [holiday_date]);
    
    console.log(`[HOLIDAYS] Added/Updated: ${name} on ${holiday_date}`);
    const row = fetchResult.rows[0];
    res.status(201).json({
      ...row,
      holiday_date: formatLocalDate(row.holiday_date)
    });
  } catch (err) {
    console.error('[HOLIDAYS] Insert error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE: Remove a holiday
app.delete('/api/holidays/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query('DELETE FROM holidays WHERE id = $1', [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Holiday not found' });
    }
    console.log(`[HOLIDAYS] Deleted: holiday #${id}`);
    res.json({ success: true, message: 'Holiday deleted' });
  } catch (err) {
    console.error('[HOLIDAYS] Delete error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ADMIN ENDPOINTS
// ============================================================

// POST: Reset Database (drops all data!)
app.post('/api/admin/reset-database', requireAdmin, async (req, res) => {
  console.log(`[ADMIN] Database reset requested by: ${req.session.username}`);
  const result = await db.resetDatabase();
  if (result.success) {
    // Destroy session after reset (admin_credentials table was recreated)
    req.session.destroy(() => {});
    res.json(result);
  } else {
    res.status(500).json(result);
  }
});

// ============================================================

// ============================================================
// PUBLIC PAYSLIP VIEW (for employees)
// ============================================================
app.get('/payslip/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const empRes = await db.query('SELECT * FROM employees WHERE id = $1', [id]);
    if (empRes.rows.length === 0) {
      return res.status(404).send('Employee not found');
    }
    const emp = empRes.rows[0];
    
    // Fetch logs
    const logRes = await db.query('SELECT * FROM attendance_logs WHERE employee_id = $1', [id]);
    const logs = logRes.rows;
    
    // Fetch holidays
    const holRes = await db.query('SELECT * FROM holidays');
    const holidaysList = holRes.rows;

    const formatLocalDate = (d) => {
      if (!d) return '';
      if (typeof d === 'string') return d.split('T')[0];
      if (!(d instanceof Date)) return '';
      return d.getFullYear() + '-' + 
             String(d.getMonth() + 1).padStart(2, '0') + '-' + 
             String(d.getDate()).padStart(2, '0');
    };

    const empFormatted = {
      ...emp,
      id: emp.id,
      firstName: emp.first_name,
      lastName: emp.last_name,
      email: emp.email,
      phone: emp.phone,
      joiningDate: formatLocalDate(emp.joining_date),
      payrollStartDate: formatLocalDate(emp.payroll_start_date),
      shiftStart: emp.shift_start ? emp.shift_start.slice(0, 5) : '09:00',
      shiftEnd: emp.shift_end ? emp.shift_end.slice(0, 5) : '18:00',
      salaryType: emp.salary_type,
      monthlyRate: parseFloat(emp.monthly_rate || 0),
      hourlyRate: parseFloat(emp.hourly_rate || 0),
      enrolled: emp.enrolled,
      leavesTaken: parseFloat(emp.leaves_taken || 0)
    };

    // Compile logs
    const grouped = {};
    for (const log of logs) {
      const timestamp = new Date(log.timestamp);
      const dateStr = timestamp.getFullYear() + '-' + 
                      String(timestamp.getMonth() + 1).padStart(2, '0') + '-' + 
                      String(timestamp.getDate()).padStart(2, '0');
      const timeStr = String(timestamp.getHours()).padStart(2, '0') + ':' + 
                      String(timestamp.getMinutes()).padStart(2, '0');
      if (!grouped[dateStr]) grouped[dateStr] = [];
      grouped[dateStr].push({ action: log.action, timeStr, timestamp, device: log.device });
    }

    const now = new Date();
    const datesList = [];
    for (let i = 30; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const dateStr = d.getFullYear() + '-' + 
                      String(d.getMonth() + 1).padStart(2, '0') + '-' + 
                      String(d.getDate()).padStart(2, '0');
      datesList.push({ dateStr, dayOfWeek: d.getDay() });
    }

    const todayStr = formatLocalDate(new Date());
    const attendanceHistory = [];
    datesList.forEach(({ dateStr, dayOfWeek }) => {
      const cutoffDate = empFormatted.payrollStartDate || empFormatted.joiningDate;
      if (cutoffDate && dateStr < cutoffDate) {
        return;
      }
      const dayLogs = grouped[dateStr];
      let login = null;
      let logout = null;
      let checkInLog = null;
      let checkOutLog = null;
      
      if (dayLogs) {
        checkInLog = dayLogs.find(l => l.action === 'IN');
        checkOutLog = dayLogs.find(l => l.action === 'OUT');
        login = checkInLog ? checkInLog.timeStr : null;
        logout = checkOutLog ? checkOutLog.timeStr : null;
      }
      
      const isHoliday = holidaysList.some(h => {
        const hDate = new Date(h.holiday_date);
        const hDateStr = hDate.getFullYear() + '-' + 
                         String(hDate.getMonth() + 1).padStart(2, '0') + '-' + 
                         String(hDate.getDate()).padStart(2, '0');
        return hDateStr === dateStr;
      });

      const hasJoined = !empFormatted.joiningDate || (dateStr >= empFormatted.joiningDate);
      const hasOccurred = dateStr <= todayStr;
      let status = (hasJoined && hasOccurred) ? 'Absent' : '—';
      let hours = 0;

      const isSaturday = (dayOfWeek === 6);
      const halfDayThreshold = isSaturday ? 4.0 : 5.0;

      if (login && logout) {
        status = (checkInLog && checkInLog.device === 'WFH_DASHBOARD') ? 'Work From Home' : 'Present';
        const [linH, linM] = login.split(':').map(Number);
        const [loutH, loutM] = logout.split(':').map(Number);
        const loginMin = linH * 60 + linM;
        const logoutMin = loutH * 60 + loutM;
        hours = Math.round(((logoutMin - loginMin) / 60) * 100) / 100;
        if (hours < halfDayThreshold && status !== 'Work From Home') {
          status = 'Half Day';
        }
      } else if (login) {
        status = (checkInLog && checkInLog.device === 'WFH_DASHBOARD') ? 'Work From Home' : 'Present';
        hours = 4.0;
        if (hours < halfDayThreshold && status !== 'Work From Home') {
          status = 'Half Day';
        }
      } else if (logout) {
        status = 'Present';
        hours = 4.0;
        if (hours < halfDayThreshold) {
          status = 'Half Day';
        }
      } else if (isHoliday && hasJoined && hasOccurred) {
        status = 'Holiday';
      } else if (dayOfWeek === 0 && hasJoined && hasOccurred) {
        status = 'Weekly Off';
      }

      attendanceHistory.push({ date: dateStr, status, hours });
    });

    const presentDays = attendanceHistory.filter(r => ['Present', 'Work From Home', 'Holiday'].includes(r.status)).length;
    const halfDays = attendanceHistory.filter(r => r.status === 'Half Day').length;
    const days = presentDays + halfDays * 0.5;

    const hours = attendanceHistory.reduce((s, r) => s + (r.hours || 0), 0);
    const md = { days, hours };

    const WORK_DAYS = 26;
    const absentDays = attendanceHistory.filter(r => r.status === 'Absent' && r.date !== todayStr).length;
    const halfDaysForLeaves = attendanceHistory.filter(r => r.status === 'Half Day' && r.date !== todayStr).length;
    const totalLeavesTaken = (empFormatted.leavesTaken || 0) + absentDays + (halfDaysForLeaves * 0.5);
    
    const paidAllowance = 2.5; 
    const paidLeaves = Math.min(totalLeavesTaken, paidAllowance);
    const paidDays = Math.min(WORK_DAYS, md.days + paidLeaves);
    
    let basicPay = 0;
    if (empFormatted.salaryType === 'monthly') {
      basicPay = Math.round((empFormatted.monthlyRate / WORK_DAYS) * paidDays);
    } else {
      basicPay = Math.round(md.hours * empFormatted.hourlyRate);
    }

    let lateCount = 0;
    datesList.forEach(({ dateStr }) => {
      const dayLogs = grouped[dateStr];
      if (dayLogs) {
        const checkIn = dayLogs.find(l => l.action === 'IN');
        if (checkIn && checkIn.device !== 'WFH_DASHBOARD') {
          const [linH, linM] = checkIn.timeStr.split(':').map(Number);
          const [sH, sM] = empFormatted.shiftStart.split(':').map(Number);
          const loginMin = linH * 60 + linM;
          const shiftMin = sH * 60 + sM;
          if (loginMin > shiftMin + 15) {
            lateCount++;
          }
        }
      }
    });

    const penaltyPerLate = 100;
    const habitualThreshold = 3;
    const latePenalty = lateCount >= habitualThreshold ? (lateCount * penaltyPerLate) : 0;
    const unpaidLeaveDeduction = empFormatted.salaryType === 'monthly' && totalLeavesTaken > paidAllowance 
      ? Math.round((totalLeavesTaken - paidAllowance) * (empFormatted.monthlyRate / WORK_DAYS)) 
      : 0;

    const totalDeductions = latePenalty;
    const netPay = Math.max(0, basicPay - totalDeductions);

    const fmt = (val) => '₹' + Number(val).toLocaleString('en-IN');
    const currentMonth = now.toLocaleString('default', { month: 'long', year: 'numeric' });

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Payslip - ${empFormatted.firstName} ${empFormatted.lastName}</title>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <style>
          :root {
            --primary: #6366f1;
            --primary-dark: #4f46e5;
            --bg: #f8fafc;
            --surface: #ffffff;
            --text: #0f172a;
            --text-secondary: #475569;
            --border: #e2e8f0;
            --success: #10b981;
            --danger: #ef4444;
          }
          body {
            font-family: 'Outfit', sans-serif;
            background: var(--bg);
            color: var(--text);
            margin: 0;
            padding: 40px 20px;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
          }
          .payslip-card {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 16px;
            box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05), 0 8px 10px -6px rgba(0,0,0,0.05);
            max-width: 650px;
            width: 100%;
            padding: 40px;
            box-sizing: border-box;
          }
          .header {
            text-align: center;
            border-bottom: 2px solid var(--border);
            padding-bottom: 24px;
            margin-bottom: 24px;
          }
          .logo {
            font-size: 24px;
            font-weight: 700;
            color: var(--primary);
            letter-spacing: -0.5px;
            margin: 0 0 4px 0;
          }
          .subtitle {
            font-size: 14px;
            color: var(--text-secondary);
            margin: 0;
          }
          .meta-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
            margin-bottom: 24px;
          }
          .meta-item {
            font-size: 14px;
          }
          .meta-item strong {
            color: var(--text-secondary);
            font-weight: 500;
            display: block;
            margin-bottom: 2px;
          }
          .meta-item span {
            font-weight: 600;
            color: var(--text);
          }
          .payslip-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 24px;
          }
          .payslip-table th, .payslip-table td {
            border: 1px solid var(--border);
            padding: 10px 14px;
            font-size: 14px;
            text-align: left;
          }
          .payslip-table th {
            background: #f1f5f9;
            font-weight: 600;
            color: var(--text-secondary);
          }
          .payslip-table tr.total-row {
            background: #f8fafc;
            font-weight: 600;
          }
          .net-pay {
            background: #e0f2fe;
            border: 1px solid #bae6fd;
            border-radius: 8px;
            padding: 16px;
            text-align: center;
            font-size: 18px;
            font-weight: 700;
            color: #0369a1;
            margin-bottom: 24px;
          }
          .footer {
            text-align: center;
            font-size: 12px;
            color: var(--text-secondary);
          }
          .btn-print {
            display: block;
            width: 100%;
            background: var(--primary);
            color: #fff;
            border: none;
            border-radius: 8px;
            padding: 12px;
            font-size: 15px;
            font-weight: 600;
            cursor: pointer;
            text-align: center;
            box-sizing: border-box;
            text-decoration: none;
            margin-bottom: 16px;
            transition: background 0.2s;
          }
          .btn-print:hover {
            background: var(--primary-dark);
          }
          @media print {
            body {
              background: #fff;
              padding: 0;
            }
            .payslip-card {
              border: none;
              box-shadow: none;
              padding: 0;
            }
            .btn-print {
              display: none;
            }
          }
        </style>
      </head>
      <body>
        <div class="payslip-card">
          <div class="header">
            <h1 class="logo">CUBIC CODE</h1>
            <p class="subtitle">Salary Payslip — ${currentMonth}</p>
          </div>
          
          <div class="meta-grid">
            <div class="meta-item"><strong>Employee Name</strong><span>${empFormatted.firstName} ${empFormatted.lastName}</span></div>
            <div class="meta-item"><strong>Employee ID</strong><span>${empFormatted.id}</span></div>
            <div class="meta-item"><strong>Department</strong><span>${empFormatted.department}</span></div>
            <div class="meta-item"><strong>Designation</strong><span>${empFormatted.designation || 'Staff'}</span></div>
            <div class="meta-item"><strong>Days Worked</strong><span>${md.days} / 26 days</span></div>
            <div class="meta-item"><strong>Leaves Taken</strong><span>${totalLeavesTaken} days</span></div>
          </div>
          
          <table class="payslip-table">
            <thead>
              <tr>
                <th>Earnings</th>
                <th>Amount</th>
                <th>Deductions</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Basic Pay</td>
                <td>${fmt(basicPay)}</td>
                <td>Unpaid Leaves (LOP)</td>
                <td>${fmt(unpaidLeaveDeduction)}</td>
              </tr>
              <tr>
                <td>Overtime Bonus</td>
                <td>${fmt(0)}</td>
                <td>Late Penalty (${lateCount} times)</td>
                <td>${fmt(latePenalty)}</td>
              </tr>
              <tr class="total-row">
                <td>Total Gross</td>
                <td>${fmt(basicPay)}</td>
                <td>Total Deductions</td>
                <td>${fmt(totalDeductions)}</td>
              </tr>
            </tbody>
          </table>
          
          <div class="net-pay">
            Net Payable Salary: ${fmt(netPay)}
          </div>
          
          <button class="btn-print" onclick="window.print()">Download PDF / Print</button>
          
          <div class="footer">
            <p>This is a computer-generated payslip. Generated by FingerTrack Enterprise.</p>
          </div>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('[PAYSLIP] View error:', err.message);
    res.status(500).send('Failed to generate payslip view: ' + err.message);
  }
});

// START SERVER
// ============================================================
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n====================================================`);
  console.log(`  QuantumCLK Backend v2.0.0`);
  console.log(`  Port: ${PORT}`);
  console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`  Frontend: http://localhost:${PORT}/`);
  console.log(`  Health:   http://localhost:${PORT}/api/health`);
  console.log(`====================================================\n`);
});
