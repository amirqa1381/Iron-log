// Comprehensive Review, Progress Assessment & Data Export Logic for Iron Log
let workoutLogs = [];
let bodyWeightLogs = [];
let START_WEIGHT = null;
let TARGET_WEIGHT = null;
let lastGeneratedReportText = '';

window.addEventListener('DOMContentLoaded', async () => {
  updateThemeIcon();
  fetchPublicAnnouncement().catch(() => {});

  const isValid = await tryRefreshToken();
  if (!isValid) {
    window.location.href = '/login.html';
    return;
  }

  await loadReviewData();
});

async function loadReviewData() {
  try {
    const [wRes, bRes, sRes] = await Promise.all([
      apiFetch('/workouts'),
      apiFetch('/bodyweight'),
      apiFetch('/settings')
    ]);

    if (wRes.ok) {
      const data = await wRes.json();
      workoutLogs = data.workouts || [];
    }
    if (bRes.ok) {
      const data = await bRes.json();
      bodyWeightLogs = data.bodyweights || [];
    }
    if (sRes.ok) {
      const data = await sRes.json();
      const s = data.settings || {};
      START_WEIGHT = s.startWeight !== null ? Number(s.startWeight) : null;
      TARGET_WEIGHT = s.targetWeight !== null ? Number(s.targetWeight) : null;
      if (START_WEIGHT) document.getElementById('cfgStartWeight').value = START_WEIGHT;
      if (TARGET_WEIGHT) document.getElementById('cfgTargetWeight').value = TARGET_WEIGHT;
    }

    populateExerciseFilter();
    renderReview();
  } catch (err) {
    console.warn('Error loading review data:', err);
  }
}

function populateExerciseFilter() {
  const sel = document.getElementById('revExercise');
  if (!sel) return;
  const exSet = new Set(workoutLogs.map(w => w.exercise).filter(Boolean));
  const sorted = Array.from(exSet).sort();
  sel.innerHTML = '<option value="all">همه حرکات ثبت‌شده</option>' + 
    sorted.map(e => `<option value="${e}">${e}</option>`).join('');
}

function toggleCustomDates() {
  const tf = document.getElementById('revTimeframe').value;
  const row = document.getElementById('revCustomDates');
  if (row) row.style.display = tf === 'custom' ? 'flex' : 'none';
  renderReview();
}

function toggleGoalSettings() {
  const box = document.getElementById('goalSettingsBox');
  const icon = document.getElementById('goalToggleIcon');
  if (!box) return;
  const isHidden = box.style.display === 'none';
  box.style.display = isHidden ? 'block' : 'none';
  if (icon) icon.textContent = isHidden ? '▲' : '▼';
}

async function saveWeightGoals() {
  const sw = parseUserNumber(document.getElementById('cfgStartWeight').value);
  const tw = parseUserNumber(document.getElementById('cfgTargetWeight').value);
  const fb = document.getElementById('goalSaveFeedback');

  try {
    const res = await apiFetch('/settings', {
      method: 'PUT',
      body: JSON.stringify({ startWeight: sw, targetWeight: tw })
    });
    if (!res.ok) throw new Error('خطا در ذخیره اهداف');
    START_WEIGHT = sw;
    TARGET_WEIGHT = tw;
    if (fb) fb.innerHTML = '<span style="color:var(--ok);">✅ اهداف ذخیره شد.</span>';
    setTimeout(() => { if (fb) fb.innerHTML = ''; }, 3000);
    renderReview();
    showToast('اهداف با موفقیت ذخیره شد.', 'success');
  } catch (err) {
    if (fb) fb.innerHTML = `<span style="color:var(--danger);">⚠️ ${err.message}</span>`;
    showToast(err.message, 'error');
  }
}

function renderReview() {
  const out = document.getElementById('reviewOutput');
  if (!out) return;
  const tf = document.getElementById('revTimeframe').value;
  const exFilter = document.getElementById('revExercise').value;

  let startDate = null, endDate = new Date();
  let periodLabel = '';

  if (tf === '14') {
    startDate = new Date(Date.now() - 14 * 24 * 3600 * 1000);
    periodLabel = '۱۴ روز گذشته (۲ هفته)';
  } else if (tf === '30') {
    startDate = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    periodLabel = '۳۰ روز گذشته (۱ ماه)';
  } else if (tf === '60') {
    startDate = new Date(Date.now() - 60 * 24 * 3600 * 1000);
    periodLabel = '۶۰ روز گذشته (۲ ماه)';
  } else if (tf === 'custom') {
    const sStr = document.getElementById('revStartDate').value;
    const eStr = document.getElementById('revEndDate').value;
    if (sStr) startDate = new Date(sStr + 'T00:00:00');
    if (eStr) endDate = new Date(eStr + 'T23:59:59');
    periodLabel = `از ${sStr || 'شروع'} تا ${eStr || 'امروز'}`;
  } else {
    startDate = null;
    periodLabel = 'کل تاریخچه ثبت‌ها (All-Time)';
  }

  const startIso = startDate ? startDate.toISOString().slice(0, 10) : '0000-00-00';
  const endIso = endDate ? endDate.toISOString().slice(0, 10) : '9999-99-99';

  const periodWorkouts = workoutLogs.filter(w => {
    if (w.date < startIso || w.date > endIso) return false;
    if (exFilter !== 'all' && w.exercise !== exFilter) return false;
    return true;
  }).sort((a,b) => a.date.localeCompare(b.date));

  const periodWeights = bodyWeightLogs.filter(w => {
    return w.date >= startIso && w.date <= endIso;
  }).sort((a,b) => a.date.localeCompare(b.date));

  if (periodWorkouts.length === 0 && periodWeights.length === 0) {
    out.innerHTML = `
      <section class="card">
        <div class="empty">در بازه انتخابی (${periodLabel}) هیچ تمرین یا وزنی ثبت نشده است.</div>
      </section>`;
    lastGeneratedReportText = '';
    return;
  }

  // Calculate volume & stats
  const uniqueWorkoutDays = new Set(periodWorkouts.map(w => w.date)).size;
  const daysInPeriod = startDate ? Math.max(7, Math.round((endDate - startDate) / (1000 * 3600 * 24))) : Math.max(7, uniqueWorkoutDays * 2);
  const weeksCount = Math.max(1, daysInPeriod / 7);
  const sessionsPerWeek = (uniqueWorkoutDays / weeksCount).toFixed(1);

  let totalVolumeKg = 0;
  let totalSetsCount = 0;
  let allRirList = [];
  const exerciseMap = {};

  periodWorkouts.forEach(w => {
    const repsArr = Array.isArray(w.reps) ? w.reps : [];
    const rirArr = Array.isArray(w.rir) ? w.rir : [];
    const setSum = repsArr.reduce((s, r) => s + Number(r), 0);
    totalVolumeKg += w.weight * setSum;
    totalSetsCount += repsArr.length;
    rirArr.forEach(r => allRirList.push(Number(r)));

    if (!exerciseMap[w.exercise]) exerciseMap[w.exercise] = [];
    exerciseMap[w.exercise].push(w);
  });

  const avgRir = allRirList.length ? (allRirList.reduce((s, r) => s + r, 0) / allRirList.length).toFixed(1) : null;
  const failureSets = allRirList.filter(r => r === 0).length;
  const failurePercent = allRirList.length ? Math.round((failureSets / allRirList.length) * 100) : 0;

  // Weight progression
  let weightDesc = 'داده کافی نیست';
  let latestW = periodWeights.length ? periodWeights[periodWeights.length - 1].weight : (bodyWeightLogs.length ? bodyWeightLogs[bodyWeightLogs.length - 1].weight : null);

  let html = `
    <section class="card">
      <div class="sectionhead">خلاصه ارزیابی (${periodLabel})</div>
      <div class="scoregrid">
        <div class="scorebox">
          <div class="k">جلسات تمرینی</div>
          <div class="v">${faDigits(uniqueWorkoutDays)} <small>جلسه (${sessionsPerWeek} در هفته)</small></div>
        </div>
        <div class="scorebox">
          <div class="k">کل ست‌ها</div>
          <div class="v">${faDigits(totalSetsCount)} <small>ست</small></div>
        </div>
        <div class="scorebox">
          <div class="k">حجم کل جابجا شده</div>
          <div class="v">${faDigits((totalVolumeKg / 1000).toFixed(1))} <small>تُن وزنه</small></div>
        </div>
        <div class="scorebox">
          <div class="k">میانگین RIR ذخیره</div>
          <div class="v">${avgRir ? faDigits(avgRir) : '—'} <small>${failurePercent > 0 ? `(${faDigits(failurePercent)}٪ ناتوانی)` : ''}</small></div>
        </div>
      </div>
      ${latestW ? `<div style="font-size:12px;color:var(--text);margin-top:6px;">⚖️ آخرین وزن ثبت‌شده: <b>${latestW} kg</b> ${TARGET_WEIGHT ? `(هدف: <b>${TARGET_WEIGHT} kg</b>)` : ''}</div>` : ''}
    </section>
  `;

  // Exercise overload list
  const exEntries = Object.entries(exerciseMap);
  if (exEntries.length > 0) {
    html += `
      <section class="card">
        <div class="sectionhead">اضافه‌بار تدریجی و رکوردهای حرکات</div>
        ${exEntries.map(([name, logs]) => {
          logs.sort((a,b) => a.date.localeCompare(b.date));
          const first = logs[0];
          const last = logs[logs.length - 1];
          const diffW = (last.weight - first.weight).toFixed(1);
          const sign = diffW > 0 ? '+' : '';
          return `
            <div style="border-top:1px solid var(--line);padding:10px 0;display:flex;justify-content:space-between;align-items:center;">
              <div>
                <b style="color:var(--text);">${name}</b>
                <div style="font-size:11px;color:var(--muted);">${logs.length} جلسه ثبت‌شده (${first.date} تا ${last.date})</div>
              </div>
              <div style="text-align:left;">
                <span class="pbtag" style="background:${diffW >= 0 ? 'var(--ok)' : 'var(--warn)'}">${sign}${diffW} kg</span>
                <div style="font-size:11px;color:var(--muted);margin-top:2px;">آخرین: ${last.weight} kg</div>
              </div>
            </div>
          `;
        }).join('')}
      </section>
    `;
  }

  out.innerHTML = html;
}

function copyReviewReport() {
  const out = document.getElementById('reviewOutput');
  if (!out || !out.innerText.trim()) {
    showToast('گزارشی برای کپی وجود ندارد.', 'error');
    return;
  }
  navigator.clipboard.writeText(out.innerText).then(() => {
    showToast('متن ارزیابی در کلیپ‌بورد کپی شد.', 'success');
  }).catch(() => {
    showToast('عدم دسترسی به کلیپ‌بورد.', 'error');
  });
}

async function exportData() {
  try {
    const res = await apiFetch('/export');
    const data = await res.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'iron-log-backup-' + todayISO() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast('فایل بک‌آپ با موفقیت دانلود شد.', 'success');
  } catch (e) {
    showToast('خطا در دانلود بک‌آپ: ' + e.message, 'error');
  }
}

function exportWorkoutsToCSV() {
  if (!workoutLogs || workoutLogs.length === 0) {
    showToast('هنوز هیچ ثبت تمرینی برای دانلود فایل اکسل وجود ندارد.', 'error');
    return;
  }
  const headers = ['تاریخ', 'برنامه', 'حرکت', 'وزن (کیلوگرم)', 'تکرارها', 'RIR', 'یادداشت'];
  const rows = workoutLogs.map(l => [
    l.date,
    l.mode === 'dumbbell' ? 'دمبل خانگی' : 'باشگاه',
    `"${(l.exercise || '').replace(/"/g, '""')}"`,
    l.weight,
    `"${(l.reps || []).join(' - ')}"`,
    `"${(l.rir || []).join(' - ')}"`,
    `"${(l.notes || '').replace(/"/g, '""')}"`
  ].join(','));

  const csvContent = '\uFEFF' + headers.join(',') + '\n' + rows.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'iron-log-workouts-' + todayISO() + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  showToast('فایل CSV با موفقیت تولید شد.', 'success');
}

async function importData(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const json = JSON.parse(e.target.result);
      const res = await apiFetch('/import', {
        method: 'POST',
        body: JSON.stringify(json)
      });
      if (!res.ok) throw new Error('خطا در بارگذاری اطلاعات');
      showToast('اطلاعات با موفقیت بازیابی شد.', 'success');
      setTimeout(() => location.reload(), 1000);
    } catch (err) {
      showToast('فایل نامعتبر است: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
}
