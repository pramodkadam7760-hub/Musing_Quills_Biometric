/* ===== Fingerprint Scanner View ===== */

function renderScanner(container) {
  container.innerHTML = `
    <div class="view-header">
      <div class="view-header-left">
        <h2>Fingerprint Scanner</h2>
        <p>Biometric check-in and check-out interface</p>
      </div>
    </div>

    <div class="scanner-layout">
      <!-- Scanner Panel -->
      <div class="scanner-panel">
        <div class="scanner-ring-container">
          <div class="scanner-ring" id="scanner-ring">
            <i class="ti ti-fingerprint"></i>
          </div>
        </div>

        <div class="scanner-status idle" id="scanner-status">
          Select an employee and scan
        </div>

        <div class="scanner-controls">
          <div class="form-group" style="margin-bottom:12px">
            <label class="form-label">Select Employee</label>
            <select class="form-select scanner-select" id="fp-sel">
              <option value="">— Choose Employee —</option>
              ${employees.map(emp => {
                const att = todayAtt[emp.id] || {};
                let tag = '';
                if (att.in && att.out) tag = ' (Shift Done)';
                else if (att.in) tag = ' (Checked In)';
                return `<option value="${emp.id}">${emp.firstName} ${emp.lastName}${tag}</option>`;
              }).join('')}
            </select>
          </div>

          <div class="scanner-btn-row">
            <button class="scanner-btn check-in" id="btn-checkin" onclick="doScan('in')">
              <i class="ti ti-login"></i> Check In
            </button>
            <button class="scanner-btn check-out" id="btn-checkout" onclick="doScan('out')">
              <i class="ti ti-logout"></i> Check Out
            </button>
            <button class="scanner-btn" id="btn-wfh" onclick="doScan('wfh')" style="background:var(--info);color:white;border:none;">
              <i class="ti ti-home"></i> WFH
            </button>
          </div>
        </div>
      </div>

      <!-- Scan Activity Log -->
      <div class="scan-log-panel">
        <div class="scan-log-header">
          <h3><i class="ti ti-history" style="margin-right:6px;color:var(--primary);vertical-align:middle;"></i>Scan Activity Log</h3>
          <button class="btn btn-ghost btn-sm" onclick="clearScanLog()">
            <i class="ti ti-trash"></i> Clear
          </button>
        </div>
        <div class="scan-log-list" id="scan-log-list">
          ${renderScanLogEntries()}
        </div>
      </div>
    </div>
  `;
}

function renderScanLogEntries() {
  if (scanLog.length === 0) {
    return `
      <div class="scan-log-empty">
        <i class="ti ti-scan"></i>
        <p>No scan activity yet</p>
        <p style="margin-top:4px;font-size:11px;">Scan events will appear here</p>
      </div>
    `;
  }
  return scanLog.map(entry => `
    <div class="scan-log-entry">
      <div class="scan-log-dot ${entry.type}"></div>
      <div class="scan-log-content">
        <div class="scan-log-name">${entry.name} <span class="mono text-muted" style="font-size:10px;margin-left:4px;">${entry.empId}</span></div>
        <div class="scan-log-detail">${entry.detail}</div>
      </div>
      <div class="scan-log-time">${entry.time}</div>
    </div>
  `).join('');
}

function doScan(action) {
  const sel = document.getElementById('fp-sel');
  const empId = sel.value;
  const ring = document.getElementById('scanner-ring');
  const status = document.getElementById('scanner-status');

  if (!empId) {
    setScannerState('fail', 'No employee selected');
    addScanLogEntry('error', 'System', '—', 'No employee selected for scan');
    return;
  }

  const emp = employees.find(e => e.id === empId);
  if (!emp) {
    setScannerState('fail', 'Employee not found');
    return;
  }

  // Check enrollment
  if (!emp.enrolled) {
    setScannerState('fail', `${emp.firstName} is not enrolled for biometric`);
    addScanLogEntry('error', `${emp.firstName} ${emp.lastName}`, emp.id, 'Biometric not enrolled');
    return;
  }

  const att = todayAtt[emp.id];

  // Validate action
  if (action === 'in' || action === 'wfh') {
    if (att.in && att.out) {
      setScannerState('fail', `${emp.firstName} already completed shift today`);
      addScanLogEntry('error', `${emp.firstName} ${emp.lastName}`, emp.id, 'Shift already completed — cannot check in again');
      return;
    }
    if (att.in) {
      setScannerState('fail', `${emp.firstName} is already checked in`);
      addScanLogEntry('error', `${emp.firstName} ${emp.lastName}`, emp.id, 'Already checked in — duplicate scan blocked');
      return;
    }
  }

  if (action === 'out') {
    if (!att.in) {
      setScannerState('fail', `${emp.firstName} hasn't checked in yet`);
      addScanLogEntry('error', `${emp.firstName} ${emp.lastName}`, emp.id, 'Check-out denied — no check-in recorded');
      return;
    }
    if (att.out) {
      setScannerState('fail', `${emp.firstName} already checked out`);
      addScanLogEntry('error', `${emp.firstName} ${emp.lastName}`, emp.id, 'Already checked out — duplicate scan blocked');
      return;
    }
  }

  // Start scanning animation
  setScannerState('scanning', 'Verifying biometric...');
  disableScanButtons(true);

  // Send real biometric log to Node.js backend
  setTimeout(async () => {
    try {
      const device = action === 'wfh' ? 'WFH_DASHBOARD' : 'DASHBOARD_SCANNER';
      const actionParam = (action === 'in' || action === 'wfh') ? 'IN' : 'OUT';

      await apiFetch(`${API_BASE_URL}/hardware/log`, {
        method: 'POST',
        body: {
          device,
          employee_id: emp.id,
          employee_name: `${emp.firstName} ${emp.lastName}`.trim(),
          action: actionParam
        }
      });

      // Reload database values
      await loadAllData();

      // Show success states / UI notices based on updated state
      const att = todayAtt[emp.id] || {};
      const now = new Date();
      if (action === 'in' || action === 'wfh') {
        const [shiftH, shiftM] = emp.shiftStart.split(':').map(Number);
        const shiftStartMin = shiftH * 60 + shiftM;
        const arrivalMin = now.getHours() * 60 + now.getMinutes();
        const delayMin = arrivalMin - shiftStartMin;
        
        if (action === 'wfh') {
          setScannerState('ok', `Welcome, ${emp.firstName}! ✓ Checked In (WFH)`);
          showToast(`${emp.firstName} ${emp.lastName} marked Work From Home`, 'info');
        } else if (delayMin > LATE_PENALTY.graceMinutes) {
          setScannerState('fail', `⚠ ${emp.firstName} is ${delayMin} min LATE!`);
          showToast(`⚠ LATE ARRIVAL: ${emp.firstName} ${emp.lastName} is ${delayMin} minutes late!`, 'late');
          
          addNotification(
            `Late Arrival — ${emp.firstName} ${emp.lastName}`,
            `Arrived ${delayMin} min late. Shift: ${format24to12(emp.shiftStart)}, Arrived: ${formatTimeShort(now)}`,
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
        } else {
          setScannerState('ok', `Welcome, ${emp.firstName}! ✓ Checked In`);
          showToast(`${emp.firstName} ${emp.lastName} checked in successfully`, 'success');
        }
      } else {
        setScannerState('ok', `Goodbye, ${emp.firstName}! ✓ Checked Out`);
        showToast(`${emp.firstName} ${emp.lastName} checked out successfully`, 'success');
      }

      // Re-render Scanner UI log listing and update selectors
      refreshScannerDropdown();
      const logList = document.getElementById('scan-log-list');
      if (logList) logList.innerHTML = renderScanLogEntries();

    } catch (err) {
      setScannerState('fail', 'Authentication Failed');
      showToast(err.message || 'Verification failed', 'error');
    } finally {
      disableScanButtons(false);
      setTimeout(() => {
        setScannerState('idle', 'Select an employee and scan');
      }, 3000);
    }
  }, 1500);
}

function setScannerState(state, message) {
  const ring = document.getElementById('scanner-ring');
  const status = document.getElementById('scanner-status');

  if (!ring || !status) return;

  ring.className = 'scanner-ring ' + state;
  status.className = 'scanner-status ' + state;
  status.textContent = message;
}

function disableScanButtons(disabled) {
  const btnIn = document.getElementById('btn-checkin');
  const btnOut = document.getElementById('btn-checkout');
  if (btnIn) btnIn.disabled = disabled;
  if (btnOut) btnOut.disabled = disabled;
}

function refreshScannerDropdown() {
  const sel = document.getElementById('fp-sel');
  if (!sel) return;
  const currentVal = sel.value;
  const options = employees.map(emp => {
    const att = todayAtt[emp.id] || {};
    let tag = '';
    if (att.in && att.out) tag = ' (Shift Done)';
    else if (att.in) tag = ' (Checked In)';
    return `<option value="${emp.id}" ${emp.id === currentVal ? 'selected' : ''}>${emp.firstName} ${emp.lastName}${tag}</option>`;
  }).join('');
  sel.innerHTML = `<option value="">— Choose Employee —</option>${options}`;
}

function addScanLogEntry(type, name, empId, detail) {
  const now = new Date();
  scanLog.unshift({
    type,
    name,
    empId,
    detail,
    time: formatTime(now)
  });

  // Update the log display
  const logList = document.getElementById('scan-log-list');
  if (logList) {
    logList.innerHTML = renderScanLogEntries();
  }
}

function clearScanLog() {
  scanLog = [];
  localStorage.setItem('SCAN_LOG_CLEARED_TIME', new Date().toISOString());
  const logList = document.getElementById('scan-log-list');
  if (logList) {
    logList.innerHTML = renderScanLogEntries();
  }
  showToast('Scan log cleared', 'info');
}
