const mysql = require('mysql2/promise');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// MySQL Connection Pool Setup
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'attendance_system',
  port: parseInt(process.env.DB_PORT || '3306'),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // Return dates as strings, not JS Date objects (matches PG behavior)
  dateStrings: true
});

// Compatibility shim: wraps mysql2 results to look like pg's { rows, rowCount }
const query = async (text, params) => {
  // Convert PostgreSQL-style $1, $2 placeholders to MySQL ? placeholders
  let mysqlText = text;
  if (params && params.length > 0) {
    mysqlText = text.replace(/\$(\d+)/g, '?');
  }
  const [rows, fields] = await pool.query(mysqlText, params);
  // For SELECT queries, rows is an array of results
  // For INSERT/UPDATE/DELETE, rows is a ResultSetHeader with affectedRows, insertId, etc.
  if (Array.isArray(rows)) {
    return { rows, rowCount: rows.length };
  }
  return { rows: [], rowCount: rows.affectedRows, insertId: rows.insertId };
};

// Initialize Database Schemas (no seed data — production clean start)
const initializeDb = async () => {
  try {
    // 1. Employees Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS employees (
        id VARCHAR(50) PRIMARY KEY,
        fingerprint_id INT UNIQUE,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) DEFAULT '',
        email VARCHAR(150) UNIQUE NOT NULL,
        phone VARCHAR(50),
        dob DATE,
        joining_date DATE NOT NULL,
        designation VARCHAR(100),
        department VARCHAR(100),
        reporting_manager VARCHAR(100),
        shift_start TIME NOT NULL,
        shift_end TIME NOT NULL,
        salary_type VARCHAR(20) DEFAULT 'monthly',
        monthly_rate DECIMAL(12, 2) DEFAULT 0.00,
        hourly_rate DECIMAL(12, 2) DEFAULT 0.00,
        lifecycle_status VARCHAR(50) DEFAULT 'Probation',
        probation_months INT DEFAULT 6,
        probation_end_date DATE,
        confirmation_date DATE,
        notice_period_end_date DATE,
        exit_date DATE,
        exit_reason TEXT,
        enrolled TINYINT(1) DEFAULT 0,
        leaves_taken DECIMAL(5, 2) DEFAULT 0.00,
        payroll_start_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Ensure leaves_taken column is DECIMAL(5,2) (handles case where table existed with INT)
    try {
      await pool.query('ALTER TABLE employees MODIFY COLUMN leaves_taken DECIMAL(5, 2) DEFAULT 0.00');
      console.log('[DB] Verified employees.leaves_taken column is DECIMAL(5,2).');
    } catch (colErr) {
      console.warn('[DB] Could not alter employees.leaves_taken column:', colErr.message);
    }

    // 2. Attendance Logs Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS attendance_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        employee_id VARCHAR(50),
        employee_name VARCHAR(200),
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        action VARCHAR(20) NOT NULL,
        device VARCHAR(50) DEFAULT 'GATE_1',
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
      )
    `);

    // 3. Documents Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS documents (
        id INT AUTO_INCREMENT PRIMARY KEY,
        employee_id VARCHAR(50),
        type VARCHAR(100) NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        upload_date DATE NOT NULL DEFAULT (CURRENT_DATE),
        status VARCHAR(50) DEFAULT 'Uploaded',
        file_path VARCHAR(500) NOT NULL,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
      )
    `);

    // 4. Admin credentials table (for password changes)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_credentials (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(150) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // 5. Holidays Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS holidays (
        id INT AUTO_INCREMENT PRIMARY KEY,
        holiday_date DATE UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 6. Salary Payments Table (History of Paid Salaries)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS salary_payments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        employee_id VARCHAR(50) NOT NULL,
        employee_name VARCHAR(200) NOT NULL,
        payment_date DATE NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        present_days DECIMAL(5, 2) DEFAULT 0.00,
        weekly_offs INT DEFAULT 0,
        holidays INT DEFAULT 0,
        absent_days DECIMAL(5, 2) DEFAULT 0.00,
        base_salary DECIMAL(12, 2) NOT NULL,
        earnings DECIMAL(12, 2) NOT NULL,
        deductions DECIMAL(12, 2) NOT NULL,
        net_salary DECIMAL(12, 2) NOT NULL,
        status VARCHAR(20) DEFAULT 'Paid',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
      )
    `);

    // Seed default admin if table is empty
    const [adminRows] = await pool.query('SELECT COUNT(*) AS count FROM admin_credentials');
    if (parseInt(adminRows[0].count) === 0) {
      const defaultUser = process.env.ADMIN_USER || 'admin@cubiccode.io';
      const defaultPass = process.env.ADMIN_PASS || '123456';
      await pool.query(
        'INSERT INTO admin_credentials (username, password) VALUES (?, ?)',
        [defaultUser, defaultPass]
      );
      console.log(`[DB] Default admin created: ${defaultUser}`);
    }

    // Seed default holidays if table is empty
    const [holidayRows] = await pool.query('SELECT COUNT(*) AS count FROM holidays');
    if (parseInt(holidayRows[0].count) === 0) {
      const defaultHolidays = [
        { date: '2026-01-01', name: "New Year's Day" },
        { date: '2026-01-26', name: 'Republic Day' },
        { date: '2026-08-15', name: 'Independence Day' },
        { date: '2026-10-02', name: 'Gandhi Jayanti' },
        { date: '2026-12-25', name: 'Christmas' }
      ];
      for (const h of defaultHolidays) {
        await pool.query(
          'INSERT IGNORE INTO holidays (holiday_date, name) VALUES (?, ?)',
          [h.date, h.name]
        );
      }
      console.log('[DB] Default public holidays seeded.');
    }

    console.log('[DB] MySQL tables initialized successfully.');
  } catch (err) {
    console.error('[DB] Error during database initialization:', err.message);
  }
};

// Drop all tables and recreate (admin-only reset)
const resetDatabase = async () => {
  const uploadsDir = path.join(__dirname, 'uploads');

  try {
    // Disable FK checks so we can drop in any order
    await pool.query('SET FOREIGN_KEY_CHECKS = 0');
    await pool.query('DROP TABLE IF EXISTS salary_payments');
    await pool.query('DROP TABLE IF EXISTS documents');
    await pool.query('DROP TABLE IF EXISTS holidays');
    await pool.query('DROP TABLE IF EXISTS attendance_logs');
    await pool.query('DROP TABLE IF EXISTS employees');
    await pool.query('DROP TABLE IF EXISTS admin_credentials');
    await pool.query('SET FOREIGN_KEY_CHECKS = 1');

    console.log('[DB] All tables dropped successfully.');

    // Clear uploaded files
    if (fs.existsSync(uploadsDir)) {
      const files = fs.readdirSync(uploadsDir);
      for (const file of files) {
        const filePath = path.join(uploadsDir, file);
        if (fs.statSync(filePath).isFile()) {
          fs.unlinkSync(filePath);
        }
      }
      console.log(`[DB] Cleared ${files.length} uploaded files.`);
    }

    // Recreate schema
    await initializeDb();

    return { success: true, message: 'Database reset completed. All data has been cleared.' };
  } catch (err) {
    console.error('[DB] Error during database reset:', err.message);
    return { success: false, error: err.message };
  }
};

// Health check — verify MySQL connection
const checkHealth = async () => {
  try {
    const [timeRows] = await pool.query('SELECT NOW() AS server_time');
    const [empCount] = await pool.query('SELECT COUNT(*) AS count FROM employees');
    const [logCount] = await pool.query('SELECT COUNT(*) AS count FROM attendance_logs');
    const [docCount] = await pool.query('SELECT COUNT(*) AS count FROM documents');

    return {
      status: 'healthy',
      database: 'connected',
      serverTime: timeRows[0].server_time,
      counts: {
        employees: parseInt(empCount[0].count),
        attendanceLogs: parseInt(logCount[0].count),
        documents: parseInt(docCount[0].count)
      }
    };
  } catch (err) {
    return {
      status: 'unhealthy',
      database: 'disconnected',
      error: err.message
    };
  }
};

module.exports = {
  query,
  pool,
  initializeDb,
  resetDatabase,
  checkHealth
};
