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

  const dateInput = document.getElementById('bwDate');
  if (dateInput) dateInput.value = todayISO();

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
      const raw = Array.isArray(data) ? data : (data.bodyweights || data.logs || data.rows || []);
      bodyWeightLogs = raw.map(l => ({
        id: l.id,
        date: l.date || l.logDate || l.log_date,
        weight: Number(l.weight !== undefined ? l.weight : (l.weightKg !== undefined ? l.weightKg : l.weight_kg)),
        created_at: l.created_at
      })).filter(l => l.date && !isNaN(l.weight));
    }

    if (setRes.ok) {
      const sData = await setRes.json();
      const sObj = sData.settings || sData || {};
      userSettings = {
        startWeight: sObj.startWeight !== undefined && sObj.startWeight !== null ? Number(sObj.startWeight) : null,
        targetWeight: sObj.targetWeight !== undefined && sObj.targetWeight !== null ? Number(sObj.targetWeight) : null
      };
      const swInput = document.getElementById('tabBwStartWeight');
      const twInput = document.getElementById('tabBwTargetWeight');
      if (swInput && userSettings.startWeight) {
        swInput.value = userSettings.startWeight;
      }
      if (twInput && userSettings.targetWeight) {
        twInput.value = userSettings.targetWeight;
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

  const curEl = document.getElementById('bwStatCurrent');
  const tgtEl = document.getElementById('bwStatTarget');
  const toGoEl = document.getElementById('bwStatToGo');
  const fb = document.getElementById('tabBwGoalFeedback');

  // Sort chronological by date, then by ID
  const sorted = bodyWeightLogs.slice().sort((a, b) => {
    const dCmp = (a.date || '').localeCompare(b.date || '');
    if (dCmp !== 0) return dCmp;
    return (Number(a.id) || 0) - (Number(b.id) || 0);
  });

  const sw = userSettings.startWeight;
  const tw = userSettings.targetWeight;
  const latestLog = sorted.length > 0 ? sorted[sorted.length - 1] : null;
  const latestWeight = latestLog ? latestLog.weight : null;

  // 1. Update Stat Chips
  if (curEl) {
    curEl.textContent = latestWeight !== null ? `${faDigits(latestWeight)} kg` : '—';
  }
  if (tgtEl) {
    tgtEl.textContent = tw !== null && tw !== undefined ? `${faDigits(tw)} kg` : 'تعیین نشده';
  }

  let distanceText = '—';
  let distanceStatusHtml = '';

  if (tw !== null && tw !== undefined && latestWeight !== null) {
    const diff = +(tw - latestWeight).toFixed(1);
    const absDiff = Math.abs(diff);

    if (absDiff < 0.2) {
      distanceText = 'رسیده به هدف 🎯';
      distanceStatusHtml = `
        <div style="color:var(--ok);font-weight:700;display:flex;align-items:center;gap:6px;">
          <span>🎯 تبریک! آخرین وزن شما (${faDigits(latestWeight)} kg) برابر با وزن هدف (${faDigits(tw)} kg) است.</span>
        </div>
      `;
    } else if (diff > 0) {
      distanceText = `${faDigits(diff)} kg افزایش`;
      distanceStatusHtml = `
        <div style="color:var(--accent);font-weight:700;font-size:13.5px;margin-bottom:4px;">
          🎯 فاصله تا وزن هدف: <span style="background:rgba(217,164,65,0.15);padding:2px 8px;border-radius:4px;">${faDigits(diff)} کیلوگرم افزایش</span> مانده تا رسیدن به ${faDigits(tw)} kg
        </div>
        <div style="font-size:11.5px;color:var(--muted);">
          وضعیت فعلی: آخرین وزن ثبت‌شده ${faDigits(latestWeight)} kg ⬅️ هدف نهایی: ${faDigits(tw)} kg
        </div>
      `;
    } else {
      distanceText = `${faDigits(absDiff)} kg کاهش`;
      distanceStatusHtml = `
        <div style="color:var(--accent);font-weight:700;font-size:13.5px;margin-bottom:4px;">
          🎯 فاصله تا وزن هدف: <span style="background:rgba(217,164,65,0.15);padding:2px 8px;border-radius:4px;">${faDigits(absDiff)} کیلوگرم کاهش</span> مانده تا رسیدن به ${faDigits(tw)} kg
        </div>
        <div style="font-size:11.5px;color:var(--muted);">
          وضعیت فعلی: آخرین وزن ثبت‌شده ${faDigits(latestWeight)} kg ⬅️ هدف نهایی: ${faDigits(tw)} kg
        </div>
      `;
    }

    if (sw !== null && sw !== undefined) {
      const overallDiff = (latestWeight - sw).toFixed(1);
      const sign = overallDiff > 0 ? '+' : '';
      distanceStatusHtml += `
        <div style="font-size:11.5px;color:var(--text);margin-top:6px;padding-top:6px;border-top:1px dashed var(--line);">
          وزن شروع دوره: <b>${faDigits(sw)} kg</b> | تغییر کل از ابتدا: <b>${sign}${faDigits(overallDiff)} kg</b>
        </div>
      `;
    }
  } else if (tw !== null && tw !== undefined) {
    distanceText = 'در انتظار ثبت وزن';
    distanceStatusHtml = `
      <div style="color:var(--text);font-weight:600;">
        🎯 وزن هدف: <b>${faDigits(tw)} kg</b>
      </div>
      <div style="font-size:11.5px;color:var(--muted);margin-top:4px;">
        برای محاسبه خودکار فاصله تا هدف، لطفاً اولین وزن خود را در فرم «ثبت جدید وزن بدن» وارد کنید.
      </div>
    `;
  } else {
    distanceText = 'هدف تعیین نشده';
    distanceStatusHtml = `
      <div style="color:var(--muted);">
        وزن هدف هنوز ثبت نشده است. با مشخص کردن وزن هدف در کادر بالا و کلیک بر روی «ذخیره اهداف وزنی»، فاصله تا وزن هدف محاسبه و پایش می‌شود.
      </div>
    `;
  }

  if (toGoEl) {
    toGoEl.textContent = distanceText;
  }

  if (fb) {
    fb.innerHTML = distanceStatusHtml;
  }

  // 2. Render History List
  if (list) {
    if (sorted.length === 0) {
      list.innerHTML = `<div class="empty">هنوز هیچ ثبتی برای وزن بدن ثبت نکرده‌اید.</div>`;
    } else {
      list.innerHTML = sorted.slice().reverse().map(l => {
        let timeHint = '';
        if (l.created_at) {
          try {
            const timeObj = new Date(l.created_at);
            if (!isNaN(timeObj.getTime())) {
              const tStr = timeObj.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
              timeHint = `<span style="font-size:10.5px;color:var(--muted);margin-right:6px;">⏱️ ${tStr}</span>`;
            }
          } catch (e) {}
        }
        return `
          <div class="wrow" style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid var(--line);">
            <div>
              <span class="d" style="font-weight:600;">${escapeHtml(l.date)}</span>
              ${timeHint}
            </div>
            <div style="display:flex;gap:12px;align-items:center;">
              <span class="v" style="font-weight:700;font-size:14px;color:var(--text);">${faDigits(l.weight)} kg</span>
              <button class="delbtn" onclick="deleteWeightLog(${l.id})" title="حذف این ثبت" style="background:none;border:none;color:var(--danger);font-size:18px;cursor:pointer;padding:2px 6px;">×</button>
            </div>
          </div>
        `;
      }).join('');
    }
  }

  // 3. Render Chart & Trend Note
  if (chartCard) {
    chartCard.style.display = sorted.length >= 2 ? 'block' : 'none';
  }

  if (sorted.length >= 2) {
    const vals = sorted.map(l => l.weight);
    const dates = sorted.map(l => l.date);
    if (typeof drawLineChart === 'function') {
      drawLineChart('bwChart', vals, dates, tw, sw);
    }

    const first = vals[0];
    const last = vals[vals.length - 1];
    const diff = (last - first).toFixed(1);
    const sign = diff > 0 ? '+' : '';

    let targetAnalysis = '';
    if (tw) {
      const rem = (tw - last).toFixed(1);
      if (Math.abs(rem) < 0.2) {
        targetAnalysis = ` 🎯 <b style="color:var(--ok);">تبریک! شما به وزن هدف (${faDigits(tw)} kg) رسیده‌اید.</b>`;
      } else if (rem > 0) {
        targetAnalysis = ` | فاصله تا وزن هدف: <b>${faDigits(rem)} kg</b> افزایش مانده تا ${faDigits(tw)} kg`;
      } else {
        targetAnalysis = ` | فاصله تا وزن هدف: <b>${faDigits(Math.abs(rem))} kg</b> کاهش مانده تا ${faDigits(tw)} kg`;
      }
    }

    if (progHead) progHead.textContent = `روند تغییرات وزن (از ${faDigits(first)} به ${faDigits(last)} kg)`;
    if (note) {
      note.innerHTML = `تغییر کل دوره: <b>${sign}${faDigits(diff)} کیلوگرم</b> (${faDigits(vals.length)} ثبت در ${faDigits(sorted.length)} نوبت).${targetAnalysis}`;
    }
  }
}

async function submitWeight() {
  const dateInput = document.getElementById('bwDate');
  const weightInput = document.getElementById('bwWeight');
  const date = (dateInput && dateInput.value) || todayISO();
  const rawWeight = weightInput ? weightInput.value : '';
  const weight = parseUserNumber(rawWeight);

  if (!weight || weight <= 0) {
    showToast('لطفاً یک وزن معتبر به کیلوگرم وارد کنید.', 'error');
    if (weightInput) weightInput.focus();
    return;
  }

  const btn = document.querySelector('button[onclick="submitWeight()"]');
  const originalText = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'در حال ثبت وزن در پایگاه داده...';
  }

  try {
    const res = await apiFetch('/bodyweight', {
      method: 'POST',
      body: JSON.stringify({ 
        date, 
        weight,
        logDate: date,
        weightKg: weight 
      })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.message || 'خطا در ذخیره وزن');
    }

    const data = await res.json();
    const newLog = {
      id: data.id || (data.log && data.log.id) || Date.now(),
      date: (data.log && data.log.date) || data.date || data.logDate || date,
      weight: Number((data.log && data.log.weight) !== undefined ? data.log.weight : (data.weight !== undefined ? data.weight : data.weightKg)) || weight,
      created_at: (data.log && data.log.created_at) || data.created_at || new Date().toISOString()
    };

    // Save every weigh-in to history
    bodyWeightLogs.push(newLog);

    if (weightInput) weightInput.value = '';
    renderWeightTab();
    showToast('وزن با موفقیت در پایگاه داده ثبت و ذخیره شد! 🎉', 'success');
  } catch (err) {
    showToast('خطا در ثبت وزن: ' + err.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalText || 'ثبت وزن بدن';
    }
  }
}

async function deleteWeightLog(id) {
  if (!confirm('آیا از حذف این ثبت وزن اطمینان دارید؟')) {
    return;
  }

  try {
    const res = await apiFetch('/bodyweight/' + id, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) throw new Error('خطا در حذف وزن');
    bodyWeightLogs = bodyWeightLogs.filter(w => Number(w.id) !== Number(id));
    renderWeightTab();
    showToast('ثبت وزن حذف شد.', 'info');
  } catch (err) {
    showToast('خطا در حذف وزن: ' + err.message, 'error');
  }
}

async function saveTabBwGoals() {
  const swVal = document.getElementById('tabBwStartWeight').value;
  const twVal = document.getElementById('tabBwTargetWeight').value;
  const sw = parseUserNumber(swVal);
  const tw = parseUserNumber(twVal);

  if (!tw || isNaN(tw) || tw <= 0) {
    showToast('لطفاً وزن هدف را به عنوان یک عدد معتبر به کیلوگرم وارد کنید.', 'error');
    return;
  }

  try {
    const payload = { targetWeight: tw };
    if (sw && !isNaN(sw) && sw > 0) {
      payload.startWeight = sw;
    }

    const res = await apiFetch('/settings', {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('خطا در ذخیره اهداف');

    if (sw && !isNaN(sw) && sw > 0) {
      userSettings.startWeight = sw;
    }
    userSettings.targetWeight = tw;

    renderWeightTab();
    showToast('🎯 اهداف وزنی ذخیره شد و فاصله تا وزن هدف محاسبه گردید!', 'success');
  } catch (err) {
    showToast('خطا در ذخیره اهداف: ' + err.message, 'error');
  }
}
