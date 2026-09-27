// Admin Control Center Logic for Iron Log
let currentAdminTab = 'metrics';
let currentRoleFilter = 'all';
let adminUsersCache = [];
let adminSearchTimer = null;
let pendingDeleteUserId = null;
let pendingDeleteTimer = null;

window.addEventListener('DOMContentLoaded', async () => {
  updateThemeIcon();
  fetchPublicAnnouncement().catch(() => {});

  const isSessionValid = await tryRefreshToken();
  if (!isSessionValid) {
    window.location.href = '/login.html?redirect=admin';
    return;
  }

  const isMasterOwner = ['amirghasemian1381@gmail.com', 'amirhusseinghasemian@outlook.com'].includes((currentUser.email || '').toLowerCase().trim());
  if (currentUser.role !== 'admin' && !isMasterOwner) {
    showToast('دسترسی به این بخش نیازمند دسترسی مدیریت (Admin) است.', 'error');
    setTimeout(() => { window.location.href = '/'; }, 1200);
    return;
  }

  switchAdminTab('metrics');
});

function switchAdminTab(tab) {
  currentAdminTab = tab;
  document.querySelectorAll('.admin-tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.atab === tab);
  });
  document.getElementById('adminTabMetrics').style.display = tab === 'metrics' ? 'block' : 'none';
  document.getElementById('adminTabUsers').style.display = tab === 'users' ? 'block' : 'none';
  document.getElementById('adminTabWorkouts').style.display = tab === 'workouts' ? 'block' : 'none';
  document.getElementById('adminTabLogs').style.display = tab === 'logs' ? 'block' : 'none';
  document.getElementById('adminTabEmail').style.display = tab === 'email' ? 'block' : 'none';

  if (tab === 'metrics') loadAdminMetrics();
  if (tab === 'users') loadAdminUsers();
  if (tab === 'workouts') loadAdminRecentWorkouts();
  if (tab === 'logs') {
    loadAdminAnnouncement();
    loadAdminSystemLogs();
  }
  if (tab === 'email') loadEmailConfig();
}

async function loadAdminMetrics() {
  try {
    const res = await apiFetch('/admin/metrics');
    const data = await parseResponseJson(res);
    if (!res.ok) throw new Error(data.message || 'خطا در دریافت آمار');

    document.getElementById('admMetricUsers').textContent = faDigits(data.metrics.totalUsers);
    document.getElementById('admMetricWorkouts').textContent = faDigits(data.metrics.totalWorkouts);
    document.getElementById('admMetricWeights').textContent = faDigits(data.metrics.totalBodyweights);
    document.getElementById('admMetricCustoms').textContent = faDigits(data.metrics.totalCustomExercises);

    // Role breakdown
    if (data.metrics.roleCounts) {
      document.getElementById('admRoleAdmins').textContent = faDigits(data.metrics.roleCounts.admin || 0);
      document.getElementById('admRoleCoaches').textContent = faDigits(data.metrics.roleCounts.coach || 0);
      document.getElementById('admRoleVips').textContent = faDigits(data.metrics.roleCounts.vip || 0);
      document.getElementById('admRoleUsers').textContent = faDigits(data.metrics.roleCounts.user || 0);
    }

    // Modes breakdown
    if (data.metrics.modeCounts) {
      document.getElementById('admModeDumbbell').textContent = `${faDigits(data.metrics.modeCounts.dumbbell || 0)} جلسه`;
      document.getElementById('admModeGym').textContent = `${faDigits(data.metrics.modeCounts.gym || 0)} جلسه`;
    }

    // Top exercises
    const topListEl = document.getElementById('admTopExercisesList');
    if (topListEl) {
      if (data.metrics.topExercises && data.metrics.topExercises.length > 0) {
        topListEl.innerHTML = data.metrics.topExercises.map((e, idx) => `
          <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px dashed var(--line);">
            <span>${idx + 1}. <b>${e.name}</b></span>
            <span style="color:var(--accent);font-weight:700;">${faDigits(e.count)} بار</span>
          </div>
        `).join('');
      } else {
        topListEl.innerHTML = '<span style="color:var(--muted)">هنوز تمرینی برای تحلیل ثبت نشده است.</span>';
      }
    }

    const uptimeMin = Math.round(data.system.uptimeSeconds / 60);
    document.getElementById('admSystemUptime').textContent = `Uptime: ${uptimeMin} min (${data.system.platform || 'linux'})`;
    document.getElementById('admMemoryText').textContent = `Node.js: ${data.system.nodeVersion || 'v20'} | مصرف RAM: ${data.system.memoryUsedMB} MB از ${data.system.memoryTotalMB} MB`;

    const dbBadge = document.getElementById('admDbBadge');
    const dbDesc = document.getElementById('admDbDesc');
    if (data.dbStatus.isPostgresConnected) {
      dbBadge.textContent = 'PostgreSQL متصل';
      dbBadge.className = 'admin-badge admin';
      dbDesc.textContent = 'دیتابیس ابری PostgreSQL متصل است و داده‌ها به طور دائمی ذخیره می‌شوند.';
    } else {
      dbBadge.textContent = 'موتور حافظه موقت (In-Memory)';
      dbBadge.className = 'admin-badge user';
      dbDesc.textContent = 'در حال اجرا بر روی موتور داده حافظه محلی با پایداری نشست.';
    }

    const emailBadge = document.getElementById('admEmailBadge');
    const emailDesc = document.getElementById('admEmailDesc');
    if (data.emailStatus.isConfigured) {
      emailBadge.textContent = 'سرویس زنده ' + (data.emailStatus.provider === 'google_gmail' ? 'جیمیل (Google Gmail)' : 'SMTP');
      emailBadge.className = 'admin-badge admin';
      emailDesc.textContent = `ارسال ایمیل‌های بازیابی از طریق ${data.emailStatus.senderEmail} فعال و تست‌شده است.`;
    } else {
      emailBadge.textContent = 'شبیه‌ساز پیش‌نمایش (Mock)';
      emailBadge.className = 'admin-badge user';
      emailDesc.textContent = 'سرویس ایمیل در حالت پیش‌نمایش است؛ کدها در کنسول نمایش داده می‌شوند.';
    }
  } catch (err) {
    console.warn('Admin metrics load error:', err);
  }
}

function filterUsersByRole(role) {
  currentRoleFilter = role;
  document.querySelectorAll('.admin-filter-pill').forEach(b => {
    b.classList.toggle('active', b.dataset.rfilter === role);
  });
  loadAdminUsers();
}

async function loadAdminUsers() {
  const q = document.getElementById('adminUserSearchInput')?.value.trim() || '';
  const tbody = document.getElementById('adminUsersTableBody');
  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:16px;color:var(--muted)">در حال دریافت کاربران...</td></tr>';

  try {
    const res = await apiFetch(`/admin/users?q=${encodeURIComponent(q)}&role=${encodeURIComponent(currentRoleFilter)}`);
    const data = await parseResponseJson(res);
    if (!res.ok) throw new Error(data.message || 'خطا در دریافت کاربران');
    adminUsersCache = data.users || [];

    renderAdminUsersTable();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:16px;color:var(--danger)">${err.message}</td></tr>`;
  }
}

function renderAdminUsersTable() {
  const tbody = document.getElementById('adminUsersTableBody');
  if (!tbody) return;

  if (!adminUsersCache || adminUsersCache.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:16px;color:var(--muted)">هیچ کاربری با این مشخصات یافت نشد.</td></tr>';
    return;
  }

  tbody.innerHTML = adminUsersCache.map(u => {
    const isSelf = currentUser && (currentUser.id === u.id || currentUser.email === u.email);
    const role = u.role || 'user';
    const roleMeta = {
      admin: { label: '👑 مدیر کل', cls: 'admin' },
      coach: { label: '🏋️ مربی', cls: 'coach' },
      vip: { label: '⭐ VIP', cls: 'vip' },
      user: { label: '👤 عادی', cls: 'user' }
    }[role] || { label: role, cls: 'user' };

    const joinDate = new Date(u.createdAt).toLocaleDateString('fa-IR', { year: 'numeric', month: 'short', day: 'numeric' });
    const lastActive = u.lastWorkoutDate 
      ? `<span style="font-size:10px;color:var(--ok);">آخرین ثبت: ${u.lastWorkoutDate}</span>` 
      : '<span style="font-size:10px;color:var(--muted);">هنوز تمرینی ندارد</span>';

    return `
      <tr id="user-row-${u.id}">
        <td>
          <div style="font-weight:700;color:var(--text);">${u.displayName || 'بی‌نام'} ${isSelf ? '<span style="font-size:10px;color:var(--accent);">(حساب شما)</span>' : ''}</div>
          <div style="font-size:11px;color:var(--muted);direction:ltr;text-align:right;font-family:monospace;">${u.email}</div>
        </td>
        <td>
          <span class="admin-badge ${roleMeta.cls}" id="badge-role-${u.id}">${roleMeta.label}</span>
        </td>
        <td>
          <!-- دکمه‌های تعاملی تغییر نقش کاربر -->
          <div class="role-btn-group" title="کلیک برای تغییر مستقیم نقش کاربر">
            <button type="button" class="role-pill-btn ${role === 'admin' ? 'active-admin' : ''}" 
              onclick="changeUserRole(${u.id}, 'admin')" title="تنظیم به مدیر">👑 مدیر</button>
            <button type="button" class="role-pill-btn ${role === 'coach' ? 'active-coach' : ''}" 
              onclick="changeUserRole(${u.id}, 'coach')" title="تنظیم به مربی">🏋️ مربی</button>
            <button type="button" class="role-pill-btn ${role === 'vip' ? 'active-vip' : ''}" 
              onclick="changeUserRole(${u.id}, 'vip')" title="تنظیم به کاربر ویژه VIP">⭐ VIP</button>
            <button type="button" class="role-pill-btn ${role === 'user' ? 'active-user' : ''}" 
              onclick="changeUserRole(${u.id}, 'user')" title="تنظیم به کاربر عادی">👤 عادی</button>
          </div>
        </td>
        <td>
          <div><b style="color:var(--accent);font-size:13px;">${faDigits(u.workoutCount)}</b> <span style="font-size:11px;color:var(--muted);">ست تمرین</span></div>
          <div>${lastActive}</div>
        </td>
        <td style="font-size:11px;color:var(--muted);white-space:nowrap;">
          ${joinDate}
        </td>
        <td>
          <div style="display:flex;gap:4px;flex-wrap:wrap;">
            <button type="button" class="btn" style="padding:3px 7px;font-size:10.5px;color:var(--accent);" onclick="openAdminUserDetails(${u.id})" title="مشاهده پرونده کامل و رکوردهای ورزشکار">
              👁️ پرونده
            </button>
            <button type="button" class="btn" style="padding:3px 7px;font-size:10.5px;color:var(--text);" onclick="openAdminUserResetModal(${u.id}, '${u.email}')" title="تغییر رمز عبور">
              🔑 رمز
            </button>
            ${!isSelf ? `
              <button type="button" class="delbtn" id="delBtn-${u.id}" style="padding:3px 7px;font-size:10.5px;" onclick="safeDeleteUserClick(${u.id}, '${u.email}')" title="حذف کاربر">
                🗑️
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function debounceAdminSearch() {
  if (adminSearchTimer) clearTimeout(adminSearchTimer);
  adminSearchTimer = setTimeout(() => {
    loadAdminUsers();
  }, 300);
}

async function changeUserRole(userId, newRole) {
  const target = adminUsersCache.find(u => Number(u.id) === Number(userId));
  const userEmail = target ? target.email : `کاربر #${userId}`;
  const roleNames = {
    admin: '👑 مدیر کل (Admin)',
    coach: '🏋️ مربی و آنالیزور (Coach)',
    vip: '⭐ کاربر ویژه (VIP)',
    user: '👤 کاربر عادی (User)'
  };

  const fb = document.getElementById('adminUsersFeedback');
  if (fb) {
    fb.innerHTML = `<div class="feedback" style="color:var(--accent);">⏳ در حال تغییر نقش ${userEmail} به ${roleNames[newRole]}...</div>`;
  }

  // Optimistic UI update
  if (target) target.role = newRole;
  if (currentUser && (Number(currentUser.id) === Number(userId) || (target && currentUser.email === target.email))) {
    currentUser.role = newRole;
    updateUserBar();
  }

  renderAdminUsersTable();

  try {
    const res = await apiFetch(`/admin/users/${userId}/role`, {
      method: 'PUT',
      body: JSON.stringify({ role: newRole })
    });
    const data = await parseResponseJson(res);
    if (!res.ok) throw new Error(data.message || 'خطا در تغییر نقش');

    if (fb) {
      fb.innerHTML = `<div class="feedback up">✅ نقش کاربر ${userEmail} با موفقیت به «${roleNames[newRole]}» تغییر یافت.</div>`;
      setTimeout(() => { if (fb.textContent.includes(userEmail)) fb.innerHTML = ''; }, 3500);
    }
    showToast(`نقش ${userEmail} به «${roleNames[newRole]}» تغییر یافت.`, 'success');

    await loadAdminMetrics();
  } catch (err) {
    if (fb) {
      fb.innerHTML = `<div class="feedback down">⚠️ خطا در تغییر نقش: ${err.message}</div>`;
    }
    showToast(`خطا در تغییر نقش: ${err.message}`, 'error');
    await loadAdminUsers();
  }
}

function safeDeleteUserClick(userId, userEmail) {
  const btn = document.getElementById(`delBtn-${userId}`);
  if (pendingDeleteUserId === userId) {
    clearTimeout(pendingDeleteTimer);
    pendingDeleteUserId = null;
    executeDeleteUser(userId, userEmail);
    return;
  }

  if (pendingDeleteTimer) clearTimeout(pendingDeleteTimer);
  if (pendingDeleteUserId) {
    const prevBtn = document.getElementById(`delBtn-${pendingDeleteUserId}`);
    if (prevBtn) {
      prevBtn.innerHTML = '🗑️';
      prevBtn.style.background = '';
    }
  }

  pendingDeleteUserId = userId;
  if (btn) {
    btn.innerHTML = '⚠️ تایید حذف؟';
    btn.style.background = '#e11d48';
    btn.style.color = '#fff';
  }

  pendingDeleteTimer = setTimeout(() => {
    pendingDeleteUserId = null;
    if (btn) {
      btn.innerHTML = '🗑️';
      btn.style.background = '';
      btn.style.color = '';
    }
  }, 4000);
}

async function executeDeleteUser(userId, userEmail) {
  const fb = document.getElementById('adminUsersFeedback');
  if (fb) {
    fb.innerHTML = `<div class="feedback" style="color:var(--muted);">در حال حذف کاربر ${userEmail}...</div>`;
  }

  try {
    const res = await apiFetch(`/admin/users/${userId}`, { method: 'DELETE' });
    const data = await parseResponseJson(res);
    if (!res.ok) throw new Error(data.message || 'خطا در حذف کاربر');

    if (fb) {
      fb.innerHTML = `<div class="feedback up">✅ ${data.message}</div>`;
      setTimeout(() => { fb.innerHTML = ''; }, 3000);
    }
    loadAdminUsers();
    loadAdminMetrics();
  } catch (err) {
    if (fb) {
      fb.innerHTML = `<div class="feedback down">⚠️ خطا: ${err.message}</div>`;
    }
  }
}

function openAdminCreateUserModal() {
  document.getElementById('admCreateName').value = '';
  document.getElementById('admCreateEmail').value = '';
  document.getElementById('admCreatePassword').value = '';
  document.getElementById('admCreateRole').value = 'user';
  document.getElementById('admCreateFeedback').innerHTML = '';
  document.getElementById('adminCreateUserModal').style.display = 'flex';
}

function closeAdminCreateUserModal() {
  document.getElementById('adminCreateUserModal').style.display = 'none';
}

async function submitAdminCreateUser() {
  const displayName = document.getElementById('admCreateName').value.trim();
  const email = document.getElementById('admCreateEmail').value.trim();
  const password = document.getElementById('admCreatePassword').value;
  const role = document.getElementById('admCreateRole').value;
  const fb = document.getElementById('admCreateFeedback');

  if (!email || !email.includes('@')) {
    fb.innerHTML = '<div class="feedback down">لطفاً یک ایمیل معتبر وارد کنید.</div>';
    return;
  }
  if (!password || password.length < 6) {
    fb.innerHTML = '<div class="feedback down">رمز عبور باید حداقل ۶ کاراکتر باشد.</div>';
    return;
  }

  fb.innerHTML = '<div class="feedback" style="color:var(--muted)">در حال ایجاد کاربر...</div>';

  try {
    const res = await apiFetch('/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email, password, displayName, role })
    });
    const data = await parseResponseJson(res);
    if (!res.ok) throw new Error(data.message || 'خطا در ایجاد کاربر');

    fb.innerHTML = `<div class="feedback up">${data.message}</div>`;
    setTimeout(() => {
      closeAdminCreateUserModal();
      loadAdminUsers();
      loadAdminMetrics();
    }, 1200);
  } catch (err) {
    fb.innerHTML = `<div class="feedback down">${err.message}</div>`;
  }
}

async function openAdminUserDetails(userId) {
  document.getElementById('adminUserDetailsModal').style.display = 'flex';
  const title = document.getElementById('admUserDetailTitle');
  const body = document.getElementById('admUserDetailBody');
  body.innerHTML = '<div style="text-align:center;padding:24px;color:var(--muted);">در حال دریافت اطلاعات پرونده...</div>';

  try {
    const res = await apiFetch(`/admin/users/${userId}/details`);
    const data = await parseResponseJson(res);
    if (!res.ok) throw new Error(data.message || 'خطا در دریافت پرونده کاربر');

    const u = data.user;
    title.textContent = `پرونده ورزشکار: ${u.displayName || u.email}`;

    const workouts = data.workouts || [];
    const bodyweights = data.bodyweights || [];
    const customs = data.customExercises || [];

    const workoutsHtml = workouts.length === 0 
      ? '<div style="color:var(--muted);font-size:12px;padding:8px 0;">هنوز تمرینی توسط این کاربر ثبت نشده است.</div>'
      : `
        <table class="admin-table" style="margin-top:8px;">
          <thead>
            <tr>
              <th>حرکت</th>
              <th>برنامه</th>
              <th>وزنه</th>
              <th>تکرارها</th>
              <th>تاریخ</th>
            </tr>
          </thead>
          <tbody>
            ${workouts.map(w => `
              <tr>
                <td><b>${w.exercise_name || w.exerciseName}</b></td>
                <td><span class="daytag" style="font-size:10px;">${w.program_mode === 'gym' ? 'باشگاه' : 'دمبل'}</span></td>
                <td style="color:var(--accent);font-weight:700;">${faDigits(w.weight_kg || w.weightKg)} kg</td>
                <td>${Array.isArray(w.reps) ? w.reps.join(' - ') : w.reps}</td>
                <td style="font-size:11px;color:var(--muted);">${w.log_date || w.logDate}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;

    const weightsHtml = bodyweights.length === 0
      ? '<div style="color:var(--muted);font-size:12px;padding:8px 0;">ثبت وزنی یافت نشد.</div>'
      : `
        <div style="display:flex;gap:6px;overflow-x:auto;padding:6px 0;">
          ${bodyweights.map(b => `
            <div style="background:var(--surface-2);border:1px solid var(--line);border-radius:6px;padding:6px 10px;text-align:center;flex-shrink:0;">
              <b style="color:var(--accent);font-size:13px;">${faDigits(b.weight_kg || b.weightKg)} kg</b>
              <div style="font-size:10px;color:var(--muted);margin-top:2px;">${b.log_date || b.logDate}</div>
            </div>
          `).join('')}
        </div>
      `;

    body.innerHTML = `
      <div style="background:var(--surface-2);border-radius:8px;padding:12px;border:1px solid var(--line);margin-bottom:14px;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-size:14px;font-weight:700;color:var(--text);">${u.displayName || 'بی‌نام'}</div>
            <div style="font-size:12px;color:var(--muted);direction:ltr;text-align:right;">${u.email}</div>
          </div>
          <span class="admin-badge ${u.role === 'admin' ? 'admin' : (u.role === 'coach' ? 'coach' : (u.role === 'vip' ? 'vip' : 'user'))}">
            ${u.role}
          </span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:8px;text-align:center;margin-top:12px;">
          <div style="background:var(--surface);padding:8px;border-radius:6px;">
            <div style="font-size:11px;color:var(--muted);">کل ست‌های تمرین</div>
            <b style="font-size:15px;color:var(--accent);">${faDigits(workouts.length)}</b>
          </div>
          <div style="background:var(--surface);padding:8px;border-radius:6px;">
            <div style="font-size:11px;color:var(--muted);">ثبت‌های وزن بدن</div>
            <b style="font-size:15px;color:var(--ok);">${faDigits(bodyweights.length)}</b>
          </div>
          <div style="background:var(--surface);padding:8px;border-radius:6px;">
            <div style="font-size:11px;color:var(--muted);">حرکات شخصی</div>
            <b style="font-size:15px;color:#a855f7;">${faDigits(customs.length)}</b>
          </div>
        </div>
      </div>

      <div style="margin-bottom:14px;">
        <div style="font-size:12.5px;font-weight:700;color:var(--text);margin-bottom:4px;">⚖️ تاریخچه اخیر وزن بدن</div>
        ${weightsHtml}
      </div>

      <div>
        <div style="font-size:12.5px;font-weight:700;color:var(--text);margin-bottom:4px;">🏋️ آخرین جلسات تمرینی ورزشکار</div>
        ${workoutsHtml}
      </div>
    `;
  } catch (err) {
    body.innerHTML = `<div class="feedback down">${err.message}</div>`;
  }
}

function closeAdminUserDetailsModal() {
  document.getElementById('adminUserDetailsModal').style.display = 'none';
}

function exportAdminUsersCsv() {
  if (!adminUsersCache || adminUsersCache.length === 0) {
    alert('کاربری برای خروجی وجود ندارد.');
    return;
  }

  let csv = '\uFEFFشناسه,نام کاربر,ایمیل,نقش,تعداد تمرینات,تعداد ثبت وزن,آخرین تاریخ تمرین,تاریخ عضویت\n';
  adminUsersCache.forEach(u => {
    csv += `"${u.id}","${u.displayName || ''}","${u.email}","${u.role}","${u.workoutCount}","${u.bodyweightCount}","${u.lastWorkoutDate || ''}","${u.createdAt}"\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ironlog-users-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ---------------- خوراک زنده تمرینات سراسر پلتفرم ---------------- */
async function loadAdminRecentWorkouts() {
  const tbody = document.getElementById('adminWorkoutsTableBody');
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:16px;color:var(--muted)">در حال دریافت تمرینات...</td></tr>';

  try {
    const res = await apiFetch('/admin/recent-workouts');
    const data = await parseResponseJson(res);
    if (!res.ok) throw new Error(data.message || 'خطا در دریافت تمرینات');

    const workouts = data.workouts || [];
    if (workouts.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:16px;color:var(--muted)">هنوز تمرینی در سامانه ثبت نشده است.</td></tr>';
      return;
    }

    tbody.innerHTML = workouts.map(w => {
      const modeLabel = w.program_mode === 'gym' ? 'باشگاه' : 'دمبل خانگی';
      const repsStr = Array.isArray(w.reps) ? w.reps.join(' - ') : (w.reps || '—');
      const rirStr = Array.isArray(w.rir) ? w.rir.join(' - ') : (w.rir || '—');
      return `
        <tr>
          <td>
            <b style="color:var(--text);font-size:12px;">${w.user_display_name || 'کاربر'}</b>
            <div style="font-size:10px;color:var(--muted);direction:ltr;text-align:right;">${w.user_email || ''}</div>
          </td>
          <td><span class="daytag" style="font-size:10px;">${modeLabel}</span></td>
          <td><b>${w.exercise_name}</b></td>
          <td style="color:var(--accent);font-weight:700;">${faDigits(w.weight_kg)} kg</td>
          <td>${faDigits(repsStr)}</td>
          <td style="color:var(--muted);">${faDigits(rirStr)}</td>
          <td style="font-size:11px;color:var(--muted);white-space:nowrap;">${w.log_date}</td>
          <td style="font-size:11px;color:var(--muted);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${w.notes || '—'}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:16px;color:var(--danger)">${err.message}</td></tr>`;
  }
}

/* ---------------- اعلان سراسری و لاگ سیستم ---------------- */
async function loadAdminAnnouncement() {
  try {
    const res = await apiFetch('/admin/announcement');
    const data = await parseResponseJson(res);
    if (res.ok && data.announcement) {
      document.getElementById('admAnnounceEnabled').checked = Boolean(data.announcement.enabled);
      document.getElementById('admAnnounceMessage').value = data.announcement.message || '';
      document.getElementById('admAnnounceLevel').value = data.announcement.level || 'info';
    }
  } catch (e) {
    console.warn('loadAdminAnnouncement error:', e);
  }
}

async function saveAdminAnnouncement() {
  const enabled = document.getElementById('admAnnounceEnabled').checked;
  const message = document.getElementById('admAnnounceMessage').value.trim();
  const level = document.getElementById('admAnnounceLevel').value;
  const fb = document.getElementById('admAnnounceFeedback');

  fb.textContent = 'در حال ذخیره...';
  fb.style.color = 'var(--muted)';

  try {
    const res = await apiFetch('/admin/announcement', {
      method: 'PUT',
      body: JSON.stringify({ enabled, message, level })
    });
    const data = await parseResponseJson(res);
    if (!res.ok) throw new Error(data.message || 'خطا در ذخیره اعلان');

    fb.textContent = '✅ اعلان با موفقیت ذخیره و منتشر شد.';
    fb.style.color = 'var(--ok)';
    applyAnnouncementBanner(data.announcement);
    setTimeout(() => { fb.textContent = ''; }, 2500);
  } catch (err) {
    fb.textContent = '⚠️ ' + err.message;
    fb.style.color = 'var(--danger)';
  }
}

async function loadAdminSystemLogs() {
  const tbody = document.getElementById('adminLogsTableBody');
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--muted)">در حال دریافت لاگ‌ها...</td></tr>';

  try {
    const res = await apiFetch('/admin/system-logs');
    const data = await parseResponseJson(res);
    if (!res.ok) throw new Error(data.message || 'خطا در دریافت لاگ‌ها');

    const logs = data.logs || [];
    if (logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--muted)">هیچ لاگی ثبت نشده است.</td></tr>';
      return;
    }

    tbody.innerHTML = logs.map(l => {
      const timeStr = new Date(l.timestamp).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const dateStr = new Date(l.timestamp).toLocaleDateString('fa-IR');
      return `
        <tr>
          <td><span class="daytag" style="font-size:10px;">${l.type}</span></td>
          <td style="font-weight:700;color:var(--text);">${l.action}</td>
          <td style="font-size:11.5px;color:var(--muted);">${l.details}</td>
          <td style="font-size:11px;color:var(--accent);">${l.user || 'مدیر'}</td>
          <td style="font-size:11px;color:var(--muted);direction:ltr;white-space:nowrap;">${dateStr} ${timeStr}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--danger)">${err.message}</td></tr>`;
  }
}

function openAdminUserResetModal(userId, userEmail) {
  document.getElementById('admResetTargetUserId').value = userId;
  document.getElementById('admResetTargetLabel').textContent = userEmail;
  document.getElementById('admResetTargetNewPassword').value = '';
  document.getElementById('admResetFeedback').innerHTML = '';
  document.getElementById('adminUserResetModal').style.display = 'flex';
}

function closeAdminUserResetModal() {
  document.getElementById('adminUserResetModal').style.display = 'none';
}

async function submitAdminUserReset() {
  const userId = document.getElementById('admResetTargetUserId').value;
  const newPassword = document.getElementById('admResetTargetNewPassword').value;
  const fb = document.getElementById('admResetFeedback');

  if (!newPassword || newPassword.length < 6) {
    fb.innerHTML = '<div class="feedback down">رمز عبور جدید باید حداقل ۶ کاراکتر باشد.</div>';
    return;
  }

  fb.innerHTML = '<div class="feedback" style="color:var(--muted)">در حال تنظیم رمز...</div>';

  try {
    const res = await apiFetch(`/admin/users/${userId}/reset-password`, {
      method: 'PUT',
      body: JSON.stringify({ newPassword })
    });
    const data = await parseResponseJson(res);
    if (!res.ok) throw new Error(data.message || 'خطا در تغییر رمز');

    fb.innerHTML = `<div class="feedback up">${data.message}</div>`;
    setTimeout(() => {
      closeAdminUserResetModal();
    }, 1500);
  } catch (err) {
    fb.innerHTML = `<div class="feedback down">${err.message}</div>`;
  }
}

async function loadEmailConfig() {
  try {
    const res = await apiFetch('/admin/email-config');
    const data = await parseResponseJson(res);
    if (res.ok && data) {
      if (!document.getElementById('admTestEmailTarget').value && currentUser) {
        document.getElementById('admTestEmailTarget').value = currentUser.email;
      }
    }
  } catch (e) {
    console.warn('loadEmailConfig error:', e);
  }
}

async function submitTestEmail() {
  const targetEmail = document.getElementById('admTestEmailTarget').value.trim();
  const resultBox = document.getElementById('admTestEmailResult');

  if (!targetEmail) {
    resultBox.innerHTML = '<div class="feedback down">لطفاً ایمیل مقصد را وارد کنید.</div>';
    return;
  }

  resultBox.innerHTML = '<div class="feedback" style="color:var(--muted)">در حال اتصال به سرور و ارسال ایمیل تستی...</div>';

  try {
    const res = await apiFetch('/admin/test-email', {
      method: 'POST',
      body: JSON.stringify({ targetEmail })
    });
    const data = await parseResponseJson(res);
    if (!res.ok) {
      throw new Error(data.message || `خطای سرور (${res.status}) در ارسال ایمیل آزمایشی.`);
    }

    resultBox.innerHTML = `<div class="feedback up">✅ ${data.message}</div>`;
  } catch (err) {
    resultBox.innerHTML = `<div class="feedback down">⚠️ ${err.message}</div>`;
  }
}
