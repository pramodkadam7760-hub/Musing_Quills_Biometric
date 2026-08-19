/* ===== FingerTrack Enterprise — Core Application ===== */

// Redirect from port 8000 to port 5001 to prevent cross-origin cookie blockage
if (window.location.port === '8000') {
  window.location.href = window.location.protocol + '//' + window.location.hostname + ':5001' + window.location.pathname + window.location.search + window.location.hash;
}

// ---- Constants ----
const DEPARTMENTS = ['Websites and Webapps Development', 'Design', 'HR', 'Sales', 'Finance', 'Operations', 'Marketing', 'Social Media'];
const DEPT_PREFIXES = { 'Websites and Webapps Development': 'WWD', Design: 'DES', HR: 'HR', Sales: 'SAL', Finance: 'FIN', Operations: 'OPS', Marketing: 'MKT', 'Social Media': 'SMD' };
const DEPT_CLASSES = { 'Websites and Webapps Development': 'dept-webdev', Design: 'dept-design', HR: 'dept-hr', Sales: 'dept-sales', Finance: 'dept-finance', Operations: 'dept-operations', Marketing: 'dept-marketing', 'Social Media': 'dept-socialmedia' };
const STATUS_TYPES = ['Present', 'Absent', 'Half Day', 'Leave', 'Work From Home', 'Holiday', 'Weekly Off'];
const STATUS_CLASSES = {
  'Present': 'success', 'Absent': 'danger', 'Half Day': 'warning',
  'Leave': 'info', 'Work From Home': 'primary', 'Holiday': 'teal', 'Weekly Off': 'purple'
};
const LEAVE_TYPES = ['casual', 'sick', 'optional', 'unpaid'];

const AVATAR_COLORS = [
  '#6366f1', '#a855f7', '#ec4899', '#f43f5e', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
  '#8b5cf6', '#d946ef', '#10b981', '#f59e0b', '#0ea5e9'
];

// ---- Employees (loaded from API — no hardcoded seed data) ----
let employees = [];

// ---- API Configuration ----
const API_BASE_URL = (function () {
  const h = window.location.hostname;
  const proto = window.location.protocol;
  // If opened via file:// or localhost, always point to the local backend
  if (proto === 'file:' || !h || h === 'localhost' || h === '127.0.0.1') {
    return 'http://localhost:5001/api';
  }
  // In production, support both main domain subfolder and subdomain deployment
  const path = window.location.pathname;
  const basePath = path.includes('/attendance') ? '/attendance' : '';
  return window.location.origin + basePath + '/api';
})();

async function apiFetch(url, options = {}) {
  options.credentials = 'include';
  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    options.headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };
    options.body = JSON.stringify(options.body);
  }

  let response;
  try {
    console.log(`[apiFetch] Requesting: ${options.method || 'GET'} ${url}`);
    response = await fetch(url, options);
  } catch (networkErr) {
    console.error(`[apiFetch] Network error for ${url}:`, networkErr);
    throw new Error(`Cannot connect to backend server (${API_BASE_URL}). Please ensure the backend is running on port 5001.`);
  }

  if (!response.ok) {
    if (response.status === 401) {
      // Only auto-logout on GET requests to core endpoints
      // POST/PUT/DELETE should show an error instead of crashing the page
      const method = (options.method || 'GET').toUpperCase();
      const isCorePath = url.includes('/auth/') || url.includes('/employees') || url.includes('/attendance');
      const isDocumentPath = url.includes('/documents/');
      if (currentUser && isCorePath && !isDocumentPath && method === 'GET') {
        logout();
        throw new Error('Session expired. Please log in again.');
      }
    }
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
  }
  return response.json();
}

// ---- State ----
let todayAtt = {};
let monthData = {};
let attendanceHistory = {}; // per-employee daily records
let scanLog = [];
let nextIdNum = 1030;
let maxLogIdSeen = 0;

let selectedPayrollMonth = new Date().getMonth();
let selectedPayrollYear = new Date().getFullYear();

// ---- Employee Documents Store (Deprecated in favor of dynamic API fetch) ----
let employeeDocuments = {};

// ---- Holidays Store ----
let holidaysList = [];

// ---- Audit Logs ----
let auditLogs = [
  { id: 'AL-1001', timestamp: new Date(Date.now() - 86400000).toISOString(), user: 'admin@cubiccode.io', action: 'System Config', details: 'Updated late penalty policy' }
];

let notifications = [];

try {
  const savedNotifications = localStorage.getItem('NOTIFICATIONS');
  if (savedNotifications) {
    notifications = JSON.parse(savedNotifications);
  } else {
    localStorage.setItem('NOTIFICATIONS', JSON.stringify(notifications));
  }
} catch (e) { console.warn('Failed to load notifications', e); }

// ---- Leave Settings ----
let LEAVE_SETTINGS = {
  casualCount: 1.0,
  sickCount: 0.5,
  optionalCount: 0.0,
  lopRule: 'pro-rata', // 'pro-rata' or 'fixed'
  lopFixedAmount: 1000,
  halfDayRule: '0.5', // '0.5' (default), '0.0' (fully paid), '1.0' (full deduction)
  carryForward: true,
  carryForwardMax: 5,
  monthlyLimit: 1.5,
  yearlyLimit: 18
};

try {
  const savedLeaveSettings = localStorage.getItem('LEAVE_SETTINGS');
  if (savedLeaveSettings) {
    LEAVE_SETTINGS = { ...LEAVE_SETTINGS, ...JSON.parse(savedLeaveSettings) };
  }
} catch (e) {
  console.error('Failed to load LEAVE_SETTINGS:', e);
}

// ---- Payroll & Overtime Settings ----
let PAYROLL_SETTINGS = {
  workDays: 26,
  otMultiplier: 1.5,
  monthlyOtEnabled: false,
  lunchBreakDeduction: true
};

try {
  const savedPayrollSettings = localStorage.getItem('PAYROLL_SETTINGS');
  if (savedPayrollSettings) {
    PAYROLL_SETTINGS = { ...PAYROLL_SETTINGS, ...JSON.parse(savedPayrollSettings) };
  }
} catch (e) {
  console.error('Failed to load PAYROLL_SETTINGS:', e);
}


function getPaidLeaveAllowance(emp) {
  const base = parseFloat(LEAVE_SETTINGS.monthlyLimit || 0);
  if (!emp) return base;
  const cf = LEAVE_SETTINGS.carryForward ? Math.min(parseFloat(emp.carriedForwardLeaves || 0), parseFloat(LEAVE_SETTINGS.carryForwardMax || 0)) : 0;
  return base + cf;
}

// ---- Late Penalty Policy ----
let LATE_PENALTY = {
  enabled: localStorage.getItem('LATE_PENALTY_enabled') !== 'false', // Default to true if not 'false'
  graceMinutes: 10,        // No penalty within 10 min of shift start
  warningThreshold: 3,     // 3+ lates = habitual latecomer
  penaltyPerLate: 500,     // ₹500 deducted per late mark beyond threshold
  maxPenaltyPct: 10        // Max 10% of gross can be deducted as late penalty
};

// ---- Attendance History Compiler from Database Events ----
function compileAttendanceData(logs) {
  attendanceHistory = {};
  scanLog = [];
  todayAtt = {};

  // Sort logs chronologically (oldest first)
  const sortedLogs = [...logs].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  // Group logs by employee and date
  const grouped = {};
  const todayStr = getTodayDate();

  for (const log of sortedLogs) {
    const timestamp = new Date(log.timestamp);
    const dateStr = timestamp.getFullYear() + '-' +
      String(timestamp.getMonth() + 1).padStart(2, '0') + '-' +
      String(timestamp.getDate()).padStart(2, '0');
    const timeStr = String(timestamp.getHours()).padStart(2, '0') + ':' +
      String(timestamp.getMinutes()).padStart(2, '0');

    const clearedTimeStr = localStorage.getItem('SCAN_LOG_CLEARED_TIME');
    const clearedTime = clearedTimeStr ? new Date(clearedTimeStr) : null;
    if (!clearedTime || timestamp > clearedTime) {
      let type = 'Check-Out';
      let detail = `Checked out at ${timeStr} on ${dateStr} via ${log.device || 'GATE_1'}`;
      if (log.action === 'IN') {
        type = log.device === 'WFH_DASHBOARD' ? 'WFH' : 'Check-In';
        detail = `${log.device === 'WFH_DASHBOARD' ? 'Checked in (WFH)' : 'Checked in'} at ${timeStr} on ${dateStr} via ${log.device || 'GATE_1'}`;
      } else if (log.action === 'ENROLL') {
        type = 'Enrollment';
        detail = `Enrolled biometric fingerprint at ${timeStr} on ${dateStr} via ${log.device || 'GATE_1'}`;
      }

      scanLog.unshift({
        id: log.id,
        empId: log.employee_id,
        name: log.employee_name,
        time: formatTimeShort(timestamp),
        type: type,
        detail: detail,
        device: log.device || 'GATE_1',
        timestamp: log.timestamp
      });
    }

    if (log.action === 'ENROLL') continue;

    // Track today's attendance for dashboard status
    if (dateStr === todayStr) {
      if (!todayAtt[log.employee_id]) {
        todayAtt[log.employee_id] = { in: null, out: null, hours: 0 };
      }
      if (log.action === 'IN') {
        if (!todayAtt[log.employee_id].in || new Date(log.timestamp) < new Date(todayAtt[log.employee_id].in)) {
          todayAtt[log.employee_id].in = log.timestamp;
        }
      } else if (log.action === 'OUT') {
        if (!todayAtt[log.employee_id].out || new Date(log.timestamp) > new Date(todayAtt[log.employee_id].out)) {
          todayAtt[log.employee_id].out = log.timestamp;
        }
      }
    }

    if (!grouped[log.employee_id]) grouped[log.employee_id] = {};
    if (!grouped[log.employee_id][dateStr]) grouped[log.employee_id][dateStr] = [];
    grouped[log.employee_id][dateStr].push({ action: log.action, timeStr, timestamp, device: log.device });
  }

  // Finalize hours for today's logs
  employees.forEach(emp => {
    const att = todayAtt[emp.id];
    if (att && att.in && att.out) {
      const inDate = new Date(att.in);
      const outDate = new Date(att.out);
      att.hours = Math.round(((outDate - inDate) / 3600000) * 100) / 100;
    } else if (att && att.in) {
      att.hours = 0;
    }
  });

  // Populate days for the selected payroll calendar month
  const datesList = [];
  const daysInMonth = new Date(selectedPayrollYear, selectedPayrollMonth + 1, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = selectedPayrollYear + '-' +
      String(selectedPayrollMonth + 1).padStart(2, '0') + '-' +
      String(d).padStart(2, '0');
    const dayOfWeek = new Date(selectedPayrollYear, selectedPayrollMonth, d).getDay();
    datesList.push({ dateStr, dayOfWeek });
  }

  employees.forEach(emp => {
    attendanceHistory[emp.id] = [];
    const empLogs = grouped[emp.id] || {};

    datesList.forEach(({ dateStr, dayOfWeek }) => {
      // 1. If date is before joining date, always skip.
      if (emp.joiningDate && dateStr < emp.joiningDate) {
        return;
      }
      // 2. Cutoff Date (payrollStartDate) check:
      // Only hide dates before payrollStartDate if those dates fall in the selected month/year or later.
      // If we are viewing a past month (before the cutoff month), we show it fully.
      if (emp.payrollStartDate && dateStr < emp.payrollStartDate) {
        const [cutY, cutM] = emp.payrollStartDate.split('-').map(Number);
        const cutoffTime = cutY * 12 + (cutM - 1);
        const selectedTime = selectedPayrollYear * 12 + selectedPayrollMonth;
        if (selectedTime >= cutoffTime) {
          return;
        }
      }
      const dayLogs = empLogs[dateStr];

      let login = null;
      let logout = null;
      let checkInLog = null;
      let checkOutLog = null;

      if (dayLogs) {
        const inLogs = dayLogs.filter(l => l.action === 'IN');
        const outLogs = dayLogs.filter(l => l.action === 'OUT');
        checkInLog = inLogs.length > 0 ? inLogs[0] : null;
        checkOutLog = outLogs.length > 0 ? outLogs[outLogs.length - 1] : null;
        login = checkInLog ? checkInLog.timeStr : null;
        logout = checkOutLog ? checkOutLog.timeStr : null;
      }

      let delay = 0;
      let earlyExit = 0;
      let hours = 0;
      const todayStr = getTodayDate();
      const hasJoined = !emp.joiningDate || (dateStr >= emp.joiningDate);
      const hasOccurred = dateStr <= todayStr;
      let status = (hasJoined && hasOccurred) ? 'Absent' : '—';

      const shiftH = parseInt(emp.shiftStart.split(':')[0]);
      const shiftM = parseInt(emp.shiftStart.split(':')[1]);
      const endH = parseInt(emp.shiftEnd.split(':')[0]);
      const endM = parseInt(emp.shiftEnd.split(':')[1]);

      // Check if dateStr matches a configured holiday
      const isHoliday = holidaysList.some(h => {
        const hDate = new Date(h.holiday_date);
        const hDateStr = hDate.getFullYear() + '-' +
          String(hDate.getMonth() + 1).padStart(2, '0') + '-' +
          String(hDate.getDate()).padStart(2, '0');
        return hDateStr === dateStr;
      });

      const isSaturday = (dayOfWeek === 6);
      const halfDayThreshold = isSaturday ? 4.0 : 5.0;
      const halfDayCutoffMin = 16 * 60 + 30; // 4:30 PM (990 mins)

      const isWfh = checkInLog && checkInLog.device === 'WFH_DASHBOARD';

      if (isWfh) {
        status = 'Work From Home';
        hours = 8.0;
        delay = 0;
        earlyExit = 0;
      } else if (login && logout) {
        status = 'Present';
        const [linH, linM] = login.split(':').map(Number);
        const [loutH, loutM] = logout.split(':').map(Number);
        const loginMin = linH * 60 + linM;
        const logoutMin = loutH * 60 + loutM;

        delay = Math.max(0, loginMin - (shiftH * 60 + shiftM));
        if (isSaturday) {
          const satEndMin = (shiftH * 60 + shiftM) + 240; // 4 hours shift
          earlyExit = Math.max(0, satEndMin - logoutMin);
        } else {
          earlyExit = Math.max(0, (endH * 60 + endM) - logoutMin);
        }
        hours = Math.round(((logoutMin - loginMin) / 60) * 100) / 100;

        if (logoutMin < halfDayCutoffMin || hours < halfDayThreshold) {
          status = 'Half Day';
        }
      } else if (login) {
        status = 'Present';
        const [linH, linM] = login.split(':').map(Number);
        delay = Math.max(0, (linH * 60 + linM) - (shiftH * 60 + shiftM));

        if (dateStr === todayStr) {
          hours = 0.0;
        } else {
          hours = 4.0;
          status = 'Half Day';
        }
      } else if (logout) {
        status = 'Half Day';
        hours = 4.0;
      } else if (isHoliday && hasJoined && hasOccurred) {
        status = 'Holiday';
      } else if (dayOfWeek === 0 && hasJoined && hasOccurred) {
        status = 'Weekly Off';
      }

      const record = {
        date: dateStr,
        login,
        logout,
        status,
        delay,
        earlyExit,
        hours,
        leaveType: null,
        missedPunch: (login && !logout) ? 'logout' : (!login && logout) ? 'login' : null
      };

      attendanceHistory[emp.id].push(record);
    });
  });
}

// ---- Initialize All Data ----
function initAttendanceData() {
  monthData = {}; // Clear previous calculations to ensure real-time accuracy on reload
  employees.forEach(emp => {
    if (!todayAtt[emp.id]) {
      todayAtt[emp.id] = { in: null, out: null, hours: 0 };
    }
    const history = attendanceHistory[emp.id] || [];
    const presentDays = history.filter(r => ['Present', 'Work From Home', 'Holiday'].includes(r.status)).length;
    const halfDays = history.filter(r => r.status === 'Half Day').length;
    const halfDayMultiplier = 1.0 - parseFloat(LEAVE_SETTINGS.halfDayRule);
    const days = presentDays + halfDays * halfDayMultiplier;
    const hours = history.reduce((s, r) => s + (r.hours || 0), 0);
    monthData[emp.id] = { days, hours: Math.round(hours * 100) / 100 };
  });
}


async function loadAllData() {
  try {
    try {
      const liveSettings = await apiFetch(`${API_BASE_URL}/settings/leave`);
      LEAVE_SETTINGS = { ...LEAVE_SETTINGS, ...liveSettings };
      localStorage.setItem('LEAVE_SETTINGS', JSON.stringify(LEAVE_SETTINGS));
    } catch (e) {
      console.warn('Could not sync LEAVE_SETTINGS from server, using local:', e);
    }

    const empData = await apiFetch(`${API_BASE_URL}/employees`);
    employees = empData;

    if (employees && employees.length > 0) {
      let maxNum = 1030;
      employees.forEach(emp => {
        if (emp.id) {
          const parts = emp.id.split('-');
          if (parts.length >= 3) {
            const num = parseInt(parts[2], 10);
            if (!isNaN(num) && num >= maxNum) {
              maxNum = num + 1;
            }
          }
        }
      });
      nextIdNum = maxNum;
    }

    const logs = await apiFetch(`${API_BASE_URL}/attendance`);
    if (logs && logs.length > 0) {
      maxLogIdSeen = Math.max(...logs.map(l => l.id || 0));
    }
    try {
      holidaysList = await apiFetch(`${API_BASE_URL}/holidays`);
    } catch (hErr) {
      console.error('Failed to load holidays:', hErr);
      holidaysList = [];
    }
    compileAttendanceData(logs);
    initAttendanceData();

    // Clean up notifications for deleted employees
    notifications = notifications.filter(n => !n.empId || employees.some(e => e.id === n.empId));
    // Recalculate anniversaries, birthdays and probation reminders
    generateAnniversaryAndBirthdayReminders();
    generateProbationReminders();
    // Persist updated notifications
    try {
      localStorage.setItem('NOTIFICATIONS', JSON.stringify(notifications));
    } catch (e) { console.warn('Failed to save notifications', e); }
    updateNotificationBadge();
  } catch (err) {
    console.error('Error loading data from APIs:', err);
  }
}

// ---- Audit Logging ----
function logAuditAction(action, details) {
  const user = typeof currentUser !== 'undefined' && currentUser ? currentUser.email : 'System';
  auditLogs.unshift({
    id: 'AL-' + Math.floor(1000 + Math.random() * 9000),
    timestamp: new Date().toISOString(),
    user,
    action,
    details
  });
}

// ---- Utility Functions ----
function getInitials(firstName, lastName) {
  const f = (firstName || '').trim().charAt(0);
  const l = (lastName || '').trim().charAt(0);
  return (f + l).toUpperCase() || '?';
}

function getAvatarColor(id) {
  const num = parseInt(id.replace(/\D/g, '')) || 0;
  return AVATAR_COLORS[num % AVATAR_COLORS.length];
}

function getDeptClass(dept) {
  return DEPT_CLASSES[dept] || 'dept-webdev';
}

function getStatusClass(status) {
  return STATUS_CLASSES[status] || 'info';
}

function formatCurrency(amount) {
  return '₹' + Math.round(amount).toLocaleString('en-IN');
}

function formatTime(date) {
  if (!date) return '—';
  const d = new Date(date);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
}

function formatTimeShort(date) {
  if (!date) return '—';
  const d = new Date(date);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function format24to12(timeStr) {
  if (!timeStr) return '—';
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function generateEmployeeId(department) {
  const prefix = DEPT_PREFIXES[department] || 'GEN';
  const id = `EMP-${prefix}-${nextIdNum}`;
  nextIdNum++;
  return id;
}

function getCurrentMonth() {
  const d = new Date();
  return d.toLocaleString('en-IN', { month: 'long', year: 'numeric' });
}

function getToday() {
  return new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function getTodayDate() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function formatDateShort(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function formatDateFull(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' });
}

function getExpectedHours(emp) {
  const [sh, sm] = emp.shiftStart.split(':').map(Number);
  const [eh, em] = emp.shiftEnd.split(':').map(Number);
  return (eh * 60 + em - sh * 60 - sm) / 60;
}

// ---- Late Count Helper ----
function getLateCount(empId) {
  const history = attendanceHistory[empId] || [];
  return history.filter(r => r.delay > LATE_PENALTY.graceMinutes).length;
}

function isHabitualLatecomer(empId) {
  return getLateCount(empId) >= LATE_PENALTY.warningThreshold;
}

function getLatePenaltyAmount(empId, grossPay) {
  if (!LATE_PENALTY.enabled) return 0;
  const lateCount = getLateCount(empId);
  if (lateCount < LATE_PENALTY.warningThreshold) return 0;
  const penalizableLates = lateCount; // charge for all late marks once threshold crossed
  const penalty = penalizableLates * LATE_PENALTY.penaltyPerLate;
  const maxPenalty = grossPay * (LATE_PENALTY.maxPenaltyPct / 100);
  return Math.min(Math.round(penalty), Math.round(maxPenalty));
}

// ---- Salary Computation (Basic Pay + Late Penalty + Leaves) ----
function computeSalary(emp) {
  const md = monthData[emp.id] || { days: 0, hours: 0, otHours: 0 };
  const WORK_DAYS = PAYROLL_SETTINGS.workDays || 26;
  const lateCount = getLateCount(emp.id);

  // Leave/LOP calculations
  const history = attendanceHistory[emp.id] || [];
  const todayStr = getTodayDate();
  const absentDays = history.filter(r => r.status === 'Absent' && r.date !== todayStr).length;
  const halfDays = history.filter(r => r.status === 'Half Day' && r.date !== todayStr).length;
  const totalLeavesTaken = (emp.leavesTaken || 0) + absentDays + (halfDays * 0.5);
  const paidAllowance = getPaidLeaveAllowance(emp);
  let unpaidLeaveDeduction = 0;
  let excessLeaves = 0;
  if (emp.salaryType === 'monthly' && totalLeavesTaken > paidAllowance) {
    excessLeaves = totalLeavesTaken - paidAllowance;
    if (LEAVE_SETTINGS.lopRule === 'fixed') {
      unpaidLeaveDeduction = Math.round(excessLeaves * LEAVE_SETTINGS.lopFixedAmount);
    } else {
      const perDaySalary = emp.monthlyRate / WORK_DAYS;
      unpaidLeaveDeduction = Math.round(excessLeaves * perDaySalary);
    }
  }

  // === EARNINGS ===
  let basicPay = 0;
  let overtime = 0;
  let bonus = emp.bonus || 0;

  if (emp.salaryType === 'monthly') {
    // Basic pay is calculated directly based on the days present + paid leaves
    const paidLeaves = md.days > 0 ? Math.min(totalLeavesTaken, paidAllowance) : 0;
    const paidDays = Math.min(WORK_DAYS, md.days + paidLeaves);
    const dailyRate = Math.round(emp.monthlyRate / WORK_DAYS);
    basicPay = dailyRate * paidDays;

    if (PAYROLL_SETTINGS.monthlyOtEnabled) {
      const hourlyRate = emp.monthlyRate / (WORK_DAYS * 8);
      const otHours = md.otHours || 0;
      overtime = Math.round(otHours * hourlyRate * PAYROLL_SETTINGS.otMultiplier);
    }
  } else {
    // Hourly: Basic is regular hours * rate, Overtime is OT hours * rate * multiplier
    const otHours = md.otHours || 0;
    const regularHours = Math.max(0, md.hours - otHours);
    basicPay = Math.round(regularHours * emp.hourlyRate);
    overtime = Math.round(otHours * emp.hourlyRate * PAYROLL_SETTINGS.otMultiplier);
  }

  const totalEarnings = basicPay + overtime + bonus;

  // === DEDUCTIONS ===
  const latePenalty = getLatePenaltyAmount(emp.id, basicPay);

  // Since LOP is already reflected in basicPay, totalDeductions is just latePenalty
  const totalDeductions = latePenalty;
  const netSalary = Math.max(0, totalEarnings - totalDeductions);

  return {
    daysPresent: md.days,
    hoursWorked: md.hours,
    otHours: md.otHours || 0,
    basicPay,
    overtime,
    bonus,
    totalEarnings,
    latePenalty,
    lateCount,
    leavesTaken: totalLeavesTaken,
    absentDays,
    halfDays,
    paidAllowance,
    excessLeaves,
    unpaidLeaveDeduction: 0, // 0 since LOP is already integrated into basicPay
    totalDeductions,
    net: Math.round(netSalary),
    // Legacy compat
    gross: basicPay + overtime + bonus,
    grossEarnings: basicPay + overtime + bonus,
    basic: basicPay,
    hra: 0,
    da: 0,
    conveyance: 0,
    medical: 0,
    special: 0,
    pf: 0,
    esi: 0,
    tds: 0,
    profTax: 0
  };
}

// ---- Toast Notifications ----
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const icons = { success: 'ti-circle-check', error: 'ti-alert-circle', info: 'ti-info-circle', warning: 'ti-alert-triangle', late: 'ti-alarm' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<i class="ti ${icons[type] || icons.info}"></i><span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  }, type === 'late' ? 6000 : 3000);
}

// ---- Notification System ----
function addNotification(title, message, type = 'info', empId = null) {
  const now = new Date();
  notifications.unshift({
    id: Date.now(),
    title,
    message,
    type, // 'late', 'habitual', 'info', 'success'
    empId,
    time: formatTimeShort(now),
    timestamp: now.toISOString(),
    read: false
  });
  // Keep max 50 notifications
  if (notifications.length > 50) notifications.pop();
  try {
    localStorage.setItem('NOTIFICATIONS', JSON.stringify(notifications));
  } catch (e) { console.warn('Failed to save notifications', e); }
  updateNotificationBadge();
}

function getUnreadCount() {
  return notifications.filter(n => !n.read).length;
}

function generateAnniversaryAndBirthdayReminders() {
  const today = new Date();
  const todayMonth = today.getMonth(); // 0-indexed
  const todayDate = today.getDate();

  const tomorrow = new Date();
  tomorrow.setDate(today.getDate() + 1);
  const tomorrowMonth = tomorrow.getMonth();
  const tomorrowDate = tomorrow.getDate();

  employees.forEach(emp => {
    // --- Birthday check ---
    if (emp.dateOfBirth) {
      const dob = new Date(emp.dateOfBirth);
      const dobMonth = dob.getMonth();
      const dobDate = dob.getDate();
      const age = today.getFullYear() - dob.getFullYear();

      if (dobMonth === todayMonth && dobDate === todayDate) {
        // Birthday is today!
        const notifExists = notifications.some(n =>
          n.empId === emp.id && n.title.includes('Birthday Today')
        );
        if (!notifExists) {
          addNotification(
            `🎂 Birthday Today — ${emp.firstName} ${emp.lastName}`,
            `Happy Birthday! ${emp.firstName} ${emp.lastName} turns ${age} today.`,
            'info',
            emp.id
          );
        }
      } else if (dobMonth === tomorrowMonth && dobDate === tomorrowDate) {
        // Birthday is tomorrow!
        const notifExists = notifications.some(n =>
          n.empId === emp.id && n.title.includes('Upcoming Birthday')
        );
        if (!notifExists) {
          addNotification(
            `🎂 Upcoming Birthday — ${emp.firstName} ${emp.lastName}`,
            `${emp.firstName} ${emp.lastName}'s birthday is tomorrow. She turns ${age}.`,
            'info',
            emp.id
          );
        }
      }
    }

    // --- Work Anniversary check ---
    if (emp.joiningDate) {
      const join = new Date(emp.joiningDate);
      const joinMonth = join.getMonth();
      const joinDate = join.getDate();
      const yearsCompleted = today.getFullYear() - join.getFullYear();

      if (yearsCompleted > 0) {
        if (joinMonth === todayMonth && joinDate === todayDate) {
          // Anniversary today!
          const notifExists = notifications.some(n =>
            n.empId === emp.id && n.title.includes('Anniversary Today')
          );
          if (!notifExists) {
            addNotification(
              `🎉 Work Anniversary Today — ${emp.firstName} ${emp.lastName}`,
              `Congratulations! ${emp.firstName} completed ${yearsCompleted} year${yearsCompleted > 1 ? 's' : ''} at QuantumClk.`,
              'success',
              emp.id
            );
          }
        } else if (joinMonth === tomorrowMonth && joinDate === tomorrowDate) {
          // Anniversary tomorrow!
          const notifExists = notifications.some(n =>
            n.empId === emp.id && n.title.includes('Anniversary Tomorrow')
          );
          if (!notifExists) {
            addNotification(
              `🎉 Work Anniversary Tomorrow — ${emp.firstName} ${emp.lastName}`,
              `${emp.firstName} completes ${yearsCompleted} year${yearsCompleted > 1 ? 's' : ''} of service tomorrow.`,
              'success',
              emp.id
            );
          }
        }
      }
    }
  });
}

function generateProbationReminders() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  employees.forEach(emp => {
    if (emp.lifecycleStatus === 'Probation' && emp.probationEndDate) {
      const probationEnd = new Date(emp.probationEndDate);
      probationEnd.setHours(0, 0, 0, 0);

      const diffTime = probationEnd.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays < 0) {
        const title = `⚠️ Probation Expired — ${emp.firstName} ${emp.lastName}`;
        const notifExists = notifications.some(n =>
          n.empId === emp.id && n.title.includes('Probation Expired')
        );
        if (!notifExists) {
          addNotification(
            title,
            `${emp.firstName} ${emp.lastName}'s probation period expired on ${emp.probationEndDate}. Action required: confirm or extend status.`,
            'habitual',
            emp.id
          );
        }
      } else if (diffDays <= 7) {
        const title = `⚠️ Probation Ending Soon — ${emp.firstName} ${emp.lastName}`;
        const notifExists = notifications.some(n =>
          n.empId === emp.id && n.title.includes('Probation Ending Soon')
        );
        if (!notifExists) {
          addNotification(
            title,
            `${emp.firstName} ${emp.lastName}'s probation period ends in ${diffDays} day${diffDays !== 1 ? 's' : ''} (on ${emp.probationEndDate}).`,
            'late',
            emp.id
          );
        }
      }
    }
  });
}


function updateNotificationBadge() {
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  const count = getUnreadCount();
  badge.textContent = count;
  badge.style.display = count > 0 ? 'flex' : 'none';
}

function toggleNotifications() {
  const dropdown = document.getElementById('notif-dropdown');
  if (!dropdown) return;
  const isOpen = dropdown.classList.contains('open');
  if (isOpen) {
    dropdown.classList.remove('open');
  } else {
    dropdown.innerHTML = renderNotificationDropdown();
    dropdown.classList.add('open');
  }
}

function markAllRead() {
  notifications.forEach(n => n.read = true);
  try {
    localStorage.setItem('NOTIFICATIONS', JSON.stringify(notifications));
  } catch (e) { console.warn('Failed to save notifications', e); }
  updateNotificationBadge();
  const dropdown = document.getElementById('notif-dropdown');
  if (dropdown && dropdown.classList.contains('open')) {
    dropdown.innerHTML = renderNotificationDropdown();
  }
}

function renderNotificationDropdown() {
  const typeIcons = { late: 'ti-alarm', habitual: 'ti-alert-octagon', info: 'ti-info-circle', success: 'ti-circle-check' };
  const typeColors = { late: 'var(--warning)', habitual: 'var(--danger)', info: 'var(--info)', success: 'var(--success)' };

  const unreadList = notifications.filter(n => !n.read);

  if (unreadList.length === 0) {
    return `
      <div class="notif-header"><span>Notifications</span></div>
      <div class="notif-empty"><i class="ti ti-bell-off"></i><p>No new notifications</p></div>
    `;
  }

  const unread = unreadList.length;
  return `
    <div class="notif-header">
      <span>Notifications ${unread > 0 ? `<span class="notif-unread-count">${unread} new</span>` : ''}</span>
      ${unread > 0 ? `<button class="btn btn-ghost btn-sm" onclick="markAllRead()">Mark all read</button>` : ''}
    </div>
    <div class="notif-list">
      ${unreadList.slice(0, 20).map(n => `
        <div class="notif-item unread">
          <div class="notif-item-icon" style="color:${typeColors[n.type] || 'var(--info)'}">
            <i class="ti ${typeIcons[n.type] || 'ti-info-circle'}"></i>
          </div>
          <div class="notif-item-content">
            <div class="notif-item-title">${n.title}</div>
            <div class="notif-item-msg">${n.message}</div>
          </div>
          <div class="notif-item-time">${n.time}</div>
        </div>
      `).join('')}
    </div>
  `;
}

// ---- Modal System ----
function openModal(content) {
  const overlay = document.getElementById('modal-overlay');
  const container = document.getElementById('modal-container');
  container.innerHTML = content;
  overlay.classList.add('active');
  overlay.onclick = (e) => {
    if (e.target === overlay) closeModal();
  };
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('active');
}

// ---- SPA Router ----
const VIEW_TITLES = {
  dashboard: { title: 'Dashboard', breadcrumb: `Overview • ${getToday()}` },
  scanner: { title: 'Fingerprint Scanner', breadcrumb: 'Biometric Check-In / Check-Out' },
  employees: { title: 'Employee Registry', breadcrumb: 'Manage Employee Roster' },
  salary: { title: 'Salary Breakdown', breadcrumb: `Payroll • ${getCurrentMonth()}` },
  report: { title: 'Reports & Analytics', breadcrumb: `Comprehensive Reports • ${getCurrentMonth()}` },
  settings: { title: 'Admin Settings', breadcrumb: 'System Configuration' }
};

function getViewRenderer(view) {
  const renderers = {
    dashboard: typeof renderDashboard !== 'undefined' ? renderDashboard : null,
    scanner: typeof renderScanner !== 'undefined' ? renderScanner : null,
    employees: typeof renderEmployees !== 'undefined' ? renderEmployees : null,
    salary: typeof renderSalary !== 'undefined' ? renderSalary : null,
    report: typeof renderReport !== 'undefined' ? renderReport : null,
    settings: typeof renderSettings !== 'undefined' ? renderSettings : null
  };
  return renderers[view] || renderers.dashboard;
}

function navigateTo(view) {
  const app = document.getElementById('app');
  if (!app) return;
  const info = VIEW_TITLES[view] || VIEW_TITLES.dashboard;

  const topbarTitle = document.getElementById('topbar-title');
  if (topbarTitle) topbarTitle.textContent = info.title;

  const topbarBreadcrumb = document.getElementById('topbar-breadcrumb');
  if (topbarBreadcrumb) topbarBreadcrumb.textContent = info.breadcrumb;

  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.view === view);
  });
  const renderer = getViewRenderer(view);
  if (renderer) renderer(app);
}

function handleRoute() {
  const hash = window.location.hash.replace('#', '') || 'dashboard';
  navigateTo(hash);
}

// ---- Auth & RBAC ----
let currentUser = null;

// ---- Admin Password (persisted in localStorage) ----
const DEFAULT_ADMIN_PASSWORD = '123456';
function getAdminPassword() {
  return localStorage.getItem('ADMIN_PASSWORD') || DEFAULT_ADMIN_PASSWORD;
}

async function initAuth() {
  try {
    const sessionStatus = await apiFetch(`${API_BASE_URL}/auth/session`);
    if (sessionStatus.loggedIn) {
      await loadAllData();
      currentUser = employees.find(e => e.systemRole === 'SUPER_ADMIN') || {
        id: 'EMP-ADM-1000',
        firstName: 'System',
        lastName: 'Admin',
        email: 'admin@cubiccode.io',
        systemRole: 'SUPER_ADMIN'
      };
      document.getElementById('login-screen').style.display = 'none';
      document.getElementById('app-shell').style.display = 'grid';
      applyRBAC();
      handleRoute();
      return;
    }
  } catch (err) {
    console.error('Session validation failed:', err);
  }

  const btn = document.getElementById('btn-login');
  if (btn) {
    btn.onclick = async () => {
      const loginId = document.getElementById('login-id').value.trim();
      const password = document.getElementById('login-password').value.trim();

      if (!loginId || !password) {
        alert('Please enter both Login ID and Password.');
        return;
      }

      try {
        const result = await apiFetch(`${API_BASE_URL}/auth/login`, {
          method: 'POST',
          body: { username: loginId, password: password }
        });

        if (result.success) {
          await loadAllData();
          currentUser = employees.find(e => e.systemRole === 'SUPER_ADMIN') || {
            id: 'EMP-ADM-1000',
            firstName: 'System',
            lastName: 'Admin',
            email: 'admin@cubiccode.io',
            systemRole: 'SUPER_ADMIN'
          };
          document.getElementById('login-screen').style.display = 'none';
          document.getElementById('app-shell').style.display = 'grid';
          applyRBAC();
          handleRoute();
          showToast('Welcome back, Admin!', 'success');
        }
      } catch (err) {
        alert(err.message || 'Invalid Admin Login ID or Password.');
      }
    };
  }
}

async function changeAdminPassword(currentPwd, newPwd, confirmPwd) {
  if (!newPwd || newPwd.length < 4) {
    showToast('New password must be at least 4 characters', 'error');
    return false;
  }
  if (newPwd !== confirmPwd) {
    showToast('New password and confirmation do not match', 'error');
    return false;
  }
  try {
    const result = await apiFetch(`${API_BASE_URL}/auth/change-password`, {
      method: 'POST',
      body: { currentPassword: currentPwd, newPassword: newPwd }
    });
    if (result.success) {
      localStorage.setItem('ADMIN_PASSWORD', newPwd);
      showToast('Password changed successfully!', 'success');
      logAuditAction('Change Password', 'Admin password was updated');
      return true;
    }
  } catch (err) {
    showToast(err.message || 'Failed to update password', 'error');
    return false;
  }
}

async function logout() {
  try {
    await apiFetch(`${API_BASE_URL}/auth/logout`, { method: 'POST' });
  } catch (e) {
    console.error('Logout error:', e);
  }
  currentUser = null;
  window.location.reload();
}


function applyRBAC() {
  if (!currentUser) return;
  // Update Topbar UI
  const profileName = document.querySelector('.topbar-profile-name');
  if (profileName) profileName.textContent = currentUser.firstName + ' ' + currentUser.lastName;
  const profileRole = document.querySelector('.topbar-profile-role');
  if (profileRole) profileRole.textContent = currentUser.systemRole;

  const color = getAvatarColor(currentUser.id);
  const avatar = document.querySelector('.topbar-profile .avatar');
  if (avatar) {
    avatar.style.background = color;
    avatar.textContent = getInitials(currentUser.firstName, currentUser.lastName);
  }

  // Hide specific modules based on role
  const isSuperAdmin = currentUser.systemRole === 'SUPER_ADMIN';
  const isHR = currentUser.systemRole === 'HR_ADMIN';
  const isManager = currentUser.systemRole === 'MANAGER';
  const isEmployee = currentUser.systemRole === 'EMPLOYEE';

  // Hide Scanner (only for Reception/Admin in real life, but for demo keep it everywhere except employee)
  if (isEmployee) document.querySelector('[data-view="scanner"]')?.closest('li')?.remove();

  // Hide Employee Registry & Payroll for simple employees
  if (isEmployee || isManager) {
    document.querySelector('[data-view="salary"]')?.closest('li')?.remove();
  }
  if (isEmployee) {
    document.querySelector('[data-view="employees"]')?.closest('li')?.remove();
  }
}

// ---- Init ----
window.addEventListener('load', function () {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.hash = item.dataset.view;
    });
  });
  window.addEventListener('hashchange', handleRoute);

  generateAnniversaryAndBirthdayReminders();
  generateProbationReminders();
  updateNotificationBadge();

  // Close dropdowns on click outside
  document.addEventListener('click', function (e) {
    // Notification dropdown
    const notifDropdown = document.getElementById('notif-dropdown');
    const notifWrapper = e.target.closest('.notif-wrapper');
    if (notifDropdown && notifDropdown.classList.contains('open') && !notifWrapper) {
      notifDropdown.classList.remove('open');
    }

    // Profile dropdown
    const profileMenu = document.getElementById('profile-menu');
    const profileWrapper = e.target.closest('.user-profile');
    if (profileMenu && profileMenu.classList.contains('open') && !profileWrapper) {
      profileMenu.classList.remove('open');
    }
  });

  // Start Auth Flow
  initAuth();

  // Start background real-time synchronization every 5 seconds
  let lastLogsSerialized = null;
  setInterval(async () => {
    if (typeof currentUser !== 'undefined' && currentUser) {
      try {
        const logs = await apiFetch(`${API_BASE_URL}/attendance`);

        // Process any new logs for late notifications
        if (logs && logs.length > 0) {
          const newLogs = logs.filter(l => l.id > maxLogIdSeen);
          if (newLogs.length > 0) {
            newLogs.forEach(log => {
              maxLogIdSeen = Math.max(maxLogIdSeen, log.id);
              if (log.action && log.action.toUpperCase() === 'IN') {
                const emp = employees.find(e => e.id === log.employee_id);
                if (emp) {
                  const [shiftH, shiftM] = emp.shiftStart.split(':').map(Number);
                  const shiftStartMin = shiftH * 60 + shiftM;
                  const inDate = new Date(log.timestamp);
                  const arrivalMin = inDate.getHours() * 60 + inDate.getMinutes();
                  const delayMin = arrivalMin - shiftStartMin;

                  if (delayMin > LATE_PENALTY.graceMinutes) {
                    showToast(`⚠ LATE ARRIVAL: ${emp.firstName} ${emp.lastName} is ${delayMin} minutes late!`, 'late');

                    addNotification(
                      `Late Arrival — ${emp.firstName} ${emp.lastName}`,
                      `Arrived ${delayMin} min late. Shift: ${format24to12(emp.shiftStart)}, Arrived: ${formatTimeShort(inDate)}`,
                      'late',
                      emp.id
                    );

                    const lateCount = getLateCount(emp.id);
                    if (lateCount >= LATE_PENALTY.warningThreshold) {
                      const penalty = getLatePenaltyAmount(emp.id, emp.monthlyRate || emp.hourlyRate * 200);
                      addNotification(
                        `⚠ Habitual Latecomer — ${emp.firstName} ${emp.lastName}`,
                        `${lateCount} late marks this month. Salary penalty: ₹${penalty.toLocaleString('en-IN')} will be deducted.`,
                        'habitual',
                        emp.id
                      );
                    }
                  }
                }
              }
            });
          }
        }

        // Skip compile and rendering if logs have not changed
        const currentLogsSerialized = JSON.stringify(logs);
        if (lastLogsSerialized !== null && lastLogsSerialized === currentLogsSerialized) {
          return;
        }
        lastLogsSerialized = currentLogsSerialized;

        compileAttendanceData(logs);
        initAttendanceData();

        const hash = window.location.hash.replace('#', '') || 'dashboard';
        if (hash === 'dashboard' || hash === 'report') {
          // Save search input value and focus/cursor position if focused
          const activeEl = document.activeElement;
          const isSearchFocused = activeEl && (activeEl.id === 'dashboard-search');
          const searchValue = activeEl ? activeEl.value : '';
          const selectionStart = activeEl ? activeEl.selectionStart : null;
          const selectionEnd = activeEl ? activeEl.selectionEnd : null;

          navigateTo(hash);

          // Restore search focus and value to prevent disruption
          if (isSearchFocused) {
            const newSearchEl = document.getElementById(activeEl.id);
            if (newSearchEl) {
              newSearchEl.value = searchValue;
              newSearchEl.focus();
              if (selectionStart !== null && selectionEnd !== null) {
                newSearchEl.setSelectionRange(selectionStart, selectionEnd);
              }
              if (typeof filterDashboard === 'function') {
                filterDashboard();
              }
            }
          }
        }
      } catch (err) {
        console.warn('Background sync failed:', err);
      }
    }
  }, 5000);
});
