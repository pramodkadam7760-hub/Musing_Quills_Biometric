/* ===== Salary Breakdown View (Basic Pay + Late Penalty) ===== */

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
  `;
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
        <p>This is a computer-generated document. No signature is required.</p>
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
