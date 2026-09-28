// Authentication Page Logic for Iron Log
let activeAuthTab = 'login';
let activeUrlResetToken = null;

window.addEventListener('DOMContentLoaded', async () => {
  updateThemeIcon();

  // Check URL params for direct password reset link
  const urlParams = new URLSearchParams(window.location.search);
  const resetToken = urlParams.get('reset_token');
  const resetEmail = urlParams.get('email');
  if (resetToken) {
    activeUrlResetToken = resetToken;
    openForgotPassword();
    switchForgotStep(2);
    if (resetEmail) {
      document.getElementById('forgotEmail').value = resetEmail;
    }
  }

  // Check if user is already logged in (skip if explicitly switching accounts)
  const isSwitching = urlParams.get('switch') === '1' || urlParams.get('logout') === '1';
  if (!isSwitching) {
    const isValid = await tryRefreshToken();
    if (isValid && currentUser) {
      const redirect = urlParams.get('redirect');
      if (redirect === 'admin' && (currentUser.role === 'admin' || isUserAdmin(currentUser))) {
        window.location.href = '/admin.html';
      } else if (redirect) {
        window.location.href = redirect.startsWith('/') ? redirect : `/${redirect}`;
      }
    }
  }
});

function quickFillLogin(email, password = '123456') {
  const emailInput = document.getElementById('loginEmail');
  const passInput = document.getElementById('loginPassword');
  if (emailInput) emailInput.value = email;
  if (passInput) passInput.value = password;
  submitLogin();
}

function switchAuthTab(tab) {
  activeAuthTab = tab;
  document.getElementById('tabBtnLogin').classList.toggle('active', tab === 'login');
  document.getElementById('tabBtnRegister').classList.toggle('active', tab === 'register');
  document.getElementById('authCardLogin').style.display = tab === 'login' ? 'block' : 'none';
  document.getElementById('authCardRegister').style.display = tab === 'register' ? 'block' : 'none';
  document.getElementById('forgotPasswordCard').style.display = 'none';
  document.getElementById('authError').style.display = 'none';
  document.getElementById('authSuccess').style.display = 'none';
}

function openForgotPassword() {
  document.getElementById('authCardLogin').style.display = 'none';
  document.getElementById('authCardRegister').style.display = 'none';
  document.getElementById('forgotPasswordCard').style.display = 'block';
  document.getElementById('authError').style.display = 'none';
  document.getElementById('authSuccess').style.display = 'none';
  switchForgotStep(1);
}

function cancelForgotPassword() {
  document.getElementById('forgotPasswordCard').style.display = 'none';
  switchAuthTab('login');
}

function switchForgotStep(step) {
  document.getElementById('forgotStep1').style.display = step === 1 ? 'block' : 'none';
  document.getElementById('forgotStep2').style.display = step === 2 ? 'block' : 'none';
}

async function submitLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('authError');
  const succEl = document.getElementById('authSuccess');
  const btn = document.getElementById('btnLoginSubmit');
  errEl.style.display = 'none';
  succEl.style.display = 'none';

  if (!email || !password) {
    errEl.textContent = 'لطفاً ایمیل و رمز عبور را وارد کنید.';
    errEl.style.display = 'block';
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'در حال احراز هویت... ⏳';
  }

  try {
    const res = await fetch(`${AUTH_API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password })
    });
    const data = await parseResponseJson(res);
    if (!res.ok) throw new Error(data.message || 'خطا در ورود به حساب');

    currentAccessToken = data.accessToken;
    currentUser = data.user;
    if (data.refreshToken) {
      localStorage.setItem('iron_refresh_token', data.refreshToken);
    }

    succEl.textContent = 'ورود موفقیت‌آمیز بود! در حال انتقال...';
    succEl.style.display = 'block';

    setTimeout(() => {
      const urlParams = new URLSearchParams(window.location.search);
      const redirect = urlParams.get('redirect');
      if (redirect === 'admin' && (currentUser.role === 'admin' || isUserAdmin(currentUser))) {
        window.location.href = '/admin.html';
      } else {
        window.location.href = '/';
      }
    }, 400);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'ورود به حساب';
    }
  }
}

async function submitRegister() {
  const email = document.getElementById('regEmail').value.trim();
  const displayName = document.getElementById('regName').value.trim();
  const password = document.getElementById('regPassword').value;
  const confirmPassword = document.getElementById('regConfirmPassword').value;
  const errEl = document.getElementById('authError');
  const succEl = document.getElementById('authSuccess');
  const btn = document.getElementById('btnRegisterSubmit');
  errEl.style.display = 'none';
  succEl.style.display = 'none';

  if (!email || !password) {
    errEl.textContent = 'لطفاً ایمیل و رمز عبور را وارد کنید.';
    errEl.style.display = 'block';
    return;
  }
  if (password.length < 6) {
    errEl.textContent = 'رمز عبور باید حداقل ۶ کاراکتر باشد.';
    errEl.style.display = 'block';
    return;
  }
  if (password !== confirmPassword) {
    errEl.textContent = 'تکرار رمز عبور با رمز وارد شده همخوانی ندارد.';
    errEl.style.display = 'block';
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = 'در حال ایجاد حساب کاربری... ⏳';
  }

  try {
    const res = await fetch(`${AUTH_API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password, displayName })
    });
    const data = await parseResponseJson(res);
    if (!res.ok) throw new Error(data.message || 'خطا در ثبت نام');

    currentAccessToken = data.accessToken;
    currentUser = data.user;
    if (data.refreshToken) {
      localStorage.setItem('iron_refresh_token', data.refreshToken);
    }

    succEl.textContent = 'حساب کاربری با موفقیت ساخته شد! در حال انتقال...';
    succEl.style.display = 'block';

    setTimeout(() => {
      window.location.href = '/';
    }, 400);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'ایجاد حساب کاربری';
    }
  }
}

async function submitForgotPassword() {
  const email = document.getElementById('forgotEmail').value.trim();
  const fb = document.getElementById('forgotFeedback');

  if (!email || !email.includes('@')) {
    fb.innerHTML = '<div class="feedback down">لطفاً ایمیل معتبر وارد کنید.</div>';
    return;
  }

  fb.innerHTML = '<div class="feedback" style="color:var(--muted)">در حال بررسی و ارسال کد بازیابی...</div>';

  try {
    const res = await fetch(`${AUTH_API_URL}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await parseResponseJson(res);
    if (!res.ok) throw new Error(data.message || 'خطا در درخواست بازیابی رمز');

    if (data.previewCode) {
      document.getElementById('resetCode').value = data.previewCode;
    }
    if (data.previewToken) {
      activeUrlResetToken = data.previewToken;
    }

    fb.innerHTML = `<div class="feedback up">${data.message}</div>`;
    setTimeout(() => {
      fb.innerHTML = '';
      switchForgotStep(2);
    }, 1200);
  } catch (err) {
    fb.innerHTML = `<div class="feedback down">${err.message}</div>`;
  }
}

async function submitResetPassword() {
  const email = document.getElementById('forgotEmail').value.trim();
  const code = document.getElementById('resetCode').value.trim();
  const newPassword = document.getElementById('newPassword').value;
  const confirmPassword = document.getElementById('confirmNewPassword').value;
  const fb = document.getElementById('resetFeedback');

  if (!newPassword || newPassword.length < 6) {
    fb.innerHTML = '<div class="feedback down">رمز عبور جدید باید حداقل ۶ کاراکتر باشد.</div>';
    return;
  }
  if (newPassword !== confirmPassword) {
    fb.innerHTML = '<div class="feedback down">تکرار رمز جدید همخوانی ندارد.</div>';
    return;
  }

  fb.innerHTML = '<div class="feedback" style="color:var(--muted)">در حال تنظیم رمز جدید...</div>';

  try {
    const payload = { email, newPassword };
    if (activeUrlResetToken) {
      payload.resetToken = activeUrlResetToken;
    } else {
      payload.code = code;
    }

    const res = await fetch(`${AUTH_API_URL}/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await parseResponseJson(res);
    if (!res.ok) throw new Error(data.message || 'خطا در تغییر رمز عبور');

    fb.innerHTML = `<div class="feedback up">${data.message}</div>`;
    setTimeout(() => {
      fb.innerHTML = '';
      cancelForgotPassword();
      document.getElementById('loginEmail').value = email;
    }, 1500);
  } catch (err) {
    fb.innerHTML = `<div class="feedback down">${err.message}</div>`;
  }
}
