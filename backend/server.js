process.env.TZ = 'Asia/Kolkata';
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const db = require('./db');

const settingsPath = path.join(__dirname, 'leave_settings.json');
let LEAVE_SETTINGS = {
  casualCount: 1.0,
  sickCount: 1.0,
  optionalCount: 0.5,
  lopRule: 'pro-rata',
  halfDayRule: 0.5,
  monthlyLimit: 1.5,
  carryForward: false,
  carryForwardMax: 5,
  latePenalty: {
    enabled: true,
    graceMinutes: 10,
    warningThreshold: 3,
    penaltyPerLate: 500,
    maxPenaltyPct: 10
  }
};

try {
  if (fs.existsSync(settingsPath)) {
    LEAVE_SETTINGS = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } else {
    fs.writeFileSync(settingsPath, JSON.stringify(LEAVE_SETTINGS, null, 2), 'utf8');
  }
} catch (err) {
  console.error('[SETTINGS] Error loading/creating settings file:', err.message);
}


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

// ============================================================
// DEVELOPER IN-MEMORY LOG BUFFER (Last 500 lines)
// ============================================================
const MAX_LOG_BUFFER = 500;
const devLogBuffer = [];

function pushDevLog(type, message, meta = null) {
  const entry = {
    timestamp: new Date().toISOString(),
    type,
    message: typeof message === 'string' ? message : JSON.stringify(message),
    meta
  };
  devLogBuffer.push(entry);
  if (devLogBuffer.length > MAX_LOG_BUFFER) {
    devLogBuffer.shift();
  }
}

// Hook console.error and console.warn to capture stack traces in buffer
const origConsoleError = console.error;
const origConsoleWarn = console.warn;
console.error = function (...args) {
  origConsoleError.apply(console, args);
  pushDevLog('ERROR', args.map(a => (a && a.stack) ? a.stack : (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '));
};
console.warn = function (...args) {
  origConsoleWarn.apply(console, args);
  pushDevLog('WARN', args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
};

// Request Logger
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logLevel = res.statusCode >= 500 ? 'ERROR' : (res.statusCode >= 400 ? 'WARN' : 'INFO');
    const logMsg = `[${logLevel}] ${req.method} ${req.originalUrl} → ${res.statusCode} (${duration}ms)`;
    console.log(logMsg);
    if (res.statusCode >= 400) {
      pushDevLog(logLevel, logMsg, { ip: req.ip, user: req.session ? (req.session.username || req.session.employeeId) : null });
    }
  });
  next();
});

// Ensure uploads folder exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));

const frontendDir = path.join(__dirname, '..');
const staticOptions = {
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
};
app.use('/css', express.static(path.join(frontendDir, 'css'), staticOptions));
app.use('/js', express.static(path.join(frontendDir, 'js'), staticOptions));
app.get('/favicon.ico', (req, res) => {
  const icoPath = path.join(frontendDir, 'favicon.ico');
  if (fs.existsSync(icoPath)) {
    res.setHeader('Content-Type', 'image/x-icon');
    return res.sendFile(icoPath);
  }
  res.sendFile(path.join(frontendDir, 'musingquills_logo.png'));
});
app.get(['/favicon.png', '/apple-touch-icon.png', '/apple-touch-icon-precomposed.png'], (req, res) => {
  res.sendFile(path.join(frontendDir, 'musingquills_logo.png'));
});
app.get('/musingquills_logo.png', (req, res) => res.sendFile(path.join(frontendDir, 'musingquills_logo.png')));
app.get('/musingquills_horizontal_blue.png', (req, res) => res.sendFile(path.join(frontendDir, 'musingquills_horizontal_blue.png')));
app.get('/musingquills_horizontal_gold.png', (req, res) => res.sendFile(path.join(frontendDir, 'musingquills_horizontal_gold.png')));
app.use(express.static(frontendDir, staticOptions));

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

const requireEmployee = async (req, res, next) => {
  if (!req.session || (!req.session.employeeId && !req.session.isAdmin)) {
    return res.status(401).json({ error: 'Unauthorized: Employee session required' });
  }

  // If logged in as an employee, verify their account is active
  if (req.session.employeeId && !req.session.isAdmin) {
    try {
      const chk = await db.query('SELECT lifecycle_status FROM employees WHERE id = $1', [req.session.employeeId]);
      if (chk.rows.length === 0) {
        req.session.destroy(() => {});
        return res.status(403).json({ error: 'Account not found. Portal access revoked.' });
      }
      const st = (chk.rows[0].lifecycle_status || '').trim().toLowerCase();
      if (['exited', 'terminated', 'inactive'].includes(st)) {
        req.session.destroy(() => {});
        return res.status(403).json({ error: 'Account Deactivated: This employee is inactive/exited. Portal access revoked.' });
      }
    } catch (err) {
      console.error('[AUTH] requireEmployee lifecycle check error:', err.message);
    }
  }

  next();
};

const requireAuth = (req, res, next) => {
  if (req.session && (req.session.isAdmin || req.session.employeeId)) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized: Authentication required' });
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

// Reverse Geocoding Proxy (resolves GPS coordinates to human-readable address/place name)
app.get('/api/geo/reverse', async (req, res) => {
  const { lat, lon } = req.query;
  if (!lat || !lon) {
    return res.status(400).json({ error: 'Latitude and Longitude required' });
  }

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
    const geoRes = await fetch(url, {
      headers: {
        'User-Agent': 'QuantumCLKAttendance/2.0 (contact@quantumclk.internal)',
        'Accept': 'application/json'
      }
    });

    if (!geoRes.ok) {
      throw new Error(`Reverse geocode returned status ${geoRes.status}`);
    }

    const data = await geoRes.json();
    const addr = data.address || {};

    const specific = addr.amenity || addr.building || addr.office || addr.shop || addr.leisure || '';
    const street = [addr.house_number, addr.road || addr.pedestrian || addr.footway || addr.street].filter(Boolean).join(' ');
    const locality = addr.suburb || addr.neighbourhood || addr.residential || addr.quarter || '';
    const city = addr.city || addr.town || addr.village || addr.municipality || addr.county || '';
    const postcode = addr.postcode || '';
    const state = addr.state || '';

    const parts = [];
    if (specific) parts.push(specific);
    if (street && !parts.includes(street)) parts.push(street);
    if (locality && !parts.includes(locality)) parts.push(locality);
    if (city && !parts.includes(city)) parts.push(city);
    if (postcode && !parts.includes(postcode)) parts.push(postcode);
    if (state && !parts.includes(state)) parts.push(state);

    const locationName = parts.length > 0
      ? parts.join(', ')
      : (data.display_name || `Location (${lat}, ${lon})`);

    res.json({
      success: true,
      locationName,
      fullAddress: data.display_name || locationName,
      lat,
      lon
    });
  } catch (err) {
    console.error('[GEO] Reverse geocode error:', err.message);
    res.json({
      success: false,
      error: err.message,
      lat,
      lon
    });
  }
});

// IP-based Location Fallback (for mobile browsers when GPS is blocked over plain HTTP)
app.get('/api/geo/ip-lookup', async (req, res) => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const ipRes = await fetch('http://ip-api.com/json', {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });
    clearTimeout(timeoutId);

    if (ipRes.ok) {
      const data = await ipRes.json();
      if (data && data.status === 'success') {
        const parts = [];
        if (data.city) parts.push(data.city);
        if (data.regionName && data.regionName !== data.city) parts.push(data.regionName);
        if (data.country) parts.push(data.country);
        const locationName = parts.join(', ');
        return res.json({
          success: true,
          locationName: locationName || `${data.city || 'India'}`,
          city: data.city || '',
          region: data.regionName || '',
          country: data.country || 'India',
          lat: data.lat,
          lon: data.lon,
          source: 'ip'
        });
      }
    }
  } catch (err) {
    // Ignore timeout / network failure
  }

  res.json({
    success: true,
    locationName: 'India',
    source: 'fallback'
  });
});

// ============================================================
// DEVELOPER REMOTE DIAGNOSTICS & TELEMETRY API (Secret Protected)
// ============================================================
const os = require('os');
const DEV_SECRET_KEY = process.env.DEV_SECRET_KEY || 'mq_dev_sec_987412356';

// Middleware to authenticate developer requests
const requireDevSecret = (req, res, next) => {
  const providedKey = req.headers['x-dev-key'] || req.query.key || (req.body && req.body.key);
  if (!providedKey || providedKey !== DEV_SECRET_KEY) {
    return res.status(403).json({ error: 'Forbidden: Invalid or missing Developer Key' });
  }
  next();
};

// 1. Comprehensive System, DB & Process Diagnostics
app.get('/api/dev/diagnostics', requireDevSecret, async (req, res) => {
  // If requested in browser, redirect to the structured dashboard diagnostics tab
  if (req.headers.accept && req.headers.accept.includes('text/html')) {
    return res.redirect(`/api/dev/dashboard?key=${encodeURIComponent(req.query.key || '')}&tab=diagnostics`);
  }

  const mem = process.memoryUsage();
  const dbHealth = await db.checkHealth();

  // Test DB ping latency
  const pingStart = Date.now();
  let dbLatencyMs = null;
  let poolStats = {};
  try {
    await db.query('SELECT 1');
    dbLatencyMs = Date.now() - pingStart;

    if (db.pool && db.pool.pool) {
      poolStats = {
        totalConnections: db.pool.pool._allConnections ? db.pool.pool._allConnections.length : 'N/A',
        freeConnections: db.pool.pool._freeConnections ? db.pool.pool._freeConnections.length : 'N/A',
        queueLength: db.pool.pool._connectionQueue ? db.pool.pool._connectionQueue.length : 'N/A'
      };
    }
  } catch (e) {
    dbLatencyMs = -1;
  }

  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    system: {
      uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
      uptimeHuman: `${Math.floor((Date.now() - startTime) / 3600000)}h ${Math.floor(((Date.now() - startTime) % 3600000) / 60000)}m`,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      cpus: os.cpus().length,
      loadAverage: os.loadavg(),
      freeMemMB: Math.round(os.freemem() / (1024 * 1024)),
      totalMemMB: Math.round(os.totalmem() / (1024 * 1024))
    },
    processMemory: {
      rssMB: (mem.rss / 1024 / 1024).toFixed(2),
      heapTotalMB: (mem.heapTotal / 1024 / 1024).toFixed(2),
      heapUsedMB: (mem.heapUsed / 1024 / 1024).toFixed(2),
      externalMB: (mem.external / 1024 / 1024).toFixed(2)
    },
    database: {
      status: dbHealth.status,
      latencyMs: dbLatencyMs,
      serverTime: dbHealth.serverTime,
      pool: poolStats,
      recordCounts: dbHealth.counts || {}
    },
    recentErrorSummary: {
      totalBufferedLogs: devLogBuffer.length,
      errorCount: devLogBuffer.filter(l => l.type === 'ERROR').length,
      warnCount: devLogBuffer.filter(l => l.type === 'WARN').length
    }
  });
});

// 2. Real-Time In-Memory Error & Warning Log Stream
app.get('/api/dev/logs', requireDevSecret, async (req, res) => {
  // If requested in browser, redirect to the structured dashboard logs tab
  if (req.headers.accept && req.headers.accept.includes('text/html')) {
    return res.redirect(`/api/dev/dashboard?key=${encodeURIComponent(req.query.key || '')}&tab=logs`);
  }

  const lines = parseInt(req.query.lines || '100');
  const level = (req.query.level || '').toUpperCase(); // 'ERROR', 'WARN', 'ATTENDANCE', etc.

  let attEntries = [];
  try {
    const attRes = await db.query(
      `SELECT id, employee_id, employee_name, action, timestamp, device, reason, location, remarks
       FROM attendance_logs
       ORDER BY timestamp DESC
       LIMIT 30`
    );
    attEntries = attRes.rows.map(a => {
      const locStr = a.location ? ` at ${a.location}` : '';
      const reasonStr = a.reason ? ` (Reason: ${a.reason})` : '';
      return {
        timestamp: new Date(String(a.timestamp).replace(' ', 'T')).toISOString(),
        type: 'ATTENDANCE',
        message: `[ATTENDANCE] ${a.employee_name} (${a.employee_id}) punched ${a.action}${locStr}${reasonStr}`,
        meta: {
          employeeId: a.employee_id,
          employeeName: a.employee_name,
          action: a.action,
          method: a.device || 'Office Scanner',
          location: a.location || 'Office Terminal / On-Site',
          reason: a.reason || 'Regular Shift',
          remarks: a.remarks || null
        }
      };
    });
  } catch (e) {
    console.warn('Could not load attendance entries for dev stream:', e.message);
  }

  let combined = [...devLogBuffer, ...attEntries];
  combined.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  let filtered = combined;
  if (level) {
    filtered = filtered.filter(l => l.type === level);
  }

  const result = filtered.slice(-Math.min(lines, 500)).reverse();

  res.json({
    success: true,
    count: result.length,
    logs: result
  });
});

// 3. Client-Side Error Collector (Frontend Auto-Reporting)
app.post('/api/dev/client-error', (req, res) => {
  const { message, source, lineno, colno, stack, userId, url, userAgent } = req.body;
  const clientLog = `[CLIENT_JS_ERR] ${message || 'Unknown error'} at ${source || 'inline'}:${lineno || '?'}:${colno || '?'}`;
  
  console.warn(clientLog);
  pushDevLog('CLIENT_ERROR', clientLog, {
    stack,
    userId: userId || 'Anonymous',
    url: url || req.headers.referer,
    userAgent: userAgent || req.headers['user-agent'],
    ip: req.ip
  });

  res.json({ success: true, recorded: true });
});

// 4. Unified All-in-One Developer Mission Control (Single Structured Page)
app.get('/api/dev/dashboard', requireDevSecret, (req, res) => {
  const secretKey = req.query.key || '';
  try {
    const templatePath = path.join(__dirname, 'dev_dashboard.html');
    const html = fs.readFileSync(templatePath, 'utf8').replace(/\{\{KEY\}\}/g, secretKey);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    res.status(500).send('Error loading dashboard: ' + err.message);
  }
});

// Serve frontend HTML
app.get(['/', '/FingerTrack_Enterprise_Demo.html', '/index.html'], (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.sendFile(path.join(frontendDir, 'FingerTrack_Enterprise_Demo.html'));
});

// ============================================================
// AUTH ENDPOINTS (Admin & Individual Employee)
// ============================================================

app.post('/api/auth/login', async (req, res) => {
  const { username, password, portalType } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username/Email and password are required' });
  }

  const cleanUser = username.trim();
  const cleanPass = password.trim();

  try {
    // 1. If portalType is not explicitly 'employee', check admin credentials first
    if (portalType !== 'employee') {
      const adminResult = await db.query(
        'SELECT * FROM admin_credentials WHERE username = $1 AND password = $2',
        [cleanUser, cleanPass]
      );

      if (adminResult.rows.length > 0) {
        req.session.isAdmin = true;
        req.session.role = 'SUPER_ADMIN';
        req.session.username = cleanUser;
        req.session.employeeId = null;
        console.log(`[AUTH] Admin login success: ${cleanUser}`);
        pushDevLog('AUTH', `Admin user "${cleanUser}" signed in successfully`, { username: cleanUser, role: 'SUPER_ADMIN' });
        return res.json({
          success: true,
          role: 'SUPER_ADMIN',
          user: { username: cleanUser, systemRole: 'SUPER_ADMIN', firstName: 'System', lastName: 'Admin' }
        });
      }
    }

    // 2. Check individual employee in employees table
    const empResult = await db.query(
      `SELECT id, fingerprint_id, first_name, last_name, email, phone, dob, joining_date,
              designation, department, reporting_manager, shift_start, shift_end, salary_type,
              lifecycle_status, password
       FROM employees
       WHERE (LOWER(email) = LOWER($1) OR id = $2 OR phone = $3)`,
      [cleanUser, cleanUser, cleanUser]
    );

    if (empResult.rows.length > 0) {
      const emp = empResult.rows[0];

      // Block login if employee is deactivated / exited / terminated
      const inactiveStatuses = ['exited', 'terminated', 'inactive'];
      if (emp.lifecycle_status && inactiveStatuses.includes(emp.lifecycle_status.trim().toLowerCase())) {
        console.log(`[AUTH] Login blocked: Employee account is deactivated (${emp.id}, status: ${emp.lifecycle_status})`);
        pushDevLog('WARN', `Blocked portal login for deactivated/exited employee "${emp.id}" (${emp.first_name})`, { employeeId: emp.id, status: emp.lifecycle_status });
        return res.status(403).json({ 
          error: 'Account Deactivated: Your employee profile is inactive/exited. Web portal access has been revoked.' 
        });
      }

      const validPass = (emp.password && emp.password.length > 0) ? emp.password : '123456';

      if (cleanPass === validPass) {
        req.session.isAdmin = false;
        req.session.role = 'EMPLOYEE';
        req.session.employeeId = emp.id;
        req.session.employeeName = `${emp.first_name} ${emp.last_name || ''}`.trim();
        req.session.username = emp.email || emp.id;

        const safeEmp = { ...emp };
        delete safeEmp.password;
        safeEmp.systemRole = 'EMPLOYEE';

        console.log(`[AUTH] Employee login success: ${emp.id} (${safeEmp.first_name})`);
        pushDevLog('AUTH', `Employee ${safeEmp.first_name} ${safeEmp.last_name || ''} (${emp.id}) signed in successfully`, { employeeId: emp.id, name: safeEmp.first_name });
        return res.json({
          success: true,
          role: 'EMPLOYEE',
          employee: safeEmp,
          user: safeEmp
        });
      }
    }

    console.log(`[AUTH] Login failed: invalid credentials for "${cleanUser}"`);
    pushDevLog('WARN', `Failed sign-in attempt for ID/Email: "${cleanUser || '(empty)'}"`, { input: cleanUser || 'empty', ip: req.ip });
    res.status(400).json({ error: 'Invalid Login ID, Email or Password.' });
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

app.get('/api/auth/session', async (req, res) => {
  try {
    if (req.session && req.session.isAdmin) {
      return res.json({
        loggedIn: true,
        role: 'SUPER_ADMIN',
        user: { username: req.session.username, systemRole: 'SUPER_ADMIN', firstName: 'System', lastName: 'Admin' }
      });
    }

    if (req.session && req.session.employeeId) {
      const empResult = await db.query(
        `SELECT id, fingerprint_id, first_name, last_name, email, phone, dob, joining_date,
                designation, department, reporting_manager, shift_start, shift_end, salary_type,
                lifecycle_status
         FROM employees WHERE id = $1`,
        [req.session.employeeId]
      );

      if (empResult.rows.length > 0) {
        const emp = empResult.rows[0];
        const inactiveStatuses = ['exited', 'terminated', 'inactive'];
        if (emp.lifecycle_status && inactiveStatuses.includes((emp.lifecycle_status || '').trim().toLowerCase())) {
          console.log(`[AUTH] Session terminated for deactivated/exited employee: ${emp.id}`);
          req.session.destroy(() => {});
          return res.json({ loggedIn: false, error: 'Account deactivated' });
        }
        emp.systemRole = 'EMPLOYEE';
        return res.json({
          loggedIn: true,
          role: 'EMPLOYEE',
          employee: emp,
          user: emp
        });
      }
    }

    res.json({ loggedIn: false });
  } catch (err) {
    console.error('[AUTH] Session check error:', err.message);
    res.json({ loggedIn: false });
  }
});

// ============================================================
// EMPLOYEE SELF-SERVICE (ESS) ENDPOINTS
// ============================================================

// GET: Current Employee Dashboard Details & Today's Status
app.get('/api/employee/dashboard', requireEmployee, async (req, res) => {
  const empId = req.session.employeeId;
  if (!empId) {
    return res.status(400).json({ error: 'No employee associated with current session' });
  }

  try {
    const empRes = await db.query(
      `SELECT id, fingerprint_id, first_name, last_name, email, phone, dob, joining_date,
              designation, department, reporting_manager, shift_start, shift_end, salary_type,
              monthly_rate, hourly_rate, lifecycle_status, leaves_taken
       FROM employees WHERE id = $1`,
      [empId]
    );

    if (empRes.rows.length === 0) {
      return res.status(404).json({ error: 'Employee record not found' });
    }

    const employee = empRes.rows[0];
    employee.systemRole = 'EMPLOYEE';

    // Get today's attendance logs (only actual attendance punches: IN/OUT)
    const todayLogsRes = await db.query(
      `SELECT id, action, timestamp, device, reason, remarks, location, status
       FROM attendance_logs
       WHERE employee_id = $1 AND DATE(timestamp) = CURRENT_DATE() AND action IN ('IN', 'OUT')
       ORDER BY timestamp ASC`,
      [empId]
    );

    const logsToday = todayLogsRes.rows;
    let checkedIn = false;
    let firstIn = null;
    let lastOut = null;
    let lastAction = null;
    let lastActionTime = null;
    let hasCheckedInToday = false;

    if (logsToday.length > 0) {
      const lastLog = logsToday[logsToday.length - 1];
      lastAction = lastLog.action;
      lastActionTime = lastLog.timestamp;
      checkedIn = (lastAction === 'IN');

      const firstInLog = logsToday.find(l => l.action === 'IN');
      if (firstInLog) {
        firstIn = firstInLog.timestamp;
        hasCheckedInToday = true;
      }

      const outLogs = logsToday.filter(l => l.action === 'OUT');
      if (outLogs.length > 0) lastOut = outLogs[outLogs.length - 1].timestamp;
    }

    // Get recent attendance logs (last 50 entries, only IN/OUT)
    const recentLogsRes = await db.query(
      `SELECT id, action, timestamp, device, reason, remarks, location, status
       FROM attendance_logs
       WHERE employee_id = $1 AND action IN ('IN', 'OUT')
       ORDER BY timestamp DESC
       LIMIT 50`,
      [empId]
    );

    res.json({
      success: true,
      employee,
      today: {
        checkedIn,
        hasCheckedInToday,
        lastAction,
        lastActionTime,
        firstIn,
        lastOut,
        logs: logsToday
      },
      recentLogs: recentLogsRes.rows
    });
  } catch (err) {
    console.error('[EMPLOYEE] Dashboard error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST: Individual Employee Remote Check-In / Check-Out
app.post('/api/employee/attendance', requireEmployee, async (req, res) => {
  const empId = req.session.employeeId;
  const { action, reason, remarks, location, coords } = req.body;

  if (!empId) {
    return res.status(400).json({ error: 'No employee ID in session' });
  }

  if (!action || !['IN', 'OUT'].includes(action.toUpperCase())) {
    return res.status(400).json({ error: 'Action must be IN or OUT' });
  }

  const effectiveAction = action.toUpperCase();

  // Check today's attendance logs for this employee
  const todayLogsRes = await db.query(`
    SELECT id, action, timestamp FROM attendance_logs 
    WHERE employee_id = $1 AND DATE(timestamp) = CURRENT_DATE()
    ORDER BY timestamp ASC
  `, [empId]);

  const hasTodayIn = todayLogsRes.rows.some(l => l.action === 'IN');
  const hasTodayOut = todayLogsRes.rows.some(l => l.action === 'OUT');

  if (hasTodayIn && hasTodayOut) {
    return res.status(403).json({ 
      error: 'Shift already completed for today. Further check-in and check-out are locked for today.' 
    });
  }

  if (effectiveAction === 'IN') {
    if (hasTodayIn) {
      return res.status(403).json({ 
        error: 'You have already checked in for today.' 
      });
    }
  } else if (effectiveAction === 'OUT') {
    if (!hasTodayIn) {
      return res.status(400).json({ 
        error: 'You have not checked in yet today. You must check in before checking out.' 
      });
    }
    if (hasTodayOut) {
      return res.status(403).json({ 
        error: 'You have already checked out for today.' 
      });
    }
  }

  if (!reason || reason.trim().length === 0) {
    return res.status(400).json({ error: 'Please select or provide a valid reason for remote check-in/out.' });
  }

  if (!location || location.trim().length === 0) {
    return res.status(400).json({ error: 'Verified GPS location is required to submit remote attendance.' });
  }

  try {
    const empRes = await db.query(
      'SELECT id, first_name, last_name, shift_start FROM employees WHERE id = $1',
      [empId]
    );
    if (empRes.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    const emp = empRes.rows[0];
    const empName = `${emp.first_name} ${emp.last_name || ''}`.trim();

    // Auto-close previous day forgotten checkout if checking in today
    const lastLogRes = await db.query(`
      SELECT action, timestamp FROM attendance_logs 
      WHERE employee_id = $1 
      ORDER BY timestamp DESC 
      LIMIT 1
    `, [empId]);

    if (lastLogRes.rows.length > 0) {
      const lastLog = lastLogRes.rows[0];
      const lastLogDate = new Date(lastLog.timestamp);
      const lastLogDateStr = lastLogDate.getFullYear() + '-' +
        String(lastLogDate.getMonth() + 1).padStart(2, '0') + '-' +
        String(lastLogDate.getDate()).padStart(2, '0');
      const now = new Date();
      const todayDateStr = now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0');

      if (lastLog.action === 'IN' && lastLogDateStr < todayDateStr && effectiveAction === 'IN') {
        const autoOutTime = new Date(lastLog.timestamp);
        autoOutTime.setTime(new Date(lastLog.timestamp).getTime() + 8.0 * 3600 * 1000);

        await db.query(`
          INSERT INTO attendance_logs (employee_id, employee_name, timestamp, action, device, reason, status)
          VALUES ($1, $2, $3, 'OUT', 'AUTO_CHECKOUT', 'Auto-closed previous day shift', 'Approved')
        `, [empId, empName, autoOutTime]);
      }
    }

    // Check delay / late
    let isLate = false;
    let delayMinutes = 0;
    if (effectiveAction === 'IN') {
      const shiftStartStr = emp.shift_start ? emp.shift_start.slice(0, 5) : '10:00';
      const [shiftH, shiftM] = shiftStartStr.split(':').map(Number);
      const now = new Date();
      const checkInMin = now.getHours() * 60 + now.getMinutes();
      const shiftStartMin = shiftH * 60 + shiftM;
      delayMinutes = Math.max(0, checkInMin - shiftStartMin);
      const grace = (LEAVE_SETTINGS.latePenalty && LEAVE_SETTINGS.latePenalty.graceMinutes !== undefined) ? LEAVE_SETTINGS.latePenalty.graceMinutes : 15;
      if (delayMinutes > grace) {
        isLate = true;
      }
    }

    // Insert attendance log with remote tag, reason, and notes
    await db.query(
      `INSERT INTO attendance_logs
        (employee_id, employee_name, action, device, reason, remarks, location, status)
       VALUES ($1, $2, $3, 'REMOTE_WEB', $4, $5, $6, 'Approved')`,
      [
        empId,
        empName,
        effectiveAction,
        reason.trim(),
        remarks ? remarks.trim() : null,
        location ? location.trim() : null
      ]
    );

    console.log(`[EMPLOYEE] Remote ${effectiveAction} logged for ${empName} (${empId}). Reason: "${reason}"`);
    const formatDelayStr = (m) => {
      const min = Math.round(Number(m) || 0);
      if (min <= 0) return '0 min';
      if (min < 60) return `${min} min`;
      const hrs = Math.floor(min / 60);
      const rem = min % 60;
      return rem === 0 ? `${hrs} hr${hrs > 1 ? 's' : ''}` : `${hrs} hr${hrs > 1 ? 's' : ''} ${rem} min`;
    };

    pushDevLog(
      'ATTENDANCE',
      `[ATTENDANCE] ${empName} (${empId}) punched ${effectiveAction} — Reason: "${reason}"${isLate ? ` [LATE by ${formatDelayStr(delayMinutes)}]` : ''}`,
      {
        employeeId: empId,
        employeeName: empName,
        action: effectiveAction,
        reason: reason,
        location: location || 'Mobile / Web Portal',
        remarks: remarks || null,
        method: 'Remote Mobile / Web',
        isLate,
        late: isLate,
        delayMinutes,
        delay: delayMinutes
      }
    );

    res.status(201).json({
      success: true,
      action: effectiveAction,
      isLate,
      late: isLate,
      delayMinutes,
      delay: delayMinutes,
      delayFormatted: formatDelayStr(delayMinutes),
      message: effectiveAction === 'IN'
        ? (isLate ? `Checked in successfully (Late by ${formatDelayStr(delayMinutes)})` : 'Checked in successfully')
        : 'Checked out successfully'
    });
  } catch (err) {
    console.error('[EMPLOYEE] Attendance error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST: Employee Change Password
app.post('/api/employee/change-password', requireEmployee, async (req, res) => {
  const empId = req.session.employeeId;
  const { currentPassword, newPassword } = req.body;

  if (!empId) {
    return res.status(400).json({ error: 'No employee session found' });
  }
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }
  if (newPassword.length < 4) {
    return res.status(400).json({ error: 'New password must be at least 4 characters' });
  }

  try {
    const empRes = await db.query('SELECT password FROM employees WHERE id = $1', [empId]);
    if (empRes.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    const currentActual = (empRes.rows[0].password && empRes.rows[0].password.length > 0)
      ? empRes.rows[0].password
      : '123456';

    if (currentPassword !== currentActual) {
      return res.status(400).json({ error: 'Incorrect current password' });
    }

    await db.query('UPDATE employees SET password = $1 WHERE id = $2', [newPassword, empId]);
    console.log(`[EMPLOYEE] Password updated for ${empId}`);
    res.json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    console.error('[EMPLOYEE] Change password error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST: Admin Reset Employee Password
app.post('/api/employees/:id/password', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { password } = req.body;

  if (!password || password.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters' });
  }

  try {
    await db.query('UPDATE employees SET password = $1 WHERE id = $2', [password, id]);
    console.log(`[ADMIN] Reset password for employee ${id}`);
    res.json({ success: true, message: `Password updated for employee ${id}` });
  } catch (err) {
    console.error('[ADMIN] Reset employee password error:', err.message);
    res.status(500).json({ error: err.message });
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
// SYSTEM SETTINGS
// ============================================================

// GET: Fetch Leave Settings
app.get('/api/settings/leave', requireAdmin, (req, res) => {
  res.json(LEAVE_SETTINGS);
});

// POST: Update Leave Settings
app.post('/api/settings/leave', requireAdmin, (req, res) => {
  try {
    LEAVE_SETTINGS = { ...LEAVE_SETTINGS, ...req.body };
    fs.writeFileSync(settingsPath, JSON.stringify(LEAVE_SETTINGS, null, 2), 'utf8');
    console.log('[SETTINGS] Updated leave settings saved to file.');
    res.json({ success: true, settings: LEAVE_SETTINGS });
  } catch (err) {
    console.error('[SETTINGS] Save error:', err.message);
    res.status(500).json({ error: err.message });
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
      password: emp.password || '123456',
      dateOfBirth: formatLocalDate(emp.dob),
      joiningDate: formatLocalDate(emp.joining_date),
      designation: emp.designation,
      department: emp.department,
      reportingManager: emp.reporting_manager,
      shiftStart: emp.shift_start ? emp.shift_start.slice(0, 5) : '10:00',
      shiftEnd: emp.shift_end ? emp.shift_end.slice(0, 5) : '17:00',
      salaryType: emp.salary_type,
      monthlyRate: parseFloat(emp.monthly_rate || 0),
      hourlyRate: parseFloat(emp.hourly_rate || 0),
      lifecycleStatus: emp.lifecycle_status,
      probationMonths: emp.probation_months,
      probationUnit: emp.probation_unit || 'months',
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
  const portalPassword = emp.password && emp.password.trim().length > 0 ? emp.password.trim() : '123456';
  try {
    await db.query(`
      INSERT INTO employees (
        id, fingerprint_id, first_name, last_name, email, phone, dob, joining_date,
        designation, department, reporting_manager, shift_start, shift_end, salary_type,
        monthly_rate, hourly_rate, lifecycle_status, probation_months, probation_unit, probation_end_date, confirmation_date,
        notice_period_end_date, exit_date, exit_reason, enrolled, leaves_taken, payroll_start_date, password
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)
    `, [
      emp.id, emp.fingerprintId || null, emp.firstName, emp.lastName || '', emp.email, emp.phone || '',
      emp.dateOfBirth || null, emp.joiningDate, emp.designation || '', emp.department || '',
      emp.reportingManager || '', emp.shiftStart, emp.shiftEnd, emp.salaryType || 'monthly',
      emp.monthlyRate || 0, emp.hourlyRate || 0, emp.lifecycleStatus || 'Probation',
      emp.probationMonths || 6, emp.probationUnit || 'months', emp.probationEndDate || null, emp.confirmationDate || null,
      emp.noticePeriodEndDate || null, emp.exitDate || null, emp.exitReason || '',
      emp.enrolled ? 1 : 0, emp.leavesTaken || 0, emp.payrollStartDate || emp.joiningDate, portalPassword
    ]);
    console.log(`[EMPLOYEES] Added: ${emp.id} (${emp.firstName} ${emp.lastName || ''}) with portal credentials`);
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
    // Preserve existing fingerprint_id and password if not provided
    let fpId = emp.fingerprintId;
    let pwd = emp.password && emp.password.trim().length > 0 ? emp.password.trim() : null;
    if (fpId === undefined || fpId === null || fpId === '' || !pwd) {
      const existing = await db.query('SELECT fingerprint_id, password FROM employees WHERE id = $1', [id]);
      if (existing.rows.length > 0) {
        if (fpId === undefined || fpId === null || fpId === '') fpId = existing.rows[0].fingerprint_id;
        if (!pwd) pwd = existing.rows[0].password || '123456';
      }
    }

    await db.query(`
      UPDATE employees SET
        fingerprint_id = $1, first_name = $2, last_name = $3, email = $4, phone = $5,
        dob = $6, joining_date = $7, designation = $8, department = $9, reporting_manager = $10,
        shift_start = $11, shift_end = $12, salary_type = $13, monthly_rate = $14, hourly_rate = $15,
        lifecycle_status = $16, probation_months = $17, probation_unit = $18, probation_end_date = $19, confirmation_date = $20,
        notice_period_end_date = $21, exit_date = $22, exit_reason = $23, enrolled = $24, leaves_taken = $25,
        payroll_start_date = $26, password = $27, updated_at = CURRENT_TIMESTAMP
      WHERE id = $28
    `, [
      fpId || null, emp.firstName, emp.lastName || '', emp.email, emp.phone || '',
      emp.dateOfBirth || null, emp.joiningDate, emp.designation || '', emp.department || '',
      emp.reportingManager || '', emp.shiftStart, emp.shiftEnd, emp.salaryType || 'monthly',
      emp.monthlyRate || 0, emp.hourlyRate || 0, emp.lifecycleStatus, emp.probationMonths || 6,
      emp.probationUnit || 'months', emp.probationEndDate || null, emp.confirmationDate || null, emp.noticePeriodEndDate || null,
      emp.exitDate || null, emp.exitReason || '', emp.enrolled ? 1 : 0, emp.leavesTaken || 0,
      emp.payrollStartDate || emp.joiningDate, pwd || '123456', id
    ]);
    console.log(`[EMPLOYEES] Updated: ${id} (portal credentials updated)`);
    res.json({ success: true, message: 'Employee updated successfully' });
  } catch (err) {
    console.error('[EMPLOYEES] Update error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE: Remove Employee (Soft Delete to preserve all past attendance & salary history)
app.delete('/api/employees/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { permanent } = req.query;
  try {
    if (permanent === 'true') {
      const docs = await db.query('SELECT file_path FROM documents WHERE employee_id = $1', [id]);
      for (const doc of docs.rows) {
        const fullPath = path.join(__dirname, doc.file_path);
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
        }
      }
      await db.query('DELETE FROM employees WHERE id = $1', [id]);
      console.log(`[EMPLOYEES] Permanently deleted: ${id}`);
      return res.json({ success: true, message: 'Employee permanently removed' });
    }

    // Default: Soft Delete (mark Exited, unenroll, but keep historical logs intact)
    await db.query(`
      UPDATE employees 
      SET lifecycle_status = 'Exited', 
          enrolled = false, 
          fingerprint_id = NULL, 
          exit_date = CURRENT_DATE,
          exit_reason = 'Deactivated by Admin',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [id]);

    console.log(`[EMPLOYEES] Soft-deleted (marked Exited): ${id} (historical data preserved)`);
    res.json({ success: true, message: 'Employee marked as Exited; all historical attendance records preserved' });
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
// SALARY PAYMENT HISTORY (Protected)
// ============================================================

// GET: Fetch all salary payment records
app.get('/api/salary-payments', requireAdmin, async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM salary_payments ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('[PAYROLL] Fetch payments error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT: Edit a salary payment record (HR mistake correction)
app.put('/api/salary-payments/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const {
    present_days, weekly_offs, holidays, absent_days,
    base_salary, earnings, deductions, net_salary, revision_note
  } = req.body;

  if (!revision_note || !revision_note.trim()) {
    return res.status(400).json({ error: 'A revision note is required when editing a payment record' });
  }

  try {
    // Verify the record exists
    const existing = await db.query('SELECT * FROM salary_payments WHERE id = ?', [id]);
    if (existing.rowCount === 0) {
      return res.status(404).json({ error: 'Salary payment record not found' });
    }

    // Update the record with new values, mark as Revised
    await db.query(
      `UPDATE salary_payments SET
        present_days = ?, weekly_offs = ?, holidays = ?, absent_days = ?,
        base_salary = ?, earnings = ?, deductions = ?, net_salary = ?,
        status = 'Revised', revised_at = NOW(), revision_note = ?
      WHERE id = ?`,
      [
        present_days, weekly_offs, holidays, absent_days,
        base_salary, earnings, deductions, net_salary,
        revision_note.trim(), id
      ]
    );

    console.log(`[PAYROLL] Payment record #${id} revised. Note: ${revision_note.trim()}`);
    res.json({ success: true, message: 'Salary payment record updated successfully' });
  } catch (err) {
    console.error('[PAYROLL] Edit payment error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE: Remove a salary payment record
app.delete('/api/salary-payments/:id', requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await db.query('SELECT * FROM salary_payments WHERE id = ?', [id]);
    if (existing.rowCount === 0) {
      return res.status(404).json({ error: 'Salary payment record not found' });
    }
    await db.query('DELETE FROM salary_payments WHERE id = ?', [id]);
    console.log(`[PAYROLL] Payment record #${id} deleted.`);
    res.json({ success: true, message: 'Payment record deleted successfully' });
  } catch (err) {
    console.error('[PAYROLL] Delete payment error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ATTENDANCE LOGS (Protected)
// ============================================================

app.get('/api/attendance', requireAdmin, async (req, res) => {
  const { limit, startDate, endDate, employeeId } = req.query;
  try {
    let sql = 'SELECT * FROM attendance_logs WHERE 1=1';
    const params = [];
    if (startDate) {
      params.push(startDate);
      sql += ` AND DATE(timestamp) >= $${params.length}`;
    }
    if (endDate) {
      params.push(endDate);
      sql += ` AND DATE(timestamp) <= $${params.length}`;
    }
    if (employeeId) {
      params.push(employeeId);
      sql += ` AND employee_id = $${params.length}`;
    }
    sql += ' ORDER BY timestamp DESC';
    const rowLimit = limit ? parseInt(limit) : 5000;
    sql += ` LIMIT ${rowLimit}`;

    const result = await db.query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[ATTENDANCE] Fetch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/attendance/reset', requireAdmin, async (req, res) => {
  const { employee_id, date } = req.body;
  if (!employee_id || !date) {
    return res.status(400).json({ error: 'Missing employee_id or date' });
  }
  try {
    await db.query(
      'DELETE FROM attendance_logs WHERE employee_id = $1 AND DATE(timestamp) = $2',
      [employee_id, date]
    );
    console.log(`[ATTENDANCE] Reset logs for employee ${employee_id} on ${date}`);
    res.json({ success: true, message: 'Attendance logs reset successfully' });
  } catch (err) {
    console.error('[ATTENDANCE] Reset error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/attendance/update', requireAdmin, async (req, res) => {
  const { employee_id, date, login, logout } = req.body;
  if (!employee_id || !date) {
    return res.status(400).json({ error: 'Missing employee_id or date' });
  }

  try {
    const empRes = await db.query('SELECT first_name, last_name FROM employees WHERE id = $1 LIMIT 1', [employee_id]);
    if (empRes.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    const empName = `${empRes.rows[0].first_name} ${empRes.rows[0].last_name}`;

    await db.query(
      'DELETE FROM attendance_logs WHERE employee_id = $1 AND DATE(timestamp) = $2',
      [employee_id, date]
    );

    if (login) {
      const loginTimestamp = `${date} ${login}:00`;
      await db.query(
        `INSERT INTO attendance_logs (employee_id, employee_name, timestamp, action, device)
         VALUES ($1, $2, $3, 'IN', 'DASHBOARD_EDIT')`,
        [employee_id, empName, loginTimestamp]
      );
    }

    if (logout) {
      const logoutTimestamp = `${date} ${logout}:00`;
      await db.query(
        `INSERT INTO attendance_logs (employee_id, employee_name, timestamp, action, device)
         VALUES ($1, $2, $3, 'OUT', 'DASHBOARD_EDIT')`,
        [employee_id, empName, logoutTimestamp]
      );
    }

    console.log(`[ATTENDANCE] Updated logs for employee ${employee_id} on ${date}: login=${login}, logout=${logout}`);
    res.json({ success: true, message: 'Attendance logs updated successfully' });
  } catch (err) {
    console.error('[ATTENDANCE] Update error:', err.message);
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

  if (!['IN', 'OUT', 'AUTO'].includes(action.toUpperCase())) {
    return res.status(400).json({ error: 'Action must be IN, OUT, or AUTO' });
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

        const shiftStartStr = findRes.rows[0].shift_start ? findRes.rows[0].shift_start.slice(0, 5) : '10:00';
        const [shiftH, shiftM] = shiftStartStr.split(':').map(Number);
        const now = new Date();
        const checkInMin = now.getHours() * 60 + now.getMinutes();
        const shiftStartMin = shiftH * 60 + shiftM;
        delayMinutes = Math.max(0, checkInMin - shiftStartMin);
        const grace = (LEAVE_SETTINGS.latePenalty && LEAVE_SETTINGS.latePenalty.graceMinutes !== undefined) ? LEAVE_SETTINGS.latePenalty.graceMinutes : 15;
        if (action.toUpperCase() === 'IN' && delayMinutes > grace) {
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

          const shiftStartStr = nameRes.rows[0].shift_start ? nameRes.rows[0].shift_start.slice(0, 5) : '10:00';
          const [shiftH, shiftM] = shiftStartStr.split(':').map(Number);
          const now = new Date();
          const checkInMin = now.getHours() * 60 + now.getMinutes();
          const shiftStartMin = shiftH * 60 + shiftM;
          delayMinutes = Math.max(0, checkInMin - shiftStartMin);
          const grace = (LEAVE_SETTINGS.latePenalty && LEAVE_SETTINGS.latePenalty.graceMinutes !== undefined) ? LEAVE_SETTINGS.latePenalty.graceMinutes : 15;
          if (action.toUpperCase() === 'IN' && delayMinutes > grace) {
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
      }
    }

    let effectiveAction = action.toUpperCase();

    // Check last attendance log for this employee to auto-close forgotten check-outs from previous days
    const lastLogRes = await db.query(`
      SELECT action, timestamp FROM attendance_logs 
      WHERE employee_id = $1 
      ORDER BY timestamp DESC 
      LIMIT 1
    `, [empId]);

    if (lastLogRes.rows.length > 0) {
      const lastLog = lastLogRes.rows[0];
      const lastLogDate = new Date(lastLog.timestamp);
      const lastLogDateStr = lastLogDate.getFullYear() + '-' +
        String(lastLogDate.getMonth() + 1).padStart(2, '0') + '-' +
        String(lastLogDate.getDate()).padStart(2, '0');
      const now = new Date();
      const todayDateStr = now.getFullYear() + '-' +
        String(now.getMonth() + 1).padStart(2, '0') + '-' +
        String(now.getDate()).padStart(2, '0');

      // If last action was IN on a PREVIOUS day and no OUT was recorded:
      if (lastLog.action === 'IN' && lastLogDateStr < todayDateStr) {
        const isSaturday = (lastLogDate.getDay() === 6);
        const shiftDurationHours = isSaturday ? 4.0 : 8.0;

        const autoOutTime = new Date(lastLog.timestamp);
        autoOutTime.setTime(new Date(lastLog.timestamp).getTime() + shiftDurationHours * 3600 * 1000);

        await db.query(`
          INSERT INTO attendance_logs (employee_id, employee_name, timestamp, action, device)
          VALUES ($1, $2, $3, 'OUT', 'AUTO_CHECKOUT')
        `, [empId, empName || 'UNKNOWN', autoOutTime]);

        console.log(`[HARDWARE] Auto-closed missing checkout for ${empId} on ${lastLogDateStr} (${shiftDurationHours}h shift)`);

        // Today is a NEW day — employee is arriving in the morning, so force Check-In (IN)
        effectiveAction = 'IN';
      }
    }

    // Check if employee has already checked in and checked out for today
    const todayLogs = await db.query(`
      SELECT action, timestamp FROM attendance_logs 
      WHERE employee_id = $1 AND DATE(timestamp) = CURRENT_DATE()
      ORDER BY timestamp ASC
    `, [empId]);

    const hasTodayIn = todayLogs.rows.some(l => l.action === 'IN');
    const hasTodayOut = todayLogs.rows.some(l => l.action === 'OUT');

    if (hasTodayIn && hasTodayOut) {
      console.log(`[HARDWARE] Re-entry blocked: ${empId} already checked in and checked out today`);
      return res.status(200).json({
        success: false,
        completed: true,
        message: 'Shift already completed for today',
        late: false
      });
    }

    if (hasTodayIn && !hasTodayOut) {
      // Already checked in today, so this subsequent scan must be their check-out!
      effectiveAction = 'OUT';
    } else if (!hasTodayIn) {
      // No check-in today yet, so first scan must be check-in!
      effectiveAction = 'IN';
    }

    if (effectiveAction === 'IN') {
      const empDetails = await db.query(`SELECT shift_start FROM employees WHERE id = $1 LIMIT 1`, [empId]);
      const shiftStartStr = (empDetails.rows.length > 0 && empDetails.rows[0].shift_start) ? empDetails.rows[0].shift_start.slice(0, 5) : '10:00';
      const [shiftH, shiftM] = shiftStartStr.split(':').map(Number);
      const now = new Date();
      const checkInMin = now.getHours() * 60 + now.getMinutes();
      const shiftStartMin = shiftH * 60 + shiftM;
      delayMinutes = Math.max(0, checkInMin - shiftStartMin);
      const grace = (LEAVE_SETTINGS.latePenalty && LEAVE_SETTINGS.latePenalty.graceMinutes !== undefined) ? LEAVE_SETTINGS.latePenalty.graceMinutes : 15;
      if (delayMinutes > grace) {
        isLate = true;
      }
    }

    await db.query(`
      INSERT INTO attendance_logs (employee_id, employee_name, action, device)
      VALUES ($1, $2, $3, $4)
    `, [empId, empName || 'UNKNOWN', effectiveAction, device || 'GATE_1']);

    console.log(`[HARDWARE] ${effectiveAction} logged for ${empId} via ${device || 'GATE_1'} (Late: ${isLate}, Delay: ${delayMinutes} mins)`);
    res.status(201).json({
      success: true,
      action: effectiveAction,
      message: effectiveAction === 'IN' ? (isLate ? 'Attendance logged (LATE)' : 'Attendance log recorded') : 'Check-out recorded',
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
    // 1. Clear this fingerprint_id slot from any existing employee first to avoid UNIQUE key conflict
    await db.query(`
      UPDATE employees 
      SET fingerprint_id = NULL, enrolled = false 
      WHERE fingerprint_id = $1
    `, [fingerprint_id]);

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

        const placeholderEmail = `setup-${nextNum}@musingquills.com`;
        const tzOffset = new Date().getTimezoneOffset() * 60000;
        const todayDate = new Date(Date.now() - tzOffset).toISOString().split('T')[0];

        // Insert placeholder profile with freed-up fingerprint_id
        await db.query(`
          INSERT INTO employees (
            id, fingerprint_id, first_name, last_name, email, phone, dob, joining_date,
            designation, department, reporting_manager, shift_start, shift_end, salary_type,
            monthly_rate, hourly_rate, lifecycle_status, enrolled, leaves_taken
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        `, [
          empId, fingerprint_id, firstName, lastName, placeholderEmail, '', null, todayDate,
          'Pending Setup', 'General', 'System Admin', '10:00', '17:00', 'monthly',
          0, 0, 'Probation', 1, 0
        ]);

        console.log(`[HARDWARE] Auto-created new employee: ${empId} for name: ${employee_name}`);
      }
    }

    if (!isNew && empId) {
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

    // 2. Soft-delete employee: mark as Exited, clear fingerprint_id so slot can be reused,
    // and PRESERVE all attendance_logs, punches, and salary records!
    await db.query(`
      UPDATE employees 
      SET lifecycle_status = 'Exited', 
          enrolled = false, 
          fingerprint_id = NULL, 
          exit_date = CURRENT_DATE,
          exit_reason = 'Deleted via Biometric Hardware Device',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [empId]);

    // 3. Log the deletion in attendance_logs for audit
    await db.query(`
      INSERT INTO attendance_logs (employee_id, employee_name, action, device, remarks)
      VALUES ($1, $2, 'DELETE', 'ESP32_READER_1', 'Removed from biometric device; historical data preserved')
    `, [empId, empName]);

    console.log(`[HARDWARE] Employee ${empName} (ID: ${empId}) deactivated & unlinked from slot #${fingerprint_id}. Past attendance records preserved.`);
    res.json({ success: true, message: `Employee ${empName} removed from biometric device; historical attendance records preserved.` });
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
    req.session.destroy(() => { });
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
      shiftStart: emp.shift_start ? emp.shift_start.slice(0, 5) : '10:00',
      shiftEnd: emp.shift_end ? emp.shift_end.slice(0, 5) : '17:00',
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
      const halfDayThreshold = isSaturday ? 3.5 : 5.0;

      const halfDayCutoffMin = 16 * 60 + 30; // 4:30 PM (990 mins)
      const isWfh = checkInLog && checkInLog.device === 'WFH_DASHBOARD';

      if (isWfh) {
        status = 'Work From Home';
        hours = 8.0;
      } else if (login && logout) {
        status = 'Present';
        const [linH, linM] = login.split(':').map(Number);
        const [loutH, loutM] = logout.split(':').map(Number);
        const loginMin = linH * 60 + linM;
        const logoutMin = loutH * 60 + loutM;
        hours = Math.round(((logoutMin - loginMin) / 60) * 100) / 100;
        const isHalfDay = isSaturday
          ? hours < halfDayThreshold
          : (logoutMin < halfDayCutoffMin || hours < halfDayThreshold);
        if (isHalfDay) {
          status = 'Half Day';
        }
      } else if (login) {
        status = 'Half Day';
        hours = 4.0;
      } else if (logout) {
        status = 'Half Day';
        hours = 4.0;
      } else if (isHoliday && hasJoined && hasOccurred) {
        status = 'Holiday';
      } else if (dayOfWeek === 0 && hasJoined && hasOccurred) {
        status = 'Weekly Off';
      }

      attendanceHistory.push({ date: dateStr, status, hours });
    });

    const presentDays = attendanceHistory.filter(r => ['Present', 'Work From Home', 'Holiday'].includes(r.status)).length;
    const halfDays = attendanceHistory.filter(r => r.status === 'Half Day').length;
    const halfDayRuleVal = parseFloat(LEAVE_SETTINGS && LEAVE_SETTINGS.halfDayRule !== undefined ? LEAVE_SETTINGS.halfDayRule : 0.5);
    const halfDayMultiplier = isNaN(halfDayRuleVal) ? 0.5 : (1.0 - halfDayRuleVal);
    const days = presentDays + (halfDays * halfDayMultiplier);

    const hours = attendanceHistory.reduce((s, r) => s + (r.hours || 0), 0);
    const md = { days, hours };

    // Check if a payment record exists in salary_payments table (including revised payments)
    const payRecordRes = await db.query(
      'SELECT * FROM salary_payments WHERE employee_id = $1 ORDER BY created_at DESC LIMIT 1',
      [id]
    );

    let basicPay = 0;
    let totalEarnings = 0;
    let totalDeductions = 0;
    let netPay = 0;
    let displayDaysPresent = 0;
    let currentMonth = now.toLocaleString('default', { month: 'long', year: 'numeric' });

    if (payRecordRes.rowCount > 0) {
      const rec = payRecordRes.rows[0];
      basicPay = parseFloat(rec.base_salary || 0);
      totalEarnings = parseFloat(rec.earnings || 0);
      totalDeductions = parseFloat(rec.deductions || 0);
      netPay = parseFloat(rec.net_salary || 0);
      displayDaysPresent = parseFloat(rec.present_days || 0);
      if (rec.payment_date) {
        const pDate = new Date(rec.payment_date);
        currentMonth = pDate.toLocaleString('default', { month: 'long', year: 'numeric' });
      }
    } else {
      const WORK_DAYS = 26;
      const absentDays = attendanceHistory.filter(r => r.status === 'Absent' && r.date !== todayStr).length;
      const halfDaysForLeaves = attendanceHistory.filter(r => r.status === 'Half Day').length;
      const totalLeavesTaken = (empFormatted.leavesTaken || 0) + absentDays + (halfDaysForLeaves * halfDayRuleVal);

      const paidAllowance = parseFloat(LEAVE_SETTINGS.monthlyLimit || 1.5);
      const paidLeaves = Math.min(totalLeavesTaken, paidAllowance);
      const paidDays = Math.min(WORK_DAYS, md.days + paidLeaves);

      if (empFormatted.salaryType === 'monthly') {
        const dailyRate = Math.round(empFormatted.monthlyRate / WORK_DAYS);
        basicPay = dailyRate * paidDays;
      } else {
        basicPay = Math.round(md.hours * empFormatted.hourlyRate);
      }

      const latePenaltyPolicy = LEAVE_SETTINGS.latePenalty || {
        enabled: true,
        graceMinutes: 15,
        warningThreshold: 3,
        penaltyPerLate: 100,
        maxPenaltyPct: 20
      };
      let lateCount = 0;
      datesList.forEach(({ dateStr }) => {
        const dayLogs = grouped[dateStr];
        if (dayLogs) {
          const checkIn = dayLogs.find(l => l.action === 'IN');
          if (checkIn && checkIn.device !== 'WFH_DASHBOARD') {
            const inDate = new Date(checkIn.timestamp);
            const loginMin = inDate.getHours() * 60 + inDate.getMinutes();
            const [sH, sM] = empFormatted.shiftStart.split(':').map(Number);
            const shiftMin = sH * 60 + sM;
            const grace = (latePenaltyPolicy.graceMinutes !== undefined) ? latePenaltyPolicy.graceMinutes : 15;
            if (loginMin > shiftMin + grace) {
              lateCount++;
            }
          }
        }
      });

      const penaltyPerLate = latePenaltyPolicy.penaltyPerLate || 100;
      const habitualThreshold = latePenaltyPolicy.warningThreshold || 3;
      const latePenalty = (latePenaltyPolicy.enabled !== false && lateCount >= habitualThreshold) ? (lateCount * penaltyPerLate) : 0;
      totalDeductions = latePenalty;
      totalEarnings = basicPay;
      netPay = Math.max(0, basicPay - totalDeductions);
      displayDaysPresent = md.days;
    }

    const fmt = (val) => '₹' + Number(val).toLocaleString('en-IN');


    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Payslip - ${empFormatted.firstName} ${empFormatted.lastName}</title>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <style>
          @page {
            size: auto;
            margin: 0mm;
          }
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
            @page {
              size: auto;
              margin: 0mm;
            }
            html, body {
              background: #fff !important;
              padding: 15mm 20mm !important;
              margin: 0 !important;
              display: block !important;
              min-height: 0 !important;
              height: auto !important;
              width: 100% !important;
            }
            .payslip-card {
              border: none !important;
              box-shadow: none !important;
              padding: 0 !important;
              max-width: 100% !important;
              width: 100% !important;
            }
            .btn-print {
              display: none !important;
            }
          }
        </style>
      </head>
      <body>
        <div class="payslip-card">
          <div class="header">
            <h1 class="logo">MUSING QUILLS</h1>
            <p class="subtitle">Salary Payslip — ${currentMonth}</p>
          </div>
          
          <div class="meta-grid">
            <div class="meta-item"><strong>Employee Name</strong><span>${empFormatted.firstName} ${empFormatted.lastName}</span></div>
            <div class="meta-item"><strong>Employee ID</strong><span>${empFormatted.id}</span></div>
            <div class="meta-item"><strong>Department</strong><span>${empFormatted.department}</span></div>
            <div class="meta-item"><strong>Designation</strong><span>${empFormatted.designation || 'Staff'}</span></div>
            <div class="meta-item"><strong>Days Worked</strong><span>${displayDaysPresent} / 26 days</span></div>
            <div class="meta-item"><strong>Payment Status</strong><span style="color: var(--success);">Paid</span></div>
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
                <td>Basic / Earnings</td>
                <td>${fmt(totalEarnings)}</td>
                <td>Total Deductions</td>
                <td>${fmt(totalDeductions)}</td>
              </tr>
              <tr class="total-row">
                <td>Total Gross Earnings</td>
                <td>${fmt(totalEarnings)}</td>
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
            <p>This is a computer-generated payslip.</p>
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
