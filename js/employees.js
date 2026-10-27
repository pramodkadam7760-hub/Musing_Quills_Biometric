/* ===== Employee Registry View (Enhanced) ===== */

function renderEmployees(container) {
  container.innerHTML = `
    <div class="view-header">
      <div class="view-header-left">
        <h2>Employee Registry</h2>
        <p>Manage your complete employee roster</p>
      </div>
      <div class="view-header-actions">
        <div class="search-box">
          <i class="ti ti-search"></i>
          <input type="text" id="emp-search" placeholder="Search by name, department, ID..." oninput="filterEmployees()">
        </div>
        <button class="btn btn-primary" onclick="openEmployeeModal()">
          <i class="ti ti-user-plus"></i> Add Employee
        </button>
      </div>
    </div>

    <div class="table-panel">
      <div class="table-panel-header">
        <span class="table-panel-title"><i class="ti ti-users" style="margin-right:6px;color:var(--primary);vertical-align:middle;"></i>All Employees (${employees.length})</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Employee ID</th>
              <th>Name</th>
              <th>Department</th>
              <th>Designation</th>
              <th>Lifecycle</th>
              <th>Shift</th>
              <th>Salary Type</th>
              <th>Rate</th>
              <th>Leaves</th>
              <th>Biometric</th>
              <th>Documents</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="emp-tbody">
            ${renderEmployeeRows(employees)}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderEmployeeRows(emps) {
  if (emps.length === 0) {
    return `<tr><td colspan="12"><div class="empty-state"><i class="ti ti-search-off"></i><h4>No employees found</h4><p>Try a different search or add a new employee</p></div></td></tr>`;
  }

  return emps.map(emp => {
    const s = computeSalary(emp);
    const color = getAvatarColor(emp.id);
    const initials = getInitials(emp.firstName, emp.lastName);
    const rate = emp.salaryType === 'monthly' ? formatCurrency(emp.monthlyRate) + '/mo' : formatCurrency(emp.hourlyRate) + '/hr';
    const salaryChip = emp.salaryType === 'monthly'
      ? '<span class="chip primary">Monthly</span>'
      : '<span class="chip warning">Hourly</span>';
    const bioChip = emp.enrolled
      ? '<span class="chip success"><span class="chip-dot success"></span>Enrolled</span>'
      : '<span class="chip danger"><span class="chip-dot danger"></span>Pending</span>';

    const lifecycleStatus = emp.lifecycleStatus || 'Confirmed';
    let lifecycleChip = '';
    if (lifecycleStatus === 'Probation') {
      lifecycleChip = '<span class="chip warning">Probation</span>';
    } else if (lifecycleStatus === 'Confirmed') {
      lifecycleChip = '<span class="chip success">Confirmed</span>';
    } else if (lifecycleStatus === 'Notice Period') {
      lifecycleChip = '<span class="chip info">Notice Period</span>';
    } else if (lifecycleStatus === 'Exited') {
      lifecycleChip = '<span class="chip danger">Exited</span>';
    }

    let docChip = '';
    if (!emp.documentCount || emp.documentCount === 0) {
      docChip = '<span class="chip danger"><span class="chip-dot danger"></span>None</span>';
    } else {
      if (emp.hasRejectedDocuments) {
        docChip = `<span class="chip danger"><span class="chip-dot danger"></span>Rejected (${emp.documentCount})</span>`;
      } else if (emp.hasPendingDocuments) {
        docChip = `<span class="chip warning"><span class="chip-dot warning"></span>Pending (${emp.documentCount})</span>`;
      } else {
        docChip = `<span class="chip success"><span class="chip-dot success"></span>Verified (${emp.documentCount})</span>`;
      }
    }

    return `
      <tr>
        <td><code class="mono">${emp.id}</code></td>
        <td>
          <div class="employee-cell">
            <div class="avatar" style="background:${color}">${initials}</div>
            <div class="employee-cell-info">
              <span class="employee-cell-name">${emp.firstName} ${emp.lastName}</span>
              <span class="employee-cell-email">${emp.email}</span>
            </div>
          </div>
        </td>
        <td><span class="chip ${getDeptClass(emp.department)}">${emp.department}</span></td>
        <td>${emp.designation || emp.role}</td>
        <td>${lifecycleChip}</td>
        <td><span class="mono" style="font-size:11px;">${format24to12(emp.shiftStart)} – ${format24to12(emp.shiftEnd)}</span></td>
        <td>${salaryChip}</td>
        <td><span class="mono">${rate}</span></td>
        <td><span class="chip info">${s.leavesTaken} / ${getPaidLeaveAllowance(emp)}</span></td>
        <td>${bioChip}</td>
        <td>${docChip}</td>
        <td>
          <div style="display:flex;gap:4px;">
            <button class="btn-icon" title="View" onclick="viewEmployee('${emp.id}')"><i class="ti ti-eye"></i></button>
            <button class="btn-icon" title="Edit" onclick="openEmployeeModal('${emp.id}')"><i class="ti ti-pencil"></i></button>
            <button class="btn-icon danger" title="Delete" onclick="deleteEmployee('${emp.id}')"><i class="ti ti-trash"></i></button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function filterEmployees() {
  const query = document.getElementById('emp-search').value.toLowerCase();
  const filtered = employees.filter(emp =>
    `${emp.firstName} ${emp.lastName}`.toLowerCase().includes(query) ||
    emp.id.toLowerCase().includes(query) ||
    emp.department.toLowerCase().includes(query) ||
    emp.role.toLowerCase().includes(query) ||
    (emp.designation || '').toLowerCase().includes(query)
  );
  document.getElementById('emp-tbody').innerHTML = renderEmployeeRows(filtered);
}

// ---- Add / Edit Employee Modal (Enhanced) ----
function openEmployeeModal(editId) {
  const isEdit = !!editId;
  const emp = isEdit ? employees.find(e => e.id === editId) : null;
  const empId = isEdit ? editId : `EMP-${DEPT_PREFIXES[DEPARTMENTS[0]] || 'GEN'}-${nextIdNum}`;

  const title = isEdit ? 'Edit Employee' : 'Add New Employee';
  const subtitle = isEdit ? `Editing ${emp.firstName} ${emp.lastName} (${emp.id})` : `Fill in the details to add a new employee (${empId})`;
  const btnLabel = isEdit ? 'Save Changes' : 'Add Employee';
  const salaryType = emp ? emp.salaryType : 'monthly';

  const eighteenYearsAgo = new Date();
  eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);
  const dobMax = eighteenYearsAgo.toISOString().split('T')[0];

  const content = `
    <div class="modal-header">
      <div class="modal-header-text">
        <h3>${title}</h3>
        <p>${subtitle}</p>
      </div>
      <button class="modal-close" onclick="closeModal()"><i class="ti ti-x"></i></button>
    </div>
    
    <div class="report-tabs" style="margin-bottom:0; border:none; border-bottom:1px solid var(--border); border-radius:0; padding:0 24px; background:transparent;">
      <button type="button" class="tab-btn active" onclick="switchEmpTab('profile')" id="etab-profile">Profile Info</button>
      <button type="button" class="tab-btn" onclick="switchEmpTab('lifecycle')" id="etab-lifecycle">Lifecycle</button>
      <button type="button" class="tab-btn" onclick="switchEmpTab('documents')" id="etab-documents">Documents <span class="chip primary" style="padding: 1px 6px; font-size: 10px; margin-left: 4px;" id="doc-tab-badge">0</span></button>
    </div>

    <div class="modal-body" style="padding-top:20px;">
      <form id="emp-form" data-emp-id="${empId}" data-is-edit="${isEdit}" onsubmit="saveEmployee(event)">
        
        <!-- === PROFILE TAB === -->
        <div id="emp-sec-profile" class="emp-section active">
          <div class="form-section-title"><i class="ti ti-user"></i> Personal Information</div>
          <div class="form-row">
          <div class="form-group">
            <label class="form-label">First Name <span class="required">*</span></label>
            <input type="text" class="form-input" id="f-firstName" value="${emp ? emp.firstName : ''}" required>
          </div>
          <div class="form-group">
            <label class="form-label">Last Name <span class="required">*</span></label>
            <input type="text" class="form-input" id="f-lastName" value="${emp ? emp.lastName : ''}" required>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Email <span class="required">*</span></label>
            <input type="email" class="form-input" id="f-email" value="${emp ? emp.email : ''}" required>
          </div>
          <div class="form-group">
            <label class="form-label">Phone</label>
            <input type="tel" class="form-input" id="f-phone" value="${emp ? emp.phone : ''}" placeholder="9876543210">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group" style="width: 50%;">
            <label class="form-label">Date of Birth</label>
            <input type="date" class="form-input" id="f-dateOfBirth" value="${emp ? (emp.dateOfBirth || '') : ''}" max="${dobMax}">
          </div>
        </div>

        <!-- Work Details -->
        <div class="form-section-title" style="margin-top:20px"><i class="ti ti-briefcase"></i> Work Details</div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Department <span class="required">*</span></label>
            <select class="form-select" id="f-department" required>
              ${DEPARTMENTS.map(d => `<option value="${d}" ${emp && emp.department === d ? 'selected' : ''}>${d}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Role <span class="required">*</span></label>
            <input type="text" class="form-input" id="f-role" value="${emp ? emp.role : ''}" required placeholder="e.g. Senior Developer">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Designation <span class="required">*</span></label>
            <input type="text" class="form-input" id="f-designation" value="${emp ? emp.designation || '' : ''}" required placeholder="e.g. Senior Software Engineer">
          </div>
          <div class="form-group">
            <label class="form-label">Reporting Manager</label>
            <input type="text" class="form-input" id="f-reportingManager" value="${emp ? emp.reportingManager || '' : ''}" placeholder="e.g. Vikram Singh">
          </div>
        </div>

        <!-- Shift Timing -->
        <div class="form-section-title" style="margin-top:20px"><i class="ti ti-clock"></i> Shift Timing</div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Shift Start <span class="required">*</span></label>
            <input type="time" class="form-input" id="f-shiftStart" value="${emp ? emp.shiftStart : '10:00'}" required>
          </div>
          <div class="form-group">
            <label class="form-label">Shift End <span class="required">*</span></label>
            <input type="time" class="form-input" id="f-shiftEnd" value="${emp ? emp.shiftEnd : '17:00'}" required>
          </div>
        </div>

        <!-- Compensation -->
        <div class="form-section-title" style="margin-top:20px"><i class="ti ti-cash"></i> Compensation</div>
        <div class="form-group">
          <label class="form-label">Salary Type</label>
          <div class="toggle-group">
            <button type="button" class="toggle-option ${salaryType === 'monthly' ? 'active' : ''}" onclick="toggleSalaryType('monthly')">Monthly</button>
            <button type="button" class="toggle-option ${salaryType === 'hourly' ? 'active' : ''}" onclick="toggleSalaryType('hourly')">Hourly</button>
          </div>
          <input type="hidden" id="f-salaryType" value="${salaryType}">
        </div>
        <div class="form-row">
          <div class="form-group" id="fg-monthly" style="${salaryType === 'hourly' ? 'display:none' : ''}">
            <label class="form-label">Monthly Rate (₹) <span class="required">*</span></label>
            <input type="number" class="form-input" id="f-monthlyRate" value="${emp ? emp.monthlyRate : ''}" min="0" step="any" placeholder="e.g. 65000">
          </div>
          <div class="form-group" id="fg-hourly" style="${salaryType === 'monthly' ? 'display:none' : ''}">
            <label class="form-label">Hourly Rate (₹) <span class="required">*</span></label>
            <input type="number" class="form-input" id="f-hourlyRate" value="${emp ? emp.hourlyRate : ''}" min="0" step="any" placeholder="e.g. 450">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Variable Pay / Bonus (₹)</label>
            <input type="number" class="form-input" id="f-bonus" value="${emp ? (emp.bonus || 0) : 0}" min="0" step="any" placeholder="e.g. 5000">
          </div>
        </div>

        <!-- Biometric Option & Leaves -->
        <div class="form-section-title" style="margin-top:20px"><i class="ti ti-fingerprint"></i> Tracking & Biometrics</div>
        <div class="form-row" style="display: flex; gap: 12px; margin-bottom: 12px;">
          <div class="form-group" style="flex: 1;">
            <label class="form-label">Leaves Taken (This Month)</label>
            <input type="number" class="form-input" id="f-leavesTaken" value="${emp ? (emp.leavesTaken || 0) : 0}" min="0" max="31" step="0.5">
            <div style="font-size:10px; color:var(--text-muted); margin-top:4px;" id="f-leavesTaken-hint">
              Paid limit: ${getPaidLeaveAllowance(emp)} leaves/month.
            </div>
          </div>
          <div class="form-group" style="flex: 1; ${LEAVE_SETTINGS.carryForward ? '' : 'display:none;'}">
            <label class="form-label">Carried Forward Leaves</label>
            <input type="number" class="form-input" id="f-carriedForwardLeaves" value="${emp ? (emp.carriedForwardLeaves || 0) : 0}" min="0" max="${LEAVE_SETTINGS.carryForwardMax}" step="0.5">
            <div style="font-size:10px; color:var(--text-muted); margin-top:4px;">Max CF: ${LEAVE_SETTINGS.carryForwardMax} days.</div>
          </div>
          <div class="form-group" style="flex: 1; display: flex; align-items: flex-end; padding-bottom: 10px;">
            <div class="form-check">
              <input type="checkbox" id="f-enrolled" ${(!emp || emp.enrolled) ? 'checked' : ''}>
              <label for="f-enrolled" style="font-weight: 500; font-size: 13px;">Biometric Enrolled</label>
            </div>
          </div>
        </div>
        </div>

        <!-- === LIFECYCLE TAB === -->
        <div id="emp-sec-lifecycle" class="emp-section" style="display:none;">
          <div class="form-section-title"><i class="ti ti-timeline"></i> Employment Lifecycle</div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Status <span class="required">*</span></label>
              <select class="form-select" id="f-lifecycleStatus" onchange="updateLifecycleUI()">
                <option value="Probation" ${emp && emp.lifecycleStatus === 'Probation' ? 'selected' : ''}>Probation</option>
                <option value="Confirmed" ${!emp || emp.lifecycleStatus === 'Confirmed' ? 'selected' : ''}>Confirmed</option>
                <option value="Notice Period" ${emp && emp.lifecycleStatus === 'Notice Period' ? 'selected' : ''}>Notice Period</option>
                <option value="Exited" ${emp && emp.lifecycleStatus === 'Exited' ? 'selected' : ''}>Exited</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Joining Date <span class="required">*</span></label>
              <input type="date" class="form-input" id="f-joiningDate" value="${emp ? (emp.joiningDate || '') : getTodayDate()}" onchange="updateLifecycleUI()" required>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group" style="flex: 1;">
              <label class="form-label">Probation Duration <span class="required">*</span></label>
              <div style="display: flex; gap: 8px;">
                <input type="number" class="form-input" id="f-probationMonths" value="${emp ? (emp.probationMonths ?? 6) : 6}" min="0" oninput="updateLifecycleUI()" style="flex: 1;" placeholder="e.g. 6">
                <select class="form-select" id="f-probationUnit" onchange="updateLifecycleUI()" style="width: 110px;">
                  <option value="months" ${(!emp || emp.probationUnit === 'months' || !emp.probationUnit) ? 'selected' : ''}>Months</option>
                  <option value="weeks" ${emp && emp.probationUnit === 'weeks' ? 'selected' : ''}>Weeks</option>
                </select>
              </div>
            </div>
            <div class="form-group" style="flex: 1;">
              <label class="form-label">Probation End Date</label>
              <input type="date" class="form-input" id="f-probationEndDate" readonly style="background-color: var(--bg-hover);">
            </div>
          </div>

          <div class="form-row" id="row-confirmation" style="display:none;">
            <div class="form-group">
              <label class="form-label">Confirmation Date <span class="required">*</span></label>
              <input type="date" class="form-input" id="f-confirmationDate" value="${emp ? (emp.confirmationDate || '') : ''}" onchange="updateLifecycleUI()">
            </div>
          </div>

          <div class="form-row" id="row-notice" style="display:none;">
            <div class="form-group">
              <label class="form-label">Notice Period End Date <span class="required">*</span></label>
              <input type="date" class="form-input" id="f-noticePeriodEndDate" value="${emp ? (emp.noticePeriodEndDate || '') : ''}" onchange="updateLifecycleUI()">
            </div>
          </div>

          <div class="form-row" id="row-exit" style="display:none;">
            <div class="form-group">
              <label class="form-label">Exit Date <span class="required">*</span></label>
              <input type="date" class="form-input" id="f-exitDate" value="${emp ? (emp.exitDate || '') : ''}" onchange="updateLifecycleUI()">
            </div>
            <div class="form-group">
              <label class="form-label">Exit Reason</label>
              <input type="text" class="form-input" id="f-exitReason" value="${emp ? (emp.exitReason || '') : ''}" placeholder="e.g. Resigned / Personal reasons">
            </div>
          </div>

          <div class="form-section-title" style="margin-top:24px"><i class="ti ti-git-commit"></i> Visual Timeline</div>
          <div id="lifecycle-timeline-container" style="margin-top:16px; margin-bottom:16px;"></div>
        </div>

        <!-- === DOCUMENTS TAB === -->
        <div id="emp-sec-documents" class="emp-section" style="display:none;">
          <div class="form-section-title"><i class="ti ti-files"></i> Employee Documents</div>
          <p class="text-muted text-sm" style="margin-bottom:16px;">Upload KYC and HR documents. Only PDFs and Images allowed.</p>
          
          ${isEdit ? `
          <div class="form-group">
            <div style="display:flex; gap:12px; align-items:center; margin-bottom:16px;">
              <select class="form-select" id="doc-type" style="width:200px;">
                <option value="Aadhaar">Aadhaar Card</option>
                <option value="PAN">PAN Card</option>
                <option value="Offer Letter">Offer Letter</option>
                <option value="Resume">Resume</option>
                <option value="Experience Letter">Experience Letter</option>
                <option value="Salary Slip">Salary Slip</option>
                <option value="Bank Details">Bank Details</option>
                <option value="Other">Other Document</option>
              </select>
              <input type="file" id="doc-file" class="form-input" style="flex:1;" accept="image/*,application/pdf">
              <button type="button" class="btn btn-primary" onclick="uploadDocument()">
                <i class="ti ti-upload"></i> Upload
              </button>
            </div>
          </div>
          ` : `
          <div style="text-align: center; padding: 30px 20px; border: 1px dashed var(--border); border-radius: var(--r); background: var(--bg-hover); margin-bottom: 16px;">
            <i class="ti ti-info-circle" style="font-size: 24px; color: var(--primary); margin-bottom: 8px; display: block;"></i>
            <div style="font-weight: 500; font-size: 13px; color: var(--text-secondary);">KYC and HR documents can be uploaded after the employee is added.</div>
            <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Once the employee registry profile is created, edit the employee to upload records.</div>
          </div>
          `}

          <div id="doc-grid-container" class="doc-grid">
            <!-- Rendered dynamically -->
          </div>
        </div>

      </form>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="document.getElementById('emp-form').requestSubmit()">
        <i class="ti ${isEdit ? 'ti-device-floppy' : 'ti-user-plus'}"></i> ${btnLabel}
      </button>
    </div>
  `;

  openModal(content);

  // Set up dynamic ID generation / migration on department change
  const deptSelect = document.getElementById('f-department');
  if (deptSelect) {
    deptSelect.addEventListener('change', function() {
      const form = document.getElementById('emp-form');
      const isEditVal = form.dataset.isEdit === 'true';
      if (isEditVal) return;

      const dept = this.value;
      const oldId = form.dataset.empId;
      const prefix = DEPT_PREFIXES[dept] || 'GEN';
      const newId = `EMP-${prefix}-${nextIdNum}`;

      if (oldId !== newId) {
        if (employeeDocuments[oldId]) {
          employeeDocuments[newId] = employeeDocuments[oldId];
          delete employeeDocuments[oldId];
          safelyPersistDocuments();
        }
        form.dataset.empId = newId;
        const subtitleEl = document.querySelector('.modal-header-text p');
        if (subtitleEl) {
          subtitleEl.textContent = `Fill in the details to add a new employee (${newId})`;
        }
        
        const docCount = (employeeDocuments[newId] || []).length;
        const badge = document.getElementById('doc-tab-badge');
        if (badge) badge.textContent = docCount;
        
        if (document.getElementById('etab-documents').classList.contains('active')) {
          renderEmployeeDocuments(newId);
        }
      }
    });
  }

  const docCount = (employeeDocuments[empId] || []).length;
  const badge = document.getElementById('doc-tab-badge');
  if (badge) badge.textContent = docCount;
  
  updateLifecycleUI();
}

function toggleSalaryType(type) {
  document.getElementById('f-salaryType').value = type;
  document.querySelectorAll('.toggle-option').forEach(btn => {
    btn.classList.toggle('active', btn.textContent.trim().toLowerCase() === type);
  });
  document.getElementById('fg-monthly').style.display = type === 'monthly' ? '' : 'none';
  document.getElementById('fg-hourly').style.display = type === 'hourly' ? '' : 'none';
}

async function saveEmployee(e) {
  e.preventDefault();

  const form = document.getElementById('emp-form');
  const empId = form.dataset.empId;
  const isEdit = form.dataset.isEdit === 'true';

  const salaryType = document.getElementById('f-salaryType').value;
  const firstName = document.getElementById('f-firstName').value.trim();
  const lastName = document.getElementById('f-lastName').value.trim();
  const email = document.getElementById('f-email').value.trim();
  const phone = document.getElementById('f-phone').value.trim();
  const department = document.getElementById('f-department').value;
  const role = document.getElementById('f-role').value.trim();
  const designation = document.getElementById('f-designation').value.trim();
  const reportingManager = document.getElementById('f-reportingManager').value.trim();
  const shiftStart = document.getElementById('f-shiftStart').value;
  const shiftEnd = document.getElementById('f-shiftEnd').value;
  const monthlyRate = parseInt(document.getElementById('f-monthlyRate').value) || 0;
  const hourlyRate = parseInt(document.getElementById('f-hourlyRate').value) || 0;
  const bonus = parseInt(document.getElementById('f-bonus').value) || 0;
  const leavesTaken = parseFloat(document.getElementById('f-leavesTaken').value) || 0;
  const carriedForwardLeaves = LEAVE_SETTINGS.carryForward ? (parseFloat(document.getElementById('f-carriedForwardLeaves').value) || 0) : 0;
  const enrolled = document.getElementById('f-enrolled').checked;
  const lifecycleStatus = document.getElementById('f-lifecycleStatus').value;
  const joiningDate = document.getElementById('f-joiningDate').value;
  const dateOfBirth = document.getElementById('f-dateOfBirth').value;
  
  const probationMonths = parseInt(document.getElementById('f-probationMonths')?.value) || 0;
  const probationUnit = document.getElementById('f-probationUnit')?.value || 'months';
  const probationEndDate = document.getElementById('f-probationEndDate')?.value || null;
  const confirmationDate = document.getElementById('f-confirmationDate')?.value || null;
  const noticePeriodEndDate = document.getElementById('f-noticePeriodEndDate')?.value || null;
  const exitDate = document.getElementById('f-exitDate')?.value || null;
  const exitReason = document.getElementById('f-exitReason')?.value || '';

  if (dateOfBirth) {
    const dob = new Date(dateOfBirth);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const m = today.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) {
      age--;
    }
    if (age < 18) {
      showToast('Employee must be at least 18 years old to join', 'error');
      return;
    }
  }

  if (!firstName || !lastName || !email || !department || !role || !designation) {
    showToast('Please fill in all required fields', 'error');
    return;
  }
  if (salaryType === 'monthly' && monthlyRate <= 0) {
    showToast('Monthly rate must be greater than 0', 'error');
    return;
  }
  if (salaryType === 'hourly' && hourlyRate <= 0) {
    showToast('Hourly rate must be greater than 0', 'error');
    return;
  }

  // Settings validations & warnings
  if (leavesTaken > LEAVE_SETTINGS.monthlyLimit) {
    showToast(`Warning: Leaves taken (${leavesTaken}) exceeds monthly limit of ${LEAVE_SETTINGS.monthlyLimit}`, 'warning');
  }
  if (carriedForwardLeaves > LEAVE_SETTINGS.carryForwardMax) {
    showToast(`Warning: Carried forward leaves (${carriedForwardLeaves}) exceeds carry forward limit of ${LEAVE_SETTINGS.carryForwardMax}`, 'warning');
  }

  const payload = {
    id: empId,
    firstName, lastName, email, phone, department, role, designation, reportingManager,
    shiftStart: shiftStart || '10:00', shiftEnd: shiftEnd || '17:00',
    salaryType, monthlyRate, hourlyRate, bonus, leavesTaken, carriedForwardLeaves, enrolled,
    lifecycleStatus, joiningDate, dateOfBirth: dateOfBirth || null,
    probationMonths, probationUnit, probationEndDate, confirmationDate, noticePeriodEndDate, exitDate, exitReason
  };

  try {
    if (isEdit) {
      await apiFetch(`${API_BASE_URL}/employees/${empId}`, {
        method: 'PUT',
        body: payload
      });
      showToast('Employee Details Updated', 'success');
    } else {
      await apiFetch(`${API_BASE_URL}/employees`, {
        method: 'POST',
        body: payload
      });
      showToast('Employee Added Successfully', 'success');
      
      nextIdNum++;
      localStorage.setItem('NEXT_ID_NUM', nextIdNum.toString());
    }

    closeModal();
    await loadAllData();
    renderEmployees(document.getElementById('app'));
  } catch (err) {
    showToast(err.message || 'Failed to save employee', 'error');
  }
}

// ---- View Employee Modal (Redesigned Tabbed Layout) ----
async function viewEmployee(empId) {
  const emp = employees.find(e => e.id === empId);
  if (!emp) return;

  const salary = computeSalary(emp);
  const color = getAvatarColor(emp.id);
  const initials = getInitials(emp.firstName, emp.lastName);
  const rate = emp.salaryType === 'monthly' ? formatCurrency(emp.monthlyRate) + '/month' : formatCurrency(emp.hourlyRate) + '/hour';
  const att = todayAtt[emp.id] || {};
  let todayStatus = 'Absent';
  if (att.in && att.out) todayStatus = 'Checked Out';
  else if (att.in) todayStatus = 'Present';

  const lateCount = getLateCount(emp.id);
  const isHabitual = isHabitualLatecomer(emp.id);

  // Load documents dynamically from server
  let docs = [];
  try {
    docs = await apiFetch(`${API_BASE_URL}/documents/employee/${empId}`);
  } catch (err) {
    console.error('Failed to load employee documents:', err);
  }

  // Generate visual timeline html
  const lifecycleStatus = emp.lifecycleStatus || 'Confirmed';
  const joinDate = emp.joiningDate || '—';
  
  // probation end date calculation
  let probEndDateStr = emp.probationEndDate || '';
  if (!probEndDateStr && joinDate && emp.probationMonths) {
    probEndDateStr = calcProbationEndDate(joinDate, emp.probationMonths, emp.probationUnit);
  }

  const confDate = emp.confirmationDate || '';
  const noticeDate = emp.noticePeriodEndDate || '';
  const exitDate = emp.exitDate || '';

  let endMilestoneLabel = 'Notice/Exit';
  let endMilestoneDate = '';
  let endMilestoneClass = '';
  
  if (lifecycleStatus === 'Notice Period') {
    endMilestoneLabel = 'Notice Period';
    endMilestoneDate = noticeDate;
    endMilestoneClass = 'active danger';
  } else if (lifecycleStatus === 'Exited') {
    endMilestoneLabel = 'Exited';
    endMilestoneDate = exitDate;
    endMilestoneClass = 'active danger';
  }

  let timelineProgress = '#cbd5e1';
  let probationDotContent = '';
  let confirmationDotContent = '';
  let endDotContent = '';

  if (lifecycleStatus === 'Probation') {
    timelineProgress = 'linear-gradient(90deg, var(--success) 0%, var(--success) 17%, var(--primary) 50%, #cbd5e1 50%, #cbd5e1 100%)';
    probationDotContent = '<i class="ti ti-clock-hour-4" style="color: #fff;"></i>';
  } else if (lifecycleStatus === 'Confirmed') {
    timelineProgress = 'linear-gradient(90deg, var(--success) 0%, var(--success) 50%, var(--primary) 100%)';
    probationDotContent = '<i class="ti ti-check"></i>';
    confirmationDotContent = '<i class="ti ti-award" style="color: #fff;"></i>';
  } else if (lifecycleStatus === 'Notice Period' || lifecycleStatus === 'Exited') {
    const endColor = lifecycleStatus === 'Notice Period' ? 'var(--primary)' : 'var(--danger)';
    timelineProgress = `linear-gradient(90deg, var(--success) 0%, var(--success) 66%, ${endColor} 100%)`;
    probationDotContent = '<i class="ti ti-check"></i>';
    confirmationDotContent = '<i class="ti ti-check"></i>';
    endDotContent = lifecycleStatus === 'Notice Period' 
      ? '<i class="ti ti-alert-triangle" style="color: #fff;"></i>' 
      : '<i class="ti ti-logout" style="color: #fff;"></i>';
  }

  const timelineHtml = `
    <div class="lifecycle-timeline" style="margin-top: 24px; margin-bottom: 24px; --timeline-progress: ${timelineProgress};">
      <div class="timeline-step completed">
        <div class="step-dot"><i class="ti ti-check"></i></div>
        <div class="step-label">Joined</div>
        <div class="step-date">${joinDate}</div>
      </div>
      <div class="timeline-step ${lifecycleStatus === 'Probation' ? 'active' : (lifecycleStatus === 'Confirmed' || lifecycleStatus === 'Notice Period' || lifecycleStatus === 'Exited' ? 'completed' : '')}">
        <div class="step-dot">${probationDotContent}</div>
        <div class="step-label">Probation End</div>
        <div class="step-date">${probEndDateStr || '—'}</div>
      </div>
      <div class="timeline-step ${lifecycleStatus === 'Confirmed' ? 'active' : (lifecycleStatus === 'Notice Period' || lifecycleStatus === 'Exited' ? 'completed' : '')}">
        <div class="step-dot">${confirmationDotContent}</div>
        <div class="step-label">Confirmed</div>
        <div class="step-date">${confDate || '—'}</div>
      </div>
      ${lifecycleStatus === 'Notice Period' || lifecycleStatus === 'Exited' ? `
      <div class="timeline-step ${endMilestoneClass}">
        <div class="step-dot">${endDotContent}</div>
        <div class="step-label">${endMilestoneLabel}</div>
        <div class="step-date">${endMilestoneDate || '—'}</div>
      </div>
      ` : ''}
    </div>
  `;

  // Generate document grid html
  let docsHtml = '';
  if (docs.length === 0) {
    docsHtml = `
      <div style="text-align: center; padding: 40px 20px; border: 1px dashed var(--border); border-radius: var(--r); background: var(--bg); width: 100%;">
        <i class="ti ti-files" style="font-size: 32px; color: var(--text-muted); margin-bottom: 8px; display: block;"></i>
        <div style="font-weight: 500; font-size: 13px; color: var(--text-secondary);">No documents uploaded yet</div>
        <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">KYC and HR documents can be uploaded in Edit mode.</div>
      </div>
    `;
  } else {
    docsHtml = `
      <div class="doc-grid">
        ${docs.map(doc => {
          const isPdf = doc.file_name?.toLowerCase().endsWith('.pdf');
          const icon = isPdf ? 'ti-file-text' : 'ti-photo';
          const statusClass = doc.status === 'Verified' ? 'success' : (doc.status === 'Rejected' ? 'danger' : 'warning');
          return `
            <div class="doc-card" style="padding: 12px; min-height: 120px;">

              <i class="ti ${icon} doc-card-icon" style="font-size: 20px; margin-bottom: 8px;"></i>
              <div class="doc-card-title" style="font-size: 12px;" title="${doc.file_name}">${doc.file_name}</div>
              <div class="doc-card-meta" style="font-size: 10px; margin-bottom: 8px;">${doc.type} • Uploaded ${doc.upload_date ? doc.upload_date.split('T')[0] : '—'}</div>
              <div class="doc-card-actions" style="padding-top: 8px; margin-top: auto; display: flex; gap: 4px; justify-content: space-between;">
                <button type="button" class="btn btn-sm" style="font-size: 10.5px; padding: 4px 8px; flex: 1; background: var(--primary-subtle); color: var(--primary); border: 1px solid rgba(99,102,241,0.2);" onclick="previewDocument('${doc.file_path}')">
                  <i class="ti ti-eye"></i> Preview
                </button>

              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  const content = `
    <div class="modal-header">
      <div class="modal-header-text">
        <h3>Employee Details</h3>
        <p>${emp.firstName} ${emp.lastName} • ${emp.id}</p>
      </div>
      <button class="modal-close" onclick="closeModal()"><i class="ti ti-x"></i></button>
    </div>

    <div class="report-tabs" style="margin-bottom:0; border:none; border-bottom:1px solid var(--border); border-radius:0; padding:0 24px; background:transparent;">
      <button type="button" class="tab-btn active view-tab-btn" onclick="switchViewEmpTab('profile')" id="vetab-profile">Profile Info</button>
      <button type="button" class="tab-btn view-tab-btn" onclick="switchViewEmpTab('lifecycle')" id="vetab-lifecycle">Lifecycle</button>
      <button type="button" class="tab-btn view-tab-btn" onclick="switchViewEmpTab('documents')" id="vetab-documents">Documents <span class="chip primary" style="padding: 1px 6px; font-size: 10px; margin-left: 4px;" id="view-doc-tab-badge">${docs.length}</span></button>
    </div>

    <div class="modal-body" style="padding-top:20px;">
      
      <!-- === PROFILE TAB === -->
      <div id="view-emp-sec-profile" class="view-emp-section">
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px;">
          <div class="avatar xl" style="background:${color}">${initials}</div>
          <div>
            <div style="font-size:18px;font-weight:700;">
              ${emp.firstName} ${emp.lastName}
              ${isHabitual ? '<span class="chip danger" style="font-size:9px;padding:1px 6px;margin-left:6px"><i class="ti ti-alarm" style="font-size:10px;margin-right:2px"></i>Habitual Late</span>' : ''}
            </div>
            <div style="font-size:13px;color:var(--text-secondary);margin-top:2px;">${emp.designation || emp.role}</div>
            <div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap;">
              <span class="chip ${getDeptClass(emp.department)}">${emp.department}</span>
              ${emp.enrolled ? '<span class="chip success"><span class="chip-dot success"></span>Enrolled</span>' : '<span class="chip danger"><span class="chip-dot danger"></span>Pending</span>'}
            </div>
          </div>
        </div>

        <div class="detail-grid" style="background:var(--surface); border:1px solid var(--border); border-radius:var(--r); padding:20px; box-shadow:var(--shadow-sm); margin-bottom:20px;">
          <div class="detail-item"><span class="detail-label">Employee ID</span><span class="detail-value mono" style="color:var(--text); font-weight:600;">${emp.id}</span></div>
          <div class="detail-item"><span class="detail-label">Email</span><span class="detail-value" style="color:var(--text); font-weight:600;">${emp.email}</span></div>
          <div class="detail-item"><span class="detail-label">Phone</span><span class="detail-value" style="color:var(--text); font-weight:600;">${emp.phone || '—'}</span></div>
          <div class="detail-item"><span class="detail-label">Date of Birth</span><span class="detail-value" style="color:var(--text); font-weight:600;">${emp.dateOfBirth || '—'}</span></div>
          <div class="detail-item"><span class="detail-label">Joining Date</span><span class="detail-value" style="color:var(--text); font-weight:600;">${emp.joiningDate || '—'}</span></div>
          <div class="detail-item"><span class="detail-label">Designation</span><span class="detail-value" style="color:var(--text); font-weight:600;">${emp.designation || '—'}</span></div>
          <div class="detail-item"><span class="detail-label">Reporting Manager</span><span class="detail-value" style="color:var(--text); font-weight:600;">${emp.reportingManager || '—'}</span></div>
          <div class="detail-item"><span class="detail-label">Shift Timing</span><span class="detail-value" style="color:var(--text); font-weight:600;">${format24to12(emp.shiftStart)} – ${format24to12(emp.shiftEnd)}</span></div>
          <div class="detail-item"><span class="detail-label">Salary Type</span><span class="detail-value" style="color:var(--text); font-weight:600;">${emp.salaryType === 'monthly' ? 'Monthly' : 'Hourly'} — ${rate}</span></div>
          <div class="detail-item"><span class="detail-label">Today's Status</span><span class="detail-value" style="color:var(--text); font-weight:600;">${todayStatus}</span></div>
          <div class="detail-item"><span class="detail-label">Leaves Taken</span><span class="detail-value" style="color:var(--text); font-weight:600;">${salary.leavesTaken} / ${getPaidLeaveAllowance(emp)}</span></div>
          <div class="detail-item"><span class="detail-label">Late Marks</span><span class="detail-value ${isHabitual ? 'text-danger' : ''}" style="font-weight:600;">${lateCount} ${isHabitual ? '⚠ Habitual' : lateCount > 0 ? '' : '✓ Clean'}</span></div>
        </div>

        <!-- Current Month Salary (Detailed) -->
        <div class="detail-section" style="border-top:none; margin-top:0;">
          <div class="detail-section-title" style="margin-bottom:8px;">Salary Breakdown — ${getCurrentMonth()}</div>
          <div class="salary-breakdown-card" style="display:flex; flex-direction:column; gap:6px; background:var(--surface); border:1px solid var(--border); border-radius:var(--r); padding:18px; box-shadow:var(--shadow-sm);">
            <div class="salary-section-title earnings" style="margin-top:0"><i class="ti ti-trending-up"></i> Earnings</div>
            <div class="salary-row"><span class="salary-row-label">Basic Pay</span><span class="salary-row-value" style="color:var(--text); font-weight:600;">${formatCurrency(salary.basicPay)}</span></div>
            ${salary.overtime > 0 ? `<div class="salary-row"><span class="salary-row-label">Overtime</span><span class="salary-row-value bonus">+${formatCurrency(salary.overtime)}</span></div>` : ''}
            <div class="salary-row subtotal"><span class="salary-row-label">Total Earnings</span><span class="salary-row-value" style="color:var(--text); font-weight:600;">${formatCurrency(salary.totalEarnings)}</span></div>

            ${salary.totalDeductions > 0 ? `<div class="salary-section-title deductions"><i class="ti ti-trending-down"></i> Deductions</div>` : ''}
            ${salary.unpaidLeaveDeduction > 0 ? `<div class="salary-row deduction-row"><span class="salary-row-label"><i class="ti ti-calendar-off" style="margin-right:4px;color:var(--danger)"></i>Unpaid Leaves (${salary.excessLeaves} days)</span><span class="salary-row-value deduction penalty">−${formatCurrency(salary.unpaidLeaveDeduction)}</span></div>` : ''}
            ${salary.latePenalty > 0 ? `<div class="salary-row late-penalty-row"><span class="salary-row-label"><i class="ti ti-alarm" style="margin-right:4px;color:var(--danger)"></i>Late Penalty (${salary.lateCount} × ₹${LATE_PENALTY.penaltyPerLate})</span><span class="salary-row-value deduction penalty">−${formatCurrency(salary.latePenalty)}</span></div>` : ''}
            ${salary.totalDeductions > 0 ? `<div class="salary-row subtotal deduction-total"><span class="salary-row-label">Total Deductions</span><span class="salary-row-value deduction">−${formatCurrency(salary.totalDeductions)}</span></div>` : ''}

            <div class="salary-row total" style="border-top:1px solid var(--border); margin-top:6px; padding-top:12px;"><span class="salary-row-label" style="font-size:14px; font-weight:700; color:var(--text);"><i class="ti ti-cash" style="margin-right:4px"></i>Net Salary</span><span class="salary-row-value" style="font-size:16px; font-weight:800; color:var(--primary);">${formatCurrency(salary.net)}</span></div>
          </div>
        </div>
      </div>

      <!-- === LIFECYCLE TAB === -->
      <div id="view-emp-sec-lifecycle" class="view-emp-section" style="display:none;">
        <div class="detail-section" style="margin-top:0; border-top:none;">
          <div class="detail-section-title"><i class="ti ti-timeline"></i> Lifecycle Milestones</div>
          <div style="display:flex; align-items:center; gap:12px; margin-bottom:20px; padding:14px 18px; background:var(--surface); border:2px solid var(--border); border-radius:var(--r); box-shadow:var(--shadow-sm);">
            <i class="ti ti-activity" style="font-size:22px; color:var(--primary);"></i>
            <span style="font-weight:700; font-size:15px; color:var(--text);">Current Status:</span>
            <span class="chip ${
              lifecycleStatus === 'Probation' ? 'warning' :
              lifecycleStatus === 'Confirmed' ? 'success' :
              lifecycleStatus === 'Notice Period' ? 'primary' : 'danger'
            }" style="font-size: 12px; padding: 4px 14px; font-weight:700;">${lifecycleStatus}</span>
          </div>
          
          <div class="lifecycle-info-grid">
            <div class="info-item">
              <span class="info-label"><i class="ti ti-calendar-event" style="margin-right:4px; font-size:12px;"></i> Joined Date</span>
              <span class="info-value">${joinDate}</span>
            </div>
            ${lifecycleStatus === 'Probation' ? `
            <div class="info-item">
              <span class="info-label"><i class="ti ti-hourglass" style="margin-right:4px; font-size:12px;"></i> Probation Period</span>
              <span class="info-value">${emp.probationMonths ?? 6} Months</span>
            </div>
            <div class="info-item">
              <span class="info-label"><i class="ti ti-calendar-due" style="margin-right:4px; font-size:12px;"></i> Probation End Date</span>
              <span class="info-value">${probEndDateStr || '—'}</span>
            </div>` : ''}
            ${lifecycleStatus === 'Confirmed' ? `
            <div class="info-item">
              <span class="info-label"><i class="ti ti-calendar-check" style="margin-right:4px; font-size:12px;"></i> Confirmation Date</span>
              <span class="info-value">${confDate || '—'}</span>
            </div>` : ''}
            ${lifecycleStatus === 'Notice Period' || lifecycleStatus === 'Exited' ? `
            <div class="info-item">
              <span class="info-label"><i class="ti ti-calendar-check" style="margin-right:4px; font-size:12px;"></i> Confirmation Date</span>
              <span class="info-value">${confDate || '—'}</span>
            </div>
            <div class="info-item">
              <span class="info-label"><i class="ti ti-calendar-x" style="margin-right:4px; font-size:12px;"></i> Exit Date</span>
              <span class="info-value">${exitDate || '—'}</span>
            </div>
            <div class="info-item" style="grid-column: 1 / -1;">
              <span class="info-label"><i class="ti ti-info-circle" style="margin-right:4px; font-size:12px;"></i> Reason for Exit</span>
              <span class="info-value">${emp.exitReason || '—'}</span>
            </div>` : ''}
          </div>

          ${timelineHtml}
        </div>
      </div>

      <!-- === DOCUMENTS TAB === -->
      <div id="view-emp-sec-documents" class="view-emp-section" style="display:none;">
        <div class="detail-section" style="margin-top:0; border-top:none;">
          <div class="detail-section-title"><i class="ti ti-files"></i> Uploaded Documents (${docs.length})</div>
          ${docsHtml}
        </div>
      </div>

    </div>

    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Close</button>
      <button class="btn btn-primary" onclick="closeModal();openEmployeeModal('${emp.id}')">
        <i class="ti ti-pencil"></i> Edit Employee
      </button>
    </div>
  `;

  openModal(content);
}

// ---- Delete Employee ----
async function deleteEmployee(empId) {
  const emp = employees.find(e => e.id === empId);
  if (!emp) return;
  if (!confirm(`Delete ${emp.firstName} ${emp.lastName}? This action cannot be undone.`)) return;

  try {
    await apiFetch(`${API_BASE_URL}/employees/${empId}`, {
      method: 'DELETE'
    });
    showToast(`${emp.firstName} ${emp.lastName} has been removed`, 'error');
    await loadAllData();
    renderEmployees(document.getElementById('app'));
  } catch (err) {
    showToast(err.message || 'Failed to delete employee', 'error');
  }
}

// ===== Employee Modal Tabs =====
function switchEmpTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  const btn = document.getElementById('etab-' + tabId);
  if (btn) btn.classList.add('active');

  document.querySelectorAll('.emp-section').forEach(sec => sec.style.display = 'none');
  const sec = document.getElementById('emp-sec-' + tabId);
  if (sec) sec.style.display = 'block';

  if (tabId === 'documents') {
    const form = document.getElementById('emp-form');
    if (form && form.dataset.isEdit === 'true' && form.dataset.empId) {
      renderEmployeeDocuments(form.dataset.empId);
    }
  }
}

function calcProbationEndDate(joinDateStr, durationVal, unitVal) {
  if (!joinDateStr) return '';
  const duration = parseInt(durationVal);
  if (isNaN(duration) || duration < 0) return '';
  const unit = unitVal || 'months';

  try {
    const jDate = new Date(joinDateStr);
    if (isNaN(jDate.getTime())) return '';

    if (unit === 'weeks') {
      jDate.setDate(jDate.getDate() + duration * 7);
    } else {
      const startDay = jDate.getDate();
      jDate.setMonth(jDate.getMonth() + duration);
      if (jDate.getDate() < startDay) {
        jDate.setDate(0);
      }
    }

    if (!isNaN(jDate.getTime())) {
      const year = jDate.getFullYear();
      if (year >= 1000 && year <= 9999) {
        return jDate.toISOString().split('T')[0];
      }
    }
  } catch (err) {
    console.error('Error calculating probation end date:', err);
  }
  return '';
}

function updateLifecycleUI() {
  const statusEl = document.getElementById('f-lifecycleStatus');
  if (!statusEl) return;
  const status = statusEl.value;
  const joinDate = document.getElementById('f-joiningDate')?.value || '';
  const duration = document.getElementById('f-probationMonths')?.value || 0;
  const unit = document.getElementById('f-probationUnit')?.value || 'months';

  const probEndInput = document.getElementById('f-probationEndDate');
  const probEndDateStr = calcProbationEndDate(joinDate, duration, unit);
  if (probEndInput) {
    probEndInput.value = probEndDateStr;
  }

  const rowConfirmation = document.getElementById('row-confirmation');
  const rowNotice = document.getElementById('row-notice');
  const rowExit = document.getElementById('row-exit');
  
  if (rowConfirmation) rowConfirmation.style.display = (status === 'Confirmed') ? 'flex' : 'none';
  if (rowNotice) rowNotice.style.display = (status === 'Notice Period') ? 'flex' : 'none';
  if (rowExit) rowExit.style.display = (status === 'Exited') ? 'flex' : 'none';

  // Auto-default milestone dates if empty when switching status
  const confDateInput = document.getElementById('f-confirmationDate');
  if (status === 'Confirmed' && confDateInput && !confDateInput.value) {
    confDateInput.value = probEndDateStr || joinDate || getTodayDate();
  }

  const noticeDateInput = document.getElementById('f-noticePeriodEndDate');
  if (status === 'Notice Period' && noticeDateInput && !noticeDateInput.value) {
    noticeDateInput.value = getTodayDate();
  }

  const exitDateInput = document.getElementById('f-exitDate');
  if (status === 'Exited' && exitDateInput && !exitDateInput.value) {
    exitDateInput.value = getTodayDate();
  }

  const timelineContainer = document.getElementById('lifecycle-timeline-container');
  if (timelineContainer) {
    const confDate = document.getElementById('f-confirmationDate')?.value || '';
    const noticeDate = document.getElementById('f-noticePeriodEndDate')?.value || '';
    const exitDate = document.getElementById('f-exitDate')?.value || '';
    
    let endMilestoneLabel = 'Notice/Exit';
    let endMilestoneDate = '';
    let endMilestoneClass = '';
    
    if (status === 'Notice Period') {
      endMilestoneLabel = 'Notice Period';
      endMilestoneDate = noticeDate;
      endMilestoneClass = 'active danger';
    } else if (status === 'Exited') {
      endMilestoneLabel = 'Exited';
      endMilestoneDate = exitDate;
      endMilestoneClass = 'active danger';
    }

    let timelineProgress = '#cbd5e1';
    let probationDotContent = '';
    let confirmationDotContent = '';
    let endDotContent = '';

    if (status === 'Probation') {
      timelineProgress = 'linear-gradient(90deg, var(--success) 0%, var(--success) 17%, var(--primary) 50%, #cbd5e1 50%, #cbd5e1 100%)';
      probationDotContent = '<i class="ti ti-clock-hour-4" style="color: #fff;"></i>';
    } else if (status === 'Confirmed') {
      timelineProgress = 'linear-gradient(90deg, var(--success) 0%, var(--success) 50%, var(--primary) 100%)';
      probationDotContent = '<i class="ti ti-check"></i>';
      confirmationDotContent = '<i class="ti ti-award" style="color: #fff;"></i>';
    } else if (status === 'Notice Period' || status === 'Exited') {
      const endColor = status === 'Notice Period' ? 'var(--primary)' : 'var(--danger)';
      timelineProgress = `linear-gradient(90deg, var(--success) 0%, var(--success) 66%, ${endColor} 100%)`;
      probationDotContent = '<i class="ti ti-check"></i>';
      confirmationDotContent = '<i class="ti ti-check"></i>';
      endDotContent = status === 'Notice Period' 
        ? '<i class="ti ti-alert-triangle" style="color: #fff;"></i>' 
        : '<i class="ti ti-logout" style="color: #fff;"></i>';
    }

    timelineContainer.innerHTML = `
      <div class="lifecycle-timeline" style="--timeline-progress: ${timelineProgress};">
        <div class="timeline-step completed">
          <div class="step-dot"><i class="ti ti-check"></i></div>
          <div class="step-label">Joined</div>
          <div class="step-date">${joinDate || 'Pending'}</div>
        </div>
        <div class="timeline-step ${status === 'Probation' ? 'active' : (status === 'Confirmed' || status === 'Notice Period' || status === 'Exited' ? 'completed' : '')}">
          <div class="step-dot">${probationDotContent}</div>
          <div class="step-label">Probation End</div>
          <div class="step-date">${probEndDateStr || 'Pending'}</div>
        </div>
        <div class="timeline-step ${status === 'Confirmed' ? 'active' : (status === 'Notice Period' || status === 'Exited' ? 'completed' : '')}">
          <div class="step-dot">${confirmationDotContent}</div>
          <div class="step-label">Confirmed</div>
          <div class="step-date">${confDate || 'Pending'}</div>
        </div>
        ${status === 'Notice Period' || status === 'Exited' ? `
        <div class="timeline-step ${endMilestoneClass}">
          <div class="step-dot">${endDotContent}</div>
          <div class="step-label">${endMilestoneLabel}</div>
          <div class="step-date">${endMilestoneDate || 'Pending'}</div>
        </div>
        ` : ''}
      </div>
    `;
  }
}

async function renderEmployeeDocuments(empId) {
  const container = document.getElementById('doc-grid-container');
  const badge = document.getElementById('doc-tab-badge');
  if (!container) return;
  if (!empId || empId === 'undefined' || empId === 'null') {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px 20px; border: 1px dashed var(--border); border-radius: var(--r); background: var(--bg); width: 100%;">
        <i class="ti ti-info-circle" style="font-size: 32px; color: var(--primary); margin-bottom: 8px; display: block;"></i>
        <div style="font-weight: 500; font-size: 13px; color: var(--text-secondary);">Save the employee first to manage documents.</div>
      </div>
    `;
    if (badge) badge.textContent = '0';
    return;
  }

  try {
    const docs = await apiFetch(`${API_BASE_URL}/documents/employee/${empId}`);
    if (badge) {
      badge.textContent = docs.length;
    }

    if (docs.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 40px 20px; border: 1px dashed var(--border); border-radius: var(--r); background: var(--bg); width: 100%;">
          <i class="ti ti-files" style="font-size: 32px; color: var(--text-muted); margin-bottom: 8px; display: block;"></i>
          <div style="font-weight: 500; font-size: 13px; color: var(--text-secondary);">No documents uploaded yet</div>
          <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">Upload KYC, Offer Letter, or other records above.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = docs.map(doc => {
      const isPdf = doc.file_name?.toLowerCase().endsWith('.pdf');
      const icon = isPdf ? 'ti-file-text' : 'ti-photo';
      const statusClass = doc.status === 'Verified' ? 'success' : (doc.status === 'Rejected' ? 'danger' : 'warning');
      
      return `
        <div class="doc-card">

          <i class="ti ${icon} doc-card-icon"></i>
          <div class="doc-card-title" title="${doc.file_name}">${doc.file_name}</div>
          <div class="doc-card-meta">${doc.type} • Uploaded on ${doc.upload_date ? doc.upload_date.split('T')[0] : '—'}</div>
          <div class="doc-card-actions">
            <button type="button" class="btn btn-sm" style="flex:1; font-size: 10.5px; padding: 4px 8px; background: var(--primary-subtle); color: var(--primary); border: 1px solid rgba(99,102,241,0.2);" onclick="previewDocument('${doc.file_path}')">
              <i class="ti ti-eye"></i> Preview
            </button>

            <button type="button" class="btn btn-sm" style="font-size: 10.5px; padding: 4px 8px; color: var(--danger); background: var(--danger-subtle); border: 1px solid rgba(239,68,68,0.2);" onclick="deleteDocument('${empId}', ${doc.id})" title="Delete Document">
              <i class="ti ti-trash"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Failed to load employee documents:', err);
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px 20px; border: 1px dashed var(--danger); border-radius: var(--r); background: var(--danger-subtle); width: 100%;">
        <i class="ti ti-alert-triangle" style="font-size: 32px; color: var(--danger); margin-bottom: 8px; display: block;"></i>
        <div style="font-weight: 500; font-size: 13px; color: var(--danger);">Failed to load documents</div>
        <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">${err.message || 'Unknown error'}</div>
      </div>
    `;
  }
}

async function uploadDocument() {
  const fileInput = document.getElementById('doc-file');
  const type = document.getElementById('doc-type').value;
  const form = document.getElementById('emp-form');
  if (!form) return;
  const empId = form.dataset.empId;

  if (!fileInput.files.length) {
    showToast('Please select a file to upload', 'error');
    return;
  }

  const file = fileInput.files[0];
  const formData = new FormData();
  formData.append('file', file);
  formData.append('employee_id', empId);
  formData.append('type', type);

  try {
    await apiFetch(`${API_BASE_URL}/documents/upload`, {
      method: 'POST',
      body: formData
    });
    fileInput.value = '';
    showToast(`${type} uploaded successfully`, 'success');
    await renderEmployeeDocuments(empId);
    await loadAllData();
  } catch (err) {
    showToast(err.message || 'Upload failed', 'error');
  }
}

async function deleteDocument(empId, docId) {
  if (!confirm(`Are you sure you want to delete this document?`)) return;

  try {
    await apiFetch(`${API_BASE_URL}/documents/${docId}`, {
      method: 'DELETE'
    });
    showToast('Document deleted', 'success');
    await renderEmployeeDocuments(empId);
    await loadAllData();
  } catch (err) {
    showToast(err.message || 'Failed to delete document', 'error');
  }
}

async function verifyDocument(empId, docId, newStatus) {
  try {
    await apiFetch(`${API_BASE_URL}/documents/${docId}/status`, {
      method: 'PATCH',
      body: { status: newStatus }
    });
    showToast(`Document status updated to ${newStatus}`, 'success');
    await renderEmployeeDocuments(empId);
    await loadAllData();
  } catch (err) {
    showToast(err.message || 'Verification failed', 'error');
  }
}

function previewDocument(filePath) {
  const fileUrl = `${API_BASE_URL.replace('/api', '')}/${filePath}`;
  const win = window.open(fileUrl, '_blank');
  if (!win) {
    showToast('Pop-up blocked. Please allow pop-ups to preview documents.', 'error');
  }
}

function switchViewEmpTab(tabId) {
  document.querySelectorAll('.view-tab-btn').forEach(btn => btn.classList.remove('active'));
  const btn = document.getElementById('vetab-' + tabId);
  if (btn) btn.classList.add('active');

  document.querySelectorAll('.view-emp-section').forEach(sec => sec.style.display = 'none');
  const sec = document.getElementById('view-emp-sec-' + tabId);
  if (sec) sec.style.display = 'block';
}

async function verifyDocumentInView(empId, docId, newStatus) {
  try {
    await apiFetch(`${API_BASE_URL}/documents/${docId}/status`, {
      method: 'PATCH',
      body: { status: newStatus }
    });
    showToast(`Document status updated to ${newStatus}`, 'success');
    closeModal();
    await viewEmployee(empId);
    switchViewEmpTab('documents');
    await loadAllData();
    renderEmployees(document.getElementById('app'));
  } catch (err) {
    showToast(err.message || 'Verification failed', 'error');
  }
}

