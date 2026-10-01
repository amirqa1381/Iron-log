// Iron Log Main Workout Tracker & AI-Powered Personalized Program Engine

let activeUserPlan = null;
let currentSelectedDayIndex = 0;
let isRebuildingPlan = false;
let workoutLogs = [];
let bodyWeightLogs = [];
let START_WEIGHT = null;
let TARGET_WEIGHT = null;
let cachedCatalogExercises = [];
let catalogLocationFilter = 'all';
let catalogForActiveDay = false;

// Rest Timer Dock State
let timerInterval = null;
let timerTotalSeconds = 0;
let timerRemainingSeconds = 0;
let isTimerPaused = false;

// Wizard State for Manual Builder
let manualBuilderDays = [
  { dayNumber: 1, dayName: 'روز ۱ — بالاتنه', tag: 'بالاتنه', focus: 'سینه، زیربغل و سرشانه', exercises: [] },
  { dayNumber: 2, dayName: 'روز ۲ — پایین‌تنه', tag: 'پایین‌تنه', focus: 'چهارسر، همسترینگ و شکم', exercises: [] },
  { dayNumber: 3, dayName: 'روز ۳ — فول بادی', tag: 'فول بادی', focus: 'تمرین جامع کل بدن', exercises: [] }
];
let manualBuilderSelectedDayIndex = 0;

// Wizard State for AI Questionnaire
let aiWizardData = {
  location: 'gym',
  equipment: ['all_gym'],
  goal: 'hypertrophy',
  experience: 'intermediate',
  daysPerWeek: 4,
  injuriesNotes: ''
};

// SVG Exercise Thumbnails by Category / Movement
const CATEGORY_ICONS = {
  chest: '🎯',
  back: '🦅',
  legs_quads: '🦵',
  legs_hamstrings: '🍑',
  shoulders: '🛡️',
  biceps: '💪',
  triceps: '⚡',
  abs_core: '🍫',
  calves: '🦶',
  forearms: '✊',
  full_body: '🔥'
};

function getExerciseCategoryIcon(category) {
  return CATEGORY_ICONS[category] || '🏋️';
}

function getExerciseThumbnailSvg(category) {
  const icon = getExerciseCategoryIcon(category);
  return `<div class="exercise-thumb-box" title="${category || 'تمرین'}">
    <span>${icon}</span>
  </div>`;
}

/* ---------------- Initialization ---------------- */
document.addEventListener('DOMContentLoaded', initApp);

async function initApp() {
  const today = new Date();
  const dateEl = document.getElementById('todayLabel');
  if (dateEl) {
    try {
      dateEl.textContent = new Intl.DateTimeFormat('fa-IR', { weekday: 'long', month: 'long', day: 'numeric' }).format(today);
    } catch (e) {
      dateEl.textContent = 'امروز';
    }
  }

  // Check auth and update top bar
  const isAuthenticated = await checkAuth();
  if (!isAuthenticated) return;
  updateUserBar();
  fetchPublicAnnouncement();

  // Load user data and current customized plan
  await Promise.all([
    loadStatsData(),
    loadUserPlan()
  ]);
}

/**
 * Load bodyweight and workout logs for stat chips
 */
async function loadStatsData() {
  try {
    const [bwRes, woRes, setRes] = await Promise.all([
      apiFetch('/bodyweight'),
      apiFetch('/workouts'),
      apiFetch('/settings')
    ]);

    if (bwRes.ok) {
      const bwData = await parseResponseJson(bwRes);
      const rawBw = Array.isArray(bwData) ? bwData : (bwData.logs || bwData.bodyweights || bwData.rows || []);
      bodyWeightLogs = rawBw.map(l => ({
        id: l.id,
        date: l.date || l.logDate || l.log_date,
        weightKg: Number(l.weightKg !== undefined ? l.weightKg : (l.weight !== undefined ? l.weight : l.weight_kg)),
        weight: Number(l.weight !== undefined ? l.weight : (l.weightKg !== undefined ? l.weightKg : l.weight_kg)),
        created_at: l.created_at
      })).filter(l => !isNaN(l.weightKg));

      // Sort chronological by date then id so the most recent is reliably at the end
      bodyWeightLogs.sort((a, b) => {
        const dCmp = (a.date || '').localeCompare(b.date || '');
        if (dCmp !== 0) return dCmp;
        return (Number(a.id) || 0) - (Number(b.id) || 0);
      });

      if (bodyWeightLogs.length > 0) {
        const last = bodyWeightLogs[bodyWeightLogs.length - 1];
        const el = document.getElementById('statWeight');
        if (el) el.textContent = `${faDigits(last.weightKg)} ک‌گ`;
        updateToGoWeight();
      }
    }

    if (woRes.ok) {
      const woData = await parseResponseJson(woRes);
      workoutLogs = Array.isArray(woData) ? woData : (woData.logs || woData.workouts || []);
      const el = document.getElementById('statSessions');
      if (el) el.textContent = faDigits(workoutLogs.length);
    }

    if (setRes.ok) {
      const setData = await parseResponseJson(setRes);
      const sObj = setData.settings || setData || {};
      START_WEIGHT = parseUserNumber(sObj.startWeight ?? sObj.start_weight);
      TARGET_WEIGHT = parseUserNumber(sObj.targetWeight ?? sObj.target_weight);
      updateToGoWeight();
    }
  } catch (err) {
    console.warn('[loadStatsData warning]:', err.message);
  }
}

function updateToGoWeight() {
  const el = document.getElementById('statToGo');
  if (!el) return;
  const tw = parseUserNumber(TARGET_WEIGHT);
  if (!tw || bodyWeightLogs.length === 0) {
    el.textContent = '—';
    return;
  }
  const lastItem = bodyWeightLogs[bodyWeightLogs.length - 1];
  const last = Number(lastItem.weightKg !== undefined ? lastItem.weightKg : (lastItem.weight !== undefined ? lastItem.weight : lastItem.weight_kg));
  if (isNaN(last) || last <= 0) {
    el.textContent = '—';
    return;
  }
  const diff = +(last - tw).toFixed(1);
  if (Math.abs(diff) < 0.2) {
    el.textContent = 'رسیده به هدف 🎯';
  } else if (diff > 0) {
    el.textContent = `${faDigits(diff)} ک‌گ کاهش`;
  } else {
    el.textContent = `${faDigits(Math.abs(diff))} ک‌گ افزایش`;
  }
}

/**
 * Load Active Customized Plan from Database
 */
async function loadUserPlan() {
  const loadingEl = document.getElementById('planLoadingState');
  const wizardSection = document.getElementById('planWizardSection');
  const activePlanSection = document.getElementById('activePlanSection');
  const topNav = document.getElementById('planTopNav');

  if (loadingEl) loadingEl.style.display = 'block';
  if (wizardSection) wizardSection.style.display = 'none';
  if (activePlanSection) activePlanSection.style.display = 'none';
  if (topNav) topNav.style.display = 'none';

  try {
    const res = await apiFetch('/api/plan/current');
    if (loadingEl) loadingEl.style.display = 'none';

    if (res.ok) {
      const data = await parseResponseJson(res);
      if (data && data.hasPlan && data.plan && Array.isArray(data.plan.days) && data.plan.days.length > 0) {
        activeUserPlan = data.plan;
        renderActivePlan();
        return;
      }
    }

    // User has no plan yet: present Onboarding Wizard
    activeUserPlan = null;
    renderPlanWizard('choice');
  } catch (err) {
    if (loadingEl) loadingEl.style.display = 'none';
    console.error('[loadUserPlan error]:', err);
    renderPlanWizard('choice');
  }
}

/* ==========================================================================
   PLAN SETUP & ONBOARDING WIZARD
   ========================================================================== */

/* ==========================================================================
   PLAN SETUP & ONBOARDING WIZARD (AI & MANUAL REDESIGNED)
   ========================================================================== */

let manualPlanMeta = {
  planName: 'برنامه تمرینی دست‌ساز من',
  goal: 'hypertrophy',
  location: 'gym',
  experience: 'intermediate'
};

const MANUAL_SPLIT_PRESETS = [
  {
    id: 'push_pull_legs',
    name: 'Push / Pull / Legs (۳ روز)',
    days: [
      { dayNumber: 1, dayName: 'روز ۱ — سینه، سرشانه و پشت‌بازو (Push)', tag: 'Push', focus: 'پرس سینه، سرشانه، پشت‌بازو', exercises: [] },
      { dayNumber: 2, dayName: 'روز ۲ — زیربغل، پشت و جلوبازو (Pull)', tag: 'Pull', focus: 'بارفیکس، پارویی، جلوبازو', exercises: [] },
      { dayNumber: 3, dayName: 'روز ۳ — پا، باسن و شکم (Legs & Core)', tag: 'Legs', focus: 'اسکات، همسترینگ، ساق و میان‌تنه', exercises: [] }
    ]
  },
  {
    id: 'upper_lower',
    name: 'Upper / Lower (۴ روز)',
    days: [
      { dayNumber: 1, dayName: 'روز ۱ — بالاتنه قدرتی A', tag: 'بالاتنه A', focus: 'سینه، زیربغل، سرشانه با اضافه بار', exercises: [] },
      { dayNumber: 2, dayName: 'روز ۲ — پایین‌تنه و شکم A', tag: 'پایین‌تنه A', focus: 'چهارسر، باسن، همسترینگ و شکم', exercises: [] },
      { dayNumber: 3, dayName: 'روز ۳ — بالاتنه هایپرتروفی B', tag: 'بالاتنه B', focus: 'بالاسینه، زیربغل، بازوها', exercises: [] },
      { dayNumber: 4, dayName: 'روز ۴ — پایین‌تنه و زنجیره پشتی B', tag: 'پایین‌تنه B', focus: 'ددلیفت، پشت پا، ساق و فیله', exercises: [] }
    ]
  },
  {
    id: 'full_body',
    name: 'فول بادی جامع (۳ روز)',
    days: [
      { dayNumber: 1, dayName: 'روز ۱ — فول‌بادی تمرکز سینه و ران', tag: 'فول‌بادی A', focus: 'حرکات ترکیبی سینه و پا', exercises: [] },
      { dayNumber: 2, dayName: 'روز ۲ — فول‌بادی تمرکز پشت و همسترینگ', tag: 'فول‌بادی B', focus: 'حرکات کششی و پشت پا', exercises: [] },
      { dayNumber: 3, dayName: 'روز ۳ — فول‌بادی سرشانه و بازو', tag: 'فول‌بادی C', focus: 'سرشانه، بازوها و میان‌تنه', exercises: [] }
    ]
  },
  {
    id: 'bro_split',
    name: 'تفکیکی کلاسیک (۵ روز)',
    days: [
      { dayNumber: 1, dayName: 'روز ۱ — عضلات سینه و شکم', tag: 'سینه', focus: 'پرس‌ها و قفسه سینه', exercises: [] },
      { dayNumber: 2, dayName: 'روز ۲ — عضلات پشت و زیربغل', tag: 'پشت', focus: 'لت، بارفیکس و پارویی', exercises: [] },
      { dayNumber: 3, dayName: 'روز ۳ — عضلات سرشانه و کول', tag: 'سرشانه', focus: 'نشرها و پرس سرشانه', exercises: [] },
      { dayNumber: 4, dayName: 'روز ۴ — بازوها (جلوبازو و پشت‌بازو)', tag: 'بازو', focus: 'سوپرست‌های اختصاصی بازو', exercises: [] },
      { dayNumber: 5, dayName: 'روز ۵ — عضلات پا و ساق', tag: 'پا', focus: 'اسکات، پرس پا و ساق', exercises: [] }
    ]
  }
];

function startPlanRebuild() {
  isRebuildingPlan = true;
  renderPlanWizard('ai');
}

function cancelPlanRebuild() {
  if (activeUserPlan) {
    isRebuildingPlan = false;
    renderActivePlan();
  }
}

/**
 * Render Plan Setup Wizard
 * @param {'choice' | 'ai' | 'manual'} mode
 */
function renderPlanWizard(mode = 'ai') {
  const wizardSection = document.getElementById('planWizardSection');
  const activePlanSection = document.getElementById('activePlanSection');
  const topNav = document.getElementById('planTopNav');

  if (activePlanSection) activePlanSection.style.display = 'none';
  if (topNav) topNav.style.display = 'none';
  if (!wizardSection) return;

  wizardSection.style.display = 'block';

  if (mode === 'choice') {
    mode = 'ai'; // Default directly to intuitive tabbed interface
  }

  if (mode === 'ai') {
    renderAiQuestionnaire();
  } else if (mode === 'manual') {
    renderManualPlanBuilder();
  }
}

/**
 * Render Top Switcher Tabs between AI and Manual
 */
function renderPlanMakerTabsHtml(currentMode) {
  return `
    <div class="plan-maker-tabs">
      <button type="button" class="plan-maker-tab-btn ${currentMode === 'ai' ? 'active' : ''}" onclick="renderPlanWizard('ai')">
        <span>✨ طراحی هوشمند با هوش مصنوعی</span>
      </button>
      <button type="button" class="plan-maker-tab-btn ${currentMode === 'manual' ? 'active' : ''}" onclick="renderPlanWizard('manual')">
        <span>🛠️ طراحی دستی و سفارشی</span>
      </button>
    </div>
  `;
}

/**
 * Render Step-by-Step AI Questionnaire
 */
function renderAiQuestionnaire() {
  const wizardSection = document.getElementById('planWizardSection');
  if (!wizardSection) return;

  wizardSection.innerHTML = `
    <div class="wizard-container">
      ${renderPlanMakerTabsHtml('ai')}

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;border-bottom:1px solid var(--line);padding-bottom:10px;">
        <div>
          <h3 style="margin:0;font-size:15px;color:var(--text);font-weight:700;">طراحی هوشمند برنامه با هوش مصنوعی</h3>
          <div style="font-size:11.5px;color:var(--muted);margin-top:2px;">
            سیستم علمی CSCS بر اساس اهداف و امکانات شما بهترین تقسیم‌بندی روزها و حرکات را تنظیم می‌کند.
          </div>
        </div>
        ${activeUserPlan ? `
          <button type="button" class="btn" onclick="cancelPlanRebuild()" style="font-size:11px;padding:4px 10px;">
            ✕ بازگشت به برنامه فعال
          </button>
        ` : ''}
      </div>

      <!-- سوال ۱: محل تمرین -->
      <div class="wizard-q-label">۱. محل اصلی تمرین شما کجاست؟</div>
      <div class="wizard-options-grid">
        <div class="wizard-option-card ${aiWizardData.location === 'gym' ? 'active' : ''}" onclick="selectAiLocation('gym')">
          🏢 باشگاه بدنسازی
        </div>
        <div class="wizard-option-card ${aiWizardData.location === 'home' ? 'active' : ''}" onclick="selectAiLocation('home')">
          🏠 خانه (تمرین خانگی)
        </div>
        <div class="wizard-option-card ${aiWizardData.location === 'hybrid' ? 'active' : ''}" onclick="selectAiLocation('hybrid')">
          🔄 ترکیبی (باشگاه و خانه)
        </div>
      </div>

      <!-- سوال ۲: تجهیزات در دسترس -->
      <div class="wizard-q-label">۲. چه وسایل و تجهیزاتی در اختیار دارید؟</div>
      <div id="aiEquipmentOptions" class="wizard-options-grid">
        ${renderEquipmentOptionsHtml()}
      </div>

      <!-- سوال ۳: هدف اصلی -->
      <div class="wizard-q-label">۳. هدف اصلی شما از تمرین چیست؟</div>
      <div class="wizard-options-grid">
        <div class="wizard-option-card ${aiWizardData.goal === 'hypertrophy' ? 'active' : ''}" onclick="selectAiGoal('hypertrophy')">
          🎯 عضله‌سازی و افزایش حجم
        </div>
        <div class="wizard-option-card ${aiWizardData.goal === 'strength' ? 'active' : ''}" onclick="selectAiGoal('strength')">
          ⚡ افزایش قدرت و توان
        </div>
        <div class="wizard-option-card ${aiWizardData.goal === 'fat_loss' ? 'active' : ''}" onclick="selectAiGoal('fat_loss')">
          🔥 چربی‌سوزی و تفکیک (کات)
        </div>
        <div class="wizard-option-card ${aiWizardData.goal === 'calisthenics' ? 'active' : ''}" onclick="selectAiGoal('calisthenics')">
          🤸 کالیستنیکس و وزن بدن
        </div>
        <div class="wizard-option-card ${aiWizardData.goal === 'general_fitness' ? 'active' : ''}" onclick="selectAiGoal('general_fitness')">
          🏃 تناسب اندام و سلامت عمومی
        </div>
      </div>

      <!-- سوال ۴: سابقه تمرین -->
      <div class="wizard-q-label">۴. سابقه و سطح آمادگی تمرینی شما:</div>
      <div class="wizard-options-grid">
        <div class="wizard-option-card ${aiWizardData.experience === 'beginner' ? 'active' : ''}" onclick="selectAiExperience('beginner')">
          🌱 مبتدی (زیر ۶ ماه)
        </div>
        <div class="wizard-option-card ${aiWizardData.experience === 'intermediate' ? 'active' : ''}" onclick="selectAiExperience('intermediate')">
          🌿 متوسط (۶ ماه تا ۲ سال)
        </div>
        <div class="wizard-option-card ${aiWizardData.experience === 'advanced' ? 'active' : ''}" onclick="selectAiExperience('advanced')">
          🌳 پیشرفته (بیش از ۲ سال)
        </div>
      </div>

      <!-- سوال ۵: تعداد روزها -->
      <div class="wizard-q-label">۵. چند روز در هفته مایل به تمرین هستید؟</div>
      <div class="wizard-options-grid">
        <div class="wizard-option-card ${aiWizardData.daysPerWeek === 2 ? 'active' : ''}" onclick="selectAiDays(2)">
          ۲ روز در هفته
        </div>
        <div class="wizard-option-card ${aiWizardData.daysPerWeek === 3 ? 'active' : ''}" onclick="selectAiDays(3)">
          ۳ روز در هفته
        </div>
        <div class="wizard-option-card ${aiWizardData.daysPerWeek === 4 ? 'active' : ''}" onclick="selectAiDays(4)">
          ۴ روز در هفته (پیشنهادی)
        </div>
        <div class="wizard-option-card ${aiWizardData.daysPerWeek === 5 ? 'active' : ''}" onclick="selectAiDays(5)">
          ۵ روز در هفته
        </div>
        <div class="wizard-option-card ${aiWizardData.daysPerWeek === 6 ? 'active' : ''}" onclick="selectAiDays(6)">
          ۶ روز در هفته
        </div>
      </div>

      <!-- سوال ۶: یادداشت خاص یا آسیب‌دیدگی -->
      <div class="wizard-q-label">۶. یادداشت، محدودیت پزشکی یا تمرکز عضلانی (اختیاری):</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
        <button type="button" class="quick-val-pill" onclick="setQuickInjury('بدون محدودیت')">بدون محدودیت</button>
        <button type="button" class="quick-val-pill" onclick="setQuickInjury('کمردرد خفیف')">کمردرد خفیف</button>
        <button type="button" class="quick-val-pill" onclick="setQuickInjury('زانودرد')">زانودرد</button>
        <button type="button" class="quick-val-pill" onclick="setQuickInjury('درد شانه')">درد شانه</button>
        <button type="button" class="quick-val-pill" onclick="setQuickInjury('تمرکز روی بازو و سرشانه')">تمرکز روی بازو و سرشانه</button>
      </div>
      <input type="text" id="aiInjuriesInput" placeholder="مثلاً: درد زانو دارم، تمرکز بیشتر روی سرشانه و بازو باشد..." value="${escapeHtml(aiWizardData.injuriesNotes)}" oninput="aiWizardData.injuriesNotes = this.value" style="font-size:12.5px;padding:8px 10px;margin-bottom:16px;">

      <button type="button" class="primary" style="width:100%;font-size:14px;padding:12px 0;margin:0;" onclick="submitAiPlanGeneration()">
        🚀 ساخت و فعال‌سازی برنامه من با هوش مصنوعی
      </button>
    </div>
  `;
}

function setQuickInjury(val) {
  aiWizardData.injuriesNotes = val;
  const input = document.getElementById('aiInjuriesInput');
  if (input) input.value = val;
}

function renderEquipmentOptionsHtml() {
  if (aiWizardData.location === 'gym') {
    return `
      <div class="wizard-option-card active" style="grid-column: 1 / -1;text-align:center;">
        ✅ کلیه تجهیزات کامل باشگاه بدنسازی (هالتر، دمبل، دستگاه‌ها، سیم‌کش)
      </div>
    `;
  }

  const items = [
    { id: 'dumbbell', name: '🏋️ دمبل' },
    { id: 'bodyweight', name: '🤸 فقط وزن بدن (بدون وسیله)' },
    { id: 'resistance_band', name: '🎗️ کش تمرینی' },
    { id: 'pullup_bar', name: '🚪 میله بارفیکس' },
    { id: 'bench', name: '🪑 نیمکت تمرین' }
  ];

  return items.map(item => {
    const isSelected = aiWizardData.equipment.includes(item.id);
    return `
      <div class="wizard-option-card ${isSelected ? 'active' : ''}" onclick="toggleAiEquipment('${item.id}')">
        ${item.name}
      </div>
    `;
  }).join('');
}

function selectAiLocation(loc) {
  aiWizardData.location = loc;
  if (loc === 'gym') {
    aiWizardData.equipment = ['all_gym'];
  } else {
    aiWizardData.equipment = ['bodyweight', 'dumbbell'];
  }
  renderAiQuestionnaire();
}

function toggleAiEquipment(equipId) {
  if (aiWizardData.equipment.includes(equipId)) {
    aiWizardData.equipment = aiWizardData.equipment.filter(x => x !== equipId);
    if (aiWizardData.equipment.length === 0) aiWizardData.equipment = ['bodyweight'];
  } else {
    aiWizardData.equipment.push(equipId);
  }
  const container = document.getElementById('aiEquipmentOptions');
  if (container) container.innerHTML = renderEquipmentOptionsHtml();
}

function selectAiGoal(goal) {
  aiWizardData.goal = goal;
  renderAiQuestionnaire();
}

function selectAiExperience(exp) {
  aiWizardData.experience = exp;
  renderAiQuestionnaire();
}

function selectAiDays(days) {
  aiWizardData.daysPerWeek = days;
  renderAiQuestionnaire();
}

/**
 * Submit AI Generation Request
 */
async function submitAiPlanGeneration() {
  const wizardSection = document.getElementById('planWizardSection');
  if (!wizardSection) return;

  const notesInput = document.getElementById('aiInjuriesInput');
  if (notesInput) aiWizardData.injuriesNotes = notesInput.value;

  // Render smooth AI loader
  wizardSection.innerHTML = `
    <div class="wizard-container">
      <div class="ai-loading-box">
        <div class="ai-spinner"></div>
        <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:8px;">
          هوش مصنوعی در حال تحلیل شرایط و طراحی برنامه شماست...
        </div>
        <div style="font-size:12px;color:var(--muted);line-height:1.7;max-width:400px;margin:0 auto;">
          چینش بهینه حرکات چندمفصلی، تنظیم استراحت، ست‌ها، دامنه‌های تکرار علمی و اتصال مستقیم به ویدیوهای یوتیوب. لطفاً چند لحظه شکیبا باشید.
        </div>
      </div>
    </div>
  `;

  try {
    const res = await apiFetch('/api/plan/generate-ai', {
      method: 'POST',
      body: JSON.stringify(aiWizardData)
    });

    const data = await parseResponseJson(res);
    if (res && res.ok && data && (data.success || data.plan)) {
      activeUserPlan = data.plan;
      isRebuildingPlan = false;
      showToast('برنامه اختصاصی شما با موفقیت ساخته و فعال شد! 🎉', 'success');
      try {
        renderActivePlan();
      } catch (rErr) {
        console.warn('Notice when rendering active plan:', rErr);
      }
      return;
    }

    const errorMsg = (data && data.message) || (res ? `خطای سرور (${res.status})` : 'خطا در تولید برنامه');
    showToast(errorMsg, 'error');
    renderPlanWizard('ai');
  } catch (err) {
    showToast(err.message || 'خطا در برقراری ارتباط با سرور برنامه هوشمند', 'error');
    renderPlanWizard('ai');
  }
}

/* ==========================================================================
   MANUAL PLAN BUILDER (REDESIGNED FROM BASE)
   ========================================================================== */

function renderManualPlanBuilder() {
  const wizardSection = document.getElementById('planWizardSection');
  if (!wizardSection) return;

  if (manualBuilderSelectedDayIndex >= manualBuilderDays.length) {
    manualBuilderSelectedDayIndex = 0;
  }

  const currentDay = manualBuilderDays[manualBuilderSelectedDayIndex] || manualBuilderDays[0];
  const totalExercises = manualBuilderDays.reduce((acc, d) => acc + (d.exercises ? d.exercises.length : 0), 0);

  wizardSection.innerHTML = `
    <div class="wizard-container">
      ${renderPlanMakerTabsHtml('manual')}

      <!-- هدر و تنظیمات کلی برنامه دستی -->
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;border-bottom:1px solid var(--line);padding-bottom:10px;flex-wrap:wrap;gap:8px;">
        <div>
          <h3 style="margin:0;font-size:15px;color:var(--text);font-weight:700;">طراحی دستی برنامه تمرینی</h3>
          <div style="font-size:11.5px;color:var(--muted);margin-top:2px;">
            نام برنامه، روزها و حرکات دلخواه را از بانک ۲۲۰+ حرکت انتخاب و به صورت کامل تنظیم کنید.
          </div>
        </div>
        ${activeUserPlan ? `
          <button type="button" class="btn" onclick="cancelPlanRebuild()" style="font-size:11px;padding:4px 10px;">
            ✕ بازگشت به برنامه فعال
          </button>
        ` : ''}
      </div>

      <!-- فیلد نام برنامه تمرینی -->
      <div style="background:var(--surface-2);border-radius:8px;padding:12px;margin-bottom:14px;border:1px solid var(--line);">
        <label style="font-size:11.5px;color:var(--muted);display:block;margin-bottom:4px;font-weight:600;">نام برنامه تمرینی شما:</label>
        <input type="text" value="${escapeHtml(manualPlanMeta.planName)}" oninput="updateManualPlanName(this.value)" placeholder="مثلاً: برنامه ۴ روزه حجم بالاتنه / پایین‌تنه من" style="font-size:13px;font-weight:700;padding:8px 10px;margin:0;">
      </div>

      <!-- انتخاب الگوهای سریع اسپلیت -->
      <div style="margin-bottom:10px;">
        <div style="font-size:11.5px;color:var(--muted);margin-bottom:6px;font-weight:600;">الگوهای آماده تقسیم‌بندی روزها (اسپلیت):</div>
        <div class="split-presets-row">
          ${MANUAL_SPLIT_PRESETS.map(p => `
            <button type="button" class="split-preset-chip" onclick="applySplitPreset('${p.id}')">
              ⚡ ${p.name}
            </button>
          `).join('')}
        </div>
      </div>

      <!-- تب‌های روزهای تمرینی دستی -->
      <div style="display:flex;gap:6px;overflow-x:auto;margin-bottom:12px;padding-bottom:4px;">
        ${manualBuilderDays.map((d, idx) => `
          <button type="button" class="manual-day-chip ${idx === manualBuilderSelectedDayIndex ? 'active' : ''}" onclick="selectManualDay(${idx})">
            <span>${escapeHtml(d.dayName || `روز ${idx + 1}`)}</span>
            <span style="font-size:10px;background:var(--surface);padding:1px 6px;border-radius:10px;border:1px solid var(--line);">
              ${faDigits((d.exercises || []).length)}
            </span>
          </button>
        `).join('')}
        <button type="button" class="plan-btn-mini" onclick="addManualDay()" style="font-size:11.5px;padding:6px 12px;white-space:nowrap;">
          + روز جدید
        </button>
      </div>

      <!-- تنظیمات روز انتخابی -->
      <div style="background:var(--surface-2);border-radius:8px;padding:12px;margin-bottom:14px;border:1px solid var(--line);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px;">
          <div style="font-size:12.5px;font-weight:700;color:var(--text);">
            ویرایش روز ${faDigits(manualBuilderSelectedDayIndex + 1)} (${faDigits((currentDay.exercises || []).length)} حرکت)
          </div>
          ${manualBuilderDays.length > 1 ? `
            <button type="button" onclick="removeManualDay(${manualBuilderSelectedDayIndex})" style="background:none;border:none;color:var(--danger);font-size:11.5px;cursor:pointer;padding:2px 6px;">
              🗑️ حذف این روز
            </button>
          ` : ''}
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
          <div>
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px;">عنوان روز:</label>
            <input type="text" value="${escapeHtml(currentDay.dayName)}" oninput="updateManualDayName(${manualBuilderSelectedDayIndex}, this.value)" style="font-size:12px;padding:6px 8px;margin:0;">
          </div>
          <div>
            <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:3px;">عضلات هدف / تمرکز:</label>
            <input type="text" value="${escapeHtml(currentDay.focus || '')}" oninput="updateManualDayFocus(${manualBuilderSelectedDayIndex}, this.value)" placeholder="سینه، سرشانه، زیربغل..." style="font-size:12px;padding:6px 8px;margin:0;">
          </div>
        </div>
      </div>

      <!-- لیست حرکات این روز -->
      <div style="margin-bottom:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <span style="font-size:13px;font-weight:700;color:var(--text);">حرکات ورزشی این جلسه:</span>
          <button type="button" class="primary" style="width:auto;margin:0;padding:6px 12px;font-size:12px;" onclick="openExerciseCatalogModal(false, true)">
            ➕ افزودن از بانک حرکات (۲۲۰+)
          </button>
        </div>

        ${(!currentDay.exercises || currentDay.exercises.length === 0) ? `
          <div style="text-align:center;padding:32px 14px;border:1px dashed var(--line);border-radius:10px;color:var(--muted);font-size:12.5px;background:var(--surface-2);">
            <div>هنوز حرکتی برای این روز انتخاب نکرده‌اید.</div>
            <button type="button" class="primary" style="width:auto;margin:12px auto 0;padding:7px 16px;font-size:12px;" onclick="openExerciseCatalogModal(false, true)">
              ➕ باز کردن بانک حرکات و انتخاب حرکات
            </button>
          </div>
        ` : `
          <div style="display:flex;flex-direction:column;gap:10px;">
            ${currentDay.exercises.map((ex, exIdx) => renderManualExerciseRowHtml(ex, manualBuilderSelectedDayIndex, exIdx)).join('')}
          </div>
        `}
      </div>

      <!-- دکمه نهایی ثبت برنامه -->
      <div style="margin-top:16px;border-top:1px solid var(--line);padding-top:14px;">
        <button type="button" class="primary" style="width:100%;font-size:14px;font-weight:700;padding:12px 0;margin:0;" onclick="submitManualPlan()">
          💾 ذخیره و فعال‌سازی این برنامه تمرینی (${faDigits(totalExercises)} حرکت کل) 🚀
        </button>
      </div>
    </div>
  `;
}

function renderManualExerciseRowHtml(ex, dayIdx, exIdx) {
  const sets = Number(ex.sets) || 3;
  const reps = ex.reps || '۸ تا ۱۲';
  const rest = ex.rest || '۹۰ ثانیه';
  const rpe = ex.rpe || 8;
  const youtubeUrl = ex.youtube || `https://www.youtube.com/results?search_query=${encodeURIComponent((ex.name || ex.nameFa) + ' form')}`;

  return `
    <div class="manual-ex-row">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
        <div style="display:flex;align-items:center;gap:10px;">
          ${getExerciseThumbnailSvg(ex.category)}
          <div>
            <div style="font-size:13.5px;font-weight:700;color:var(--text);">${escapeHtml(ex.nameFa || ex.name)}</div>
            <div style="font-size:11px;color:var(--muted);direction:ltr;text-align:right;">${escapeHtml(ex.name)}</div>
            <div style="display:flex;gap:4px;margin-top:3px;">
              <span class="tag-badge accent">${escapeHtml(ex.target || '')}</span>
              <span class="tag-badge">${escapeHtml(ex.equipment || '')}</span>
            </div>
          </div>
        </div>

        <div style="display:flex;align-items:center;gap:4px;">
          <a href="${escapeHtml(youtubeUrl)}" target="_blank" rel="noopener noreferrer" class="youtube-action-btn" title="مشاهده ویدیو در یوتیوب">
            🎬
          </a>
          <button type="button" onclick="moveManualExercise(${dayIdx}, ${exIdx}, -1)" class="manual-stepper-btn" title="انتقال به بالا">⬆️</button>
          <button type="button" onclick="moveManualExercise(${dayIdx}, ${exIdx}, 1)" class="manual-stepper-btn" title="انتقال به پایین">⬇️</button>
          <button type="button" onclick="removeExerciseFromManualDay(${dayIdx}, ${exIdx})" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:16px;padding:2px 6px;" title="حذف حرکت">✕</button>
        </div>
      </div>

      <!-- کنترل‌های ست، تکرار، استراحت و RPE -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(110px, 1fr));gap:8px;background:var(--surface);padding:8px 10px;border-radius:8px;border:1px solid var(--line);">
        <!-- تعداد ست -->
        <div>
          <label style="font-size:10.5px;color:var(--muted);display:block;margin-bottom:2px;">تعداد ست:</label>
          <div style="display:flex;align-items:center;gap:6px;">
            <button type="button" class="manual-stepper-btn" onclick="updateManualExSets(${dayIdx}, ${exIdx}, -1)">−</button>
            <span style="font-size:12px;font-weight:700;min-width:32px;text-align:center;">${faDigits(sets)} ست</span>
            <button type="button" class="manual-stepper-btn" onclick="updateManualExSets(${dayIdx}, ${exIdx}, 1)">+</button>
          </div>
        </div>

        <!-- دامنه تکرار -->
        <div>
          <label style="font-size:10.5px;color:var(--muted);display:block;margin-bottom:2px;">دامنه تکرار:</label>
          <input type="text" value="${escapeHtml(reps)}" onchange="updateManualExReps(${dayIdx}, ${exIdx}, this.value)" style="font-size:11.5px;padding:4px 6px;margin:0;">
        </div>

        <!-- زمان استراحت -->
        <div>
          <label style="font-size:10.5px;color:var(--muted);display:block;margin-bottom:2px;">استراحت بین ست:</label>
          <input type="text" value="${escapeHtml(rest)}" onchange="updateManualExRest(${dayIdx}, ${exIdx}, this.value)" style="font-size:11.5px;padding:4px 6px;margin:0;">
        </div>

        <!-- فشار تمرین (RPE) -->
        <div>
          <label style="font-size:10.5px;color:var(--muted);display:block;margin-bottom:2px;">شدت (RPE):</label>
          <select onchange="updateManualExRpe(${dayIdx}, ${exIdx}, this.value)" style="font-size:11px;padding:4px 6px;margin:0;">
            <option value="7" ${rpe == 7 ? 'selected' : ''}>RPE 7 (۳ تکرار تا ناتوانی)</option>
            <option value="7.5" ${rpe == 7.5 ? 'selected' : ''}>RPE 7.5 (۲-۳ تکرار)</option>
            <option value="8" ${rpe == 8 ? 'selected' : ''}>RPE 8 (۲ تکرار تا ناتوانی)</option>
            <option value="8.5" ${rpe == 8.5 ? 'selected' : ''}>RPE 8.5 (۱-۲ تکرار)</option>
            <option value="9" ${rpe == 9 ? 'selected' : ''}>RPE 9 (۱ تکرار تا ناتوانی)</option>
            <option value="10" ${rpe == 10 ? 'selected' : ''}>RPE 10 (ناتوانی کامل)</option>
          </select>
        </div>
      </div>
    </div>
  `;
}

function updateManualPlanName(val) {
  manualPlanMeta.planName = val || 'برنامه تمرینی دست‌ساز من';
}

function applySplitPreset(presetId) {
  const preset = MANUAL_SPLIT_PRESETS.find(p => p.id === presetId);
  if (!preset) return;

  manualBuilderDays = JSON.parse(JSON.stringify(preset.days));
  manualBuilderSelectedDayIndex = 0;
  manualPlanMeta.planName = `برنامه ${preset.name}`;
  showToast(`الگوی ${preset.name} اعمال شد! اکنون حرکات را اضافه کنید.`, 'success');
  renderManualPlanBuilder();
}

function selectManualDay(idx) {
  manualBuilderSelectedDayIndex = idx;
  renderManualPlanBuilder();
}

function addManualDay() {
  if (manualBuilderDays.length >= 7) {
    showToast('حداکثر ۷ روز تمرینی در هفته مجاز است.', 'error');
    return;
  }
  const nextNum = manualBuilderDays.length + 1;
  manualBuilderDays.push({
    dayNumber: nextNum,
    dayName: `روز ${nextNum} — تمرین تکمیلی`,
    tag: `روز ${nextNum}`,
    focus: 'عضلات هدف',
    exercises: []
  });
  manualBuilderSelectedDayIndex = manualBuilderDays.length - 1;
  renderManualPlanBuilder();
}

function removeManualDay(idx) {
  if (manualBuilderDays.length <= 1) {
    showToast('برنامه باید حداقل ۱ روز تمرینی داشته باشد.', 'error');
    return;
  }
  manualBuilderDays.splice(idx, 1);
  // Re-index days
  manualBuilderDays.forEach((d, i) => {
    d.dayNumber = i + 1;
    if (d.dayName.startsWith('روز ')) {
      const parts = d.dayName.split('—');
      if (parts.length > 1) {
        d.dayName = `روز ${i + 1} —${parts.slice(1).join('—')}`;
      }
    }
  });
  manualBuilderSelectedDayIndex = Math.max(0, idx - 1);
  renderManualPlanBuilder();
}

function updateManualDayName(dayIdx, name) {
  if (manualBuilderDays[dayIdx]) {
    manualBuilderDays[dayIdx].dayName = name;
  }
}

function updateManualDayFocus(dayIdx, focus) {
  if (manualBuilderDays[dayIdx]) {
    manualBuilderDays[dayIdx].focus = focus;
  }
}

function updateManualExSets(dayIdx, exIdx, delta) {
  const day = manualBuilderDays[dayIdx];
  if (!day || !day.exercises[exIdx]) return;
  const current = Number(day.exercises[exIdx].sets) || 3;
  day.exercises[exIdx].sets = Math.max(1, Math.min(10, current + delta));
  renderManualPlanBuilder();
}

function updateManualExReps(dayIdx, exIdx, reps) {
  const day = manualBuilderDays[dayIdx];
  if (!day || !day.exercises[exIdx]) return;
  day.exercises[exIdx].reps = reps;
}

function updateManualExRest(dayIdx, exIdx, rest) {
  const day = manualBuilderDays[dayIdx];
  if (!day || !day.exercises[exIdx]) return;
  day.exercises[exIdx].rest = rest;
}

function updateManualExRpe(dayIdx, exIdx, rpe) {
  const day = manualBuilderDays[dayIdx];
  if (!day || !day.exercises[exIdx]) return;
  day.exercises[exIdx].rpe = Number(rpe);
}

function moveManualExercise(dayIdx, exIdx, direction) {
  const day = manualBuilderDays[dayIdx];
  if (!day || !day.exercises) return;
  const targetIdx = exIdx + direction;
  if (targetIdx < 0 || targetIdx >= day.exercises.length) return;
  const temp = day.exercises[exIdx];
  day.exercises[exIdx] = day.exercises[targetIdx];
  day.exercises[targetIdx] = temp;
  renderManualPlanBuilder();
}

function removeExerciseFromManualDay(dayIdx, exIdx) {
  if (manualBuilderDays[dayIdx]) {
    manualBuilderDays[dayIdx].exercises.splice(exIdx, 1);
    renderManualPlanBuilder();
  }
}

async function submitManualPlan() {
  const totalEx = manualBuilderDays.reduce((acc, d) => acc + (d.exercises ? d.exercises.length : 0), 0);
  if (totalEx === 0) {
    showToast('لطفاً حداقل ۱ حرکت ورزشی به روزهای برنامه خود اضافه کنید.', 'error');
    return;
  }

  try {
    const res = await apiFetch('/api/plan/save-custom', {
      method: 'POST',
      body: JSON.stringify({
        planName: manualPlanMeta.planName || 'برنامه تمرینی دست‌ساز من',
        daysPerWeek: manualBuilderDays.length,
        goal: manualPlanMeta.goal || 'hypertrophy',
        location: manualPlanMeta.location || 'gym',
        experience: manualPlanMeta.experience || 'intermediate',
        days: manualBuilderDays
      })
    });

    const data = await parseResponseJson(res);
    if (res && res.ok && data && (data.success || data.plan)) {
      activeUserPlan = data.plan;
      isRebuildingPlan = false;
      showToast('برنامه اختصاصی دست‌ساز شما با موفقیت ذخیره و فعال شد! 🎉', 'success');
      try {
        renderActivePlan();
      } catch (rErr) {
        console.warn('Notice when rendering active plan:', rErr);
      }
      return;
    }

    const err = (data && data.message) || 'خطا در ثبت برنامه دست‌ساز';
    showToast(err, 'error');
  } catch (err) {
    showToast(err.message || 'خطا در اتصال به سرور', 'error');
  }
}

/* ==========================================================================
   ACTIVE CUSTOMIZED PLAN DISPLAY & TRACKER
   ========================================================================== */

function renderActivePlan() {
  const wizardSection = document.getElementById('planWizardSection');
  const activePlanSection = document.getElementById('activePlanSection');
  const topNav = document.getElementById('planTopNav');
  const planNameDisplay = document.getElementById('planNameDisplay');
  const planSourceBadge = document.getElementById('planSourceBadge');

  if (wizardSection) wizardSection.style.display = 'none';
  if (activePlanSection) activePlanSection.style.display = 'block';
  if (topNav) topNav.style.display = 'flex';

  if (!activeUserPlan || !activeUserPlan.days || activeUserPlan.days.length === 0) {
    renderPlanWizard('choice');
    return;
  }

  // Update Top Nav
  if (planNameDisplay) planNameDisplay.textContent = activeUserPlan.planName || 'برنامه اختصاصی شما';
  if (planSourceBadge) {
    if (activeUserPlan.source === 'ai') {
      planSourceBadge.className = 'plan-badge-ai';
      planSourceBadge.textContent = '✨ هوش مصنوعی';
    } else {
      planSourceBadge.className = 'plan-badge-custom';
      planSourceBadge.textContent = '🛠️ برنامه دست‌ساز';
    }
  }

  // Render Day Selector Tabs
  const daysBar = document.getElementById('planDaysTabs');
  if (daysBar) {
    daysBar.innerHTML = activeUserPlan.days.map((d, idx) => `
      <div class="custom-day-chip ${idx === currentSelectedDayIndex ? 'active' : ''}" onclick="selectActiveDayIndex(${idx})">
        <div>${escapeHtml(d.dayName || `روز ${idx + 1}`)}</div>
        <div style="font-size:10px;opacity:0.8;margin-top:2px;">${escapeHtml(d.tag || '')}</div>
      </div>
    `).join('');
  }

  // Selected Day Information
  const day = activeUserPlan.days[currentSelectedDayIndex] || activeUserPlan.days[0];
  const titleEl = document.getElementById('selectedDayTitle');
  const focusEl = document.getElementById('selectedDayFocus');

  if (titleEl) titleEl.textContent = day.dayName || `روز ${currentSelectedDayIndex + 1}`;
  if (focusEl) focusEl.textContent = day.focus || 'تقویت و اضافه بار عضلات هدف';

  // Render Exercises for the Selected Day
  const exContainer = document.getElementById('planExercisesContainer');
  if (!exContainer) return;

  if (!day.exercises || day.exercises.length === 0) {
    exContainer.innerHTML = `
      <div style="text-align:center;padding:30px 10px;border:1px dashed var(--line);border-radius:10px;color:var(--muted);font-size:13px;">
        حرکتی در این روز تعریف نشده است.
        <div style="margin-top:10px;">
          <button type="button" class="primary" style="width:auto;margin:0;padding:6px 14px;font-size:12px;" onclick="openExerciseCatalogModal(true)">
            ➕ افزودن حرکت از بانک ۲۲۰+ حرکت
          </button>
        </div>
      </div>
    `;
    return;
  }

  let coachBannerHtml = '';
  if (day.coachTips && (day.coachTips.warmup || day.coachTips.focus || day.coachTips.overload)) {
    coachBannerHtml = `
      <div class="day-coach-banner">
        <div class="coach-head">
          <span style="font-size:16px;">🧠</span>
          <span>راهنمای مربی هوشمند این جلسه:</span>
        </div>
        <div class="coach-body">
          ${day.coachTips.warmup ? `<div>🏃 <b>گرم‌کردن اختصاصی:</b> ${escapeHtml(day.coachTips.warmup)}</div>` : ''}
          ${day.coachTips.focus ? `<div>🎯 <b>استراتژی جلسه:</b> ${escapeHtml(day.coachTips.focus)}</div>` : ''}
          ${day.coachTips.overload ? `<div>📈 <b>هدف اضافه بار:</b> ${escapeHtml(day.coachTips.overload)}</div>` : ''}
        </div>
      </div>
    `;
  }

  exContainer.innerHTML = coachBannerHtml + day.exercises.map((ex, exIndex) => renderExerciseCardHtml(ex, exIndex)).join('');
}

function selectActiveDayIndex(idx) {
  currentSelectedDayIndex = idx;
  renderActivePlan();
}

/**
 * Render Rich Exercise Card with Thumbnail Image & YouTube Video Link
 */
function renderExerciseCardHtml(ex, exIndex) {
  const setsCount = Number(ex.sets) || 3;
  const youtubeUrl = ex.youtube || `https://www.youtube.com/results?search_query=${encodeURIComponent((ex.name || ex.nameFa) + ' form')}`;

  // Find existing logs for this exercise today if any (most recent entry)
  const todayStr = todayISO();
  const existingLog = workoutLogs.slice().reverse().find(l => 
    (l.exerciseName === ex.name || l.exerciseName === ex.nameFa || l.exercise_name === ex.name || l.exercise_name === ex.nameFa) &&
    (l.logDate === todayStr || l.log_date === todayStr)
  );

  // Find most recent previous session log for ghost record / previous benchmark
  const previousLog = workoutLogs.slice().reverse().find(l => 
    (l.exerciseName === ex.name || l.exerciseName === ex.nameFa || l.exercise_name === ex.name || l.exercise_name === ex.nameFa) &&
    (l.logDate !== todayStr && l.log_date !== todayStr)
  );

  let prevRecordHintHtml = '';
  let prevWeightVal = '';
  if (previousLog) {
    const pw = previousLog.weightKg !== undefined ? previousLog.weightKg : previousLog.weight_kg;
    prevWeightVal = pw !== null && pw !== undefined ? String(pw) : '';
    const prArr = Array.isArray(previousLog.reps) ? previousLog.reps : [previousLog.reps];
    const prRpe = Array.isArray(previousLog.rpe) ? previousLog.rpe : [];
    const validPrevRpes = prRpe.filter(v => typeof v === 'number' && !isNaN(v));
    const avgPrevRpe = validPrevRpes.length > 0 ? (validPrevRpes.reduce((a, b) => a + b, 0) / validPrevRpes.length).toFixed(1) : '';

    prevRecordHintHtml = `
      <div class="previous-record-hint">
        <div>📊 رکورد جلسه قبل: <span class="pr-val">${faDigits(pw || 0)} kg × ${faDigits(prArr.join('-'))}</span> ${avgPrevRpe ? `<span class="rpe-tag-badge ${getRpeClass(avgPrevRpe)}">RPE ${faDigits(avgPrevRpe)}</span>` : ''}</div>
        <div style="font-size:10px;color:var(--muted);">${escapeHtml(previousLog.logDate || previousLog.log_date || '')}</div>
      </div>
    `;
  }

  const loggedReps = (existingLog && existingLog.reps) || [];
  const loggedWeight = (existingLog && (existingLog.weightKg || existingLog.weight_kg)) || '';
  const loggedRpe = (existingLog && existingLog.rpe) || [];

  // Check if average RPE is available for today's log
  let avgRpeBadgeHtml = '';
  if (loggedRpe && loggedRpe.length > 0) {
    const validRpes = loggedRpe.filter(v => typeof v === 'number' && !isNaN(v));
    if (validRpes.length > 0) {
      const avg = (validRpes.reduce((a, b) => a + b, 0) / validRpes.length).toFixed(1);
      avgRpeBadgeHtml = `<span class="rpe-tag-badge ${getRpeClass(avg)}" title="میانگین شدت RPE ست‌های ثبت‌شده امروز">شدت: RPE ${faDigits(avg)}</span>`;
    }
  }

  let setsRowsHtml = '';
  for (let s = 1; s <= setsCount; s++) {
    const repVal = loggedReps[s - 1] !== undefined ? loggedReps[s - 1] : '';
    const rpeVal = loggedRpe[s - 1] !== undefined ? loggedRpe[s - 1] : '';
    const weightPlaceholder = prevWeightVal ? `قبل: ${faDigits(prevWeightVal)}` : 'وزنه (kg)';

    setsRowsHtml += `
      <div class="set-row-box" style="display:flex;align-items:center;justify-content:space-between;gap:6px;padding:6px 0;border-top:1px solid var(--line);">
        <span style="font-size:12px;font-weight:700;color:var(--muted);width:42px;">ست ${faDigits(s)}</span>
        <div style="display:flex;align-items:center;gap:6px;flex:1;">
          <input type="text" inputmode="decimal" placeholder="${weightPlaceholder}" value="${loggedWeight !== '' ? loggedWeight : ''}" 
            id="weight_${exIndex}_${s}" 
            oninput="debouncedAutoSaveSet(${exIndex})" 
            onchange="autoSaveSet(${exIndex})" 
            style="font-size:11.5px;padding:5px 6px;margin:0;width:75px;text-align:center;">
          <input type="number" placeholder="تکرار (${escapeHtml(ex.reps || '۸-۱۲')})" value="${repVal}" 
            id="reps_${exIndex}_${s}" 
            oninput="debouncedAutoSaveSet(${exIndex})" 
            onchange="autoSaveSet(${exIndex})" 
            style="font-size:11.5px;padding:5px 6px;margin:0;width:75px;text-align:center;">
          <select id="rpe_${exIndex}_${s}" 
            onchange="onRpeSelectChange(${exIndex}, ${s})" 
            class="rpe-select ${getRpeClass(rpeVal)}"
            style="font-size:11px;padding:5px 3px;margin:0;width:105px;text-align:center;"
            title="میزان درک سختی (RPE) ست ${s}">
            <option value="">RPE —</option>
            <option value="10" ${rpeVal == 10 ? 'selected' : ''}>۱۰ (نهایت توان)</option>
            <option value="9.5" ${rpeVal == 9.5 ? 'selected' : ''}>۹.۵ (مرز شکست)</option>
            <option value="9" ${rpeVal == 9 ? 'selected' : ''}>۹ (۱ تکرار ذخیره)</option>
            <option value="8.5" ${rpeVal == 8.5 ? 'selected' : ''}>۸.۵ (۱-۲ ذخیره)</option>
            <option value="8" ${rpeVal == 8 ? 'selected' : ''}>۸ (۲ تکرار ذخیره)</option>
            <option value="7.5" ${rpeVal == 7.5 ? 'selected' : ''}>۷.۵ (۲-۳ ذخیره)</option>
            <option value="7" ${rpeVal == 7 ? 'selected' : ''}>۷ (۳ تکرار ذخیره)</option>
            <option value="6.5" ${rpeVal == 6.5 ? 'selected' : ''}>۶.۵ (۳-۴ ذخیره)</option>
            <option value="6" ${rpeVal == 6 ? 'selected' : ''}>۶ (گرم‌کردن / سبک)</option>
            <option value="5" ${rpeVal == 5 ? 'selected' : ''}>۵ (بسیار سبک)</option>
          </select>
        </div>
        <button type="button" class="btn" style="width:auto;margin:0;padding:4px 8px;font-size:11px;" onclick="triggerRestTimerFromExercise('${escapeHtml(ex.rest || '۹۰ ثانیه')}')" title="شروع استراحت">
          ⏱️ استراحت
        </button>
      </div>
    `;
  }

  return `
    <div class="exercise-rich-card" id="exCard_${exIndex}">
      <div class="exercise-top-row">
        <!-- تصویر / شماتیک حرکت -->
        ${getExerciseThumbnailSvg(ex.category)}

        <!-- نام و مشخصات حرکت -->
        <div class="exercise-title-area">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:6px;">
            <div class="exercise-title-fa">${escapeHtml(ex.nameFa || ex.name)}</div>
            <!-- دکمه ویدیوی یوتیوب -->
            <a href="${escapeHtml(youtubeUrl)}" target="_blank" rel="noopener noreferrer" class="youtube-action-btn" title="مشاهده ویدیو اجرای صحیح در یوتیوب">
              🎬 تماشا در یوتیوب
            </a>
          </div>
          <div class="exercise-title-en">${escapeHtml(ex.name || '')}</div>

          <div class="exercise-badges-row">
            <span class="tag-badge accent">${faDigits(ex.sets || 3)} ست × ${escapeHtml(ex.reps || '۸ تا ۱۲')}</span>
            <span class="tag-badge">استراحت: ${escapeHtml(ex.rest || '۹۰ ثانیه')}</span>
            ${ex.rir !== undefined ? `<span class="tag-badge">RIR: ${faDigits(ex.rir)}</span>` : ''}
            ${avgRpeBadgeHtml}
            ${ex.target ? `<span class="tag-badge">${escapeHtml(ex.target)}</span>` : ''}
          </div>
        </div>
      </div>

      <!-- تکنیک و اشتباه رایج -->
      ${ex.tech ? `
        <div style="margin-top:8px;font-size:11.5px;color:var(--text);line-height:1.6;background:var(--surface-2);padding:6px 10px;border-radius:6px;">
          <span style="color:var(--accent);font-weight:700;">💡 تکنیک اجرا:</span> ${escapeHtml(ex.tech)}
        </div>
      ` : ''}

      ${ex.mistake ? `
        <div style="margin-top:4px;font-size:11px;color:var(--warn);line-height:1.5;">
          <span style="font-weight:700;">⚠️ اشتباه رایج:</span> ${escapeHtml(ex.mistake)}
        </div>
      ` : ''}

      <!-- رکورد جلسه قبلی (Ghost Record) برای اضافه بار آگاهانه -->
      ${prevRecordHintHtml}

      <!-- جدول ثبت ست‌ها و رکوردها همراه با RPE -->
      <div style="margin-top:10px;">
        <div class="sets-table-header">
          <span style="width:42px;text-align:right;">ست</span>
          <div style="display:flex;align-items:center;gap:6px;flex:1;">
            <span style="width:75px;text-align:center;">وزنه (kg)</span>
            <span style="width:75px;text-align:center;">تکرار</span>
            <span style="width:105px;text-align:center;display:flex;align-items:center;justify-content:center;gap:3px;">
              شدت RPE
              <span onclick="openRpeGuideModal()" style="cursor:pointer;color:var(--accent);font-size:12px;" title="راهنمای مقیاس RPE">ℹ️</span>
            </span>
          </div>
          <span style="width:70px;text-align:center;">استراحت</span>
        </div>
        ${setsRowsHtml}
      </div>

      <!-- نوار اقدام سریع حرکت: تعویض هوشمند، مشاوره مربی، افزودن/کاهش ست و حذف -->
      <div class="card-action-bar">
        <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;">
          <button type="button" class="action-chip-btn accent" onclick="openSwapExerciseModal(${exIndex}, ${ex.id || 'null'})" title="انتخاب حرکت جایگزین هم‌گروه">
            🔄 تعویض حرکت
          </button>
          <button type="button" class="action-chip-btn" onclick="openSmartAdviceModal(${exIndex}, '${escapeHtml(ex.nameFa || ex.name)}')" title="مشاوره اضافه بار تدریجی مربی">
            💡 مشاوره وزنه
          </button>
        </div>
        <div style="display:flex;gap:4px;align-items:center;">
          <button type="button" class="action-chip-btn" onclick="adjustExerciseSets(${exIndex}, 1)" title="افزودن ۱ ست به این حرکت">+ ست</button>
          <button type="button" class="action-chip-btn" onclick="adjustExerciseSets(${exIndex}, -1)" title="کاهش ۱ ست">- ست</button>
          <button type="button" class="action-chip-btn danger" onclick="deleteExerciseFromActiveDay(${exIndex})" title="حذف این حرکت از برنامه امروز">🗑️</button>
        </div>
      </div>
    </div>
  `;
}

function getRpeClass(rpe) {
  const num = parseFloat(rpe);
  if (isNaN(num)) return '';
  if (num >= 9.5) return 'rpe-extreme';
  if (num >= 8.5) return 'rpe-hard';
  if (num >= 7.5) return 'rpe-optimal';
  if (num >= 6.5) return 'rpe-moderate';
  return 'rpe-light';
}

function onRpeSelectChange(exIndex, s) {
  const sel = document.getElementById(`rpe_${exIndex}_${s}`);
  if (sel) {
    sel.className = 'rpe-select ' + getRpeClass(sel.value);
  }
  autoSaveSet(exIndex);
}

function openRpeGuideModal() {
  const m = document.getElementById('rpeGuideModal');
  if (m) m.style.display = 'flex';
}

function closeRpeGuideModal() {
  const m = document.getElementById('rpeGuideModal');
  if (m) m.style.display = 'none';
}

let autoSaveDebounceTimers = {};
function debouncedAutoSaveSet(exIndex, delay = 400) {
  if (autoSaveDebounceTimers[exIndex]) {
    clearTimeout(autoSaveDebounceTimers[exIndex]);
  }
  autoSaveDebounceTimers[exIndex] = setTimeout(() => {
    autoSaveSet(exIndex);
  }, delay);
}

/**
 * Auto-Save set log to database with RPE support
 */
async function autoSaveSet(exIndex) {
  const day = activeUserPlan?.days?.[currentSelectedDayIndex];
  if (!day) return;
  const ex = day.exercises?.[exIndex];
  if (!ex) return;

  const setsCount = Number(ex.sets) || 3;
  const reps = [];
  const rir = [];
  const rpe = [];
  let weightKg = null;

  for (let s = 1; s <= setsCount; s++) {
    const wInput = document.getElementById(`weight_${exIndex}_${s}`);
    const rInput = document.getElementById(`reps_${exIndex}_${s}`);
    const rpeSelect = document.getElementById(`rpe_${exIndex}_${s}`);

    if (wInput && wInput.value && !weightKg) {
      weightKg = parseUserNumber(wInput.value);
    }
    if (rInput && rInput.value) {
      reps.push(Number(rInput.value));
    }
    if (rpeSelect && rpeSelect.value) {
      const val = parseFloat(rpeSelect.value);
      if (!isNaN(val)) {
        rpe.push(val);
        // Corresponding RIR calculation: max(0, 10 - RPE)
        rir.push(Math.max(0, Math.round((10 - val) * 2) / 2));
      }
    }
  }

  if (reps.length === 0 && !weightKg && rpe.length === 0) return;

  try {
    const payload = {
      programMode: activeUserPlan.source || 'custom',
      exerciseName: ex.nameFa || ex.name,
      logDate: todayISO(),
      weightKg: weightKg || 0,
      reps: reps.length > 0 ? reps : [10],
      rir: rir.length > 0 ? rir : [ex.rir !== undefined ? ex.rir : 2],
      notes: `برنامه: ${activeUserPlan.planName || ''}`
    };
    if (rpe.length > 0) {
      payload.rpe = rpe;
    }

    const res = await apiFetch('/workouts', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      const saved = await parseResponseJson(res);
      const exIdx = workoutLogs.findIndex(l => 
        (l.exerciseName === ex.name || l.exerciseName === ex.nameFa || l.exercise_name === ex.name || l.exercise_name === ex.nameFa) &&
        (l.logDate === todayISO() || l.log_date === todayISO())
      );
      if (exIdx !== -1) {
        workoutLogs[exIdx] = saved;
      } else {
        workoutLogs.push(saved);
      }
      const statSessionsEl = document.getElementById('statSessions');
      if (statSessionsEl) statSessionsEl.textContent = faDigits(workoutLogs.length);
      const rpeSummary = rpe.length > 0 ? ` (RPE: ${rpe.join('/')})` : '';
      showToast(`ثبت شد: ${ex.nameFa}${rpeSummary}`, 'success');
    }
  } catch (err) {
    console.warn('[autoSaveSet warning]:', err.message);
  }
}

/* ==========================================================================
   REST TIMER DOCK LOGIC
   ========================================================================== */

function triggerRestTimerFromExercise(restStr) {
  let seconds = 90;
  if (typeof restStr === 'string') {
    if (restStr.includes('۶۰') || restStr.includes('60')) seconds = 60;
    else if (restStr.includes('۴۵') || restStr.includes('45')) seconds = 45;
    else if (restStr.includes('۳۰') || restStr.includes('30')) seconds = 30;
    else if (restStr.includes('۱۲۰') || restStr.includes('120') || restStr.includes('۲ دقیقه')) seconds = 120;
    else if (restStr.includes('۱۸۰') || restStr.includes('180') || restStr.includes('۳ دقیقه')) seconds = 180;
  }
  startRestTimer(seconds);
}

function startRestTimer(seconds) {
  clearInterval(timerInterval);
  timerTotalSeconds = seconds;
  timerRemainingSeconds = seconds;
  isTimerPaused = false;

  const dock = document.getElementById('timerDock');
  if (dock) dock.style.display = 'flex';
  updateTimerDockDisplay();

  timerInterval = setInterval(() => {
    if (!isTimerPaused) {
      timerRemainingSeconds--;
      updateTimerDockDisplay();
      if (timerRemainingSeconds <= 0) {
        clearInterval(timerInterval);
        playTimerBeep();
        showToast('⏱️ زمان استراحت به پایان رسید! ست بعدی را پرقدرت شروع کنید.', 'success');
        stopRestTimer();
      }
    }
  }, 1000);
}

function updateTimerDockDisplay() {
  const textEl = document.getElementById('dockTimerText');
  const progEl = document.getElementById('dockTimerProgress');

  const m = Math.floor(timerRemainingSeconds / 60);
  const s = timerRemainingSeconds % 60;
  const formatted = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

  if (textEl) textEl.textContent = faDigits(formatted);
  if (progEl && timerTotalSeconds > 0) {
    const pct = ((timerTotalSeconds - timerRemainingSeconds) / timerTotalSeconds) * 100;
    progEl.style.width = `${pct}%`;
  }
}

function togglePauseTimer() {
  isTimerPaused = !isTimerPaused;
  const btn = document.getElementById('dockPauseBtn');
  if (btn) btn.textContent = isTimerPaused ? 'ادامه' : 'مکث';
}

function addTimerSeconds(s) {
  timerRemainingSeconds += s;
  timerTotalSeconds += s;
  updateTimerDockDisplay();
}

function stopRestTimer() {
  clearInterval(timerInterval);
  const dock = document.getElementById('timerDock');
  if (dock) dock.style.display = 'none';
}

/* ==========================================================================
   EXERCISE CATALOG MODAL (220+ Exercises Browser)
   ========================================================================== */

let catalogOpeningMode = 'active';

async function openExerciseCatalogModal(forActive = false, forManual = false) {
  catalogOpeningMode = forManual ? 'manual' : (forActive ? 'active' : (activeUserPlan ? 'active' : 'manual'));
  catalogForActiveDay = (catalogOpeningMode === 'active');
  const modal = document.getElementById('exerciseCatalogModal');
  if (!modal) return;

  modal.style.display = 'flex';

  if (cachedCatalogExercises.length === 0) {
    try {
      const res = await apiFetch('/api/exercises?limit=250');
      if (res.ok) {
        const data = await parseResponseJson(res);
        cachedCatalogExercises = data.exercises || [];
      }
    } catch (e) {
      console.warn('Failed to load exercises catalog:', e);
    }
  }

  filterCatalogExercises();
}

function closeExerciseCatalogModal() {
  const modal = document.getElementById('exerciseCatalogModal');
  if (modal) modal.style.display = 'none';
  if (!catalogForActiveDay) {
    renderManualPlanBuilder();
  }
}

function setCatalogLocationFilter(loc) {
  catalogLocationFilter = loc;
  document.querySelectorAll('[data-loc]').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-loc') === loc);
  });
  filterCatalogExercises();
}

function filterCatalogExercises() {
  const container = document.getElementById('catalogListContainer');
  if (!container) return;

  const catSelect = document.getElementById('catalogCatSelect');
  const equipSelect = document.getElementById('catalogEquipSelect');
  const searchInput = document.getElementById('catalogSearchInput');

  const selectedCat = catSelect ? catSelect.value : 'all';
  const selectedEquip = equipSelect ? equipSelect.value : 'all';
  const query = searchInput ? searchInput.value.toLowerCase().trim() : '';

  let list = cachedCatalogExercises;

  if (catalogLocationFilter !== 'all') {
    list = list.filter(e => e.location === catalogLocationFilter || e.location === 'all');
  }
  if (selectedCat !== 'all') {
    list = list.filter(e => e.category === selectedCat);
  }
  if (selectedEquip !== 'all') {
    list = list.filter(e => e.equipment === selectedEquip);
  }
  if (query) {
    list = list.filter(e => 
      e.name.toLowerCase().includes(query) || 
      e.nameFa.includes(query) ||
      (e.target && e.target.includes(query))
    );
  }

  if (list.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:40px 10px;color:var(--muted);font-size:13px;">
        حرکتی با فیلترهای انتخابی یافت نشد.
      </div>
    `;
    return;
  }

  const currentManualDay = (!catalogForActiveDay && manualBuilderDays[manualBuilderSelectedDayIndex]) 
    ? manualBuilderDays[manualBuilderSelectedDayIndex] 
    : null;

  container.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;font-size:11.5px;color:var(--muted);margin-bottom:8px;">
      <span>نمایش ${faDigits(list.length)} حرکت ورزشی:</span>
      ${currentManualDay ? `
        <span style="color:var(--accent);font-weight:700;">
          انتخاب برای: ${escapeHtml(currentManualDay.dayName)} (${faDigits((currentManualDay.exercises || []).length)} حرکت افزوده شده)
        </span>
      ` : ''}
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;">
      ${list.map(ex => `
        <div class="catalog-item-card">
          <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">
            ${getExerciseThumbnailSvg(ex.category)}
            <div style="flex:1;min-width:0;">
              <div style="font-size:13px;font-weight:700;color:var(--text);">${escapeHtml(ex.nameFa)}</div>
              <div style="font-size:11px;color:var(--muted);direction:ltr;text-align:right;">${escapeHtml(ex.name)}</div>
              <div style="display:flex;gap:4px;margin-top:4px;flex-wrap:wrap;">
                <span class="tag-badge accent">${escapeHtml(ex.target || '')}</span>
                <span class="tag-badge">${escapeHtml(ex.equipment || '')}</span>
              </div>
            </div>
          </div>

          <div style="display:flex;align-items:center;gap:6px;">
            <a href="${escapeHtml(ex.youtube)}" target="_blank" rel="noopener noreferrer" class="youtube-action-btn" title="مشاهده ویدیو در یوتیوب">
              🎬 یوتیوب
            </a>
            <button type="button" class="primary" style="width:auto;margin:0;padding:5px 10px;font-size:11px;" onclick="addExerciseToPlan(${ex.id}, this)">
              + افزودن
            </button>
          </div>
        </div>
      `).join('')}
    </div>

    <!-- نوار چسبان پایین مودال برای اتمام انتخاب -->
    <div style="position:sticky;bottom:0;background:var(--surface);padding:10px 0;margin-top:14px;border-top:1px solid var(--line);text-align:center;">
      <button type="button" class="primary" style="width:100%;font-size:13px;padding:9px 0;" onclick="closeExerciseCatalogModal()">
        ✓ تایید و بازگشت به برنامه
      </button>
    </div>
  `;
}

/**
 * Add chosen exercise to current active day or manual builder
 */
async function addExerciseToPlan(exerciseId, btn = null) {
  const ex = cachedCatalogExercises.find(e => e.id === Number(exerciseId));
  if (!ex) return;

  const normalizedEx = {
    id: ex.id,
    name: ex.name,
    nameFa: ex.nameFa,
    category: ex.category || 'full_body',
    equipment: ex.equipment || 'bodyweight',
    target: ex.target || 'عضلات هدف',
    sets: ex.defaultSets || 3,
    reps: ex.defaultReps || '۸ تا ۱۲',
    rpe: 8,
    rir: 2,
    rest: ex.defaultRest || '۹۰ ثانیه',
    tech: ex.tech || '',
    mistake: ex.mistake || '',
    youtube: ex.youtube || `https://www.youtube.com/results?search_query=${encodeURIComponent((ex.name || ex.nameFa) + ' form exercise')}`
  };

  if (catalogForActiveDay && activeUserPlan) {
    const day = activeUserPlan.days[currentSelectedDayIndex];
    if (!day) return;

    day.exercises = day.exercises || [];
    day.exercises.push(normalizedEx);

    try {
      await apiFetch('/api/plan/current', {
        method: 'PUT',
        body: JSON.stringify({
          id: activeUserPlan.id,
          days: activeUserPlan.days
        })
      });
      showToast(`حرکت ${ex.nameFa} به برنامه فعال اضافه شد!`, 'success');
      closeExerciseCatalogModal();
      renderActivePlan();
    } catch (e) {
      showToast('خطا در به‌روزرسانی برنامه', 'error');
    }
  } else {
    // Adding to manual builder
    const day = manualBuilderDays[manualBuilderSelectedDayIndex];
    if (day) {
      day.exercises = day.exercises || [];
      day.exercises.push(normalizedEx);

      if (btn) {
        const origText = btn.textContent;
        btn.textContent = '✅ افزوده شد';
        btn.style.background = '#10b981';
        btn.style.borderColor = '#10b981';
        setTimeout(() => {
          if (btn) {
            btn.textContent = origText;
            btn.style.background = '';
            btn.style.borderColor = '';
          }
        }, 1200);
      }

      showToast(`حرکت ${ex.nameFa} به ${day.dayName} اضافه شد`, 'success');
      filterCatalogExercises();
      renderManualPlanBuilder();
    }
  }
}

/* ==========================================================================
   DIET PLAN TEASER MODAL
   ========================================================================== */

function openDietPlanModal() {
  const modal = document.getElementById('dietPlanModal');
  if (modal) modal.style.display = 'flex';
}

function closeDietPlanModal() {
  const modal = document.getElementById('dietPlanModal');
  if (modal) modal.style.display = 'none';
}

/* ==========================================================================
   CUSTOM EXERCISE SUBMISSION (Legacy Compatibility)
   ========================================================================== */

function openAddExerciseModal() {
  const modal = document.getElementById('addCustomExModal');
  if (modal) modal.style.display = 'flex';
}

function closeAddExerciseModal() {
  const modal = document.getElementById('addCustomExModal');
  if (modal) modal.style.display = 'none';
}

async function submitCustomExercise() {
  const nameFa = document.getElementById('customExNameFa')?.value.trim();
  const nameEn = document.getElementById('customExNameEn')?.value.trim();
  const day = Number(document.getElementById('customExDay')?.value || 1);
  const sets = Number(document.getElementById('customExSets')?.value || 3);
  const reps = document.getElementById('customExReps')?.value.trim() || '۸ تا ۱۲';
  const rest = document.getElementById('customExRest')?.value.trim() || '۹۰ ثانیه';

  if (!nameFa) {
    showToast('لطفاً نام فارسی حرکت را وارد کنید', 'error');
    return;
  }

  try {
    await apiFetch('/custom-exercises', {
      method: 'POST',
      body: JSON.stringify({
        programMode: activeUserPlan?.source || 'custom',
        dayNumber: day,
        name: nameEn || nameFa,
        nameFa: nameFa,
        sets,
        reps,
        rest,
        equip: 'دلخواه'
      })
    });
    showToast('حرکت اختصاصی با موفقیت ثبت شد', 'success');
    closeAddExerciseModal();
    loadUserPlan();
  } catch (err) {
    showToast('خطا در ثبت حرکت اختصاصی', 'error');
  }
}

/* ==========================================================================
   SMART COACH & UX EXTENSIONS (Audio chime, Quick Swap, Smart Advice)
   ========================================================================== */

function playTimerBeep() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.15); // A5
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.6);
    }
  } catch (e) {}
  if (navigator.vibrate) {
    try { navigator.vibrate([200, 100, 200]); } catch (e) {}
  }
}

let activeSwapExerciseIndex = null;

async function openSwapExerciseModal(exIndex, exerciseId) {
  activeSwapExerciseIndex = exIndex;
  const modal = document.getElementById('swapExerciseModal');
  const container = document.getElementById('swapListContainer');
  const title = document.getElementById('swapModalTitle');
  const subtitle = document.getElementById('swapModalSubtitle');

  if (!modal) return;
  modal.style.display = 'flex';

  const day = activeUserPlan?.days?.[currentSelectedDayIndex];
  const currentEx = day?.exercises?.[exIndex];
  const displayName = currentEx ? (currentEx.nameFa || currentEx.name) : 'حرکت جاری';

  if (title) title.textContent = `🔄 انتخاب جایگزین برای: ${displayName}`;
  if (subtitle) subtitle.textContent = currentEx?.category ? `حرکات استاندارد متناسب با گروه عضلانی «${displayName}»` : 'حرکات متناسب';
  if (container) container.innerHTML = '<div style="text-align:center;padding:30px 10px;color:var(--muted);"><div class="ai-spinner"></div>در حال بارگذاری بهترین گزینه‌های جایگزین...</div>';

  try {
    const res = await apiFetch(`/api/plan/alternatives?exerciseId=${encodeURIComponent(exerciseId || currentEx?.id || 1)}`);
    if (res.ok) {
      const data = await parseResponseJson(res);
      const alternatives = data.alternatives || [];
      if (alternatives.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:30px 10px;color:var(--muted);">حرکت جایگزین دیگری برای این حرکت یافت نشد.</div>';
        return;
      }

      container.innerHTML = `
        <div style="font-size:11.5px;color:var(--muted);margin-bottom:10px;">
          گزینه‌های پیشنهادی بر اساس هماهنگی عضلانی و تجهیزات:
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${alternatives.map(alt => `
            <div class="catalog-item-card">
              <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">
                ${getExerciseThumbnailSvg(alt.category)}
                <div style="flex:1;min-width:0;">
                  <div style="font-size:13px;font-weight:700;color:var(--text);">${escapeHtml(alt.nameFa)}</div>
                  <div style="font-size:11px;color:var(--muted);direction:ltr;text-align:right;">${escapeHtml(alt.name)}</div>
                  <div style="display:flex;gap:4px;margin-top:4px;flex-wrap:wrap;">
                    <span class="tag-badge accent">${escapeHtml(alt.target || '')}</span>
                    <span class="tag-badge">${escapeHtml(alt.equipment || '')}</span>
                  </div>
                </div>
              </div>

              <div style="display:flex;align-items:center;gap:6px;">
                <a href="${escapeHtml(alt.youtube || `https://www.youtube.com/results?search_query=${encodeURIComponent(alt.name + ' form')}`)}" target="_blank" rel="noopener noreferrer" class="youtube-action-btn" title="مشاهده ویدیو">
                  🎬
                </a>
                <button type="button" class="primary" style="width:auto;margin:0;padding:6px 12px;font-size:11.5px;" onclick="executeSwapExercise(${exIndex}, ${alt.id})">
                  🔄 جایگزینی
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      `;
      return;
    }
  } catch (err) {
    console.error('Error fetching alternatives:', err);
  }

  if (container) {
    container.innerHTML = '<div style="text-align:center;padding:30px 10px;color:var(--danger);">خطا در دریافت لیست جایگزین‌ها.</div>';
  }
}

function closeSwapExerciseModal() {
  const modal = document.getElementById('swapExerciseModal');
  if (modal) modal.style.display = 'none';
  activeSwapExerciseIndex = null;
}

async function executeSwapExercise(exIndex, newExId) {
  try {
    const res = await apiFetch('/api/plan/swap-exercise', {
      method: 'POST',
      body: JSON.stringify({
        dayIndex: currentSelectedDayIndex,
        exerciseIndex: exIndex,
        newExerciseId: newExId
      })
    });

    if (res.ok) {
      const data = await parseResponseJson(res);
      if (data && data.success && data.days) {
        activeUserPlan.days = data.days;
        showToast(data.message || 'حرکت با موفقیت جایگزین شد! 🎉', 'success');
        closeSwapExerciseModal();
        renderActivePlan();
        return;
      }
    }
    const err = await parseResponseJson(res);
    showToast(err.message || 'خطا در جایگزینی حرکت', 'error');
  } catch (err) {
    showToast('خطا در اتصال به سرور جهت جایگزینی حرکت', 'error');
  }
}

async function adjustExerciseSets(exIndex, delta) {
  try {
    const res = await apiFetch('/api/plan/adjust-sets', {
      method: 'POST',
      body: JSON.stringify({
        dayIndex: currentSelectedDayIndex,
        exerciseIndex: exIndex,
        delta: delta
      })
    });

    if (res.ok) {
      const data = await parseResponseJson(res);
      if (data && data.success && data.days) {
        activeUserPlan.days = data.days;
        renderActivePlan();
        showToast(`تعداد ست‌ها به ${faDigits(data.newSets)} تغییر یافت.`, 'success');
        return;
      }
    }
    showToast('خطا در تغییر ست‌ها', 'error');
  } catch (e) {
    showToast('خطا در اتصال به سرور', 'error');
  }
}

async function deleteExerciseFromActiveDay(exIndex) {
  const day = activeUserPlan?.days?.[currentSelectedDayIndex];
  const ex = day?.exercises?.[exIndex];
  const name = ex?.nameFa || ex?.name || 'این حرکت';

  if (!confirm(`آیا مطمئن هستید که می‌خواهید «${name}» را از برنامه امروز حذف کنید؟`)) {
    return;
  }

  try {
    const res = await apiFetch('/api/plan/exercise', {
      method: 'DELETE',
      body: JSON.stringify({
        dayIndex: currentSelectedDayIndex,
        exerciseIndex: exIndex
      })
    });

    if (res.ok) {
      const data = await parseResponseJson(res);
      if (data && data.success && data.days) {
        activeUserPlan.days = data.days;
        renderActivePlan();
        showToast(data.message || 'حرکت حذف شد.', 'success');
        return;
      }
    }
    showToast('خطا در حذف حرکت', 'error');
  } catch (e) {
    showToast('خطا در اتصال به سرور', 'error');
  }
}

async function openSmartAdviceModal(exIndex, exerciseName) {
  const modal = document.getElementById('smartAdviceModal');
  const content = document.getElementById('adviceModalContent');
  const title = document.getElementById('adviceModalTitle');

  if (!modal) return;
  modal.style.display = 'flex';

  if (title) title.textContent = `مشاوره هوشمند: ${exerciseName}`;
  if (content) content.innerHTML = '<div style="text-align:center;padding:24px 0;color:var(--muted);"><div class="ai-spinner"></div>در حال تحلیل تاریخچه و شدت RPE...</div>';

  try {
    const res = await apiFetch(`/api/plan/smart-advice?exerciseName=${encodeURIComponent(exerciseName)}`);
    if (res.ok) {
      const data = await parseResponseJson(res);
      const sug = data.suggestion || {};
      const last = data.lastSession;

      let badgeClass = 'amber';
      if (sug.action === 'increase_weight') badgeClass = 'green';
      else if (sug.action === 'deload_or_form') badgeClass = 'red';

      let lastSessionHtml = '';
      if (last) {
        const repsText = Array.isArray(last.reps) ? last.reps.join('، ') : last.reps;
        lastSessionHtml = `
          <div style="background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin-bottom:12px;">
            <div style="font-size:11px;color:var(--muted);margin-bottom:4px;">📊 عملکرد جلسه گذشته (${escapeHtml(last.date || '')}):</div>
            <div style="font-size:13px;font-weight:700;color:var(--text);">
              وزنه: ${faDigits(last.weightKg)} کیلوگرم | تکرارها: [${faDigits(repsText)}]
            </div>
            ${last.avgRpe ? `
              <div style="margin-top:4px;font-size:11.5px;color:var(--accent);">
                میانگین شدت ثبت‌شده: <b>RPE ${faDigits(last.avgRpe.toFixed(1))}</b>
              </div>
            ` : ''}
          </div>
        `;
      }

      content.innerHTML = `
        ${lastSessionHtml}

        <div class="advice-card-box">
          <div class="advice-badge-chip ${badgeClass}">
            ${escapeHtml(sug.badge || '💡 پیشنهاد مربی')}
          </div>
          <div style="font-size:12.5px;line-height:1.75;color:var(--text);margin-bottom:12px;">
            ${escapeHtml(sug.text || data.message || '')}
          </div>

          ${last && (sug.action === 'increase_weight' || sug.action === 'maintain') ? `
            <button type="button" class="primary" style="width:100%;font-size:12px;padding:7px 0;margin:0;" onclick="applyAdvisedWeight(${exIndex}, ${sug.action === 'increase_weight' ? (last.weightKg + 2.5) : last.weightKg})">
              🚀 اعمال خودکار این وزنه در ست ۱ (${faDigits(sug.action === 'increase_weight' ? (last.weightKg + 2.5) : last.weightKg)} kg)
            </button>
          ` : ''}
        </div>

        <button type="button" class="btn" style="width:100%;margin-top:6px;font-size:12px;" onclick="closeSmartAdviceModal()">
          بستن
        </button>
      `;
      return;
    }
  } catch (err) {
    console.error('Smart advice error:', err);
  }

  if (content) {
    content.innerHTML = '<div style="text-align:center;padding:20px 0;color:var(--danger);">خطا در دریافت مشاوره هوشمند.</div>';
  }
}

function closeSmartAdviceModal() {
  const modal = document.getElementById('smartAdviceModal');
  if (modal) modal.style.display = 'none';
}

function applyAdvisedWeight(exIndex, weightVal) {
  const input = document.getElementById(`weight_${exIndex}_1`);
  if (input) {
    input.value = weightVal;
    input.focus();
    autoSaveSet(exIndex);
    showToast(`وزنه ${faDigits(weightVal)} کیلوگرم برای ست اول اعمال شد.`, 'success');
    closeSmartAdviceModal();
  }
}

