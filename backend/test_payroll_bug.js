// Test the attendance compile logic for a new employee joined today
const now = new Date("2026-06-29T21:45:00"); // Monday

const emp = {
  id: "EMP-ENG-1037",
  firstName: "Test",
  lastName: "Employee",
  joiningDate: "2026-06-29", // Joined today
  shiftStart: "09:00",
  shiftEnd: "18:00",
  salaryType: "monthly",
  monthlyRate: 30000,
  leavesTaken: 0
};

const holidaysList = []; // empty for test
const LEAVE_SETTINGS = {
  casualCount: 1.0,
  sickCount: 1.0,
  optionalCount: 0.5,
  lopRule: "pro-rata",
  halfDayRule: 0.5
};

const datesList = [];
for (let i = 30; i >= 0; i--) {
  const d = new Date(now);
  d.setDate(now.getDate() - i);
  const dateStr = d.getFullYear() + '-' + 
                  String(d.getMonth() + 1).padStart(2, '0') + '-' + 
                  String(d.getDate()).padStart(2, '0');
  datesList.push({ dateStr, dayOfWeek: d.getDay() });
}

// Grouped logs (empty logs since he hasn't checked in/out)
const empLogs = {};

const attendanceHistory = [];

datesList.forEach(({ dateStr, dayOfWeek }) => {
  // Skip dates before the employee's actual joining date
  if (emp.joiningDate && dateStr < emp.joiningDate) {
    return;
  }

  const dayLogs = empLogs[dateStr];
  
  let login = null;
  let logout = null;
  let checkInLog = null;
  let checkOutLog = null;
  
  let delay = 0;
  let earlyExit = 0;
  let hours = 0;
  let dailyOt = 0;
  
  const hasJoined = !emp.joiningDate || (dateStr >= emp.joiningDate);
  let status = hasJoined ? 'Absent' : '—';
  
  const shiftH = parseInt(emp.shiftStart.split(':')[0]);
  const shiftM = parseInt(emp.shiftStart.split(':')[1]);
  const endH = parseInt(emp.shiftEnd.split(':')[0]);
  const endM = parseInt(emp.shiftEnd.split(':')[1]);
  
  let expectedWorkHours = 8.0;

  if (login && logout) {
    status = 'Present';
  } else if (login) {
    status = 'Present';
    hours = 4.0;
  } else if (logout) {
    status = 'Present';
    hours = 4.0;
  } else if (false) { // isHoliday
    status = 'Holiday';
  } else if (dayOfWeek === 0 && hasJoined) {
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
    dailyOt,
    leaveType: null
  };
  
  attendanceHistory.push(record);
});

console.log("datesList length:", datesList.length);
console.log("Compiled attendanceHistory length:", attendanceHistory.length);
console.log("Compiled history details:", JSON.stringify(attendanceHistory, null, 2));

const presentDays = attendanceHistory.filter(r => ['Present', 'Work From Home', 'Weekly Off', 'Holiday'].includes(r.status)).length;
const halfDays = attendanceHistory.filter(r => r.status === 'Half Day').length;
const days = presentDays + halfDays * 0.5;

console.log("presentDays:", presentDays);
console.log("days present (md.days):", days);

// computeSalary simulation
const md = { days, hours: 0, otHours: 0 };
const WORK_DAYS = 26;
const absentDays = attendanceHistory.filter(r => r.status === 'Absent').length;
const totalLeavesTaken = (emp.leavesTaken || 0) + absentDays + (halfDays * 0.5);
const paidAllowance = LEAVE_SETTINGS.casualCount + LEAVE_SETTINGS.sickCount + LEAVE_SETTINGS.optionalCount;

const paidLeaves = md.days > 0 ? Math.min(totalLeavesTaken, paidAllowance) : 0;
const paidDays = Math.min(WORK_DAYS, md.days + paidLeaves);
const basicPay = Math.round((emp.monthlyRate / WORK_DAYS) * paidDays);

console.log("absentDays:", absentDays);
console.log("totalLeavesTaken:", totalLeavesTaken);
console.log("paidAllowance:", paidAllowance);
console.log("paidLeaves:", paidLeaves);
console.log("paidDays:", paidDays);
console.log("basicPay:", basicPay);
