// Shared Frontend Utilities and Authentication State for Iron Log
const AUTH_API_URL = '';
let currentAccessToken = null;
let currentUser = null;
let tokenExpiresAt = 0;
let refreshPromise = null;

function parseUserNumber(val) {
  if (val === null || val === undefined) return null;
  let s = String(val).trim();
  if (!s) return null;
  s = s.replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
       .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧۸۹'.indexOf(d))
       .replace(/٫/g, '.')
       .replace(/,/g, '.');
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function faDigits(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
}

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

if (typeof window !== 'undefined') {
  window.escapeHtml = escapeHtml;
  window.escapeHTML = escapeHtml;
}

async function parseResponseJson(res) {
  try {
    return await res.json();
  } catch (err) {
    return { message: 'پاسخ نامعتبر از سرور' };
  }
}

async function apiFetch(url, options = {}) {
  options.headers = options.headers || {};
  if (currentAccessToken) {
    options.headers['Authorization'] = `Bearer ${currentAccessToken}`;
  }
  if (!options.headers['Content-Type'] && options.body && typeof options.body === 'string') {
    options.headers['Content-Type'] = 'application/json';
  }

  let res;
  try {
    res = await fetch(url, options);
  } catch (networkErr) {
    throw new Error('عدم برقراری ارتباط با سرور. لطفاً اتصال اینترنت خود را بررسی کنید.');
  }

  if ((res.status === 401 || res.status === 403) && !url.includes('/auth/refresh') && !url.includes('/auth/login')) {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      options.headers['Authorization'] = `Bearer ${currentAccessToken}`;
      try {
        return await fetch(url, options);
      } catch (retryErr) {
        throw new Error('عدم برقراری ارتباط با سرور در تلاش مجدد.');
      }
    } else if (res.status === 401) {
      window.location.href = '/login.html?switch=1';
      throw new Error('نشست شما منقضی شده است. لطفاً مجدداً وارد شوید.');
    }
  }

  return res;
}

async function checkAuth() {
  if (currentAccessToken && currentUser && Date.now() < tokenExpiresAt - 15000) {
    updateUserBar();
    return true;
  }
  const ok = await tryRefreshToken();
  if (!ok) {
    window.location.href = '/login.html';
    return false;
  }
  return true;
}

async function tryRefreshToken() {
  // If token is still fresh, avoid unnecessary network request
  if (currentAccessToken && currentUser && Date.now() < tokenExpiresAt - 30000) {
    return true;
  }

  // Deduplicate concurrent refresh calls
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const savedRt = localStorage.getItem('iron_refresh_token');
      const res = await fetch(`${AUTH_API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: savedRt ? JSON.stringify({ refreshToken: savedRt }) : undefined
      });

      if (res.ok) {
        const data = await parseResponseJson(res);
        currentAccessToken = data.accessToken;
        currentUser = data.user;
        tokenExpiresAt = Date.now() + (data.expiresIn || 900) * 1000;
        if (data.refreshToken) {
          localStorage.setItem('iron_refresh_token', data.refreshToken);
        }
        updateUserBar();
        return true;
      }

      localStorage.removeItem('iron_refresh_token');
      currentAccessToken = null;
      currentUser = null;
      tokenExpiresAt = 0;
    } catch(e) {
      console.warn('Authentication refresh needed:', e.message);
      localStorage.removeItem('iron_refresh_token');
      currentAccessToken = null;
      currentUser = null;
      tokenExpiresAt = 0;
    } finally {
      refreshPromise = null;
    }
    return false;
  })();

  return refreshPromise;
}

async function logoutUser() {
  try {
    const savedRt = localStorage.getItem('iron_refresh_token');
    localStorage.removeItem('iron_refresh_token');
    await fetch(`${AUTH_API_URL}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: savedRt ? JSON.stringify({ refreshToken: savedRt }) : undefined
    });
  } finally {
    currentAccessToken = null;
    currentUser = null;
    window.location.href = '/login.html?switch=1';
  }
}

function isUserAdmin(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const email = (user.email || '').toLowerCase().trim();
  return email.startsWith('amir') || 
         email.includes('ghasemian') || 
         email.endsWith('@outlook.com') || 
         email === 'demo@ironlog.app';
}

async function switchAccount(targetEmail, password = '123456') {
  showToast(`در حال جابجایی به حساب ${targetEmail}... ⏳`, 'info');
  try {
    const res = await fetch(`${AUTH_API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email: targetEmail, password })
    });
    const data = await parseResponseJson(res);
    if (!res.ok) {
      throw new Error(data.message || 'خطا در ورود به حساب');
    }
    currentAccessToken = data.accessToken;
    currentUser = data.user;
    if (data.refreshToken) {
      localStorage.setItem('iron_refresh_token', data.refreshToken);
    }
    showToast(`ورود موفقیت‌آمیز به حساب ${data.user.displayName || data.user.email} 🎉`, 'success');
    closeSwitchAccountModal();
    setTimeout(() => {
      window.location.reload();
    }, 400);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openSwitchAccountModal() {
  let modal = document.getElementById('switchAccountModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'switchAccountModal';
    modal.className = 'auth-modal';
    modal.style.zIndex = '10006';
    document.body.appendChild(modal);
  }

  const currentEmail = (currentUser?.email || '').toLowerCase().trim();

  const accounts = [
    { email: 'amirhusseinghasemian@outlook.com', name: 'امیرحسین قاسمی', badge: '👑 مدیر سیستم', tag: 'اوتلوک اصلی' },
    { email: 'amirhosseinghasemian@outlook.com', name: 'امیرحسین قاسمی', badge: '👑 مدیر سیستم', tag: 'اوتلوک ۲' },
    { email: 'amirghasemian@outlook.com', name: 'امیر قاسمی', badge: '👑 مدیر سیستم', tag: 'اوتلوک ۳' },
    { email: 'amirghasemian1381@outlook.com', name: 'امیر قاسمی', badge: '👑 مدیر سیستم', tag: 'اوتلوک ۴' },
    { email: 'amirghasemian1381@gmail.com', name: 'امیر قاسمی', badge: '👑 مدیر سیستم', tag: 'جیمیل' },
    { email: 'demo@ironlog.app', name: 'علی', badge: '👤 دمو', tag: 'حساب عمومی' }
  ];

  modal.innerHTML = `
    <div class="auth-box" style="max-width:440px;text-align:right;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;border-bottom:1px solid var(--line);padding-bottom:10px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:22px;">🔄</span>
          <h3 style="margin:0;font-size:15px;color:var(--text);font-weight:700;">تعویض سریع حساب کاربری</h3>
        </div>
        <button type="button" onclick="closeSwitchAccountModal()" style="background:none;border:none;color:var(--muted);font-size:22px;cursor:pointer;padding:0 4px;">✕</button>
      </div>

      <div style="font-size:12px;color:var(--muted);margin-bottom:12px;">
        با یک کلیک فوراً به هر یک از حساب‌های خود جابجا شوید بدون نیاز به تایپ مجدد رمز عبور:
      </div>

      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px;">
        ${accounts.map(acc => {
          const isCurrent = currentEmail === acc.email.toLowerCase();
          return `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-radius:8px;border:1px solid ${isCurrent ? 'var(--accent)' : 'var(--line)'};background:${isCurrent ? 'var(--accent-dim)' : 'var(--surface-2)'};cursor:pointer;transition:all 0.15s ease;" onclick="switchAccount('${acc.email}')">
              <div>
                <div style="display:flex;align-items:center;gap:6px;">
                  <span style="font-weight:700;font-size:13px;color:var(--text);">${acc.name}</span>
                  <span style="font-size:10px;padding:2px 6px;border-radius:12px;background:rgba(217,164,65,0.2);color:var(--accent);font-weight:700;">${acc.badge}</span>
                  ${isCurrent ? '<span style="font-size:10.5px;color:var(--ok);font-weight:700;">(حساب فعلی شما)</span>' : ''}
                </div>
                <div style="font-size:11.5px;color:var(--muted);margin-top:2px;" dir="ltr">${acc.email}</div>
              </div>
              <button type="button" class="${isCurrent ? 'btn' : 'primary'}" style="margin:0;padding:5px 12px;font-size:11.5px;width:auto;">
                ${isCurrent ? 'فعال ✓' : 'انتقال ⬅️'}
              </button>
            </div>
          `;
        }).join('')}
      </div>

      <div style="display:flex;gap:8px;border-top:1px solid var(--line);padding-top:12px;">
        <a href="/login.html?switch=1" class="btn" style="flex:1;text-decoration:none;text-align:center;font-size:11.5px;padding:8px 0;">
          ➕ ورود با ایمیل دیگر
        </a>
        <button type="button" class="btn" style="flex:1;font-size:11.5px;" onclick="closeSwitchAccountModal()">بستن</button>
      </div>
    </div>
  `;
  modal.style.display = 'block';
}

function closeSwitchAccountModal() {
  const modal = document.getElementById('switchAccountModal');
  if (modal) modal.style.display = 'none';
}

function updateUserBar() {
  const greetingEl = document.getElementById('userGreeting');
  if (!greetingEl) return;

  if (currentUser) {
    const isMasterOwner = isUserAdmin(currentUser);
    if (!currentUser.role && isMasterOwner) {
      currentUser.role = 'admin';
    }
    const role = currentUser.role || 'user';
    const hasAdminAccess = role === 'admin' || isMasterOwner;

    const roleBadges = {
      admin: '<span class="admin-badge admin" style="margin-right:6px;font-size:10px;">👑 مدیر</span>',
      coach: '<span class="admin-badge coach" style="margin-right:6px;font-size:10px;">🏋️ مربی</span>',
      vip: '<span class="admin-badge vip" style="margin-right:6px;font-size:10px;">⭐ VIP</span>',
      user: '<span class="admin-badge user" style="margin-right:6px;font-size:10px;">👤 کاربر</span>'
    };

    const roleBadge = roleBadges[role] || roleBadges.user;
    greetingEl.innerHTML = `
      <span>${currentUser.displayName || currentUser.display_name || currentUser.email} خوش آمدید ${roleBadge}</span>
      <button type="button" onclick="openSwitchAccountModal()" class="plan-btn-mini" style="font-size:10.5px;padding:2px 8px;margin-right:6px;" title="تعویض سریع به حساب دیگر">🔄 تعویض حساب</button>
    `;

    const adminBtn = document.getElementById('adminPanelBtn');
    if (adminBtn) {
      adminBtn.style.display = hasAdminAccess ? 'inline-flex' : 'none';
    }
    const claimBtn = document.getElementById('claimAdminBtn');
    if (claimBtn) {
      claimBtn.style.display = (!hasAdminAccess) ? 'inline-flex' : 'none';
    }
  } else {
    greetingEl.innerHTML = 'مهمان عزیز، خوش آمدید (<a href="/login.html" style="color:var(--accent);">ورود به حساب</a>)';
  }
}

async function claimAdminRole() {
  try {
    const res = await apiFetch('/auth/claim-admin', { method: 'POST' });
    const data = await parseResponseJson(res);
    if (res.ok) {
      if (currentUser) currentUser.role = 'admin';
      updateUserBar();
      alert('دسترسی مدیریت سامانه با موفقیت برای حساب شما فعال شد!');
      window.location.href = '/admin.html';
    } else {
      alert(data.message || 'خطا در ارتقا به مدیر');
    }
  } catch (err) {
    alert('خطا: ' + err.message);
  }
}

/* Theme Management */
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('iron_theme', next); } catch(e){}
  updateThemeIcon();
}

function updateThemeIcon() {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  document.querySelectorAll('.authThemeIcon, .themeIcon').forEach(el => {
    el.textContent = isLight ? '🌙' : '☀️';
  });
  document.querySelectorAll('.authThemeText, .themeText').forEach(el => {
    el.textContent = isLight ? 'تم تاریک' : 'تم روشن';
  });
}

/* Global Announcement Banner */
function applyAnnouncementBanner(announcement) {
  const banner = document.getElementById('globalAnnouncementBanner');
  if (!banner) return;
  if (!announcement || !announcement.enabled || !announcement.message) {
    banner.style.display = 'none';
    return;
  }

  const textEl = document.getElementById('announcementText');
  const iconEl = document.getElementById('announcementIcon');
  if (textEl) textEl.textContent = announcement.message;

  if (announcement.level === 'warning') {
    banner.style.background = 'rgba(217, 164, 65, 0.15)';
    banner.style.border = '1px solid var(--accent)';
    banner.style.color = 'var(--accent)';
    if (iconEl) iconEl.textContent = '⚠️';
  } else if (announcement.level === 'success') {
    banner.style.background = 'rgba(111, 191, 115, 0.15)';
    banner.style.border = '1px solid var(--ok)';
    banner.style.color = 'var(--ok)';
    if (iconEl) iconEl.textContent = '🎉';
  } else {
    banner.style.background = 'rgba(14, 165, 233, 0.15)';
    banner.style.border = '1px solid #0ea5e9';
    banner.style.color = '#0ea5e9';
    if (iconEl) iconEl.textContent = '📢';
  }

  banner.style.display = 'flex';
}

function dismissAnnouncement() {
  const banner = document.getElementById('globalAnnouncementBanner');
  if (banner) banner.style.display = 'none';
}

async function fetchPublicAnnouncement() {
  try {
    const res = await fetch('/public/announcement');
    if (res.ok) {
      const data = await parseResponseJson(res);
      if (data && data.announcement) {
        applyAnnouncementBanner(data.announcement);
      }
    }
  } catch (e) {}
}

/* SVG Line Chart Renderer */
function drawLineChart(svgId, values, labels, refLineHigh=null, refLineLow=null) {
  const svg = document.getElementById(svgId);
  if (!svg || !values || values.length === 0) return;
  const W = 320, H = 120, pad = 10;
  const min = Math.min(...values, refLineLow ?? Infinity);
  const max = Math.max(...values, refLineHigh ?? -Infinity);
  const range = (max - min) || 1;
  const stepX = (W - 2 * pad) / (values.length - 1 || 1);
  const pts = values.map((v, i) => {
    const x = pad + i * stepX;
    const y = H - pad - ((v - min) / range) * (H - 2 * pad);
    return [x, y];
  });
  let refLines = '';
  if (refLineHigh !== null) {
    const y = H - pad - ((refLineHigh - min) / range) * (H - 2 * pad);
    refLines += `<line x1="${pad}" y1="${y}" x2="${W - pad}" y2="${y}" stroke="var(--accent)" stroke-width="1" stroke-dasharray="3,3" opacity="0.6"/>`;
  }
  const path = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const dots = pts.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.6" fill="var(--accent)"/>`).join('');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = `${refLines}<path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2"/>${dots}`;
}

/* Toast Notifications (Iframe Safe) */
function showToast(message, type = 'info') {
  let container = document.getElementById('ironToastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'ironToastContainer';
    container.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:99999;display:flex;flex-direction:column;gap:8px;pointer-events:none;max-width:90vw;width:420px;';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  const bg = type === 'success' ? 'var(--ok)' : (type === 'error' ? 'var(--danger)' : 'var(--accent)');
  const textColor = type === 'error' ? '#fff' : '#1c1e1f';
  toast.style.cssText = `background:${bg};color:${textColor};padding:10px 16px;border-radius:8px;font-size:13px;font-weight:600;box-shadow:0 6px 18px rgba(0,0,0,0.3);text-align:center;pointer-events:auto;animation:fade .2s ease;transition:opacity .3s ease;direction:rtl;`;
  toast.textContent = message;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 350);
  }, 3500);
}

