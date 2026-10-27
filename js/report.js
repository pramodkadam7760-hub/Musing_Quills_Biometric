/* ===== Reports & Analytics — 10-Section Tabbed System ===== */

let activeReportTab = 'summary';
let activeComplianceFilter = 'below90';
let reportFilterDept = '';
let reportFilterStartDate = '';
let reportFilterEndDate = '';

function switchComplianceFilter(filterId) {
  activeComplianceFilter = filterId;
  const content = document.getElementById('report-content');
  if (content && activeReportTab === 'compliance') {
    content.innerHTML = renderComplianceReport();
  }
}

const REPORT_TABS = [
  { id: 'summary', label: 'Attendance Summary', icon: 'ti-list-details' },
  { id: 'daily', label: 'Daily Log', icon: 'ti-calendar-event' },
  { id: 'late', label: 'Late Arrivals', icon: 'ti-alarm' },
  { id: 'early', label: 'Early Exits', icon: 'ti-door-exit' },
  { id: 'hours', label: 'Working Hours', icon: 'ti-clock-hour-4' },
  { id: 'monthly', label: 'Monthly Dashboard', icon: 'ti-chart-bar' },
  { id: 'compliance', label: 'Compliance', icon: 'ti-shield-check' },
  { id: 'weekly', label: 'Weekly Summary', icon: 'ti-report' },
  { id: 'audit', label: 'Audit Logs', icon: 'ti-history' }
];

// ===== FILTER HELPERS =====
function getFilteredEmployees() {
  if (!reportFilterDept) return employees;
  return employees.filter(emp => emp.department === reportFilterDept);
}

function getFilteredHistory(empId) {
  const history = attendanceHistory[empId] || [];
  const emp = employees.find(e => e.id === empId);
  return history.filter(rec => {
    if (emp && emp.joiningDate && rec.date < emp.joiningDate) return false;
    if (reportFilterStartDate && rec.date < reportFilterStartDate) return false;
    if (reportFilterEndDate && rec.date > reportFilterEndDate) return false;
    return true;
  });
}

function getTodayStr() {
  const now = new Date();
  return now.getFullYear() + '-' + 
         String(now.getMonth() + 1).padStart(2, '0') + '-' + 
         String(now.getDate()).padStart(2, '0');
}

function applyReportFilters() {
  const deptSelect = document.getElementById('report-filter-dept');
  const startInput = document.getElementById('report-filter-start');
  const endInput = document.getElementById('report-filter-end');
  reportFilterDept = deptSelect ? deptSelect.value : '';
  reportFilterStartDate = startInput ? startInput.value : '';
  reportFilterEndDate = endInput ? endInput.value : '';
  // Clamp end date to today — no future dates allowed
  const todayMax = getTodayStr();
  if (reportFilterEndDate && reportFilterEndDate > todayMax) {
    reportFilterEndDate = todayMax;
    if (endInput) endInput.value = todayMax;
    showToast('End date capped to today — future dates have no data', 'info');
  }
  if (reportFilterStartDate && reportFilterStartDate > todayMax) {
    reportFilterStartDate = todayMax;
    if (startInput) startInput.value = todayMax;
  }
  document.getElementById('report-content').innerHTML = renderReportSection(activeReportTab);
}

function resetReportFilters() {
  reportFilterDept = '';
  reportFilterStartDate = '';
  reportFilterEndDate = '';
  const deptSelect = document.getElementById('report-filter-dept');
  const startInput = document.getElementById('report-filter-start');
  const endInput = document.getElementById('report-filter-end');
  if (deptSelect) deptSelect.value = '';
  if (startInput) startInput.value = '';
  if (endInput) endInput.value = '';
  document.getElementById('report-content').innerHTML = renderReportSection(activeReportTab);
  showToast('Filters reset', 'info');
}

function renderReport(container) {
  // Set default date range to current month
  const now = new Date();
  const todayMax = getTodayStr();
  const monthStart = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-01';
  const monthEnd = todayMax; // Cap to today, not end of month
  if (!reportFilterStartDate) reportFilterStartDate = monthStart;
  if (!reportFilterEndDate) reportFilterEndDate = monthEnd;
  // Clamp end date to today if user somehow set it to future
  if (reportFilterEndDate > todayMax) reportFilterEndDate = todayMax;

  container.innerHTML = `
    <div class="view-header">
      <div class="view-header-left">
        <h2>Reports & Analytics</h2>
        <p>Comprehensive attendance, payroll & compliance reports for ${getCurrentMonth()}</p>
      </div>
      <div class="view-header-actions">
        <button class="btn btn-secondary btn-sm" onclick="exportReportCSV()"><i class="ti ti-file-spreadsheet"></i> Export CSV</button>
        <button class="btn btn-primary btn-sm" onclick="exportReportPDF()"><i class="ti ti-file-type-pdf"></i> Export PDF</button>
      </div>
    </div>

    <!-- Report Tabs -->
    <div class="report-tabs" id="report-tabs">
      ${REPORT_TABS.filter(tab => tab.id !== 'audit' || (typeof currentUser !== 'undefined' && currentUser && currentUser.systemRole === 'SUPER_ADMIN')).map(tab => `
        <button class="report-tab ${tab.id === activeReportTab ? 'active' : ''}" onclick="switchReportTab('${tab.id}')">
          <i class="ti ${tab.icon}"></i><span>${tab.label}</span>
        </button>
      `).join('')}
    </div>

    <!-- Advanced Filters -->
    <div class="report-filters" style="padding: 16px 24px; background: var(--surface); border-bottom: 1px solid var(--border); display: flex; gap: 16px; align-items: center; flex-wrap: wrap;">
      <div style="font-weight: 600; font-size: 13px; color: var(--text-muted);"><i class="ti ti-filter"></i> Filters:</div>
      <select id="report-filter-dept" class="form-select" style="width: 150px; padding: 6px 12px; font-size: 13px; height: auto;" onchange="applyReportFilters()">
        <option value="">All Departments</option>
        ${DEPARTMENTS.map(d => `<option value="${d}" ${reportFilterDept === d ? 'selected' : ''}>${d}</option>`).join('')}
      </select>
      <input type="date" id="report-filter-start" class="form-input" style="width: 150px; padding: 6px 12px; font-size: 13px; height: auto;" title="Start Date" value="${reportFilterStartDate}" max="${todayMax}" onchange="applyReportFilters()">
      <span style="color:var(--text-muted)">to</span>
      <input type="date" id="report-filter-end" class="form-input" style="width: 150px; padding: 6px 12px; font-size: 13px; height: auto;" title="End Date" value="${reportFilterEndDate}" max="${todayMax}" onchange="applyReportFilters()">
      <button class="btn btn-outline btn-sm" onclick="resetReportFilters()">Reset</button>
      <span id="report-filter-info" style="font-size: 11px; color: var(--text-muted); margin-left: auto;">
        ${reportFilterStartDate || reportFilterEndDate ? `Showing: ${reportFilterStartDate || '...'} to ${reportFilterEndDate || '...'}` : 'Showing: Current Month'}
        ${reportFilterDept ? ` • Dept: ${reportFilterDept}` : ''}
      </span>
    </div>

    <!-- Report Content -->
    <div class="report-content" id="report-content">
      ${renderReportSection(activeReportTab)}
    </div>
  `;
}

function switchReportTab(tabId) {
  activeReportTab = tabId;
  document.querySelectorAll('.report-tab').forEach(t => t.classList.toggle('active', t.textContent.trim().includes(REPORT_TABS.find(x => x.id === tabId).label)));
  // Re-render just tabs and content
  document.getElementById('report-tabs').innerHTML = REPORT_TABS.filter(tab => tab.id !== 'audit' || (typeof currentUser !== 'undefined' && currentUser && currentUser.systemRole === 'SUPER_ADMIN')).map(tab => `
    <button class="report-tab ${tab.id === activeReportTab ? 'active' : ''}" onclick="switchReportTab('${tab.id}')">
      <i class="ti ${tab.icon}"></i><span>${tab.label}</span>
    </button>
  `).join('');
  document.getElementById('report-content').innerHTML = renderReportSection(tabId);
}

function renderReportSection(tabId) {
  switch (tabId) {
    case 'summary': return renderAttendanceSummary();
    case 'daily': return renderDailyAttendance();
    case 'late': return renderLateArrivals();
    case 'early': return renderEarlyExits();
    case 'hours': return renderWorkingHours();
    case 'monthly': return renderMonthlyDashboard();
    case 'compliance': return renderComplianceReport();
    case 'weekly': return renderWeeklySummary();
    case 'audit': return renderAuditLogs();
    default: return '<div>Select a report</div>';
  }
}

// ===== 1. ATTENDANCE SUMMARY =====
function renderAttendanceSummary() {
  const filteredEmps = getFilteredEmployees();
  const todayStr = getTodayStr();

  // Target date defaults to today, or end date of filter if selected
  let targetDateStr = todayStr;
  if (reportFilterEndDate && reportFilterEndDate <= todayStr) {
    targetDateStr = reportFilterEndDate;
  }
  if (reportFilterStartDate && reportFilterStartDate === reportFilterEndDate) {
    targetDateStr = reportFilterStartDate;
  }

  // Check if target date is Sunday (day 0) or listed in holidaysList
  const targetDateObj = new Date(targetDateStr + 'T00:00:00');
  const isSunday = targetDateObj.getDay() === 0;
  const isPublicHoliday = typeof holidaysList !== 'undefined' && holidaysList.some(h => {
    if (!h.holiday_date) return false;
    const hDateStr = h.holiday_date.split('T')[0];
    return hDateStr === targetDateStr;
  });
  const isHolidayOrSunday = isSunday || isPublicHoliday;

  const headerLabel = (targetDateStr === todayStr) ? 'Status Today' : `Status (${formatDateShort(targetDateStr)})`;

  return `
    <div class="table-panel">
      <div class="table-panel-header">
        <span class="table-panel-title"><i class="ti ti-list-details" style="margin-right:6px;color:var(--primary)"></i>Employee Attendance Summary</span>
        <span class="text-muted" style="font-size:12px">${filteredEmps.length} employees${reportFilterDept ? ' • ' + reportFilterDept : ''}</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Employee</th><th>Employee ID</th><th>Department</th><th>Designation</th><th>Reporting Manager</th><th>Shift</th><th>${headerLabel}</th></tr></thead>
          <tbody>
            ${filteredEmps.map(emp => {
              const att = (targetDateStr === todayStr) ? (todayAtt[emp.id] || {}) : {};
              const history = attendanceHistory[emp.id] || [];
              const dayRec = history.find(r => r.date === targetDateStr);

              let status = 'Absent', statusCls = 'danger';

              // 1. Check live today / historical check-in status for target date
              if (att.in && att.out) {
                status = 'Checked Out'; statusCls = 'info';
              } else if (att.in) {
                const shiftParts = (emp.shiftStart || '09:00').split(':').map(Number);
                const shiftStartMin = shiftParts[0] * 60 + shiftParts[1];
                const inDate = new Date(att.in);
                const inMin = inDate.getHours() * 60 + inDate.getMinutes();
                if (inMin > shiftStartMin + 15) {
                  status = 'Present (Late)'; statusCls = 'warning';
                } else {
                  status = 'Present'; statusCls = 'success';
                }
              } else if (dayRec && dayRec.login && dayRec.logout) {
                status = 'Checked Out'; statusCls = 'info';
              } else if (dayRec && dayRec.login) {
                if (dayRec.delay > 15) {
                  status = 'Present (Late)'; statusCls = 'warning';
                } else {
                  status = 'Present'; statusCls = 'success';
                }
              } else if (dayRec && dayRec.logout) {
                status = 'Present'; statusCls = 'success';
              }
              // 2. If no check-in, check if Sunday or Public Holiday for target date
              else if (isHolidayOrSunday || (dayRec && (dayRec.status === 'Holiday' || dayRec.status === 'Weekly Off'))) {
                status = 'Holiday'; statusCls = 'info';
              }
              // 3. Check leave status for target date
              else if (dayRec && dayRec.status === 'Leave') {
                status = 'On Leave'; statusCls = 'info';
              }
              // 4. Default to Absent for working day with no check-in
              else {
                status = 'Absent'; statusCls = 'danger';
              }

              const color = getAvatarColor(emp.id);
              return `<tr>
                <td><div class="employee-cell"><div class="avatar sm" style="background:${color}">${getInitials(emp.firstName, emp.lastName)}</div><span class="employee-cell-name">${emp.firstName} ${emp.lastName}</span></div></td>
                <td><code class="mono">${emp.id}</code></td>
                <td><span class="chip ${getDeptClass(emp.department)}" style="font-size:10px;padding:2px 8px">${emp.department}</span></td>
                <td>${emp.designation || emp.role}</td>
                <td>${emp.reportingManager || '—'}</td>
                <td class="mono" style="font-size:11px">${format24to12(emp.shiftStart)} – ${format24to12(emp.shiftEnd)}</td>
                <td><span class="chip ${statusCls}"><span class="chip-dot ${statusCls}"></span>${status}</span></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}





// ===== 2. DAILY ATTENDANCE =====
function renderDailyAttendance() {
  const filteredEmps = getFilteredEmployees();
  // Flatten all history records with employee info (using filtered history)
  const allRecords = [];
  filteredEmps.forEach(emp => {
    getFilteredHistory(emp.id).forEach(rec => {
      // Only include dates where the employee actually had logs, worked, or was on leave to avoid listing everyone as absent
      if (['Present', 'Work From Home', 'Half Day', 'Leave'].includes(rec.status) || rec.login || rec.logout) {
        allRecords.push({ emp, ...rec });
      }
    });
  });
  // Show working days grouped by date, sorted newest first
  const dates = [...new Set(allRecords.map(r => r.date))].sort().reverse().slice(0, 15);

  return `
    <div class="table-panel">
      <div class="table-panel-header">
        <span class="table-panel-title"><i class="ti ti-calendar-event" style="margin-right:6px;color:var(--primary)"></i>Daily Attendance Log</span>
        <span class="text-muted" style="font-size:12px">${dates.length} days shown</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Employee</th><th>Login Time</th><th>Logout Time</th><th>Total Hours</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${dates.length > 0 ? dates.map(date => {
              const dayRecs = allRecords.filter(r => r.date === date).slice(0, 20);
              return dayRecs.map((r, i) => `<tr>
                ${i === 0 ? `<td rowspan="${dayRecs.length}" style="vertical-align:top;font-weight:600;border-right:2px solid var(--border)">${formatDateFull(r.date)}</td>` : ''}
                <td><span class="fw-600">${r.emp.firstName} ${r.emp.lastName}</span></td>
                <td class="mono">${r.login ? format24to12(r.login) : '—'}</td>
                <td class="mono">${r.logout ? format24to12(r.logout) : '—'}</td>
                <td class="mono">${r.hours > 0 ? r.hours.toFixed(2) + ' Hrs' : '—'}</td>
                <td><span class="chip ${getStatusClass(r.status)}">${r.status}</span></td>
                <td>
                  <div style="display:flex;gap:4px;">
                    <button class="btn-icon" title="Edit Timings" onclick="openEditAttendanceModal('${r.emp.id}', '${r.date}', '${r.login || ''}', '${r.logout || ''}', '${r.emp.firstName} ${r.emp.lastName}')">
                      <i class="ti ti-pencil"></i>
                    </button>
                    <button class="btn-icon text-danger" title="Reset Attendance" onclick="resetDailyAttendance('${r.emp.id}', '${r.date}', '${r.emp.firstName} ${r.emp.lastName}')">
                      <i class="ti ti-rotate-clockwise"></i>
                    </button>
                  </div>
                </td>
              </tr>`).join('');
            }).join('') : '<tr><td colspan="7"><div class="empty-state"><i class="ti ti-calendar-off"></i><h4>No records found</h4><p>Try adjusting your date range or department filter</p></div></td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ===== 3. LATE ARRIVALS =====
function renderLateArrivals() {
  const filteredEmps = getFilteredEmployees();
  const lateRecords = [];
  filteredEmps.forEach(emp => {
    getFilteredHistory(emp.id).forEach(rec => {
      if (rec.delay > 0 && rec.login) {
        lateRecords.push({ emp, ...rec });
      }
    });
  });

  // Per-employee late stats
  const lateStats = {};
  lateRecords.forEach(r => {
    if (!lateStats[r.emp.id]) lateStats[r.emp.id] = { emp: r.emp, count: 0, totalDelay: 0 };
    lateStats[r.emp.id].count++;
    lateStats[r.emp.id].totalDelay += r.delay;
  });
  const habitualLatecomers = Object.values(lateStats).filter(s => s.count >= 3).sort((a, b) => b.count - a.count);

  return `
    <!-- Stats -->
    <div class="stat-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:18px">
      <div class="stat-card warning"><div class="stat-card-header"><div class="stat-card-icon"><i class="ti ti-alarm"></i></div><span class="stat-card-label">Late Arrivals</span></div><div class="stat-card-value">${lateRecords.length}</div><div class="stat-card-sub">Total instances in period</div></div>
      <div class="stat-card danger"><div class="stat-card-header"><div class="stat-card-icon"><i class="ti ti-clock-x"></i></div><span class="stat-card-label">Total Delay</span></div><div class="stat-card-value">${lateRecords.reduce((s,r) => s + r.delay, 0)} min</div><div class="stat-card-sub">Combined delay minutes</div></div>
      <div class="stat-card primary"><div class="stat-card-header"><div class="stat-card-icon"><i class="ti ti-user-exclamation"></i></div><span class="stat-card-label">Habitual Latecomers</span></div><div class="stat-card-value">${habitualLatecomers.length}</div><div class="stat-card-sub">3+ late arrivals</div></div>
    </div>

    <!-- Late Arrivals Table -->
    <div class="table-panel" style="margin-bottom:18px">
      <div class="table-panel-header"><span class="table-panel-title"><i class="ti ti-alarm" style="margin-right:6px;color:var(--warning)"></i>Late Arrival Records</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Employee</th><th>Date</th><th>Shift Start</th><th>Login Time</th><th>Delay</th></tr></thead>
          <tbody>
            ${lateRecords.sort((a,b) => b.delay - a.delay).slice(0, 30).map(r => `<tr>
              <td><span class="fw-600">${r.emp.firstName} ${r.emp.lastName}</span></td>
              <td>${formatDateShort(r.date)}</td>
              <td class="mono">${format24to12(r.emp.shiftStart)}</td>
              <td class="mono">${format24to12(r.login)}</td>
              <td><span class="chip warning">${r.delay} Mins</span></td>
            </tr>`).join('') || '<tr><td colspan="5"><div class="empty-state"><i class="ti ti-mood-happy"></i><h4>No late arrivals</h4></div></td></tr>'}
          </tbody>
        </table>
      </div>
    </div>

    ${habitualLatecomers.length > 0 ? `
    <!-- Habitual Latecomers -->
    <div class="table-panel">
      <div class="table-panel-header"><span class="table-panel-title"><i class="ti ti-user-exclamation" style="margin-right:6px;color:var(--danger)"></i>Habitual Latecomers (3+ instances)</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Employee</th><th>Department</th><th>Late Count</th><th>Total Delay</th><th>Avg Delay</th></tr></thead>
          <tbody>
            ${habitualLatecomers.map(s => `<tr>
              <td class="fw-600">${s.emp.firstName} ${s.emp.lastName}</td>
              <td><span class="chip ${getDeptClass(s.emp.department)}" style="font-size:10px;padding:2px 8px">${s.emp.department}</span></td>
              <td><span class="chip danger">${s.count} times</span></td>
              <td class="mono">${s.totalDelay} min</td>
              <td class="mono">${Math.round(s.totalDelay / s.count)} min</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>` : ''}`;
}

// ===== 4. EARLY EXITS =====
function renderEarlyExits() {
  const filteredEmps = getFilteredEmployees();
  const earlyRecords = [];
  filteredEmps.forEach(emp => {
    getFilteredHistory(emp.id).forEach(rec => {
      if (rec.earlyExit > 0) {
        earlyRecords.push({ emp, ...rec });
      }
    });
  });

  return `
    <div class="stat-grid" style="grid-template-columns:repeat(2,1fr);margin-bottom:18px">
      <div class="stat-card warning"><div class="stat-card-header"><div class="stat-card-icon"><i class="ti ti-door-exit"></i></div><span class="stat-card-label">Early Exits</span></div><div class="stat-card-value">${earlyRecords.length}</div><div class="stat-card-sub">Instances in period</div></div>
      <div class="stat-card danger"><div class="stat-card-header"><div class="stat-card-icon"><i class="ti ti-clock-minus"></i></div><span class="stat-card-label">Total Early Minutes</span></div><div class="stat-card-value">${earlyRecords.reduce((s,r)=>s+r.earlyExit,0)} min</div></div>
    </div>
    <div class="table-panel">
      <div class="table-panel-header"><span class="table-panel-title"><i class="ti ti-door-exit" style="margin-right:6px;color:var(--warning)"></i>Early Exit Records</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Employee</th><th>Date</th><th>Logout Time</th><th>Scheduled End</th><th>Early Exit</th></tr></thead>
          <tbody>
            ${earlyRecords.sort((a,b)=>b.earlyExit-a.earlyExit).map(r => `<tr>
              <td class="fw-600">${r.emp.firstName} ${r.emp.lastName}</td>
              <td>${formatDateShort(r.date)}</td>
              <td class="mono">${format24to12(r.logout)}</td>
              <td class="mono">${format24to12(r.emp.shiftEnd)}</td>
              <td><span class="chip warning">${r.earlyExit} Mins</span></td>
            </tr>`).join('') || '<tr><td colspan="5"><div class="empty-state"><i class="ti ti-mood-happy"></i><h4>No early exits</h4></div></td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ===== 5. WORKING HOURS =====
function renderWorkingHours() {
  const filteredEmps = getFilteredEmployees();
  const hoursData = filteredEmps.map(emp => {
    const history = getFilteredHistory(emp.id);
    const workDays = history.filter(r => ['Present','Work From Home','Half Day'].includes(r.status));
    const actualHours = workDays.reduce((s, r) => s + (r.hours || 0), 0);
    const expectedPerDay = getExpectedHours(emp);
    const expectedHours = workDays.length * expectedPerDay;
    const overtime = Math.max(0, actualHours - expectedHours);
    const shortfall = Math.max(0, expectedHours - actualHours);
    return { emp, actualHours: Math.round(actualHours * 100) / 100, expectedHours: Math.round(expectedHours * 100) / 100, overtime: Math.round(overtime * 100) / 100, shortfall: Math.round(shortfall * 100) / 100, hasData: history.length > 0 };
  }).filter(d => d.hasData);

  if (hoursData.length === 0) {
    return `<div class="empty-state"><i class="ti ti-calendar-off"></i><h4>No Data Available</h4><p>No attendance records found for the selected date range. Try adjusting your filters.</p></div>`;
  }

  return `
    <div class="table-panel">
      <div class="table-panel-header"><span class="table-panel-title"><i class="ti ti-clock-hour-4" style="margin-right:6px;color:var(--primary)"></i>Working Hours Report</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Employee</th><th>Department</th><th>Expected Hours</th><th>Actual Hours</th><th>Overtime</th><th>Shortfall</th><th>Efficiency</th></tr></thead>
          <tbody>
            ${hoursData.map(d => {
              const eff = d.expectedHours > 0 ? Math.round((d.actualHours / d.expectedHours) * 100) : 0;
              const effCls = eff >= 95 ? 'success' : eff >= 80 ? 'warning' : 'danger';
              return `<tr>
                <td class="fw-600">${d.emp.firstName} ${d.emp.lastName}</td>
                <td><span class="chip ${getDeptClass(d.emp.department)}" style="font-size:10px;padding:2px 8px">${d.emp.department}</span></td>
                <td class="mono">${d.expectedHours}h</td>
                <td class="mono fw-600">${d.actualHours}h</td>
                <td>${d.overtime > 0 ? `<span class="mono text-success fw-600">+${d.overtime}h</span>` : '<span class="text-muted">—</span>'}</td>
                <td>${d.shortfall > 0 ? `<span class="mono text-danger fw-600">-${d.shortfall}h</span>` : '<span class="text-muted">—</span>'}</td>
                <td><span class="chip ${effCls}">${eff}%</span></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ===== 6. MONTHLY DASHBOARD =====
function renderMonthlyDashboard() {
  const filteredEmps = getFilteredEmployees();
  const halfDayRuleVal = parseFloat(LEAVE_SETTINGS && LEAVE_SETTINGS.halfDayRule !== undefined ? LEAVE_SETTINGS.halfDayRule : 0.5);
  const halfDayMultiplier = isNaN(halfDayRuleVal) ? 0.5 : (1.0 - halfDayRuleVal);
  const dashData = filteredEmps.map(emp => {
    const history = getFilteredHistory(emp.id);
    const present = history.filter(r => r.status === 'Present' || r.status === 'Work From Home').length;
    const absent = history.filter(r => r.status === 'Absent').length;
    const leave = history.filter(r => r.status === 'Leave').length;
    const halfDay = history.filter(r => r.status === 'Half Day').length;
    const late = history.filter(r => r.delay > 0).length;
    const totalHours = history.reduce((s, r) => s + (r.hours || 0), 0);
    const expected = (present * getExpectedHours(emp)) + (halfDay * getExpectedHours(emp) * 0.5);
    const overtime = Math.max(0, totalHours - expected);
    return { emp, present, absent, leave, halfDay, late, overtime: Math.round(overtime * 100) / 100, hasData: history.length > 0 };
  }).filter(d => d.hasData);

  if (dashData.length === 0) {
    return `<div class="empty-state"><i class="ti ti-calendar-off"></i><h4>No Data Available</h4><p>No attendance records found for the selected date range. Try adjusting your filters.</p></div>`;
  }

  const totPresent = dashData.reduce((s, d) => s + d.present + (d.halfDay * halfDayMultiplier), 0);
  const totAbsent = dashData.reduce((s, d) => s + d.absent, 0);
  const totLeave = dashData.reduce((s, d) => s + d.leave, 0);
  const totLate = dashData.reduce((s, d) => s + d.late, 0);

  return `
    <div class="stat-grid" style="margin-bottom:18px">
      <div class="stat-card success"><div class="stat-card-header"><div class="stat-card-icon"><i class="ti ti-user-check"></i></div><span class="stat-card-label">Total Present</span></div><div class="stat-card-value">${totPresent}</div></div>
      <div class="stat-card danger"><div class="stat-card-header"><div class="stat-card-icon"><i class="ti ti-user-x"></i></div><span class="stat-card-label">Total Absent</span></div><div class="stat-card-value">${totAbsent}</div></div>
      <div class="stat-card info"><div class="stat-card-header"><div class="stat-card-icon"><i class="ti ti-calendar-off"></i></div><span class="stat-card-label">On Leave</span></div><div class="stat-card-value">${totLeave}</div></div>
      <div class="stat-card warning"><div class="stat-card-header"><div class="stat-card-icon"><i class="ti ti-alarm"></i></div><span class="stat-card-label">Late Marks</span></div><div class="stat-card-value">${totLate}</div></div>
    </div>
    <div class="table-panel">
      <div class="table-panel-header"><span class="table-panel-title"><i class="ti ti-chart-bar" style="margin-right:6px;color:var(--primary)"></i>Monthly Attendance Dashboard</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Employee</th><th>Present</th><th>Absent</th><th>Leave</th><th>Half Day</th><th>Late Marks</th><th>Overtime</th></tr></thead>
          <tbody>
            ${dashData.map(d => `<tr>
              <td class="fw-600">${d.emp.firstName} ${d.emp.lastName}</td>
              <td><span class="chip success">${d.present}</span></td>
              <td>${d.absent > 0 ? `<span class="chip danger">${d.absent}</span>` : '<span class="text-muted">0</span>'}</td>
              <td>${d.leave > 0 ? `<span class="chip info">${d.leave}</span>` : '<span class="text-muted">0</span>'}</td>
              <td>${d.halfDay > 0 ? `<span class="chip warning">${d.halfDay}</span>` : '<span class="text-muted">0</span>'}</td>
              <td>${d.late > 0 ? `<span class="chip warning">${d.late}</span>` : '<span class="text-muted">0</span>'}</td>
              <td>${d.overtime > 0 ? `<span class="mono text-success fw-600">+${d.overtime}h</span>` : '<span class="text-muted">—</span>'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}




function renderComplianceReport() {
  const filteredEmps = getFilteredEmployees();
  const WORK_DAYS = PAYROLL_SETTINGS.workDays || 26;
  const compData = filteredEmps.map(emp => {
    const history = getFilteredHistory(emp.id);
    const totalWorkDays = history.filter(r => !['Weekly Off', 'Holiday', '—'].includes(r.status)).length;
    const fullDays = history.filter(r => ['Present', 'Work From Home'].includes(r.status)).length;
    const halfDays = history.filter(r => r.status === 'Half Day').length;
    const halfDayRuleVal = parseFloat(LEAVE_SETTINGS && LEAVE_SETTINGS.halfDayRule !== undefined ? LEAVE_SETTINGS.halfDayRule : 0.5);
    const halfDayMultiplier = isNaN(halfDayRuleVal) ? 0.5 : (1.0 - halfDayRuleVal);
    const presentDays = fullDays + (halfDays * halfDayMultiplier);
    const attPct = totalWorkDays > 0 ? Math.round((presentDays / totalWorkDays) * 100) : 0;
    const lateCount = history.filter(r => r.delay > LATE_PENALTY.graceMinutes).length;
    const totalHours = history.reduce((s, r) => s + (r.hours || 0), 0);
    const expectedHours = (fullDays * getExpectedHours(emp)) + (halfDays * getExpectedHours(emp) * 0.5);
    const shortHours = presentDays > 0 && totalHours < expectedHours * 0.9;
    return { emp, attPct, lateCount, presentDays, totalWorkDays, shortHours, totalHours: Math.round(totalHours) };
  });

  const below90 = compData.filter(d => d.attPct < 90);
  const repeatedLate = compData.filter(d => d.lateCount >= LATE_PENALTY.warningThreshold);
  const frequentShort = compData.filter(d => d.shortHours);
  const excessive = compData.filter(d => d.attPct < 60);

  let currentList = [];
  let tableHeader = '';
  let emptyMessage = '';
  let tableBody = '';

  if (activeComplianceFilter === 'below90') {
    currentList = below90;
    tableHeader = 'Employees Below 90% Attendance';
    emptyMessage = 'All Clear! All employees are above 90% attendance';
    tableBody = `
      <table>
        <thead><tr><th>Employee</th><th>Department</th><th>Present</th><th>Working Days</th><th>Attendance %</th><th>Late Count</th></tr></thead>
        <tbody>
          ${currentList.sort((a,b) => a.attPct - b.attPct).map(d => {
            const attCls = d.attPct >= 80 ? 'warning' : 'danger';
            return `<tr>
              <td class="fw-600">${d.emp.firstName} ${d.emp.lastName}</td>
              <td><span class="chip ${getDeptClass(d.emp.department)}" style="font-size:10px;padding:2px 8px">${d.emp.department}</span></td>
              <td>${d.presentDays}</td><td>${d.totalWorkDays}</td>
              <td><span class="chip ${attCls} fw-700">${d.attPct}%</span></td>
              <td>${d.lateCount > 0 ? `<span class="chip warning">${d.lateCount}</span>` : '0'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    `;
  } else if (activeComplianceFilter === 'repeatedLate') {
    currentList = repeatedLate;
    tableHeader = `Employees with Repeated Late Arrivals (${LATE_PENALTY.warningThreshold}+ late marks)`;
    emptyMessage = `All Clear! No employees with ${LATE_PENALTY.warningThreshold}+ late arrivals`;
    tableBody = `
      <table>
        <thead><tr><th>Employee</th><th>Department</th><th>Late Marks</th><th>Present Days</th><th>Working Days</th></tr></thead>
        <tbody>
          ${currentList.sort((a,b) => b.lateCount - a.lateCount).map(d => {
            return `<tr>
              <td class="fw-600">${d.emp.firstName} ${d.emp.lastName}</td>
              <td><span class="chip ${getDeptClass(d.emp.department)}" style="font-size:10px;padding:2px 8px">${d.emp.department}</span></td>
              <td><span class="chip danger fw-700">${d.lateCount} late marks</span></td>
              <td>${d.presentDays}</td><td>${d.totalWorkDays}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    `;
  } else if (activeComplianceFilter === 'frequentShort') {
    currentList = frequentShort;
    tableHeader = 'Employees with Frequent Short Hours (Below 90% expected hours)';
    emptyMessage = 'All Clear! No employees with frequent short hours';
    tableBody = `
      <table>
        <thead><tr><th>Employee</th><th>Department</th><th>Actual Hours</th><th>Expected Hours</th><th>Efficiency %</th></tr></thead>
        <tbody>
          ${currentList.sort((a,b) => a.totalHours - b.totalHours).map(d => {
            const expH = Math.round(d.presentDays * getExpectedHours(d.emp));
            const eff = expH > 0 ? Math.round((d.totalHours / expH) * 100) : 0;
            const effCls = eff >= 95 ? 'success' : eff >= 80 ? 'warning' : 'danger';
            return `<tr>
              <td class="fw-600">${d.emp.firstName} ${d.emp.lastName}</td>
              <td><span class="chip ${getDeptClass(d.emp.department)}" style="font-size:10px;padding:2px 8px">${d.emp.department}</span></td>
              <td class="mono fw-600">${d.totalHours}h</td>
              <td class="mono">${expH}h</td>
              <td><span class="chip ${effCls} fw-700">${eff}%</span></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    `;
  } else if (activeComplianceFilter === 'excessive') {
    currentList = excessive;
    tableHeader = 'Employees with Excessive Absenteeism (Below 60% attendance)';
    emptyMessage = 'All Clear! No excessive absenteeism detected';
    tableBody = `
      <table>
        <thead><tr><th>Employee</th><th>Department</th><th>Present</th><th>Working Days</th><th>Attendance %</th></tr></thead>
        <tbody>
          ${currentList.sort((a,b) => a.attPct - b.attPct).map(d => {
            return `<tr>
              <td class="fw-600">${d.emp.firstName} ${d.emp.lastName}</td>
              <td><span class="chip ${getDeptClass(d.emp.department)}" style="font-size:10px;padding:2px 8px">${d.emp.department}</span></td>
              <td>${d.presentDays}</td><td>${d.totalWorkDays}</td>
              <td><span class="chip danger fw-700">${d.attPct}%</span></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    `;
  }

  return `
    <!-- Compliance Cards -->
    <div class="compliance-grid">
      <div class="compliance-card ${below90.length > 0 ? 'alert' : 'ok'} ${activeComplianceFilter === 'below90' ? 'active' : ''}" onclick="switchComplianceFilter('below90')" style="cursor:pointer;">
        <div class="compliance-card-icon"><i class="ti ti-percentage"></i></div>
        <div class="compliance-card-info">
          <h4>Below 90% Attendance</h4>
          <p>${below90.length} employee${below90.length !== 1 ? 's' : ''}</p>
        </div>
        <div class="compliance-card-count ${below90.length > 0 ? 'danger' : 'success'}">${below90.length}</div>
      </div>
      <div class="compliance-card ${repeatedLate.length > 0 ? 'alert' : 'ok'} ${activeComplianceFilter === 'repeatedLate' ? 'active' : ''}" onclick="switchComplianceFilter('repeatedLate')" style="cursor:pointer;">
        <div class="compliance-card-icon"><i class="ti ti-alarm"></i></div>
        <div class="compliance-card-info">
          <h4>Repeated Late Arrivals</h4>
          <p>${LATE_PENALTY.warningThreshold}+ late marks this month</p>
        </div>
        <div class="compliance-card-count ${repeatedLate.length > 0 ? 'warning' : 'success'}">${repeatedLate.length}</div>
      </div>
      <div class="compliance-card ${frequentShort.length > 0 ? 'alert' : 'ok'} ${activeComplianceFilter === 'frequentShort' ? 'active' : ''}" onclick="switchComplianceFilter('frequentShort')" style="cursor:pointer;">
        <div class="compliance-card-icon"><i class="ti ti-clock-minus"></i></div>
        <div class="compliance-card-info">
          <h4>Frequent Short Hours</h4>
          <p>Below 90% expected hours</p>
        </div>
        <div class="compliance-card-count ${frequentShort.length > 0 ? 'warning' : 'success'}">${frequentShort.length}</div>
      </div>
      <div class="compliance-card ${excessive.length > 0 ? 'critical' : 'ok'} ${activeComplianceFilter === 'excessive' ? 'active' : ''}" onclick="switchComplianceFilter('excessive')" style="cursor:pointer;">
        <div class="compliance-card-icon"><i class="ti ti-alert-octagon"></i></div>
        <div class="compliance-card-info">
          <h4>Excessive Absenteeism</h4>
          <p>Below 60% attendance</p>
        </div>
        <div class="compliance-card-count ${excessive.length > 0 ? 'danger' : 'success'}">${excessive.length}</div>
      </div>
    </div>

    ${currentList.length > 0 ? `
    <div class="table-panel" style="margin-top:18px">
      <div class="table-panel-header"><span class="table-panel-title"><i class="ti ti-shield-check" style="margin-right:6px;color:var(--danger)"></i>${tableHeader}</span></div>
      <div class="table-wrap">
        ${tableBody}
      </div>
    </div>` : `<div class="empty-state" style="margin-top:18px"><i class="ti ti-shield-check"></i><h4>All Clear!</h4><p>${emptyMessage}</p></div>`}`;
}

// ===== 10. WEEKLY SUMMARY =====
function renderWeeklySummary() {
  const filteredEmps = getFilteredEmployees();
  const totalEmp = filteredEmps.length;
  // Get data from attendance history
  let totalPresent = 0, totalAbsent = 0, totalOnLeave = 0, totalLate = 0, totalOT = 0;
  const todayStr = getTodayStr();

  // Calculate the actual date range for the last 7 calendar days
  const today = new Date();
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(today.getDate() - 6); // 6 days back + today = 7 days
  const startDateStr = sevenDaysAgo.getFullYear() + '-' +
    String(sevenDaysAgo.getMonth() + 1).padStart(2, '0') + '-' +
    String(sevenDaysAgo.getDate()).padStart(2, '0');

  const empWeeklyData = filteredEmps.map(emp => {
    const history = attendanceHistory[emp.id] || [];
    // Filter to actual last 7 calendar days by date, not by array position
    const last7 = history.filter(r => r.date >= startDateStr && r.date <= todayStr);
    const present = last7.filter(r => ['Present', 'Work From Home'].includes(r.status)).length;
    const absent = last7.filter(r => r.status === 'Absent').length;
    const leave = last7.filter(r => r.status === 'Leave').length;
    const halfDay = last7.filter(r => r.status === 'Half Day').length;
    const halfDayRuleVal = parseFloat(LEAVE_SETTINGS && LEAVE_SETTINGS.halfDayRule !== undefined ? LEAVE_SETTINGS.halfDayRule : 0.5);
    const halfDayMultiplier = isNaN(halfDayRuleVal) ? 0.5 : (1.0 - halfDayRuleVal);
    const late = last7.filter(r => r.delay > 0).length;
    const hrs = last7.reduce((s, r) => s + (r.hours || 0), 0);
    const expected = (present * getExpectedHours(emp)) + (halfDay * getExpectedHours(emp) * 0.5);
    const ot = Math.max(0, hrs - expected);

    totalPresent += present + (halfDay * halfDayMultiplier);
    totalAbsent += absent;
    totalOnLeave += leave;
    totalLate += late;
    totalOT += ot;

    return { emp, present: present + (halfDay * halfDayMultiplier), absent, leave, halfDay, late, ot: Math.round(ot * 100) / 100 };
  });

  const attPct = totalEmp > 0 ? Math.round((totalPresent / (totalEmp * 5)) * 100) : 0; // assume 5 work days in week

  const tableBody = empWeeklyData.map(d => `
    <tr>
      <td class="fw-600">${d.emp.firstName} ${d.emp.lastName}</td>
      <td><span class="chip ${getDeptClass(d.emp.department)}" style="font-size:10px;padding:2px 8px">${d.emp.department}</span></td>
      <td><span class="chip success">${d.present}</span></td>
      <td>${d.absent > 0 ? `<span class="chip danger">${d.absent}</span>` : '<span class="text-muted">0</span>'}</td>
      <td>${d.leave > 0 ? `<span class="chip info">${d.leave}</span>` : '<span class="text-muted">0</span>'}</td>
      <td>${d.halfDay > 0 ? `<span class="chip warning">${d.halfDay}</span>` : '<span class="text-muted">0</span>'}</td>
      <td>${d.late > 0 ? `<span class="chip warning">${d.late}</span>` : '<span class="text-muted">0</span>'}</td>
      <td>${d.ot > 0 ? `<span class="mono text-success fw-600">+${d.ot}h</span>` : '<span class="text-muted">—</span>'}</td>
    </tr>
  `).join('');

  return `
    <div class="weekly-summary-card">
      <div class="weekly-summary-header">
        <div>
          <h3><i class="ti ti-report" style="margin-right:8px;color:var(--primary)"></i>Weekly Management Report</h3>
          <p>Summary for ${startDateStr} to ${todayStr} • ${getCurrentMonth()}</p>
        </div>
      </div>

      <div class="weekly-summary-grid">
        <div class="weekly-metric">
          <div class="weekly-metric-icon" style="background:var(--primary-subtle);color:var(--primary)"><i class="ti ti-users"></i></div>
          <div class="weekly-metric-info"><span class="weekly-metric-label">Total Employees</span><span class="weekly-metric-value">${totalEmp}</span></div>
        </div>
        <div class="weekly-metric">
          <div class="weekly-metric-icon" style="background:var(--success-subtle);color:var(--success)"><i class="ti ti-user-check"></i></div>
          <div class="weekly-metric-info"><span class="weekly-metric-label">Present (week total)</span><span class="weekly-metric-value">${totalPresent}</span></div>
        </div>
        <div class="weekly-metric">
          <div class="weekly-metric-icon" style="background:var(--danger-subtle);color:var(--danger)"><i class="ti ti-user-x"></i></div>
          <div class="weekly-metric-info"><span class="weekly-metric-label">Absent</span><span class="weekly-metric-value">${totalAbsent}</span></div>
        </div>
        <div class="weekly-metric">
          <div class="weekly-metric-icon" style="background:var(--info-subtle);color:var(--info)"><i class="ti ti-calendar-off"></i></div>
          <div class="weekly-metric-info"><span class="weekly-metric-label">On Leave</span><span class="weekly-metric-value">${totalOnLeave}</span></div>
        </div>
        <div class="weekly-metric">
          <div class="weekly-metric-icon" style="background:rgba(99,102,241,0.12);color:var(--primary)"><i class="ti ti-percentage"></i></div>
          <div class="weekly-metric-info"><span class="weekly-metric-label">Attendance %</span><span class="weekly-metric-value">${attPct}%</span></div>
        </div>
        <div class="weekly-metric">
          <div class="weekly-metric-icon" style="background:var(--warning-subtle);color:var(--warning)"><i class="ti ti-alarm"></i></div>
          <div class="weekly-metric-info"><span class="weekly-metric-label">Late Arrivals</span><span class="weekly-metric-value">${totalLate}</span></div>
        </div>
        <div class="weekly-metric">
          <div class="weekly-metric-icon" style="background:rgba(20,184,166,0.12);color:#14b8a6"><i class="ti ti-clock-plus"></i></div>
          <div class="weekly-metric-info"><span class="weekly-metric-label">Overtime Hours</span><span class="weekly-metric-value">${Math.round(totalOT)}h</span></div>
        </div>
      </div>
    </div>

    <div class="table-panel" style="margin-top: 24px;">
      <div class="table-panel-header">
        <span class="table-panel-title"><i class="ti ti-users" style="margin-right:6px;color:var(--primary)"></i>Employee Weekly Performance Summary</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th>Department</th>
              <th>Present Days</th>
              <th>Absent Days</th>
              <th>On Leave</th>
              <th>Half Days</th>
              <th>Late Marks</th>
              <th>Overtime Hours</th>
            </tr>
          </thead>
          <tbody>
            ${tableBody || '<tr><td colspan="8"><div class="empty-state"><h4>No data found</h4></div></td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ===== EXPORT FUNCTIONS =====
function exportReportCSV() {
  const WORK_DAYS = PAYROLL_SETTINGS.workDays || 26;
  const headers = ['Employee ID','Name','Department','Designation','Manager','Shift','Days Present','Hours Worked','Attendance %','Late Count','Basic','HRA','DA','Conveyance','Medical','Special Allowance','Gross Pay','PF','ESI','TDS','Prof Tax','Late Penalty','Total Deductions','Net Salary'];
  const rows = employees.map(emp => {
    const salary = computeSalary(emp);
    const md = monthData[emp.id] || { days: 0, hours: 0 };
    const attPct = Math.round((md.days / WORK_DAYS) * 100);
    const lateCount = getLateCount(emp.id);
    return [emp.id, `${emp.firstName} ${emp.lastName}`, emp.department, emp.designation, emp.reportingManager, `${emp.shiftStart}-${emp.shiftEnd}`, md.days, md.hours.toFixed(2), attPct + '%', lateCount, salary.basic, salary.hra, salary.da, salary.conveyance, salary.medical, salary.special, salary.grossEarnings, salary.pf, salary.esi, salary.tds, salary.profTax, salary.latePenalty, salary.totalDeductions, salary.net].join(',');
  });
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `FingerTrack_Report_${getCurrentMonth().replace(/\s+/g, '_')}.csv`;
  a.click(); URL.revokeObjectURL(url);
  showToast('CSV report downloaded', 'success');
}

function exportReportPDF() {
  const printWindow = window.open('', '_blank');
  const content = document.getElementById('report-content').innerHTML;
  printWindow.document.write(`<!DOCTYPE html><html><head><title>Attendance Report — ${getCurrentMonth()}</title>
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',sans-serif;padding:30px;color:#1a1a2e;font-size:12px}h1{font-size:20px;margin-bottom:4px}.subtitle{color:#666;margin-bottom:20px;font-size:13px}table{width:100%;border-collapse:collapse;margin:10px 0}th{background:#f4f4f8;padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#666;border-bottom:2px solid #e0e0e0}td{padding:8px 10px;border-bottom:1px solid #eee;font-size:11px}tr:nth-child(even){background:#fafafa}.chip{display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600}.stat-grid,.stat-card,.compliance-grid,.compliance-card,.weekly-summary-card,.weekly-summary-grid,.weekly-metric,.report-tabs{display:none!important}.table-panel{border:1px solid #e0e0e0;border-radius:8px;margin:10px 0;overflow:hidden}.table-panel-header{padding:10px;border-bottom:1px solid #e0e0e0;font-weight:700;font-size:13px;background:#f4f4f8}.footer{margin-top:30px;padding-top:14px;border-top:1px solid #e0e0e0;font-size:10px;color:#999;text-align:center}@media print{@page{margin:0}body{padding:15mm}}</style>
    </head><body><h1>Attendance Report</h1><div class="subtitle">${getCurrentMonth()} • ${activeReportTab.charAt(0).toUpperCase() + activeReportTab.slice(1)} Report</div>${content}<div class="footer">Musing Quills • Confidential</div><script>window.onload=()=>{window.print()}<\/script></body></html>`);
  printWindow.document.close();
  showToast('PDF report opened in print dialog', 'success');
}


// ===== Audit Logs =====
function renderAuditLogs() {
  if (typeof currentUser === 'undefined' || !currentUser || currentUser.systemRole !== 'SUPER_ADMIN') {
    return `<div class="empty-state">
      <i class="ti ti-lock" style="font-size:48px;color:var(--danger)"></i>
      <h4>Access Denied</h4>
      <p>You must be a Super Admin to view Audit Logs.</p>
    </div>`;
  }

  if (auditLogs.length === 0) {
    return `<div class="empty-state">
      <i class="ti ti-shield-check"></i>
      <h4>No Audit Logs Found</h4>
      <p>System actions will be recorded here.</p>
    </div>`;
  }

  const rows = auditLogs.map(log => `
    <tr>
      <td style="font-family:monospace;color:var(--text-muted);font-size:12px;">${log.id}</td>
      <td>${formatTime(log.timestamp)} <br><span class="text-muted" style="font-size:11px;">${formatDateShort(log.timestamp)}</span></td>
      <td><strong>${log.user}</strong></td>
      <td><span class="chip primary">${log.action}</span></td>
      <td style="max-width:300px;white-space:normal;line-height:1.4;">${log.details}</td>
    </tr>
  `).join('');

  return `
    <div class="report-section-header">
      <h3>System Audit Logs</h3>
      <p>Secure log of all critical system modifications.</p>
    </div>
    <table class="data-table">
      <thead>
        <tr>
          <th>Log ID</th>
          <th>Timestamp</th>
          <th>User / Entity</th>
          <th>Action Type</th>
          <th>Details</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
}

// ===== EDIT / RESET ATTENDANCE UTILITIES =====
async function resetDailyAttendance(empId, date, name) {
  if (!confirm(`Are you sure you want to reset the check-in and check-out logs for ${name} on ${date}?`)) {
    return;
  }
  try {
    const res = await apiFetch(`${API_BASE_URL}/attendance/reset`, {
      method: 'POST',
      body: { employee_id: empId, date: date }
    });
    if (res.success) {
      showToast('Attendance logs reset successfully', 'success');
      await loadAllData();
      if (typeof activeReportTab !== 'undefined') {
        switchReportTab(activeReportTab);
      }
    } else {
      showToast(res.error || 'Failed to reset attendance', 'error');
    }
  } catch (err) {
    showToast(err.message || 'Failed to reset attendance', 'error');
  }
}

function openEditAttendanceModal(empId, date, loginTime, logoutTime, empName) {
  const content = `
    <div class="modal-header">
      <div class="modal-header-text">
        <h3>Edit Daily Timings</h3>
        <p>${empName} • ${date}</p>
      </div>
      <button class="modal-close" onclick="closeModal()"><i class="ti ti-x"></i></button>
    </div>
    <form id="edit-attendance-form" onsubmit="saveAttendanceEdit(event)">
      <div class="modal-body" style="padding-top:20px;">
        <input type="hidden" id="edit-att-empid" value="${empId}">
        <input type="hidden" id="edit-att-date" value="${date}">
        
        <div class="form-group" style="margin-bottom: 16px;">
          <label class="form-label" for="edit-att-login">Check-In Time</label>
          <input type="time" class="form-input" id="edit-att-login" value="${loginTime ? loginTime.substring(0, 5) : ''}">
          <span class="text-muted" style="font-size: 11px; display: block; margin-top: 4px;">Leave empty to clear Check-In</span>
        </div>
        
        <div class="form-group" style="margin-bottom: 16px;">
          <label class="form-label" for="edit-att-logout">Check-Out Time</label>
          <input type="time" class="form-input" id="edit-att-logout" value="${logoutTime ? logoutTime.substring(0, 5) : ''}">
          <span class="text-muted" style="font-size: 11px; display: block; margin-top: 4px;">Leave empty to clear Check-Out</span>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary">Save Changes</button>
      </div>
    </form>
  `;
  openModal(content);
}

async function saveAttendanceEdit(event) {
  event.preventDefault();
  const empId = document.getElementById('edit-att-empid').value;
  const date = document.getElementById('edit-att-date').value;
  const login = document.getElementById('edit-att-login').value;
  const logout = document.getElementById('edit-att-logout').value;

  try {
    const res = await apiFetch(`${API_BASE_URL}/attendance/update`, {
      method: 'POST',
      body: { employee_id: empId, date, login, logout }
    });
    if (res.success) {
      showToast('Attendance updated successfully', 'success');
      closeModal();
      await loadAllData();
      if (typeof activeReportTab !== 'undefined') {
        switchReportTab(activeReportTab);
      }
    } else {
      showToast(res.error || 'Failed to update attendance', 'error');
    }
  } catch (err) {
    showToast(err.message || 'Failed to update attendance', 'error');
  }
}
