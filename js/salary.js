/* ===== Salary Breakdown View (Basic Pay + Late Penalty) ===== */

let salaryPaymentRecords = [];

function renderSalary(container) {
  let totalPayroll = 0, totalNet = 0, totalDeductions = 0, totalLatePenalties = 0;
  const salaryData = employees.map(emp => {
    const s = computeSalary(emp);
    totalPayroll += s.totalEarnings;
    totalNet += s.net;
    totalDeductions += s.totalDeductions;
    totalLatePenalties += s.latePenalty;
    return { emp, salary: s };
  });

  const avgSalary = employees.length > 0 ? Math.round(totalNet / employees.length) : 0;
  const habCount = employees.filter(e => isHabitualLatecomer(e.id)).length;

  container.innerHTML = `
    <div class="view-header">
      <div class="view-header-left">
        <h2>Salary Breakdown</h2>
        <p>Monthly payroll computation for ${getCurrentMonth()}</p>
      </div>
      <div class="view-header-actions" style="display: flex; gap: 10px; align-items: center;">
        <select id="payroll-month-select" class="form-control" style="width: 140px; height: 36px; padding: 0 10px; border-radius: 6px;" onchange="onPayrollPeriodChange()">
          ${[
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"
          ].map((m, idx) => `<option value="${idx}" ${idx === selectedPayrollMonth ? 'selected' : ''}>${m}</option>`).join('')}
        </select>
        <select id="payroll-year-select" class="form-control" style="width: 100px; height: 36px; padding: 0 10px; border-radius: 6px;" onchange="onPayrollPeriodChange()">
          ${[2025, 2026, 2027, 2028].map(y => `<option value="${y}" ${y === selectedPayrollYear ? 'selected' : ''}>${y}</option>`).join('')}
        </select>
        <button class="btn btn-secondary btn-sm" onclick="exportPayroll()">
          <i class="ti ti-file-spreadsheet"></i> Export Payroll
        </button>
      </div>
    </div>

    <!-- Summary Cards -->
    <div class="stat-grid">
      <div class="stat-card primary">
        <div class="stat-card-header">
          <div class="stat-card-icon"><i class="ti ti-wallet"></i></div>
          <span class="stat-card-label">Total Earnings</span>
        </div>
        <div class="stat-card-value">${formatCurrency(totalPayroll)}</div>
        <div class="stat-card-sub">Basic pay + overtime</div>
      </div>
      <div class="stat-card success">
        <div class="stat-card-header">
          <div class="stat-card-icon"><i class="ti ti-cash"></i></div>
          <span class="stat-card-label">Total Net Pay</span>
        </div>
        <div class="stat-card-value">${formatCurrency(totalNet)}</div>
        <div class="stat-card-sub">After deductions</div>
      </div>
      <div class="stat-card info">
        <div class="stat-card-header">
          <div class="stat-card-icon"><i class="ti ti-chart-bar"></i></div>
          <span class="stat-card-label">Average Salary</span>
        </div>
        <div class="stat-card-value">${formatCurrency(avgSalary)}</div>
        <div class="stat-card-sub">Per employee</div>
      </div>
      <div class="stat-card ${habCount > 0 ? 'danger' : 'warning'}">
        <div class="stat-card-header">
          <div class="stat-card-icon"><i class="ti ti-alarm"></i></div>
          <span class="stat-card-label">Late Penalties</span>
        </div>
        <div class="stat-card-value">${formatCurrency(totalLatePenalties)}</div>
        <div class="stat-card-sub">${habCount} habitual latecomers</div>
      </div>
    </div>

    <!-- Late Penalty Policy Info -->
    ${(!LATE_PENALTY.enabled || totalLatePenalties > 0) ? `
    <div class="salary-structure-info">
      <div class="salary-structure-header">
        <i class="ti ti-alert-triangle" style="color:var(--warning);margin-right:6px"></i>
        <strong>Late Penalty Policy:</strong>
        ${LATE_PENALTY.enabled ? `
          <span class="text-muted" style="margin-left:6px">${LATE_PENALTY.graceMinutes} min grace • ${LATE_PENALTY.warningThreshold}+ lates = ₹${LATE_PENALTY.penaltyPerLate}/late • Max ${LATE_PENALTY.maxPenaltyPct}% of basic pay</span>
        ` : `
          <span class="text-danger" style="margin-left:6px; font-weight: bold;">Disabled by Admin Settings</span>
        `}
      </div>
    </div>
    ` : ''}

    <!-- Salary Cards Grid -->
    <div class="salary-grid">
      ${salaryData.map(({ emp, salary }) => renderSalaryCard(emp, salary)).join('')}
    </div>

    <!-- Payment History Section -->
    <div class="payment-history-section" style="margin-top: 40px;">
      <div class="view-header" style="margin-bottom: 16px;">
        <div class="view-header-left">
          <h2><i class="ti ti-history" style="margin-right: 8px;"></i>Payment History</h2>
          <p>Records of all salary payments made</p>
        </div>
      </div>
      <div id="payment-history-container">
        <div style="text-align: center; padding: 40px; color: var(--text-muted);">
          <i class="ti ti-loader" style="font-size: 24px; animation: spin 1s linear infinite;"></i>
          <p>Loading payment history...</p>
        </div>
      </div>
    </div>
  `;

  // Load payment history from API
  loadPaymentHistory();
}

function renderSalaryCard(emp, s) {
  const color = getAvatarColor(emp.id);
  const initials = getInitials(emp.firstName, emp.lastName);
  const rateLabel = emp.salaryType === 'monthly'
    ? formatCurrency(emp.monthlyRate) + '/mo'
    : formatCurrency(emp.hourlyRate) + '/hr';
  const isHabitual = s.lateCount >= LATE_PENALTY.warningThreshold;

  return `
    <div class="salary-card ${isHabitual ? 'salary-card-penalty' : ''}">
      <div class="salary-card-header">
        <div class="avatar" style="background:${color}">${initials}</div>
        <div class="salary-card-info">
          <div class="salary-card-name">
            ${emp.firstName} ${emp.lastName}
            ${isHabitual ? '<span class="chip danger" style="font-size:9px;padding:1px 6px;margin-left:6px"><i class="ti ti-alarm" style="font-size:10px;margin-right:2px"></i>Habitual Late</span>' : ''}
          </div>
          <div class="salary-card-meta">
            <span class="chip ${getDeptClass(emp.department)}" style="font-size:10px;padding:2px 8px;">${emp.department}</span>
            <span>${emp.designation || emp.role}</span>
            <span class="mono" style="color:var(--text-muted)">${rateLabel}</span>
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" onclick="printPayslip('${emp.id}')" title="Download Payslip">
          <i class="ti ti-printer"></i>
        </button>
        <button class="btn btn-ghost btn-sm" onclick="sendPayslipWhatsApp('${emp.id}')" title="Send via WhatsApp" style="color: #25D366;">
          <i class="ti ti-brand-whatsapp"></i>
        </button>
        <button class="btn btn-ghost btn-sm" onclick="paySalary('${emp.id}')" title="Pay Salary" style="color: var(--success);">
          <i class="ti ti-circle-check"></i>
        </button>
      </div>

      <div class="salary-card-body">
        <!-- ATTENDANCE -->
        <div class="salary-attendance-summary">
          <div class="salary-att-item">
            <span class="salary-att-label">Days Present</span>
            <span class="salary-att-value">${s.daysPresent} / 26</span>
          </div>
          ${emp.salaryType === 'hourly' ? `
            <div class="salary-att-item">
              <span class="salary-att-label">Hours Worked</span>
              <span class="salary-att-value">${s.hoursWorked}h</span>
            </div>
          ` : ''}
          <div class="salary-att-item">
            <span class="salary-att-label">Late Marks</span>
            <span class="salary-att-value ${isHabitual ? 'text-danger' : ''}">${s.lateCount} ${isHabitual ? '⚠' : ''}</span>
          </div>
        </div>

        <!-- EARNINGS -->
        <div class="salary-row">
          <span class="salary-row-label">Basic Pay</span>
          <span class="salary-row-value">${formatCurrency(s.basicPay)}</span>
        </div>
        ${s.overtime > 0 ? `
          <div class="salary-row">
            <span class="salary-row-label">Overtime</span>
            <span class="salary-row-value bonus">+${formatCurrency(s.overtime)}</span>
          </div>
        ` : ''}
        ${s.bonus > 0 ? `
          <div class="salary-row">
            <span class="salary-row-label">Variable Pay / Bonus</span>
            <span class="salary-row-value bonus">+${formatCurrency(s.bonus)}</span>
          </div>
        ` : ''}
        <div class="salary-row subtotal">
          <span class="salary-row-label">Total Earnings</span>
          <span class="salary-row-value">${formatCurrency(s.totalEarnings)}</span>
        </div>

        <!-- DEDUCTIONS -->
        ${s.totalDeductions > 0 ? `
          <div style="font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;margin:12px 0 6px;">Deductions Breakdown</div>
          ${s.unpaidLeaveDeduction > 0 ? `
            <div class="salary-row deduction-row">
              <span class="salary-row-label"><i class="ti ti-calendar-off" style="margin-right:4px;color:var(--danger)"></i>Unpaid Leaves (${s.excessLeaves} excess days)</span>
              <span class="salary-row-value deduction penalty">−${formatCurrency(s.unpaidLeaveDeduction)}</span>
            </div>
            <div class="salary-formula-hint" style="font-size:10.5px;color:var(--text-muted);padding-left:18px;margin-bottom:8px;line-height:1.4">
              <strong>Calculation:</strong> ${LEAVE_SETTINGS.lopRule === 'fixed' 
                ? `₹${LEAVE_SETTINGS.lopFixedAmount} per day × ${s.excessLeaves} days.`
                : `(₹${emp.monthlyRate} / 26 days) × ${s.excessLeaves} days.`}<br>
              <em>Note: First ${s.paidAllowance} leaves per month are paid.</em>
            </div>
          ` : ''}
          ${s.latePenalty > 0 ? `
            <div class="salary-row late-penalty-row">
              <span class="salary-row-label"><i class="ti ti-alarm" style="margin-right:4px;color:var(--danger)"></i>Late Penalty (${s.lateCount} occurrences)</span>
              <span class="salary-row-value deduction penalty">−${formatCurrency(s.latePenalty)}</span>
            </div>
            <div class="salary-formula-hint" style="font-size:10.5px;color:var(--text-muted);padding-left:18px;margin-bottom:8px;line-height:1.4">
              <strong>Calculation:</strong> ${s.lateCount} lates × ₹${LATE_PENALTY.penaltyPerLate} per occurrence.<br>
              <em>(Applies after ${LATE_PENALTY.warningThreshold} warnings)</em>
            </div>
          ` : ''}
          <div class="salary-row subtotal" style="border-top:1px dashed var(--danger); color:var(--danger)">
            <span class="salary-row-label">Total Deductions</span>
            <span class="salary-row-value">−${formatCurrency(s.totalDeductions)}</span>
          </div>
        ` : ''}

        <!-- NET SALARY -->
        <div class="salary-row total">
          <span class="salary-row-label"><i class="ti ti-cash" style="margin-right:4px"></i>Net Salary</span>
          <span class="salary-row-value">${formatCurrency(s.net)}</span>
        </div>
      </div>
    </div>
  `;
}

// ===== Payment History =====
async function loadPaymentHistory() {
  const container = document.getElementById('payment-history-container');
  if (!container) return;

  try {
    salaryPaymentRecords = await apiFetch(`${API_BASE_URL}/salary-payments`);

    // Filter records to only show the selected payroll month & year
    const filtered = (salaryPaymentRecords || []).filter(rec => {
      if (!rec.payment_date) return false;
      const d = new Date(rec.payment_date);
      return d.getMonth() === selectedPayrollMonth && d.getFullYear() === selectedPayrollYear;
    });

    const monthLabel = new Date(selectedPayrollYear, selectedPayrollMonth, 1)
      .toLocaleString('default', { month: 'long', year: 'numeric' });

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="payment-history-empty">
          <i class="ti ti-receipt-off" style="font-size: 48px; color: var(--text-muted); margin-bottom: 12px;"></i>
          <p style="color: var(--text-muted); font-size: 14px;">No salary payments recorded for <strong>${monthLabel}</strong>.</p>
          <p style="color: var(--text-muted); font-size: 12px;">Switch months using the selector above to view other records.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="payment-history-table-wrap">
        <table class="payment-history-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Period</th>
              <th>Days Present</th>
              <th>Base Salary</th>
              <th>Earnings</th>
              <th>Deductions</th>
              <th>Net Salary</th>
              <th>Status</th>
              <th>Paid On</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${filtered.map(rec => {
              const isRevised = rec.status === 'Revised';
              const statusClass = isRevised ? 'chip-revised' : 'chip-paid';
              const revisedInfo = isRevised && rec.revised_at
                ? `<div class="revised-info" title="${(rec.revision_note || '').replace(/"/g, '&quot;')}">
                     <i class="ti ti-pencil" style="font-size: 11px;"></i>
                     Revised ${new Date(rec.revised_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                   </div>`
                : '';
              const paymentDate = rec.payment_date
                ? new Date(rec.payment_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                : '—';
              // Period: show "Month YYYY" derived from payment_date
              const periodLabel = rec.payment_date
                ? new Date(rec.payment_date).toLocaleString('default', { month: 'long', year: 'numeric' })
                : '—';

              return `
                <tr>
                  <td>
                    <div class="ph-emp-name">${rec.employee_name || 'Employee'}</div>
                    <div class="ph-emp-id">${rec.employee_id}</div>
                  </td>
                  <td>${periodLabel}</td>
                  <td>${parseFloat(rec.present_days || 0)}</td>
                  <td>${formatCurrency(parseFloat(rec.base_salary || 0))}</td>
                  <td>${formatCurrency(parseFloat(rec.earnings || 0))}</td>
                  <td style="color: var(--danger);">−${formatCurrency(parseFloat(rec.deductions || 0))}</td>
                  <td><strong>${formatCurrency(parseFloat(rec.net_salary || 0))}</strong></td>
                  <td>
                    <span class="chip ${statusClass}">${rec.status}</span>
                    ${revisedInfo}
                  </td>
                  <td>${paymentDate}</td>
                  <td>
                    <button class="btn btn-ghost btn-sm" onclick="printPaymentHistoryPayslip(${rec.id})" title="Print Payslip">
                      <i class="ti ti-printer"></i>
                    </button>
                    <button class="btn btn-ghost btn-sm" onclick="sendPaymentHistoryWhatsApp(${rec.id})" title="Send via WhatsApp" style="color: #25D366;">
                      <i class="ti ti-brand-whatsapp"></i>
                    </button>
                    <button class="btn btn-ghost btn-sm" onclick="openEditPaymentModal(${rec.id})" title="Edit Payment Record" style="color: var(--primary);">
                      <i class="ti ti-edit"></i>
                    </button>
                    <button class="btn btn-ghost btn-sm" onclick="deletePaymentRecord(${rec.id})" title="Delete Record" style="color: var(--danger);">
                      <i class="ti ti-trash"></i>
                    </button>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `
      <div class="payment-history-empty">
        <i class="ti ti-alert-circle" style="font-size: 48px; color: var(--danger); margin-bottom: 12px;"></i>
        <p style="color: var(--danger); font-size: 14px;">Failed to load payment history.</p>
        <p style="color: var(--text-muted); font-size: 12px;">${err.message || 'Unknown error'}</p>
      </div>
    `;
  }
}

// ===== Delete Payment Record =====
async function deletePaymentRecord(paymentId) {
  const rec = salaryPaymentRecords.find(r => r.id === paymentId);
  if (!rec) return;
  const empName = rec.employee_name || rec.employee_id;
  const period = rec.payment_date
    ? new Date(rec.payment_date).toLocaleString('default', { month: 'long', year: 'numeric' })
    : 'this period';
  if (!confirm(`Delete salary payment for ${empName} (${period})? This cannot be undone.`)) return;
  try {
    await apiFetch(`${API_BASE_URL}/salary-payments/${paymentId}`, { method: 'DELETE' });
    showToast('Payment record deleted', 'success');
    await loadPaymentHistory();
  } catch (err) {
    showToast(err.message || 'Delete failed', 'error');
  }
}

// ===== Print Payslip for Payment History Record (Clean Employee Facing) =====
function printPaymentHistoryPayslip(paymentId) {
  const rec = salaryPaymentRecords.find(r => r.id === paymentId);
  if (!rec) return;
  const emp = employees.find(e => e.id === rec.employee_id) || {};

  let printArea = document.getElementById('print-area');
  if (!printArea) {
    printArea = document.createElement('div');
    printArea.id = 'print-area';
    document.body.appendChild(printArea);
  }

  const payMonth = rec.payment_date ? new Date(rec.payment_date).toLocaleString('default', { month: 'long', year: 'numeric' }) : getCurrentMonth();

  printArea.innerHTML = `
    <div class="payslip-container">
      <div class="payslip-header">
        <img src="/cubiccode_logo.png" alt="Cubic Code Logo" style="height: 50px; margin-bottom: 10px;">
        <h2 style="margin: 0; font-size: 24px; font-weight: 700; color: #000; letter-spacing: -0.5px;">CUBIC CODE</h2>
        <p style="margin: 5px 0 0 0; color: #555;">Payslip for the month of ${payMonth}</p>
      </div>
      <div class="payslip-emp-details">
        <div><strong>Employee Name:</strong> ${rec.employee_name}</div>
        <div><strong>Employee ID:</strong> ${rec.employee_id}</div>
        <div><strong>Department:</strong> ${emp.department || '—'}</div>
        <div><strong>Designation:</strong> ${emp.designation || emp.role || '—'}</div>
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
            <td>${formatCurrency(parseFloat(rec.earnings || 0))}</td>
            <td>Total Deductions</td>
            <td>${formatCurrency(parseFloat(rec.deductions || 0))}</td>
          </tr>
          <tr class="payslip-totals">
            <td><strong>Total Earnings</strong></td>
            <td><strong>${formatCurrency(parseFloat(rec.earnings || 0))}</strong></td>
            <td><strong>Total Deductions</strong></td>
            <td><strong>${formatCurrency(parseFloat(rec.deductions || 0))}</strong></td>
          </tr>
        </tbody>
      </table>
      
      <div class="payslip-net">
        <h3>Net Salary: ${formatCurrency(parseFloat(rec.net_salary || 0))}</h3>
      </div>
      <div class="payslip-footer">
        <p>This is a computer-generated payslip.</p>
      </div>
    </div>
  `;

  window.print();
}

// ===== Send WhatsApp Payslip for Payment History Record (Clean Employee Facing) =====
function sendPaymentHistoryWhatsApp(paymentId) {
  const rec = salaryPaymentRecords.find(r => r.id === paymentId);
  if (!rec) return;
  const emp = employees.find(e => e.id === rec.employee_id) || {};

  const payMonth = rec.payment_date ? new Date(rec.payment_date).toLocaleString('default', { month: 'long', year: 'numeric' }) : getCurrentMonth();

  const text = `*CUBIC CODE*\n` +
               `*Salary Slip - ${payMonth}*\n\n` +
               `*Employee Details:*\n` +
               `• Name: ${rec.employee_name}\n` +
               `• ID: ${rec.employee_id}\n` +
               `• Dept: ${emp.department || '—'}\n` +
               `• Designation: ${emp.designation || emp.role || '—'}\n\n` +
               `*Earnings:*\n` +
               `• Total Earnings: ${formatCurrency(parseFloat(rec.earnings || 0))}\n\n` +
               `*Deductions:*\n` +
               `• Total Deductions: ${formatCurrency(parseFloat(rec.deductions || 0))}\n\n` +
               `*Net Payable Salary:* *${formatCurrency(parseFloat(rec.net_salary || 0))}*\n` +
               `• Days Present: ${parseFloat(rec.present_days || 0)}\n\n` +
               `*View / Download Official PDF Payslip:*\n` +
               `${API_BASE_URL.replace(/\/api$/, '')}/payslip/${rec.employee_id}\n\n` +
               `_This is a computer-generated payslip notification._`;

  let phone = emp.phone ? emp.phone.replace(/[^0-9]/g, '') : '';
  if (!phone) {
    showToast('Employee phone number is not available or invalid', 'error');
    return;
  }
  if (phone.length === 10) {
    phone = '91' + phone;
  }
  
  const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  window.open(waUrl, '_blank');
}


// ===== Edit Payment Modal =====
function openEditPaymentModal(paymentId) {
  const rec = salaryPaymentRecords.find(r => r.id === paymentId);
  if (!rec) {
    showToast('Payment record not found', 'error');
    return;
  }

  const presentDays = parseFloat(rec.present_days || 0);
  const weeklyOffs = parseInt(rec.weekly_offs || 0);
  const holidays = parseInt(rec.holidays || 0);
  const absentDays = parseFloat(rec.absent_days || 0);
  const baseSalary = parseFloat(rec.base_salary || 0);
  const earnings = parseFloat(rec.earnings || 0);
  const deductions = parseFloat(rec.deductions || 0);
  const netSalary = parseFloat(rec.net_salary || 0);

  openModal(`
    <div class="modal-card" style="max-width: 560px; padding: 28px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <div>
          <h3 style="margin: 0; font-size: 20px; font-weight: 700; color: var(--text);">
            <i class="ti ti-edit" style="margin-right: 6px; color: var(--primary);"></i>Edit Payment Record
          </h3>
          <p style="color: var(--text-muted); font-size: 13px; margin: 4px 0 0;">
            ${rec.employee_name} • ID: ${rec.employee_id}
          </p>
        </div>
        <button class="modal-close" onclick="closeModal()"><i class="ti ti-x"></i></button>
      </div>

      ${rec.status === 'Revised' && rec.revision_note ? `
        <div style="background: #fef3c7; border: 1px solid #fbbf24; border-radius: 8px; padding: 10px 14px; margin-bottom: 16px; font-size: 12px; color: #92400e;">
          <i class="ti ti-info-circle" style="margin-right: 4px;"></i>
          <strong>Previous revision:</strong> ${rec.revision_note}
        </div>
      ` : ''}

      <div class="edit-payment-grid">
        <div class="edit-payment-group">
          <label>Present Days</label>
          <input type="number" id="edit-present-days" class="form-control" value="${presentDays}" step="0.5" min="0" oninput="recalcEditPayment()">
        </div>
        <div class="edit-payment-group">
          <label>Absent Days</label>
          <input type="number" id="edit-absent-days" class="form-control" value="${absentDays}" step="0.5" min="0" oninput="recalcEditPayment()">
        </div>
        <div class="edit-payment-group">
          <label>Weekly Offs</label>
          <input type="number" id="edit-weekly-offs" class="form-control" value="${weeklyOffs}" step="1" min="0" oninput="recalcEditPayment()">
        </div>
        <div class="edit-payment-group">
          <label>Holidays</label>
          <input type="number" id="edit-holidays" class="form-control" value="${holidays}" step="1" min="0" oninput="recalcEditPayment()">
        </div>
      </div>

      <div style="border-top: 1px solid var(--border, #e2e8f0); margin: 16px 0; padding-top: 16px;">
        <div class="edit-payment-grid">
          <div class="edit-payment-group">
            <label>Base Salary (₹)</label>
            <input type="number" id="edit-base-salary" class="form-control" value="${baseSalary}" step="1" min="0" oninput="recalcEditPayment()">
          </div>
          <div class="edit-payment-group">
            <label>Earnings (₹)</label>
            <input type="number" id="edit-earnings" class="form-control" value="${earnings}" step="1" min="0" oninput="recalcEditPayment()">
          </div>
          <div class="edit-payment-group">
            <label>Deductions (₹)</label>
            <input type="number" id="edit-deductions" class="form-control" value="${deductions}" step="1" min="0" oninput="recalcEditPayment()">
          </div>
          <div class="edit-payment-group">
            <label style="display: flex; align-items: center; gap: 6px;">
              Net Salary (₹)
              <span class="edit-net-auto-badge" id="edit-net-badge">Auto</span>
            </label>
            <input type="number" id="edit-net-salary" class="form-control" value="${netSalary}" step="1" min="0" oninput="onNetSalaryManualEdit()">
          </div>
        </div>
      </div>

      <div style="margin: 16px 0;">
        <label style="display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: var(--text);">
          Revision Note <span style="color: var(--danger);">*</span>
        </label>
        <textarea id="edit-revision-note" class="form-control" rows="2" placeholder="e.g. Corrected absent days from 5 to 3" style="width: 100%; box-sizing: border-box; resize: vertical; padding: 10px; border-radius: 6px;"></textarea>
      </div>

      <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 20px;">
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="submitEditPayment(${paymentId})">
          <i class="ti ti-check" style="margin-right: 4px;"></i>Save Changes
        </button>
      </div>
    </div>
  `);

  // Initialize auto-calc state
  window._editNetManualOverride = false;
}

// Auto-recalculate net salary when fields change
function recalcEditPayment() {
  if (window._editNetManualOverride) return;
  const earnings = parseFloat(document.getElementById('edit-earnings').value) || 0;
  const deductions = parseFloat(document.getElementById('edit-deductions').value) || 0;
  const net = Math.max(0, earnings - deductions);
  document.getElementById('edit-net-salary').value = Math.round(net);
}

// When user manually edits net salary, switch to manual mode
function onNetSalaryManualEdit() {
  window._editNetManualOverride = true;
  const badge = document.getElementById('edit-net-badge');
  if (badge) {
    badge.textContent = 'Manual';
    badge.classList.add('manual');
  }
}

// Submit edited payment
async function submitEditPayment(paymentId) {
  const revision_note = document.getElementById('edit-revision-note').value;
  if (!revision_note || !revision_note.trim()) {
    showToast('Please enter a revision note explaining the change', 'error');
    return;
  }

  const payload = {
    present_days: parseFloat(document.getElementById('edit-present-days').value) || 0,
    absent_days: parseFloat(document.getElementById('edit-absent-days').value) || 0,
    weekly_offs: parseInt(document.getElementById('edit-weekly-offs').value) || 0,
    holidays: parseInt(document.getElementById('edit-holidays').value) || 0,
    base_salary: parseFloat(document.getElementById('edit-base-salary').value) || 0,
    earnings: parseFloat(document.getElementById('edit-earnings').value) || 0,
    deductions: parseFloat(document.getElementById('edit-deductions').value) || 0,
    net_salary: parseFloat(document.getElementById('edit-net-salary').value) || 0,
    revision_note: revision_note.trim()
  };

  try {
    const res = await apiFetch(`${API_BASE_URL}/salary-payments/${paymentId}`, {
      method: 'PUT',
      body: payload
    });
    showToast(res.message || 'Payment record updated', 'success');
    closeModal();
    loadPaymentHistory();
  } catch (err) {
    showToast(err.message || 'Failed to update payment record', 'error');
  }
}

// ===== Print Payslip =====
function printPayslip(empId) {
  const emp = employees.find(e => e.id === empId);
  const s = computeSalary(emp);
  if (!emp) return;

  // Create an invisible print container if it doesn't exist
  let printArea = document.getElementById('print-area');
  if (!printArea) {
    printArea = document.createElement('div');
    printArea.id = 'print-area';
    document.body.appendChild(printArea);
  }

  // Populate print area
  printArea.innerHTML = `
    <div class="payslip-container">
      <div class="payslip-header">
        <img src="/cubiccode_logo.png" alt="Cubic Code Logo" style="height: 50px; margin-bottom: 10px;">
        <h2 style="margin: 0; font-size: 24px; font-weight: 700; color: #000; letter-spacing: -0.5px;">CUBIC CODE</h2>
        <p style="margin: 5px 0 0 0; color: #555;">Payslip for the month of ${getCurrentMonth()}</p>
      </div>
      <div class="payslip-emp-details">
        <div><strong>Employee Name:</strong> ${emp.firstName} ${emp.lastName}</div>
        <div><strong>Employee ID:</strong> ${emp.id}</div>
        <div><strong>Department:</strong> ${emp.department}</div>
        <div><strong>Designation:</strong> ${emp.designation || emp.role}</div>
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
            <td>${formatCurrency(s.basicPay)}</td>
            <td>Unpaid Leaves (${s.excessLeaves} days)</td>
            <td>${s.unpaidLeaveDeduction > 0 ? formatCurrency(s.unpaidLeaveDeduction) : '0'}</td>
          </tr>
          <tr>
            <td>Overtime Bonus</td>
            <td>${s.overtime > 0 ? formatCurrency(s.overtime) : '0'}</td>
            <td>Late Penalty (${s.lateCount} occurrences)</td>
            <td>${s.latePenalty > 0 ? formatCurrency(s.latePenalty) : '0'}</td>
          </tr>
          <tr>
            <td>Variable Pay / Bonus</td>
            <td>${s.bonus > 0 ? formatCurrency(s.bonus) : '0'}</td>
            <td></td>
            <td></td>
          </tr>
          <tr class="payslip-totals">
            <td><strong>Total Earnings</strong></td>
            <td><strong>${formatCurrency(s.totalEarnings)}</strong></td>
            <td><strong>Total Deductions</strong></td>
            <td><strong>${formatCurrency(s.totalDeductions)}</strong></td>
          </tr>
        </tbody>
      </table>
      
      <div class="payslip-net">
        <h3>Net Salary: ${formatCurrency(s.net)}</h3>
      </div>
      <div class="payslip-footer">
        <p>This is a computer-generated payslip.</p>
      </div>
    </div>
  `;

  // Print
  window.print();
}

// ===== Send Payslip via WhatsApp =====
function sendPayslipWhatsApp(empId) {
  const emp = employees.find(e => e.id === empId);
  if (!emp) return;
  const s = computeSalary(emp);
  
  const formattedNet = formatCurrency(s.net);
  const formattedBasic = formatCurrency(s.basicPay);
  const formattedOvertime = formatCurrency(s.overtime);
  const formattedBonus = formatCurrency(s.bonus);
  const formattedDeduction = formatCurrency(s.totalDeductions);
  const formattedLatePenalty = formatCurrency(s.latePenalty);
  const formattedLop = formatCurrency(s.unpaidLeaveDeduction || 0);
  
  const text = `*CUBIC CODE*\n` +
               `*Salary Slip - ${getCurrentMonth()}*\n\n` +
               `*Employee Details:*\n` +
               `• Name: ${emp.firstName} ${emp.lastName}\n` +
               `• ID: ${emp.id}\n` +
               `• Dept: ${emp.department}\n` +
               `• Designation: ${emp.designation || emp.role}\n\n` +
               `*Earnings:*\n` +
               `• Basic Pay: ${formattedBasic}\n` +
               `• Overtime: ${formattedOvertime}\n` +
               `• Bonus: ${formattedBonus}\n` +
               `• Total Earnings: ${formatCurrency(s.totalEarnings)}\n\n` +
               `*Deductions:*\n` +
               `• Late Penalty: ${formattedLatePenalty}\n` +
               `• Unpaid Leaves LOP: ${formattedLop}\n` +
               `• Total Deductions: ${formattedDeduction}\n\n` +
               `*Net Payable Salary:* *${formattedNet}*\n` +
               `• Days Present: ${s.daysPresent} / 26\n` +
               `• Leaves Taken: ${s.leavesTaken}\n\n` +
               `*View / Download Official PDF Payslip:*\n` +
               `${API_BASE_URL.replace(/\/api$/, '')}/payslip/${emp.id}\n\n` +
               `_This is a computer-generated payslip notification._`;

  let phone = emp.phone ? emp.phone.replace(/[^0-9]/g, '') : '';
  if (!phone) {
    showToast('Employee phone number is not available or invalid', 'error');
    return;
  }
  if (phone.length === 10) {
    phone = '91' + phone;
  }
  
  const waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  window.open(waUrl, '_blank');
}

function exportPayroll() {
  const headers = [
    'Employee ID',
    'Name',
    'Department',
    'Designation',
    'Salary Type',
    'Rate',
    'Days Present',
    'Late Marks',
    'Basic Pay',
    'Overtime Pay',
    'Bonus',
    'Total Earnings',
    'Late Penalty',
    'LOP leaves',
    'Total Deductions',
    'Net Pay'
  ];

  const rows = employees.map(emp => {
    const s = computeSalary(emp);
    const rate = emp.salaryType === 'monthly' ? emp.monthlyRate : emp.hourlyRate;
    return [
      emp.id,
      `"${emp.firstName} ${emp.lastName}"`,
      `"${emp.department}"`,
      `"${emp.designation || emp.role}"`,
      emp.salaryType,
      rate,
      s.daysPresent,
      s.lateCount,
      s.basicPay,
      s.overtime,
      s.bonus,
      s.totalEarnings,
      s.latePenalty,
      s.unpaidLeaveDeduction || 0,
      s.totalDeductions,
      s.net
    ];
  });

  const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `payroll_export_${getCurrentMonth().replace(' ', '_')}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function onPayrollPeriodChange() {
  const m = parseInt(document.getElementById('payroll-month-select').value);
  const y = parseInt(document.getElementById('payroll-year-select').value);
  selectedPayrollMonth = m;
  selectedPayrollYear = y;
  
  // Re-run compilation to compile for the selected month
  apiFetch(`${API_BASE_URL}/attendance`).then(logs => {
    compileAttendanceData(logs);
    initAttendanceData();
    // Re-navigate to refresh view
    navigateTo('salary');
  });
}

function paySalary(empId) {
  const emp = employees.find(e => e.id === empId);
  if (!emp) return;
  const s = computeSalary(emp);
  
  // Format dates for display
  const todayVal = new Date().toISOString().split('T')[0];

  openModal(`
    <div class="modal-card" style="max-width: 450px; padding: 24px;">
      <h3 style="margin-top: 0; font-size: 20px; font-weight: 700; color: var(--text);">Pay Salary</h3>
      <p style="color: var(--text-muted); font-size: 14px; margin-bottom: 20px;">
        Register salary payment for <strong>${emp.firstName} ${emp.lastName}</strong>. This will set their payroll start date to the day after the selected cutoff, resetting their unpaid days to 0.
      </p>
      
      <div style="background: #f8fafc; padding: 16px; border-radius: 8px; margin-bottom: 20px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px;">
          <span>Days Worked:</span>
          <strong>${s.daysPresent} days</strong>
        </div>
        <div style="display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px;">
          <span>Net Salary:</span>
          <strong style="color: var(--primary); font-size: 16px;">${formatCurrency(s.net)}</strong>
        </div>
        <div style="display: flex; justify-content: space-between; font-size: 13px; color: var(--text-muted);">
          <span>Current Cycle:</span>
          <span>From ${emp.payrollStartDate || emp.joiningDate}</span>
        </div>
      </div>
      
      <div class="form-group" style="margin-bottom: 24px;">
        <label for="payment-cutoff-date" style="display: block; font-size: 13px; font-weight: 600; margin-bottom: 8px; color: var(--text);">Payment Cutoff Date</label>
        <input type="date" id="payment-cutoff-date" class="form-control" value="${todayVal}" style="width: 100%; box-sizing: border-box; height: 38px; border-radius: 6px; padding: 0 10px;">
      </div>
      
      <div style="display: flex; justify-content: flex-end; gap: 12px;">
        <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="submitSalaryPayment('${emp.id}', '${emp.firstName} ${emp.lastName}', '${emp.payrollStartDate || emp.joiningDate}', ${emp.salaryType === 'monthly' ? emp.monthlyRate : emp.hourlyRate}, ${s.daysPresent}, ${s.weeklyOffs || 0}, ${s.holidays || 0}, ${s.absentDays || 0}, ${s.totalEarnings}, ${s.totalDeductions}, ${s.net})">Confirm Payment</button>
      </div>
    </div>
  `);
}

async function submitSalaryPayment(empId, employeeName, startDate, baseSalary, daysPresent, weeklyOffs, holidays, absentDays, earnings, deductions, net) {
  const cutoffDate = document.getElementById('payment-cutoff-date').value;
  if (!cutoffDate) {
    showToast('Please select a payment cutoff date', 'error');
    return;
  }
  
  try {
    const res = await apiFetch(`${API_BASE_URL}/employees/${empId}/pay`, {
      method: 'POST',
      body: { 
        paymentDate: cutoffDate,
        employeeName,
        startDate,
        baseSalary,
        daysPresent,
        weeklyOffs,
        holidays,
        absentDays,
        earnings,
        deductions,
        net
      }
    });
    
    showToast(res.message, 'success');
    closeModal();
    
    // Reload database events and refresh view
    await loadAllData();
    navigateTo('salary');
  } catch (err) {
    showToast(err.message || 'Payment failed', 'error');
  }
}
