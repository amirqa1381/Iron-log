// Bodyweight Tracking Page Logic for Iron Log
let bodyWeightLogs = [];
let userSettings = { startWeight: null, targetWeight: null };

window.addEventListener('DOMContentLoaded', async () => {
  updateThemeIcon();
  fetchPublicAnnouncement().catch(() => {});

  const isValid = await tryRefreshToken();
  if (!isValid) {
    window.location.href = '/login.html';
    return;
  }

  document.getElementById('bwDate').value = todayISO();
  await loadWeightData();
});

async function loadWeightData() {
  try {
    const [bwRes, setRes] = await Promise.all([
      apiFetch('/bodyweight'),
      apiFetch('/settings')
    ]);

    if (bwRes.ok) {
      const data = await bwRes.json();
      bodyWeightLogs = data.bodyweights || [];
    }
    if (setRes.ok) {
      const sData = await setRes.json();
      userSettings = sData.settings || {};
      if (userSettings.startWeight) {
        document.getElementById('tabBwStartWeight').value = userSettings.startWeight;
      }
      if (userSettings.targetWeight) {
        document.getElementById('tabBwTargetWeight').value = userSettings.targetWeight;
      }
    }

    renderWeightTab();
  } catch (err) {
    console.warn('Error loading weight data:', err);
  }
}

function renderWeightTab() {
  const list = document.getElementById('bwList');
  const chartCard = document.getElementById('bwChartCard');
  const note = document.getElementById('bwTrendNote');
  const progHead = document.getElementById('bwProgHead');

  // Goals feedback
  const sw = userSettings.startWeight;
  const tw = userSettings.targetWeight;
  const fb = document.getElementById('tabBwGoalFeedback');
  if (fb) {
    if (sw && tw) {
      const diff = (tw - sw).toFixed(1);
      fb.innerHTML = `<span style="color:var(--ok);">اهداف فعال: مبدأ ${sw} kg ⬅️ هدف ${tw} kg (${diff > 0 ? '+' : ''}${diff} kg)</span>`;
    } else {
      fb.innerHTML = `<span style="color:var(--muted);">وزن مبدأ و هدف تعیین نشده است.</span>`;
    }
  }

  if (bodyWeightLogs.length === 0) {
    list.innerHTML = `<div class="empty">هنوز هیچ ثبتی برای وزن بدن ثبت نکرده‌اید.</div>`;
    chartCard.style.display = 'none';
    return;
  }

  // Sort chronological
  const sorted = bodyWeightLogs.slice().sort((a, b) => a.date.localeCompare(b.date));

  list.innerHTML = sorted.slice().reverse().map(l => `
    <div class="wrow">
      <span class="d">${l.date}</span>
      <div style="display:flex;gap:10px;align-items:center;">
        <span class="v">${l.weight} kg</span>
        <button class="delbtn" onclick="deleteWeightLog(${l.id})" title="حذف این ثبت">×</button>
      </div>
    </div>
  `).join('');

  chartCard.style.display = sorted.length >= 2 ? 'block' : 'none';
  if (sorted.length >= 2) {
    const vals = sorted.map(l => l.weight);
    const dates = sorted.map(l => l.date);
    drawLineChart('bwChart', vals, dates, tw, sw);

    const first = vals[0];
    const last = vals[vals.length - 1];
    const diff = (last - first).toFixed(1);
    const sign = diff > 0 ? '+' : '';

    let targetAnalysis = '';
    if (tw) {
      const rem = (tw - last).toFixed(1);
      if (Math.abs(rem) < 0.3) {
        targetAnalysis = ` 🎯 <b style="color:var(--ok);">تبریک! شما به وزن هدف (${tw} kg) رسیده‌اید.</b>`;
      } else if (rem > 0) {
        targetAnalysis = ` | فاصله تا وزن هدف: <b>${rem} kg</b> مانده تا ${tw} kg`;
      } else {
        targetAnalysis = ` | فاصله تا وزن هدف: <b>${Math.abs(rem)} kg</b> کاهش مانده تا ${tw} kg`;
      }
    }

    if (progHead) progHead.textContent = `روند تغییرات وزن (از ${first} به ${last} kg)`;
    if (note) {
      note.innerHTML = `تغییر کل دوره: <b>${sign}${diff} کیلوگرم</b> (${vals.length} ثبت در ${sorted.length} تاریخ مختلف).${targetAnalysis}`;
    }
  }
}

async function submitWeight() {
  const date = document.getElementById('bwDate').value || todayISO();
  const rawWeight = document.getElementById('bwWeight').value;
  const weight = parseUserNumber(rawWeight);

  if (!weight || weight <= 0) {
    showToast('لطفاً یک وزن معتبر به کیلوگرم وارد کنید.', 'error');
    return;
  }

  try {
    const res = await apiFetch('/bodyweight', {
      method: 'POST',
      body: JSON.stringify({ date, weight })
    });
    if (!res.ok) throw new Error('خطا در ذخیره وزن');
    const data = await res.json();

    const existingIdx = bodyWeightLogs.findIndex(w => w.date === date);
    if (existingIdx !== -1) {
      bodyWeightLogs[existingIdx] = data.log;
    } else {
      bodyWeightLogs.push(data.log);
    }

    document.getElementById('bwWeight').value = '';
    renderWeightTab();
    showToast('وزن با موفقیت ثبت شد.', 'success');
  } catch (err) {
    showToast('خطا در ثبت وزن: ' + err.message, 'error');
  }
}

async function deleteWeightLog(id) {
  try {
    const res = await apiFetch('/bodyweight/' + id, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) throw new Error('خطا در حذف وزن');
    bodyWeightLogs = bodyWeightLogs.filter(w => w.id !== id);
    renderWeightTab();
    showToast('ثبت وزن حذف شد.', 'info');
  } catch (err) {
    showToast('خطا در حذف وزن: ' + err.message, 'error');
  }
}

async function saveTabBwGoals() {
  const sw = parseUserNumber(document.getElementById('tabBwStartWeight').value);
  const tw = parseUserNumber(document.getElementById('tabBwTargetWeight').value);
  const fb = document.getElementById('tabBwGoalFeedback');

  if (!sw || !tw) {
    if (fb) fb.innerHTML = '<span style="color:var(--danger)">لطفاً هر دو وزن مبدأ و هدف را معتبر وارد کنید.</span>';
    return;
  }

  try {
    const res = await apiFetch('/settings', {
      method: 'PUT',
      body: JSON.stringify({ startWeight: sw, targetWeight: tw })
    });
    if (!res.ok) throw new Error('خطا در ذخیره اهداف');
    userSettings.startWeight = sw;
    userSettings.targetWeight = tw;
    renderWeightTab();
    if (fb) fb.innerHTML = '<span style="color:var(--ok)">✅ اهداف با موفقیت ذخیره شدند.</span>';
    setTimeout(() => { if (fb) fb.innerHTML = ''; }, 3000);
  } catch (err) {
    if (fb) fb.innerHTML = `<span style="color:var(--danger)">⚠️ ${err.message}</span>`;
  }
}
