// History Page Logic for Iron Log
let workoutLogs = [];

window.addEventListener('DOMContentLoaded', async () => {
  updateThemeIcon();
  fetchPublicAnnouncement().catch(() => {});

  const isValid = await tryRefreshToken();
  if (!isValid) {
    window.location.href = '/login.html';
    return;
  }

  await loadHistoryData();
});

async function loadHistoryData() {
  try {
    const res = await apiFetch('/workouts');
    if (res.ok) {
      const data = await res.json();
      const raw = Array.isArray(data) ? data : (data.workouts || data.logs || []);
      workoutLogs = raw.map(w => ({
        id: w.id,
        exercise: w.exerciseName || w.exercise_name || w.exercise,
        date: w.logDate || w.log_date || w.date,
        weight: w.weightKg !== undefined ? Number(w.weightKg) : (w.weight_kg !== undefined ? Number(w.weight_kg) : Number(w.weight || 0)),
        reps: Array.isArray(w.reps) ? w.reps : [w.reps || 0],
        rir: Array.isArray(w.rir) ? w.rir : [],
        rpe: Array.isArray(w.rpe) ? w.rpe : [],
        notes: w.notes || ''
      }));
      buildExerciseSelect();
      renderHistory();
    }
  } catch (err) {
    console.warn('Error loading workout history:', err);
  }
}

function buildExerciseSelect() {
  const select = document.getElementById('histExercise');
  if (!select) return;

  const currentVal = select.value;
  const exSet = new Set();
  workoutLogs.forEach(w => {
    if (w.exercise) exSet.add(w.exercise);
  });

  const sortedEx = Array.from(exSet).sort();
  if (sortedEx.length === 0) {
    select.innerHTML = '<option value="">(هنوز تمرینی ثبت نشده است)</option>';
    return;
  }

  select.innerHTML = sortedEx.map(ex => `<option value="${ex}">${ex}</option>`).join('');
  if (currentVal && sortedEx.includes(currentVal)) {
    select.value = currentVal;
  } else {
    select.value = sortedEx[0];
  }
}

function renderHistory() {
  const select = document.getElementById('histExercise');
  const exercise = select ? select.value : '';
  const entries = workoutLogs.filter(l => l.exercise === exercise).sort((a, b) => a.date.localeCompare(b.date));
  const list = document.getElementById('histList');
  const chartCard = document.getElementById('histChartCard');
  const summaryBanner = document.getElementById('histSummaryBanner');
  const countBadge = document.getElementById('histCountBadge');
  const searchInput = document.getElementById('histSearchInput');
  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

  if (!list) return;

  if (entries.length === 0) {
    list.innerHTML = `<div class="empty">هنوز ثبتی برای این حرکت وجود ندارد.</div>`;
    if (chartCard) chartCard.style.display = 'none';
    if (summaryBanner) summaryBanner.style.display = 'none';
    if (countBadge) countBadge.textContent = '۰ ثبت';
    return;
  }

  let best1RM = 0;
  let maxWeight = 0;
  let pbScore = -1, pbId = null;

  entries.forEach(e => {
    const repsArr = Array.isArray(e.reps) ? e.reps : [e.reps];
    const maxRep = Math.max(...repsArr, 1);
    if (e.weight > maxWeight) maxWeight = e.weight;
    const est1RM = e.weight * (1 + maxRep / 30);
    if (est1RM > best1RM) best1RM = est1RM;

    const score = e.weight * maxRep;
    if (score > pbScore) {
      pbScore = score;
      pbId = e.id;
    }
  });

  if (summaryBanner) {
    summaryBanner.style.display = 'block';
    const el1RM = document.getElementById('histStatBest1RM');
    const elMaxW = document.getElementById('histStatMaxWeight');
    const elTotal = document.getElementById('histStatTotalLogs');
    if (el1RM) el1RM.textContent = best1RM > 0 ? `${best1RM.toFixed(1)} kg` : '—';
    if (elMaxW) elMaxW.textContent = `${maxWeight} kg`;
    if (elTotal) elTotal.textContent = `${entries.length} جلسه`;
  }

  let filteredEntries = entries;
  if (query) {
    filteredEntries = entries.filter(e => {
      const repsArr = Array.isArray(e.reps) ? e.reps : [e.reps];
      const rpeArr = Array.isArray(e.rpe) ? e.rpe : [];
      const dateMatch = e.date && e.date.includes(query);
      const weightMatch = String(e.weight).includes(query);
      const repsMatch = repsArr.join(' ').includes(query);
      const rpeMatch = rpeArr.join(' ').includes(query) || (query.includes('rpe') && rpeArr.length > 0);
      const notesMatch = e.notes ? e.notes.toLowerCase().includes(query) : false;
      return dateMatch || weightMatch || repsMatch || rpeMatch || notesMatch;
    });
  }

  if (countBadge) {
    countBadge.textContent = query ? `${filteredEntries.length} از ${entries.length} ثبت` : `${entries.length} ثبت`;
  }

  if (filteredEntries.length === 0) {
    list.innerHTML = `<div class="empty" style="padding:16px;">موردی منطبق با «${query}» یافت نشد.</div>`;
  } else {
    list.innerHTML = filteredEntries.slice().reverse().map(e => {
      const isPB = e.id === pbId;
      const repsArr = Array.isArray(e.reps) ? e.reps : [e.reps];
      const maxRep = Math.max(...repsArr, 1);
      const itemEst1RM = (e.weight * (1 + maxRep / 30)).toFixed(1);

      let intensityHtml = '';
      if (Array.isArray(e.rpe) && e.rpe.length > 0) {
        const avgRpe = (e.rpe.reduce((a, b) => a + b, 0) / e.rpe.length).toFixed(1);
        intensityHtml = `<span class="rpe-tag-badge ${getRpeClass(avgRpe)}" style="margin-inline-start:6px;" title="شدت ادراک‌شده ست‌ها (RPE)">RPE: ${e.rpe.join(' / ')}</span>`;
      } else if (Array.isArray(e.rir) && e.rir.length > 0) {
        intensityHtml = `<span style="font-size:11px;color:var(--muted);margin-inline-start:4px;">(RIR ${e.rir.join('/')})</span>`;
      }

      return `
        <div class="histentry">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div class="histdate">${e.date} ${isPB ? '<span class="pbtag">رکورد جدید</span>' : ''}</div>
            <div style="display:flex;gap:6px;align-items:center;">
              <span style="font-size:10.5px;color:var(--muted);background:var(--surface-2);padding:2px 6px;border-radius:4px;" title="یک تکرار بیشینه تخمینی">1RM ≈ ${itemEst1RM}kg</span>
              <button class="delbtn" onclick="deleteWorkoutLog(${e.id})" title="حذف این ثبت">×</button>
            </div>
          </div>
          <div class="histsets" style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;">
            <span>${e.weight} کیلوگرم — ${repsArr.join(' / ')}</span>
            ${intensityHtml}
          </div>
          ${e.notes ? `<div class="histnote">${e.notes}</div>` : ''}
        </div>
      `;
    }).join('');
  }

  if (chartCard) {
    chartCard.style.display = entries.length >= 2 ? 'block' : 'none';
    if (entries.length >= 2) {
      const vols = entries.map(e => {
        const repsArr = Array.isArray(e.reps) ? e.reps : [e.reps];
        const avg = repsArr.reduce((s, n) => s + Number(n), 0) / (repsArr.length || 1);
        return e.weight * avg;
      });
      drawLineChart('histChart', vols, entries.map(e => e.date));
    }
  }
}

async function deleteWorkoutLog(id) {
  try {
    const res = await apiFetch('/workouts/' + id, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) throw new Error('خطا در حذف تمرین');
    workoutLogs = workoutLogs.filter(w => w.id !== id);
    buildExerciseSelect();
    renderHistory();
    showToast('ثبت تمرین حذف شد.', 'info');
  } catch (err) {
    showToast('خطا در حذف ثبت: ' + err.message, 'error');
  }
}

function getRpeClass(rpe) {
  const num = parseFloat(rpe);
  if (isNaN(num)) return '';
  if (num >= 9.5) return 'extreme';
  if (num >= 8.5) return 'hard';
  if (num >= 7.5) return 'optimal';
  return '';
}
