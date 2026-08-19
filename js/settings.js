/* ===== Admin Settings View ===== */

function renderSettings(container) {
  const isEnabled = LATE_PENALTY.enabled;
  container.innerHTML = `
    <div class="view-header">
      <div class="view-header-left">
        <h2>Admin Settings</h2>
        <p>Global system settings and business rules configuration</p>
      </div>
    </div>

    <div class="settings-grid">
      <div class="settings-card">
        <div class="settings-card-header">
          <div class="settings-card-icon"><i class="ti ti-adjustments-horizontal"></i></div>
          <div class="settings-card-title-group">
            <h3>Late Penalty Policy</h3>
            <p class="text-muted" style="font-size:12px;margin-top:2px;">Configure salary deductions and warnings for late arrival rules</p>
          </div>
        </div>

        <div class="settings-card-body">
          <!-- Policy Summary -->
          <div class="settings-policy-summary">
            <div class="summary-item">
              <span class="summary-label">Grace Minutes</span>
              <span class="summary-value">${LATE_PENALTY.graceMinutes} min</span>
            </div>
            <div class="summary-item">
              <span class="summary-label">Warning Threshold</span>
              <span class="summary-value">${LATE_PENALTY.warningThreshold} lates</span>
            </div>
            <div class="summary-item">
              <span class="summary-label">Penalty / Late Mark</span>
              <span class="summary-value">₹${LATE_PENALTY.penaltyPerLate}</span>
            </div>
            <div class="summary-item">
              <span class="summary-label">Max Deduction Pct</span>
              <span class="summary-value">${LATE_PENALTY.maxPenaltyPct}% of basic</span>
            </div>
          </div>

          <!-- Toggle Option -->
          <div class="settings-toggle-row">
            <div class="toggle-info">
              <span class="toggle-label">Late Penalty Calculations</span>
              <p class="toggle-desc text-muted" style="margin-top:4px;">Enable or disable late arrival monetary penalties in payroll and scanner alerts.</p>
            </div>
            <label class="switch">
              <input type="checkbox" id="toggle-late-penalty" ${isEnabled ? 'checked' : ''} onchange="handleLatePenaltyToggle(this.checked)">
              <span class="slider round"></span>
            </label>
          </div>

          <!-- Alert Explainer -->
          <div class="settings-explainer ${isEnabled ? 'enabled' : 'disabled'}" id="settings-explainer">
            <i class="ti ${isEnabled ? 'ti-circle-check' : 'ti-info-circle'}"></i>
            <div class="explainer-content">
              <strong>${isEnabled ? 'Policy Status: ACTIVE' : 'Policy Status: DEACTIVATED'}</strong>
              <p id="explainer-text" style="font-size:12.5px;margin-top:2px;">
                ${isEnabled 
                  ? 'Late penalties are currently being calculated and applied to employee salary computations. Biometric check-in scanner will warn latecomers about salary deductions.'
                  : 'Late penalties are bypassed. Employee payroll will show late penalties as disabled with zero deductions. Scanner check-in alerts will omit deduction warnings.'}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-card-header">
          <div class="settings-card-icon"><i class="ti ti-calendar-off"></i></div>
          <div class="settings-card-title-group">
            <h3>Leave Settings</h3>
            <p class="text-muted" style="font-size:12px;margin-top:2px;">Configure leave counts, LOP deductions, half-day, and carry forward rules</p>
          </div>
        </div>

        <div class="settings-card-body">
          <form id="leave-settings-form" onsubmit="saveLeaveSettings(event)">
            <div class="form-row" style="display: flex; gap: 12px; margin-bottom: 12px;">
              <div class="form-group" style="flex: 1;">
                <label class="form-label" style="font-size: 12px;">Casual Leaves (Monthly)</label>
                <input type="number" class="form-input" id="setting-casual-count" min="0" step="0.5" value="${LEAVE_SETTINGS.casualCount}">
              </div>
              <div class="form-group" style="flex: 1;">
                <label class="form-label" style="font-size: 12px;">Sick Leaves (Monthly)</label>
                <input type="number" class="form-input" id="setting-sick-count" min="0" step="0.5" value="${LEAVE_SETTINGS.sickCount}">
              </div>
              <div class="form-group" style="flex: 1;">
                <label class="form-label" style="font-size: 12px;">Optional Leaves (Monthly)</label>
                <input type="number" class="form-input" id="setting-optional-count" min="0" step="0.5" value="${LEAVE_SETTINGS.optionalCount}">
              </div>
            </div>

            <div class="form-row" style="display: flex; gap: 12px; margin-bottom: 12px;">
              <div class="form-group" style="flex: 1;">
                <label class="form-label" style="font-size: 12px;">Monthly Leave Limit</label>
                <input type="number" class="form-input" id="setting-monthly-limit" min="0" step="any" value="${LEAVE_SETTINGS.monthlyLimit}">
              </div>
              <div class="form-group" style="flex: 1;">
                <label class="form-label" style="font-size: 12px;">Yearly Leave Limit</label>
                <input type="number" class="form-input" id="setting-yearly-limit" min="1" step="1" value="${LEAVE_SETTINGS.yearlyLimit}">
              </div>
              <div class="form-group" style="flex: 1;">
                <label class="form-label" style="font-size: 12px;">Max Carry Forward Days</label>
                <input type="number" class="form-input" id="setting-carry-forward-max" min="0" step="1" value="${LEAVE_SETTINGS.carryForwardMax}">
              </div>
            </div>

            <div class="form-row" style="display: flex; gap: 12px; margin-bottom: 12px;">
              <div class="form-group" style="flex: 1;">
                <label class="form-label" style="font-size: 12px;">Unpaid Leave Rule (LOP)</label>
                <select class="form-select" id="setting-lop-rule" onchange="toggleLopFixedGroup(this.value)" style="height: 38px;">
                  <option value="pro-rata" ${LEAVE_SETTINGS.lopRule === 'pro-rata' ? 'selected' : ''}>Pro-Rata (Salary/26 per day)</option>
                  <option value="fixed" ${LEAVE_SETTINGS.lopRule === 'fixed' ? 'selected' : ''}>Fixed Amount per day</option>
                </select>
              </div>
              <div class="form-group" id="setting-lop-fixed-group" style="flex: 1; ${LEAVE_SETTINGS.lopRule === 'fixed' ? '' : 'display:none;'}">
                <label class="form-label" style="font-size: 12px;">LOP Fixed Amount (₹)</label>
                <input type="number" class="form-input" id="setting-lop-fixed-amount" min="0" step="100" value="${LEAVE_SETTINGS.lopFixedAmount}">
              </div>
              <div class="form-group" style="flex: 1;">
                <label class="form-label" style="font-size: 12px;">Half-Day Deduction Rule</label>
                <select class="form-select" id="setting-half-day-rule" style="height: 38px;">
                  <option value="0.5" ${LEAVE_SETTINGS.halfDayRule === '0.5' ? 'selected' : ''}>Counts as 0.5 Leave</option>
                  <option value="0.0" ${LEAVE_SETTINGS.halfDayRule === '0.0' ? 'selected' : ''}>Fully Paid (0.0 Leave)</option>
                  <option value="1.0" ${LEAVE_SETTINGS.halfDayRule === '1.0' ? 'selected' : ''}>Counts as Full Leave (1.0)</option>
                </select>
              </div>
            </div>

            <div class="settings-toggle-row" style="padding: 12px 0 0 0; border-top: 1px solid var(--border); margin-top: 16px;">
              <div class="toggle-info">
                <span class="toggle-label" style="font-size: 13px;">Enable Leave Carry Forward</span>
                <p class="toggle-desc text-muted" style="margin-top:2px; font-size:11.5px;">Allows unused paid leaves to roll over to subsequent periods.</p>
              </div>
              <label class="switch">
                <input type="checkbox" id="setting-carry-forward" ${LEAVE_SETTINGS.carryForward ? 'checked' : ''}>
                <span class="slider round"></span>
              </label>
            </div>

            <div style="margin-top: 18px; display: flex; justify-content: flex-end;">
              <button type="submit" class="btn btn-primary btn-sm"><i class="ti ti-device-floppy"></i> Save Leave Settings</button>
            </div>
          </form>
        </div>
      </div>

      <div class="settings-card">
        <div class="settings-card-header">
          <div class="settings-card-icon"><i class="ti ti-lock"></i></div>
          <div class="settings-card-title-group">
            <h3>Change Password</h3>
            <p class="text-muted" style="font-size:12px;margin-top:2px;">Update the admin login password for this portal</p>
          </div>
        </div>

        <div class="settings-card-body">
          <form id="change-password-form" onsubmit="handleChangePassword(event)">
            <div class="form-group" style="margin-bottom: 12px;">
              <label class="form-label" style="font-size: 12px;">Current Password</label>
              <input type="password" class="form-input" id="setting-current-password" placeholder="Enter current password" required>
            </div>
            <div class="form-row" style="display: flex; gap: 12px; margin-bottom: 12px;">
              <div class="form-group" style="flex: 1;">
                <label class="form-label" style="font-size: 12px;">New Password</label>
                <input type="password" class="form-input" id="setting-new-password" placeholder="Enter new password (min 4 chars)" required minlength="4">
              </div>
              <div class="form-group" style="flex: 1;">
                <label class="form-label" style="font-size: 12px;">Confirm New Password</label>
                <input type="password" class="form-input" id="setting-confirm-password" placeholder="Re-enter new password" required minlength="4">
              </div>
            </div>

            <div class="settings-explainer disabled" style="margin-bottom: 14px;">
              <i class="ti ti-info-circle"></i>
              <div class="explainer-content">
                <strong>Password Policy</strong>
                <p style="font-size:12.5px;margin-top:2px;">
                  Password must be at least 4 characters. After changing, you will need to use the new password for all future logins. Default password is <code>123456</code>.
                </p>
              </div>
            </div>

            <div style="display: flex; justify-content: flex-end;">
              <button type="submit" class="btn btn-primary btn-sm"><i class="ti ti-key"></i> Update Password</button>
            </div>
          </form>
        </div>
      </div>

      <!-- === Holiday Calendar Settings === -->
      <div class="settings-card">
        <div class="settings-card-header">
          <div class="settings-card-icon" style="background: rgba(20,184,166,0.1); color: var(--teal);"><i class="ti ti-calendar-event"></i></div>
          <div class="settings-card-title-group">
            <h3>Holiday Calendar</h3>
            <p class="text-muted" style="font-size:12px;margin-top:2px;">Manage official public holidays. These are treated as paid leaves.</p>
          </div>
        </div>

        <div class="settings-card-body">
          <form id="add-holiday-form" onsubmit="addHoliday(event)" style="margin-bottom: 20px;">
            <div class="form-row" style="display: flex; gap: 12px; align-items: flex-end;">
              <div class="form-group" style="flex: 2;">
                <label class="form-label" style="font-size: 12px;">Holiday Name</label>
                <input type="text" class="form-input" id="new-holiday-name" placeholder="e.g. Independence Day" required>
              </div>
              <div class="form-group" style="flex: 1.5;">
                <label class="form-label" style="font-size: 12px;">Date</label>
                <input type="date" class="form-input" id="new-holiday-date" required>
              </div>
              <div style="flex: 0.5;">
                <button type="submit" class="btn btn-primary" style="height: 38px; padding: 0 16px;"><i class="ti ti-plus"></i> Add</button>
              </div>
            </div>
          </form>

          <div style="border-top: 1px solid var(--border); padding-top: 16px;">
            <h4 style="font-size: 13px; font-weight: 600; margin-bottom: 12px; color: var(--text-secondary);">Active Holidays</h4>
            <div id="holiday-list-container" style="display: flex; flex-direction: column; gap: 8px; max-height: 250px; overflow-y: auto; padding-right: 4px;">
              <!-- Rendered dynamically -->
            </div>
          </div>
        </div>
      </div>

      <!-- === Payroll & Overtime Settings === -->
      <div class="settings-card">
        <div class="settings-card-header">
          <div class="settings-card-icon" style="background: rgba(99,102,241,0.1); color: var(--primary);"><i class="ti ti-cash"></i></div>
          <div class="settings-card-title-group">
            <h3>Payroll & Overtime Rules</h3>
            <p class="text-muted" style="font-size:12px;margin-top:2px;">Configure overtime rates, monthly work days, and auto lunch break deductions</p>
          </div>
        </div>

        <div class="settings-card-body">
          <form id="payroll-settings-form" onsubmit="savePayrollSettings(event)">
            <div class="form-row" style="display: flex; gap: 12px; margin-bottom: 12px;">
              <div class="form-group" style="flex: 1;">
                <label class="form-label" style="font-size: 12px;">Monthly Work Days <span class="required">*</span></label>
                <input type="number" class="form-input" id="setting-payroll-workdays" value="${PAYROLL_SETTINGS.workDays}" min="1" max="31" required>
              </div>
              <div class="form-group" style="flex: 1;">
                <label class="form-label" style="font-size: 12px;">OT Rate Multiplier <span class="text-muted" style="font-size:10px;">(Optional)</span></label>
                <input type="number" class="form-input" id="setting-payroll-multiplier" value="${PAYROLL_SETTINGS.otMultiplier}" min="0.5" max="5.0" step="0.1" placeholder="Default: 1.5x">
              </div>
            </div>

            <div class="settings-toggle-row" style="padding: 12px 0 0 0; border-top: 1px solid var(--border); margin-top: 16px;">
              <div class="toggle-info">
                <span class="toggle-label" style="font-size: 13px;">Enable Overtime for Monthly Employees</span>
                <p class="toggle-desc text-muted" style="margin-top:2px; font-size:11.5px;">If enabled, monthly salaried employees earn daily overtime beyond expected hours.</p>
              </div>
              <label class="switch">
                <input type="checkbox" id="setting-payroll-monthly-ot" ${PAYROLL_SETTINGS.monthlyOtEnabled ? 'checked' : ''}>
                <span class="slider round"></span>
              </label>
            </div>

            <div class="settings-toggle-row" style="padding: 12px 0 0 0; border-top: 1px solid var(--border); margin-top: 16px;">
              <div class="toggle-info">
                <span class="toggle-label" style="font-size: 13px;">Auto 1-Hour Lunch Break Deduction</span>
                <p class="toggle-desc text-muted" style="margin-top:2px; font-size:11.5px;">Deduct 1 hour from daily working hours if they exceed 5 hours.</p>
              </div>
              <label class="switch">
                <input type="checkbox" id="setting-payroll-lunch-deduction" ${PAYROLL_SETTINGS.lunchBreakDeduction ? 'checked' : ''}>
                <span class="slider round"></span>
              </label>
            </div>

            <div style="margin-top: 18px; display: flex; justify-content: flex-end;">
              <button type="submit" class="btn btn-primary btn-sm"><i class="ti ti-device-floppy"></i> Save Payroll Rules</button>
            </div>
          </form>
        </div>
      </div>

    </div>
  `;
  renderHolidayList();
}


function renderHolidayList() {
  const container = document.getElementById('holiday-list-container');
  if (!container) return;

  if (holidaysList.length === 0) {
    container.innerHTML = `
      <div class="text-muted text-sm" style="text-align:center; padding: 20px 0;">
        No holidays configured yet.
      </div>
    `;
    return;
  }

  container.innerHTML = holidaysList.map(h => {
    const date = new Date(h.holiday_date);
    const dateStr = date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    return `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: var(--r);">
        <div>
          <span style="font-weight: 600; font-size: 13px;">${h.name}</span>
          <span class="mono text-muted" style="font-size: 11px; margin-left: 8px;">${dateStr}</span>
        </div>
        <button type="button" class="btn-icon danger" onclick="deleteHoliday(${h.id})" title="Delete Holiday">
          <i class="ti ti-trash"></i>
        </button>
      </div>
    `;
  }).join('');
}

async function addHoliday(e) {
  e.preventDefault();
  const nameEl = document.getElementById('new-holiday-name');
  const dateEl = document.getElementById('new-holiday-date');
  if (!nameEl || !dateEl) return;

  const name = nameEl.value.trim();
  const date = dateEl.value;

  try {
    await apiFetch(`${API_BASE_URL}/holidays`, {
      method: 'POST',
      body: { holiday_date: date, name }
    });
    nameEl.value = '';
    dateEl.value = '';
    showToast('Holiday added successfully', 'success');
    await loadAllData();
    renderHolidayList();
  } catch (err) {
    showToast(err.message || 'Failed to add holiday', 'error');
  }
}

async function deleteHoliday(id) {
  if (!confirm('Are you sure you want to delete this holiday?')) return;

  try {
    await apiFetch(`${API_BASE_URL}/holidays/${id}`, {
      method: 'DELETE'
    });
    showToast('Holiday deleted successfully', 'success');
    await loadAllData();
    renderHolidayList();
  } catch (err) {
    showToast(err.message || 'Failed to delete holiday', 'error');
  }
}

function toggleLopFixedGroup(value) {
  const group = document.getElementById('setting-lop-fixed-group');
  if (group) {
    group.style.display = value === 'fixed' ? 'block' : 'none';
  }
}

function saveLeaveSettings(event) {
  event.preventDefault();
  
  const casualCount = parseFloat(document.getElementById('setting-casual-count').value) || 0;
  const sickCount = parseFloat(document.getElementById('setting-sick-count').value) || 0;
  const optionalCount = parseFloat(document.getElementById('setting-optional-count').value) || 0;
  const monthlyLimit = parseFloat(document.getElementById('setting-monthly-limit').value) || 0;
  const yearlyLimit = parseFloat(document.getElementById('setting-yearly-limit').value) || 0;
  const carryForwardMax = parseFloat(document.getElementById('setting-carry-forward-max').value) || 0;
  const lopRule = document.getElementById('setting-lop-rule').value;
  const lopFixedAmount = parseFloat(document.getElementById('setting-lop-fixed-amount').value) || 0;
  const halfDayRule = document.getElementById('setting-half-day-rule').value;
  const carryForward = document.getElementById('setting-carry-forward').checked;

  LEAVE_SETTINGS = {
    casualCount,
    sickCount,
    optionalCount,
    monthlyLimit,
    yearlyLimit,
    carryForwardMax,
    lopRule,
    lopFixedAmount,
    halfDayRule,
    carryForward
  };
  localStorage.setItem('LEAVE_SETTINGS', JSON.stringify(LEAVE_SETTINGS));

  // Sync to backend server
  apiFetch(`${API_BASE_URL}/settings/leave`, {
    method: 'POST',
    body: LEAVE_SETTINGS
  }).then(res => {
    console.log('[SETTINGS] Leave settings synced to server successfully');
  }).catch(err => {
    console.error('[SETTINGS] Failed to sync settings to server:', err);
  });

  // Re-calculate attendance days for all employees since half-day rules might have changed
  employees.forEach(emp => {
    const history = attendanceHistory[emp.id] || [];
    const presentDays = history.filter(r => ['Present', 'Work From Home', 'Holiday'].includes(r.status)).length;
    const halfDays = history.filter(r => r.status === 'Half Day').length;
    const halfDayMultiplier = 1.0 - parseFloat(LEAVE_SETTINGS.halfDayRule);
    const days = presentDays + halfDays * halfDayMultiplier;
    const hours = history.reduce((s, r) => s + (r.hours || 0), 0);
    monthData[emp.id] = { days, hours: Math.round(hours * 100) / 100 };
  });

  showToast('Leave settings saved successfully', 'success');
  logAuditAction('Update Leave Policy', 'Updated leave limits, carry-forward, and LOP rules');

  // Re-render
  const container = document.getElementById('app');
  if (container) {
    renderSettings(container);
  }
}

function handleLatePenaltyToggle(checked) {
  LATE_PENALTY.enabled = checked;
  localStorage.setItem('LATE_PENALTY_enabled', checked ? 'true' : 'false');
  
  if (checked) {
    showToast('Late penalty calculations enabled globally', 'success');
  } else {
    showToast('Late penalty calculations disabled globally', 'warning');
  }

  const explainer = document.getElementById('settings-explainer');
  const text = document.getElementById('explainer-text');
  if (explainer && text) {
    if (checked) {
      explainer.className = 'settings-explainer enabled';
      const icon = explainer.querySelector('.ti');
      if (icon) icon.className = 'ti ti-circle-check';
      const strong = explainer.querySelector('strong');
      if (strong) strong.textContent = 'Policy Status: ACTIVE';
      text.textContent = 'Late penalties are currently being calculated and applied to employee salary computations. Biometric check-in scanner will warn latecomers about salary deductions.';
    } else {
      explainer.className = 'settings-explainer disabled';
      const icon = explainer.querySelector('.ti');
      if (icon) icon.className = 'ti ti-info-circle';
      const strong = explainer.querySelector('strong');
      if (strong) strong.textContent = 'Policy Status: DEACTIVATED';
      text.textContent = 'Late penalties are bypassed. Employee payroll will show late penalties as disabled with zero deductions. Scanner check-in alerts will omit deduction warnings.';
    }
  }

  logAuditAction('Toggle Policy', `Set Late Penalty calculations to: ${checked ? 'Enabled' : 'Disabled'}`);
}

async function handleChangePassword(event) {
  event.preventDefault();
  
  const currentPwd = document.getElementById('setting-current-password').value;
  const newPwd = document.getElementById('setting-new-password').value;
  const confirmPwd = document.getElementById('setting-confirm-password').value;

  const success = await changeAdminPassword(currentPwd, newPwd, confirmPwd);
  
  if (success) {
    // Clear the form
    document.getElementById('setting-current-password').value = '';
    document.getElementById('setting-new-password').value = '';
    document.getElementById('setting-confirm-password').value = '';
  }
}

function savePayrollSettings(event) {
  event.preventDefault();

  const workDays = parseInt(document.getElementById('setting-payroll-workdays').value) || 26;
  const otMultiplier = parseFloat(document.getElementById('setting-payroll-multiplier').value) || 1.5;
  const monthlyOtEnabled = document.getElementById('setting-payroll-monthly-ot').checked;
  const lunchBreakDeduction = document.getElementById('setting-payroll-lunch-deduction').checked;

  PAYROLL_SETTINGS = {
    workDays,
    otMultiplier,
    monthlyOtEnabled,
    lunchBreakDeduction
  };

  localStorage.setItem('PAYROLL_SETTINGS', JSON.stringify(PAYROLL_SETTINGS));

  // Reload and re-calculate all data from logs
  loadAllData().then(() => {
    showToast('Payroll & Overtime settings saved successfully', 'success');
    logAuditAction('Update Payroll Settings', `Updated Work Days: ${workDays}, OT Multiplier: ${otMultiplier}`);
    // Re-render
    const container = document.getElementById('app');
    if (container) {
      renderSettings(container);
    }
  }).catch(err => {
    console.error('Failed to reload data after saving settings:', err);
    showToast('Settings saved, but failed to reload payroll data', 'warning');
  });
}
