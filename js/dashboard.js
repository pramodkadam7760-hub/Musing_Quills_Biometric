/* ===== Dashboard View ===== */

function renderDashboard(container) {
  // Compute stats
  const total = employees.length;
  let present = 0, checkedOut = 0, absent = 0;

  employees.forEach(emp => {
    const att = todayAtt[emp.id];
    if (att && att.in && att.out) {
      checkedOut++;
    } else if (att && att.in) {
      present++;
    } else {
      absent++;
    }
  });

  const activeEmps = employees.filter(e => e.lifecycleStatus !== 'Terminated');
  const totalHours = activeEmps.reduce((sum, emp) => sum + (monthData[emp.id]?.hours || 0), 0);
  const avgHours = activeEmps.length > 0 ? (totalHours / activeEmps.length).toFixed(1) : '0.0';

  container.innerHTML = `
    <div class="view-header" style="justify-content: flex-start; gap: 16px;">
      <h2 style="font-size: 24px; font-weight: 700; color: var(--text);">Statistics</h2>
      <div style="background: #fae8e8; color: var(--primary); padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 700;">THIS MONTH</div>
    </div>

    <!-- Stat Cards -->
    <div class="stat-grid">
      <div class="stat-card" onclick="filterDashboardByStatus('all')" style="cursor:pointer" title="View all employees">
        <div class="stat-card-label">ACTIVE EMPLOYEES</div>
        <div class="stat-card-value">${total}</div>
        <div class="stat-card-sub">Total Headcount</div>
      </div>
      <div class="stat-card" onclick="filterDashboardByStatus('present')" style="cursor:pointer" title="View present employees">
        <div class="stat-card-label">HAD ATTENDANCE</div>
        <div class="stat-card-value green">${present + checkedOut}</div>
        <div class="stat-card-sub">Logged in today</div>
      </div>
      <div class="stat-card" onclick="filterDashboardByStatus('absent')" style="cursor:pointer" title="View absent employees">
        <div class="stat-card-label">NO ATTENDANCE</div>
        <div class="stat-card-value red">${absent}</div>
        <div class="stat-card-sub">Absent today</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-label">AVG HOURS / MONTH</div>
        <div class="stat-card-value">${avgHours}</div>
        <div class="stat-card-sub">Across ${new Set(employees.map(e=>e.department).filter(d=>d&&d.trim()!=='')).size} departments</div>
      </div>
    </div>

    <!-- Attendance Log -->
    <div class="table-panel">
      <div class="table-panel-header">
        <span class="table-panel-title"><i class="ti ti-list-details" style="margin-right:6px;color:var(--primary);vertical-align:middle;"></i>Today's Attendance Log</span>
        <div class="table-panel-actions">
          <div class="search-box">
            <i class="ti ti-search"></i>
            <input type="text" id="dashboard-search" placeholder="Search employee..." oninput="filterDashboard()">
          </div>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Employee</th>
              <th>ID</th>
              <th>Department</th>
              <th>Check-In</th>
              <th>Check-Out</th>
              <th>Duration</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody id="dashboard-tbody">
            ${renderDashboardRows(employees)}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderDashboardRows(emps) {
  if (emps.length === 0) {
    return `<tr><td colspan="7"><div class="empty-state"><i class="ti ti-search-off"></i><h4>No results found</h4><p>Try a different search term</p></div></td></tr>`;
  }

  return emps.map(emp => {
    const att = todayAtt[emp.id] || { in: null, out: null, hours: 0 };
    let status, statusClass, duration;

    if (att.in && att.out) {
      status = 'Checked Out';
      statusClass = 'info';
      duration = att.hours.toFixed(2) + 'h';
    } else if (att.in) {
      // Check if late
      const [shiftH, shiftM] = emp.shiftStart.split(':').map(Number);
      const shiftStartMin = shiftH * 60 + shiftM;
      const inDate = new Date(att.in);
      const inMin = inDate.getHours() * 60 + inDate.getMinutes();
      
      if (inMin > shiftStartMin + 15) { // Assuming 15 min grace period
        status = 'Present (Late)';
        statusClass = 'warning';
      } else {
        status = 'Present';
        statusClass = 'success';
      }
      duration = '<span class="active-badge">Active</span>';
    } else {
      status = 'Absent';
      statusClass = 'danger';
      duration = '—';
    }

    const color = getAvatarColor(emp.id);
    const initials = getInitials(emp.firstName, emp.lastName);

    return `
      <tr>
        <td>
          <div class="employee-cell">
            <div class="avatar" style="background:${color}">${initials}</div>
            <div class="employee-cell-info">
              <span class="employee-cell-name">${emp.firstName} ${emp.lastName}</span>
              <span class="employee-cell-email">${emp.email}</span>
            </div>
          </div>
        </td>
        <td><code class="mono">${emp.id}</code></td>
        <td><span class="chip ${getDeptClass(emp.department)}">${emp.department}</span></td>
        <td><span class="mono">${formatTime(att.in)}</span></td>
        <td><span class="mono">${formatTime(att.out)}</span></td>
        <td>${duration}</td>
        <td><span class="chip ${statusClass}"><span class="chip-dot ${statusClass}"></span>${status}</span></td>
      </tr>
    `;
  }).join('');
}

let dashboardStatusFilter = 'all';

function filterDashboardByStatus(status) {
  dashboardStatusFilter = status;
  filterDashboard();
}

function filterDashboard() {
  const query = document.getElementById('dashboard-search').value.toLowerCase();
  const filtered = employees.filter(emp => {
    const att = todayAtt[emp.id] || { in: null, out: null };
    let matchesStatus = true;
    
    if (dashboardStatusFilter === 'present') {
      matchesStatus = !!att.in;
    } else if (dashboardStatusFilter === 'checkedout') {
      matchesStatus = !!(att.in && att.out);
    } else if (dashboardStatusFilter === 'absent') {
      matchesStatus = !att.in;
    }
    
    const matchesSearch = `${emp.firstName} ${emp.lastName}`.toLowerCase().includes(query) ||
                          emp.id.toLowerCase().includes(query);
                          
    return matchesStatus && matchesSearch;
  });
  document.getElementById('dashboard-tbody').innerHTML = renderDashboardRows(filtered);
}

function exportDashboard() {
  showToast('Dashboard export coming in production build', 'info');
}
