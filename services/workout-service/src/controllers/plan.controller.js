import { GoogleGenAI } from '@google/genai';
import { pool } from '../config/db.js';
import { 
  EXERCISES_LIBRARY, 
  EXERCISE_CATEGORIES, 
  EQUIPMENT_TYPES, 
  LOCATION_TYPES, 
  queryExercises, 
  getExerciseById 
} from '../data/exercises.data.js';

// Safe Gemini client initialization
let genAI = null;
try {
  if (process.env.GEMINI_API_KEY) {
    genAI = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });
  }
} catch (err) {
  console.warn('[Gemini Plan Controller] Initialization notice:', err.message);
}

/**
 * Classify exercise biomechanically to enforce CSCS compound-first sequencing
 */
function classifyExerciseMovement(ex) {
  const text = (ex.name + ' ' + ex.nameFa + ' ' + (ex.target || '')).toLowerCase();
  
  const isPrimaryHeavy = /اسکات پا|ددلیفت|پرس سینه هالتر|پرس سینه دمبل|بارفیکس|پرس سرشانه هالتر|زیربغل هالتر خم|front squat|back squat|barbell bench press|deadlift/i.test(text);
  const isCompound = isPrimaryHeavy || /اسکات|squat|پرس|press|ددلیفت|deadlift|زیربغل|row|تی بار|t-bar|بارفیکس|pull.?up|لت|lat pulldown|دیپ|dip|لانج|lunge/i.test(text);
  const isCore = ex.category === 'abs_core' || /پلانک|شکم|کرانچ|core|plank/i.test(text);

  return {
    isPrimaryHeavy,
    isCompound,
    isCore,
    tier: isPrimaryHeavy ? 1 : (isCompound ? 2 : (isCore ? 4 : 3))
  };
}

/**
 * Get active plan for currently authenticated user
 */
export async function getCurrentPlan(req, res) {
  try {
    const userId = req.userId || req.user?.userId;
    const result = await pool.query(
      `SELECT * FROM user_plans WHERE user_id = $1 AND is_active = true ORDER BY id DESC LIMIT 1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({ hasPlan: false, plan: null });
    }

    const row = result.rows[0];
    let planData = row.plan_data;
    if (typeof planData === 'string') {
      try { planData = JSON.parse(planData); } catch (e) {}
    }
    let equipment = row.equipment;
    if (typeof equipment === 'string') {
      try { equipment = JSON.parse(equipment); } catch (e) {}
    }

    return res.json({
      hasPlan: true,
      plan: {
        id: row.id,
        userId: row.user_id,
        planName: row.plan_name,
        source: row.source,
        goal: row.goal,
        location: row.location,
        equipment: equipment || [],
        experience: row.experience,
        daysPerWeek: row.days_per_week,
        days: planData || [],
        isActive: row.is_active,
        createdAt: row.created_at,
        updated_at: row.updated_at
      }
    });
  } catch (err) {
    console.error('[getCurrentPlan Error]:', err);
    return res.status(500).json({ message: 'خطا در بارگذاری برنامه تمرینی کاربر' });
  }
}

/**
 * Get exercise catalog with rich filters
 */
export async function getExerciseCatalog(req, res) {
  try {
    const { category, equipment, location, difficulty, query, limit, offset } = req.query;
    const data = queryExercises({
      category,
      equipment,
      location,
      difficulty,
      query,
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0
    });

    return res.json({
      categories: EXERCISE_CATEGORIES,
      equipments: EQUIPMENT_TYPES,
      locations: LOCATION_TYPES,
      total: data.total,
      exercises: data.exercises
    });
  } catch (err) {
    console.error('[getExerciseCatalog Error]:', err);
    return res.status(500).json({ message: 'خطا در دریافت بانک حرکات ورزشی' });
  }
}

/**
 * Advanced CSCS-Grounded Deterministic Plan Generator
 * Creates an optimal routine with compound-first sequencing, tiered volume/RPE/rest,
 * anti-repetition tracking across days, and personalized warm-up/overload coach tips.
 */
function generateDeterministicPlan({ location, equipment, goal, experience, daysPerWeek, injuriesNotes, userHistory = [] }) {
  const isGym = location === 'gym' || (Array.isArray(equipment) && equipment.includes('all_gym'));
  const hasDumbbells = Array.isArray(equipment) && equipment.includes('dumbbell');
  const hasBands = Array.isArray(equipment) && equipment.includes('resistance_band');
  const onlyBodyweight = !isGym && !hasDumbbells && (!equipment || equipment.length === 0 || (equipment.length === 1 && equipment[0] === 'bodyweight'));

  const numDays = Math.min(Math.max(Number(daysPerWeek) || 3, 2), 6);

  // Goal & Experience-calibrated parameters
  const goalConfig = {
    hypertrophy: {
      compoundSets: 3, compoundReps: '۶ تا ۱۰', compoundRpe: 8, compoundRest: '۱۲۰ ثانیه',
      isolationSets: 3, isolationReps: '۱۰ تا ۱۲', isolationRpe: 8.5, isolationRest: '۷۵ تا ۹۰ ثانیه',
      coreSets: 3, coreReps: '۱۲ تا ۱۵', coreRpe: 8, coreRest: '۶۰ ثانیه'
    },
    strength: {
      compoundSets: 4, compoundReps: '۴ تا ۶', compoundRpe: 8.5, compoundRest: '۱۵۰ تا ۱۸۰ ثانیه',
      isolationSets: 3, isolationReps: '۸ تا ۱۰', isolationRpe: 8, isolationRest: '۹۰ تا ۱۲۰ ثانیه',
      coreSets: 2, coreReps: '۱۰ تا ۱۲', coreRpe: 8, coreRest: '۶۰ ثانیه'
    },
    fat_loss: {
      compoundSets: 3, compoundReps: '۱۰ تا ۱۲', compoundRpe: 8, compoundRest: '۷۵ ثانیه',
      isolationSets: 3, isolationReps: '۱۲ تا ۱۵', isolationRpe: 8.5, isolationRest: '۶۰ ثانیه',
      coreSets: 3, coreReps: '۱۵ تا ۲۰', coreRpe: 8.5, coreRest: '۴۵ ثانیه'
    },
    general_fitness: {
      compoundSets: 3, compoundReps: '۸ تا ۱۰', compoundRpe: 7.5, compoundRest: '۹۰ ثانیه',
      isolationSets: 3, isolationReps: '۱۰ تا ۱۲', isolationRpe: 8, isolationRest: '۶۰ تا ۷۵ ثانیه',
      coreSets: 2, coreReps: '۱۲ تا ۱۵', coreRpe: 7.5, coreRest: '۶۰ ثانیه'
    },
    calisthenics: {
      compoundSets: 3, compoundReps: '۸ تا ۱۲ (کنترل‌شده)', compoundRpe: 8.5, compoundRest: '۹۰ ثانیه',
      isolationSets: 3, isolationReps: '۱۰ تا ۱۵', isolationRpe: 8.5, isolationRest: '۶۰ ثانیه',
      coreSets: 3, coreReps: 'حداکثر توان تکنیکی', coreRpe: 9, coreRest: '۶۰ ثانیه'
    }
  }[goal] || {
    compoundSets: 3, compoundReps: '۸ تا ۱۲', compoundRpe: 8, compoundRest: '۹۰ ثانیه',
    isolationSets: 3, isolationReps: '۱۰ تا ۱۲', isolationRpe: 8.5, isolationRest: '۷۵ ثانیه',
    coreSets: 2, coreReps: '۱۲ تا ۱۵', coreRpe: 8, coreRest: '۶۰ ثانیه'
  };

  if (experience === 'beginner') {
    goalConfig.compoundSets = Math.max(2, goalConfig.compoundSets - 1);
    goalConfig.compoundRpe = Math.max(7, goalConfig.compoundRpe - 0.5);
    goalConfig.isolationRpe = Math.max(7.5, goalConfig.isolationRpe - 0.5);
  } else if (experience === 'advanced') {
    goalConfig.compoundSets = Math.min(4, goalConfig.compoundSets + 1);
    goalConfig.compoundRpe = Math.min(9, goalConfig.compoundRpe + 0.5);
  }

  // Injury & physical limitation filter
  const hasKneeIssue = /زانو|knee/i.test(injuriesNotes || '');
  const hasBackIssue = /کمر|مهره|دیسک|back|lumbar/i.test(injuriesNotes || '');
  const hasShoulderIssue = /شانه|کتف|shoulder/i.test(injuriesNotes || '');

  const isExerciseSafe = (ex) => {
    const text = (ex.name + ' ' + ex.nameFa + ' ' + (ex.target || '')).toLowerCase();
    if (hasKneeIssue && (text.includes('اسکات عمیق') || text.includes('جلو پا دستگاه سنگین') || text.includes('لانج پیاده‌روی'))) return false;
    if (hasBackIssue && (text.includes('ددلیفت سنتی سنگین') || text.includes('زیربغل هالتر خم سنگین') || text.includes('اسکات پشت سنگین'))) return false;
    if (hasShoulderIssue && (text.includes('پشت گردن') || text.includes('کول هالتر دست جمع') || text.includes('پرس سرشانه پشت'))) return false;
    return true;
  };

  // Filter exercises pool by user location/equipment
  const poolExercises = EXERCISES_LIBRARY.filter(e => {
    if (!isExerciseSafe(e)) return false;
    if (isGym) return true;
    if (onlyBodyweight) return e.equipment === 'bodyweight';
    if (hasDumbbells && hasBands) {
      return e.equipment === 'dumbbell' || e.equipment === 'bodyweight' || e.equipment === 'resistance_band';
    }
    if (hasDumbbells) {
      return e.equipment === 'dumbbell' || e.equipment === 'bodyweight';
    }
    if (hasBands) {
      return e.equipment === 'resistance_band' || e.equipment === 'bodyweight';
    }
    return e.location === 'home' || e.location === 'all' || e.equipment === 'bodyweight';
  });

  // Global used exercise tracker to prevent dull repetition across days
  const usedExerciseIds = new Set();

  const selectExercises = (cat, count = 2, preferredTier = null) => {
    let list = poolExercises.filter(e => e.category === cat && !usedExerciseIds.has(e.id));
    if (list.length < count) {
      // If exhausted, fallback to all valid candidates in this category
      const fallbackList = poolExercises.filter(e => e.category === cat);
      list = [...list, ...fallbackList.filter(e => !list.some(x => x.id === e.id))];
    }
    if (list.length === 0) {
      list = EXERCISES_LIBRARY.filter(e => e.category === cat);
    }

    // Sort by tier: compounds first for tier 1/2, isolations for tier 3
    list.sort((a, b) => {
      const clsA = classifyExerciseMovement(a);
      const clsB = classifyExerciseMovement(b);
      if (preferredTier) {
        const diffA = Math.abs(clsA.tier - preferredTier);
        const diffB = Math.abs(clsB.tier - preferredTier);
        if (diffA !== diffB) return diffA - diffB;
      }
      return clsA.tier - clsB.tier;
    });

    const chosen = list.slice(0, count);
    chosen.forEach(c => usedExerciseIds.add(c.id));
    return chosen;
  };

  const days = [];

  if (numDays === 2) {
    // 2 Days: Full Body A & Full Body B
    days.push({
      dayNumber: 1,
      dayName: 'روز ۱ — فول‌بادی جامع قدرتی (A)',
      tag: 'فول‌بادی A',
      focus: 'سینه، زیربغل، چهارسر ران، سرشانه و میان‌تنه',
      coachTips: {
        warmup: '۵ تا ۷ دقیقه گرم‌کردن عمومی با طناب یا پروانه + گردش مفاصل سرشانه و لگن + ۲ ست سبک افزایشی در حرکت اول',
        focus: 'تمرکز بر اجرای سنگین و قدرتی حرکات چندمفصلی پایه؛ کنترل فاز منفی تکرارها',
        overload: 'در حرکات اسکات و پرس سینه، تلاش کنید به RPE ۸ پایبند بمانید و از فرم صحیح خارج نشوید.'
      },
      exercises: [
        ...selectExercises('legs_quads', 2, 1),
        ...selectExercises('chest', 2, 1),
        ...selectExercises('back', 2, 1),
        ...selectExercises('shoulders', 1, 2),
        ...selectExercises('abs_core', 1, 4)
      ]
    });

    days.push({
      dayNumber: 2,
      dayName: 'روز ۲ — فول‌بادی هایپرتروفی و زنجیره خلفی (B)',
      tag: 'فول‌بادی B',
      focus: 'همسترینگ، باسن، بالاسینه، زیربغل، دست‌ها و ساق',
      coachTips: {
        warmup: 'کشش دینامیک همسترینگ و فعال‌سازی باسن با پل باسن + گرم‌کردن تخصصی مچ و آرنج',
        focus: 'ایجاد حداکثر پمپ عضلانی و تنش مکانیکی در زوایای تکمیلی بالاتنه و پایین‌تنه',
        overload: 'در ست‌های پایانی دست‌ها و ساق پا می‌توانید به RPE ۹ (۱ تکرار در ذخیره) برسید.'
      },
      exercises: [
        ...selectExercises('legs_hamstrings', 2, 1),
        ...selectExercises('chest', 1, 2),
        ...selectExercises('back', 2, 2),
        ...selectExercises('biceps', 1, 3),
        ...selectExercises('triceps', 1, 3),
        ...selectExercises('calves', 1, 4),
        ...selectExercises('abs_core', 1, 4)
      ]
    });
  } else if (numDays === 3) {
    // 3 Days: Push / Pull / Legs
    days.push({
      dayNumber: 1,
      dayName: 'روز ۱ — عضلات فشاری بالاتنه و چهارسر (Push & Quads)',
      tag: 'Push & Quads',
      focus: 'سینه، سرشانه، چهارسر ران و پشت‌بازو',
      coachTips: {
        warmup: 'گرم‌کردن اختصاصی روتاتور کاف شانه با کش یا وزنه سبک + اسکات با وزن بدن برای آماده‌سازی زانوها',
        focus: 'حرکات فشاری با زاویه تخت و بالاسینه همراه با اضافه بار تدریجی',
        overload: 'اگر وزنه پرس برای دامنه تکرار سبک بود، حداقل ۱ تکرار اضافه کنید سپس وزنه را در جلسه بعد ارتقا دهید.'
      },
      exercises: [
        ...selectExercises('legs_quads', 2, 1),
        ...selectExercises('chest', 2, 1),
        ...selectExercises('shoulders', 2, 2),
        ...selectExercises('triceps', 1, 3),
        ...selectExercises('abs_core', 1, 4)
      ]
    });

    days.push({
      dayNumber: 2,
      dayName: 'روز ۲ — عضلات کششی و زنجیره خلفی (Pull & Posterior)',
      tag: 'Pull & Hams',
      focus: 'پشت، زیربغل، همسترینگ، باسن و جلوبازو',
      coachTips: {
        warmup: 'آویزان شدن سبک از بارفیکس برای کشش عضلات لَت + گربه-شتر برای ستون فقرات و فیله‌ها',
        focus: 'انقباض کامل عضلات پهنای پشت در انتهای هر تکرار و مکث ۱ ثانیه‌ای در اوج انقباض',
        overload: 'در حرکات زیربغل، حرکت را با جمع کردن اسکاپولا (استخوان کتف) آغاز کنید نه فقط کشیدن آرنج.'
      },
      exercises: [
        ...selectExercises('back', 3, 1),
        ...selectExercises('legs_hamstrings', 2, 1),
        ...selectExercises('biceps', 2, 3),
        ...selectExercises('calves', 1, 4)
      ]
    });

    days.push({
      dayNumber: 3,
      dayName: 'روز ۳ — حجم و تفکیک فول‌بادی و میان‌تنه (Hypertrophy & Core)',
      tag: 'Full Hypertrophy',
      focus: 'عضلات هدف ضعیف‌تر، دلتوئید جانبی، فیله و سیکس‌پک',
      coachTips: {
        warmup: '۵ دقیقه فعال‌سازی عمومی عضلات میان‌تنه و داینامیک استرچ برای ریکاوری فعال',
        focus: 'ایزولاسیون دقیق با حفظ فرم کنترل‌شده و احساس سوزش عضلانی (Metabolic Stress)',
        overload: 'فاصله استراحت بین ست‌ها را دقیقاً رعایت کنید تا راندمان تمرینی افزایش یابد.'
      },
      exercises: [
        ...selectExercises('legs_quads', 1, 2),
        ...selectExercises('chest', 1, 2),
        ...selectExercises('back', 1, 2),
        ...selectExercises('shoulders', 2, 3),
        ...selectExercises('abs_core', 2, 4)
      ]
    });
  } else if (numDays === 4) {
    // 4 Days: Upper / Lower Split (Gold Standard Hypertrophy Split)
    days.push({
      dayNumber: 1,
      dayName: 'روز ۱ — بالاتنه قدرت و ضخامت (Upper A)',
      tag: 'بالاتنه A',
      focus: 'سینه، زیربغل، سرشانه و بازوها با اضافه بار مکانیکی',
      coachTips: {
        warmup: 'گرم‌کردن مفصل شانه با حرکات دورانی + ۲ ست با میله خالی هالتر در پرس سینه',
        focus: 'توان بیشینه در حرکات چندمفصلی پایه بالاتنه با حفظ RPE ۸ تا ۸.۵',
        overload: 'ثبت دقیق وزنه و تکرارها در اپلیکیشن برای مقایسه مستقیم در جلسه بعد.'
      },
      exercises: [
        ...selectExercises('chest', 2, 1),
        ...selectExercises('back', 2, 1),
        ...selectExercises('shoulders', 1, 2),
        ...selectExercises('triceps', 1, 3),
        ...selectExercises('biceps', 1, 3)
      ]
    });

    days.push({
      dayNumber: 2,
      dayName: 'روز ۲ — پایین‌تنه و شکم (Lower A)',
      tag: 'پایین‌تنه A',
      focus: 'چهارسر ران، همسترینگ، باسن، ساق و عضلات کور',
      coachTips: {
        warmup: 'حرکات تحرک مچ پا و لگن + لانج بدون وزنه برای گرم‌کردن زانو و کشاله ران',
        focus: 'عمق مناسب و ایمن در حرکات اسکات و کنترل فاز پایین آمدن در ۳ ثانیه',
        overload: 'از کمربند تمرینی در ست‌های پایانی سنگین اسکات در صورت نیاز استفاده کنید.'
      },
      exercises: [
        ...selectExercises('legs_quads', 2, 1),
        ...selectExercises('legs_hamstrings', 2, 1),
        ...selectExercises('calves', 1, 4),
        ...selectExercises('abs_core', 2, 4)
      ]
    });

    days.push({
      dayNumber: 3,
      dayName: 'روز ۳ — بالاتنه هایپرتروفی و زاویه‌های فرعی (Upper B)',
      tag: 'بالاتنه B',
      focus: 'بالاسینه، پهنای زیربغل، دلتوئید جانبی و پمپ عضلانی بازوها',
      coachTips: {
        warmup: 'فعال‌سازی عضله سراتوس قدامی و چرخش شانه به بیرون + گرم‌کردن با سیم‌کش سبک',
        focus: 'تمرکز بر زوایای شیب‌دار (اینکلاین) و انقباض اوج با مکث کوتاه',
        overload: 'در حرکات نشر جانب، وزنه را پرتاب نکنید؛ کنترل حرکت مهم‌تر از سنگینی وزنه است.'
      },
      exercises: [
        ...selectExercises('chest', 2, 2),
        ...selectExercises('back', 2, 2),
        ...selectExercises('shoulders', 2, 3),
        ...selectExercises('biceps', 1, 3),
        ...selectExercises('triceps', 1, 3)
      ]
    });

    days.push({
      dayNumber: 4,
      dayName: 'روز ۴ — پایین‌تنه زنجیره خلفی و میان‌تنه (Lower B)',
      tag: 'پایین‌تنه B',
      focus: 'ددلیفت رومانیایی، هیپ تراست، ساق و فرم‌دهی باسن',
      coachTips: {
        warmup: 'کشش فعال خم‌کننده‌های ران (Hip Flexors) + ۲ ست سبک هیپ هینج برای هماهنگی عصب و عضله',
        focus: 'کشش عمیق همسترینگ در پایین حرکت بدون گرد شدن ستون فقرات',
        overload: 'فشار اصلی باید از کف پا و پاشنه‌ها منتقل شود تا باسن به خوبی درگیر گردد.'
      },
      exercises: [
        ...selectExercises('legs_hamstrings', 2, 1),
        ...selectExercises('legs_quads', 2, 2),
        ...selectExercises('calves', 1, 4),
        ...selectExercises('abs_core', 2, 4)
      ]
    });
  } else {
    // 5 or 6 Days: Push / Pull / Legs Split
    days.push({
      dayNumber: 1,
      dayName: 'روز ۱ — سینه، سرشانه و پشت بازو (Push 1)',
      tag: 'Push Heavy',
      focus: 'حرکات فشاری با تاکید بر توان بیشینه و حجم سینه',
      coachTips: {
        warmup: 'گرم‌کردن کامل شانه و روتاتور کاف + ۲ ست صعودی وزنه در پرس سینه',
        focus: 'اضافه بار تدریجی در حرکات چندمفصلی سینه و سرشانه',
        overload: 'ست‌های سنگین را روی RPE ۸ نگه دارید و در ست آخر به RPE ۹ برسید.'
      },
      exercises: [
        ...selectExercises('chest', 3, 1),
        ...selectExercises('shoulders', 2, 2),
        ...selectExercises('triceps', 2, 3)
      ]
    });

    days.push({
      dayNumber: 2,
      dayName: 'روز ۲ — پشت، زیربغل و جلو بازو (Pull 1)',
      tag: 'Pull Heavy',
      focus: 'ضخامت و پهنای عضلات پشت، دلتوئید خلفی و جلو بازو',
      coachTips: {
        warmup: 'آویزان شدن از بارفیکس و چرخش دست‌ها + گرم‌کردن مچ دست و ساعد',
        focus: 'انقباض عمیق کتف‌ها و دامنه حرکتی کامل در کشش‌ها',
        overload: 'در حرکات قایقی و پارویی از حرکت دادن بیش از حد تنه به جلو و عقب خودداری کنید.'
      },
      exercises: [
        ...selectExercises('back', 3, 1),
        ...selectExercises('shoulders', 1, 3), // rear delt
        ...selectExercises('biceps', 2, 3),
        ...selectExercises('forearms', 1, 4)
      ]
    });

    days.push({
      dayNumber: 3,
      dayName: 'روز ۳ — پا، باسن و شکم (Legs 1)',
      tag: 'Legs Heavy',
      focus: 'چهارسر ران، همسترینگ، باسن، ساق و شکم',
      coachTips: {
        warmup: 'تحرک مچ پا، زانو و لگن + لانج کششی برای باز شدن خم‌کننده‌های ران',
        focus: 'اسکات عمیق با تکنیک صحیح و توزیع یکنواخت وزن روی کف پا',
        overload: 'استراحت بین ست‌های اسکات را حداقل ۲ دقیقه بگیرید تا سیستم عصبی ریکاوری شود.'
      },
      exercises: [
        ...selectExercises('legs_quads', 2, 1),
        ...selectExercises('legs_hamstrings', 2, 1),
        ...selectExercises('calves', 1, 4),
        ...selectExercises('abs_core', 2, 4)
      ]
    });

    days.push({
      dayNumber: 4,
      dayName: 'روز ۴ — سینه، سرشانه و پشت بازو هایپرتروفی (Push 2)',
      tag: 'Push Volume',
      focus: 'بالاسینه، دلتوئید میانی و تفکیک پشت‌بازو با سیم‌کش و دمبل',
      coachTips: {
        warmup: 'چرخش مفصل شانه و گرم‌کردن با کراس‌اور سبک',
        focus: 'حفظ تنش مداوم روی عضله بدون قفل کردن کامل مفاصل در بالای حرکت',
        overload: 'در ست‌های پایانی نشر از جانب می‌توانید تکرارهای نیمه نهایی تا ناتوانی کامل بزنید.'
      },
      exercises: [
        ...selectExercises('chest', 2, 2),
        ...selectExercises('shoulders', 2, 3),
        ...selectExercises('triceps', 2, 3)
      ]
    });

    days.push({
      dayNumber: 5,
      dayName: 'روز ۵ — پشت، همسترینگ و بازوها (Pull 2)',
      tag: 'Pull Volume',
      focus: 'کشش لَت، زنجیره خلفی و پیک جلوبازو',
      coachTips: {
        warmup: 'کشش دینامیک لت و گرم‌کردن فیله کمر',
        focus: 'کنترل فاز منفی تکرارها در ۳ ثانیه برای تحریک بیشینه تارهای تند انقباض',
        overload: 'در حرکات جلوبازو دمبل، از چرخش مچ (سوپینیشن) در بالای حرکت برای انقباض کامل استفاده کنید.'
      },
      exercises: [
        ...selectExercises('back', 2, 2),
        ...selectExercises('legs_hamstrings', 2, 1),
        ...selectExercises('biceps', 2, 3),
        ...selectExercises('abs_core', 2, 4)
      ]
    });

    if (numDays === 6) {
      days.push({
        dayNumber: 6,
        dayName: 'روز ۶ — پا، ساق، سرشانه و میان‌تنه (Legs & Delts)',
        tag: 'Legs & Delts',
        focus: 'چهارسر، همسترینگ، ساق، دلتوئید جانبی و شکم',
        coachTips: {
          warmup: 'گرم‌کردن کامل زانوها و مفاصل مچ پا + حرکت پروانه و پرش سبک',
          focus: 'پمپ عضلانی شدید در ساق و دلتوئیدها با زمان استراحت کوتاه‌تر (۶۰ ثانیه)',
          overload: 'ست‌های ساق پا را با مکث ۲ ثانیه‌ای در اوج کشش در پایین پله اجرا کنید.'
        },
        exercises: [
          ...selectExercises('legs_quads', 2, 2),
          ...selectExercises('shoulders', 2, 3),
          ...selectExercises('calves', 1, 4),
          ...selectExercises('abs_core', 2, 4)
        ]
      });
    }
  }

  // Format sets, reps, rpe, rest, and youtube links according to movement tier
  const formattedDays = days.map(d => ({
    ...d,
    exercises: d.exercises.map(ex => {
      const cls = classifyExerciseMovement(ex);
      let sets = goalConfig.isolationSets;
      let reps = goalConfig.isolationReps;
      let rpe = goalConfig.isolationRpe;
      let rest = goalConfig.isolationRest;

      if (cls.tier === 1) {
        sets = goalConfig.compoundSets;
        reps = goalConfig.compoundReps;
        rpe = goalConfig.compoundRpe;
        rest = goalConfig.compoundRest;
      } else if (cls.tier === 2) {
        sets = goalConfig.compoundSets;
        reps = goalConfig.isolationReps;
        rpe = goalConfig.compoundRpe;
        rest = '۹۰ تا ۱۲۰ ثانیه';
      } else if (cls.tier === 4) {
        sets = goalConfig.coreSets;
        reps = goalConfig.coreReps;
        rpe = goalConfig.coreRpe;
        rest = goalConfig.coreRest;
      }

      return {
        id: ex.id,
        name: ex.name,
        nameFa: ex.nameFa,
        category: ex.category,
        equipment: ex.equipment,
        target: ex.target,
        tier: cls.tier,
        sets,
        reps,
        rir: Math.max(0, Math.round((10 - rpe) * 2) / 2),
        rpe,
        rest,
        tech: ex.tech || '',
        mistake: ex.mistake || '',
        youtube: ex.youtube || `https://www.youtube.com/results?search_query=${encodeURIComponent(ex.name + ' form')}`
      };
    })
  }));

  const goalTitles = {
    hypertrophy: 'عضله‌سازی و افزایش حجم (هایپرتروفی)',
    fat_loss: 'چربی‌سوزی، فرم‌دهی و کات',
    strength: 'افزایش قدرت و توان بیشینه',
    general_fitness: 'تناسب اندام عمومی و استقامت بدنی',
    calisthenics: 'تسلط بر وزن بدن و کالیستنیکس'
  };

  const locTitles = {
    gym: 'باشگاه بدنسازی',
    home: 'خانه',
    hybrid: 'ترکیبی خانه و باشگاه'
  };

  const planName = `برنامه اختصاصی ${goalTitles[goal] || 'تمرینی'} (${locTitles[location] || 'شخصی‌سازی‌شده'}) - ${numDays} روز در هفته`;

  return {
    planName,
    source: 'ai',
    goal,
    location,
    equipment: equipment || [],
    experience: experience || 'intermediate',
    daysPerWeek: numDays,
    days: formattedDays
  };
}

/**
 * Generate AI-Powered Personalized Plan
 */
export async function generateAiPlan(req, res) {
  try {
    const userId = req.userId || req.user?.userId || req.user?.id || 2;
    const { 
      location = 'gym', 
      equipment = [], 
      goal = 'hypertrophy', 
      experience = 'intermediate', 
      daysPerWeek = 4, 
      injuriesNotes = '' 
    } = req.body || {};

    let generatedPlan = null;

    // Fetch user recent performance history to personalize AI weights and cues
    let userWorkoutHistory = [];
    let userHistorySummary = '';
    try {
      const historyRes = await pool.query(
        `SELECT exercise_name, MAX(weight_kg) as max_weight, COUNT(*) as logs_count 
         FROM workout_logs WHERE user_id = $1 GROUP BY exercise_name ORDER BY logs_count DESC LIMIT 8`,
        [userId]
      );
      if (historyRes.rows && historyRes.rows.length > 0) {
        userWorkoutHistory = historyRes.rows;
        userHistorySummary = historyRes.rows.map(r => `${r.exercise_name}: بیشترین وزنه ${r.max_weight}kg (${r.logs_count} جلسه)`).join('، ');
      }
    } catch (dbErr) {
      console.warn('[AI Plan Gen] Could not fetch user history:', dbErr.message);
    }

    // Filter exercises pool by user location/equipment for candidate selection
    const isGym = location === 'gym' || (Array.isArray(equipment) && equipment.includes('all_gym'));
    const userEquipList = Array.isArray(equipment) ? equipment : [equipment];

    const validCandidates = EXERCISES_LIBRARY.filter(e => {
      if (isGym) return true;
      if (e.equipment === 'bodyweight') return true;
      return userEquipList.includes(e.equipment) || e.location === 'home' || e.location === 'all';
    });

    // Attempt Gemini Generation if available
    if (genAI && process.env.GEMINI_API_KEY) {
      const abortCtrl = new AbortController();
      const timeoutId = setTimeout(() => {
        try { abortCtrl.abort(); } catch (e) {}
      }, 4500);

      try {
        const categories = ['chest', 'back', 'legs_quads', 'legs_hamstrings', 'shoulders', 'biceps', 'triceps', 'abs_core'];
        const representativePool = [];
        
        for (const cat of categories) {
          const list = validCandidates.filter(e => e.category === cat);
          list.slice(0, 3).forEach(e => {
            representativePool.push({
              id: e.id,
              nameFa: e.nameFa,
              name: e.name,
              category: e.category,
              equipment: e.equipment,
              target: e.target
            });
          });
        }

        const prompt = `You are a world-renowned Certified Strength and Conditioning Specialist (CSCS) and expert exercise physiologist.
Design an optimal, science-based multi-day workout split in Persian (Farsi) customized specifically for this athlete:
- Training Location: ${location} (${isGym ? 'Full Gym equipment' : 'Home setup'})
- Available Equipment: ${userEquipList.join(', ')}
- Primary Goal: ${goal} (hypertrophy = muscle growth 8-12 reps, strength = 4-6 reps, fat_loss = 12-15 reps, calisthenics = bodyweight mastery)
- Experience Level: ${experience}
- Frequency: ${daysPerWeek} days per week
- Physical Limitations / Injuries: ${injuriesNotes || 'None'}
${userHistorySummary ? `- Athlete's Past Logged Strength Records: ${userHistorySummary}` : ''}

Scientific CSCS Programming Rules:
1. Exercise Sequencing: Order exercises by neural complexity (Primary compound multi-joint movements FIRST, secondary accessories NEXT, targeted isolations THIRD, core/stability LAST).
2. Anti-Repetition: Do NOT repeat the exact same exercise across different days in the routine. Use complementary movement angles (e.g. flat press on Day 1, incline press on Day 3).
3. Intensity & RPE: Heavy compounds at RPE 7.5-8.5 (to preserve CNS recovery); isolation movements at RPE 8.5-9.5 (safe near failure).
4. Provide a valuable "coachTips" object for EACH workout day in Persian (warmup routine, daily focus, progressive overload target).
5. Exercise Selection: Select exact matching exercise IDs from the candidate pool below. Never suggest an exercise that violates the user's available equipment or physical limitations.

Candidate Exercises Pool:
${JSON.stringify(representativePool)}

Respond ONLY with a valid JSON object matching this schema:
{
  "planName": "Persian title for plan",
  "overview": "Short 1-2 sentence Persian description",
  "days": [
    {
      "dayNumber": 1,
      "dayName": "روز ۱ — بالاتنه قدرتی و سینه",
      "tag": "بالاتنه A",
      "focus": "سینه، سرشانه، زیربغل",
      "coachTips": {
        "warmup": "۵ تا ۷ دقیقه گرم‌کردن پویا و چرخش مفاصل شانه + ۲ ست صعودی در حرکت اول",
        "focus": "تمرکز بر اضافه بار تدریجی در حرکات چندمفصلی پایه",
        "overload": "در صورت رسیدن به سقف تکرارها با فرم بی‌نقص، جلسه بعد ۲.۵ کیلوگرم اضافه کنید"
      },
      "exercises": [
        {
          "id": 1,
          "sets": 3,
          "reps": "۸ تا ۱۲",
          "rpe": 8,
          "rir": 2,
          "rest": "۹۰ ثانیه"
        }
      ]
    }
  ]
}`;

        const response = await genAI.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            abortSignal: abortCtrl.signal
          }
        });

        const text = response.text?.trim();
        if (text) {
          const parsed = JSON.parse(text);
          if (parsed && Array.isArray(parsed.days) && parsed.days.length > 0) {
            const days = parsed.days.map((d, idx) => {
              const exerciseItems = Array.isArray(d.exercises) ? d.exercises : [];
              const mappedExercises = exerciseItems.map(item => {
                const exDb = getExerciseById(item.id || item.exerciseId);
                if (!exDb) return null;
                const cls = classifyExerciseMovement(exDb);
                return {
                  id: exDb.id,
                  name: exDb.name,
                  nameFa: exDb.nameFa,
                  category: exDb.category,
                  equipment: exDb.equipment,
                  target: exDb.target,
                  tier: cls.tier,
                  sets: Number(item.sets) || exDb.defaultSets || 3,
                  reps: String(item.reps || exDb.defaultReps || '۸ تا ۱۲'),
                  rir: item.rir !== undefined ? Number(item.rir) : (exDb.defaultRir || 2),
                  rpe: item.rpe !== undefined ? Number(item.rpe) : 8,
                  rest: String(item.rest || exDb.defaultRest || '۹۰ ثانیه'),
                  tech: exDb.tech || '',
                  mistake: exDb.mistake || '',
                  youtube: exDb.youtube || `https://www.youtube.com/results?search_query=${encodeURIComponent(exDb.name + ' form')}`
                };
              }).filter(Boolean);

              return {
                dayNumber: d.dayNumber || idx + 1,
                dayName: d.dayName || `روز ${idx + 1}`,
                tag: d.tag || `روز ${idx + 1}`,
                focus: d.focus || 'تقویت و اضافه بار عضلات هدف',
                coachTips: d.coachTips || {
                  warmup: '۵ تا ۷ دقیقه گرم‌کردن عمومی و چرخش مفاصل + ست‌های افزایشی سبک',
                  focus: 'حفظ تنش مکانیکی و کنترل کامل فاز منفی تکرارها',
                  overload: 'تلاش برای افزودن ۱ تکرار به ست‌های تمرینی نسبت به جلسه پیش'
                },
                exercises: mappedExercises.length >= 3 ? mappedExercises : null
              };
            });

            // If all days have mapped exercises, accept plan
            if (days.every(d => d.exercises && d.exercises.length >= 3)) {
              generatedPlan = {
                planName: parsed.planName || `برنامه هوشمند اختصاصی (${daysPerWeek} روزه)`,
                source: 'ai',
                goal,
                location,
                equipment: equipment || [],
                experience,
                daysPerWeek: Number(daysPerWeek) || days.length,
                days
              };
            }
          }
        }
      } catch (aiErr) {
        console.warn('[Gemini Plan Notice - Engaging CSCS Algorithmic Engine]:', aiErr.message);
      } finally {
        clearTimeout(timeoutId);
      }
    }

    // Algorithmic Fallback Engine
    if (!generatedPlan) {
      generatedPlan = generateDeterministicPlan({
        location,
        equipment,
        goal,
        experience,
        daysPerWeek,
        injuriesNotes,
        userHistory: userWorkoutHistory
      });
    }

    // Deactivate previous active plans for this user
    try {
      await pool.query(
        `UPDATE user_plans SET is_active = false WHERE user_id = $1`,
        [userId]
      );
    } catch (deactErr) {
      console.warn('[AI Plan Deactivate Notice]:', deactErr.message);
    }

    // Save newly generated plan to database
    let savedRow = null;
    try {
      const insertRes = await pool.query(
        `INSERT INTO user_plans (user_id, plan_name, source, goal, location, equipment, experience, days_per_week, plan_data, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          userId,
          generatedPlan.planName,
          'ai',
          generatedPlan.goal,
          generatedPlan.location,
          JSON.stringify(generatedPlan.equipment),
          generatedPlan.experience,
          generatedPlan.daysPerWeek,
          JSON.stringify(generatedPlan.days),
          true
        ]
      );
      savedRow = insertRes.rows?.[0];
    } catch (saveErr) {
      console.warn('[AI Plan DB Save Notice]:', saveErr.message);
    }

    const planId = savedRow?.id || Date.now();
    const createdAt = savedRow?.created_at || new Date().toISOString();

    return res.json({
      success: true,
      message: 'برنامه اختصاصی شما با موفقیت توسط سیستم هوشمند طراحی شد! 🎉',
      plan: {
        id: planId,
        userId: userId,
        planName: generatedPlan.planName,
        source: 'ai',
        goal: generatedPlan.goal,
        location: generatedPlan.location,
        equipment: generatedPlan.equipment,
        experience: generatedPlan.experience,
        daysPerWeek: generatedPlan.daysPerWeek,
        days: generatedPlan.days,
        isActive: true,
        createdAt: createdAt
      }
    });
  } catch (err) {
    console.error('[generateAiPlan Error]:', err);
    return res.status(500).json({ message: 'خطا در تولید برنامه هوشمند تمرینی' });
  }
}

/**
 * Get Smart Alternative Exercises for Quick Swapping
 */
export async function getExerciseAlternatives(req, res) {
  try {
    const { exerciseId } = req.query;
    if (!exerciseId) {
      return res.status(400).json({ message: 'شناسه حرکت الزامی است.' });
    }

    const currentEx = getExerciseById(exerciseId);
    if (!currentEx) {
      return res.status(404).json({ message: 'حرکت یافت نشد.' });
    }

    // Find smart alternatives: same muscle category, ranking same equipment/target higher
    const alternatives = EXERCISES_LIBRARY.filter(e => {
      if (Number(e.id) === Number(currentEx.id)) return false;
      return e.category === currentEx.category;
    });

    alternatives.sort((a, b) => {
      let scoreA = 0;
      let scoreB = 0;
      if (a.equipment === currentEx.equipment) scoreA += 2;
      if (b.equipment === currentEx.equipment) scoreB += 2;
      if (a.target && currentEx.target && a.target.includes(currentEx.target)) scoreA += 3;
      if (b.target && currentEx.target && b.target.includes(currentEx.target)) scoreB += 3;
      return scoreB - scoreA;
    });

    return res.json({
      currentExercise: currentEx,
      alternatives: alternatives.slice(0, 10)
    });
  } catch (err) {
    console.error('[getExerciseAlternatives Error]:', err);
    return res.status(500).json({ message: 'خطا در دریافت حرکات جایگزین' });
  }
}

/**
 * Quick Swap an Exercise in User's Active Plan
 */
export async function swapExerciseInPlan(req, res) {
  try {
    const userId = req.userId || req.user?.userId;
    const { dayIndex, exerciseIndex, newExerciseId } = req.body;

    if (dayIndex === undefined || exerciseIndex === undefined || !newExerciseId) {
      return res.status(400).json({ message: 'پارامترهای جایگزینی حرکت نامعتبر است.' });
    }

    const planRes = await pool.query(
      `SELECT * FROM user_plans WHERE user_id = $1 AND is_active = true ORDER BY id DESC LIMIT 1`,
      [userId]
    );

    if (planRes.rows.length === 0) {
      return res.status(404).json({ message: 'برنامه فعالی یافت نشد.' });
    }

    const planRow = planRes.rows[0];
    let planData = planRow.plan_data;
    if (typeof planData === 'string') {
      try { planData = JSON.parse(planData); } catch (e) {}
    }

    const newEx = getExerciseById(newExerciseId);
    if (!newEx) {
      return res.status(404).json({ message: 'حرکت جدید یافت نشد.' });
    }

    const day = planData[dayIndex];
    if (!day || !day.exercises || !day.exercises[exerciseIndex]) {
      return res.status(400).json({ message: 'موقعیت حرکت در برنامه معتبر نیست.' });
    }

    const oldEx = day.exercises[exerciseIndex];
    const cls = classifyExerciseMovement(newEx);

    // Swap exercise while preserving prescribed sets/reps
    day.exercises[exerciseIndex] = {
      id: newEx.id,
      name: newEx.name,
      nameFa: newEx.nameFa,
      category: newEx.category,
      equipment: newEx.equipment,
      target: newEx.target,
      tier: cls.tier,
      sets: oldEx.sets || newEx.defaultSets || 3,
      reps: oldEx.reps || newEx.defaultReps || '۸ تا ۱۲',
      rir: oldEx.rir !== undefined ? oldEx.rir : (newEx.defaultRir || 2),
      rpe: oldEx.rpe !== undefined ? oldEx.rpe : 8,
      rest: oldEx.rest || newEx.defaultRest || '۹۰ ثانیه',
      tech: newEx.tech || '',
      mistake: newEx.mistake || '',
      youtube: newEx.youtube || `https://www.youtube.com/results?search_query=${encodeURIComponent(newEx.name + ' form')}`
    };

    // Update in database with userId parameter
    await pool.query(
      `UPDATE user_plans SET plan_data = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3`,
      [JSON.stringify(planData), planRow.id, userId]
    );

    return res.json({
      success: true,
      message: `حرکت «${newEx.nameFa}» با موفقیت جایگزین شد.`,
      days: planData
    });
  } catch (err) {
    console.error('[swapExerciseInPlan Error]:', err);
    return res.status(500).json({ message: 'خطا در جایگزینی حرکت' });
  }
}

/**
 * Adjust sets for an exercise in active plan (+1 or -1 set)
 */
export async function adjustPlanExerciseSets(req, res) {
  try {
    const userId = req.userId || req.user?.userId;
    const { dayIndex, exerciseIndex, delta } = req.body;

    if (dayIndex === undefined || exerciseIndex === undefined || delta === undefined) {
      return res.status(400).json({ message: 'پارامترهای تغییر ست نامعتبر است.' });
    }

    const planRes = await pool.query(
      `SELECT * FROM user_plans WHERE user_id = $1 AND is_active = true ORDER BY id DESC LIMIT 1`,
      [userId]
    );

    if (planRes.rows.length === 0) {
      return res.status(404).json({ message: 'برنامه فعالی یافت نشد.' });
    }

    const planRow = planRes.rows[0];
    let planData = planRow.plan_data;
    if (typeof planData === 'string') {
      try { planData = JSON.parse(planData); } catch (e) {}
    }

    const day = planData[dayIndex];
    if (!day || !day.exercises || !day.exercises[exerciseIndex]) {
      return res.status(400).json({ message: 'حرکت مورد نظر یافت نشد.' });
    }

    const ex = day.exercises[exerciseIndex];
    const currentSets = Number(ex.sets) || 3;
    const newSets = Math.min(Math.max(currentSets + Number(delta), 1), 8);

    ex.sets = newSets;

    await pool.query(
      `UPDATE user_plans SET plan_data = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3`,
      [JSON.stringify(planData), planRow.id, userId]
    );

    return res.json({
      success: true,
      newSets,
      days: planData
    });
  } catch (err) {
    console.error('[adjustPlanExerciseSets Error]:', err);
    return res.status(500).json({ message: 'خطا در تغییر تعداد ست‌ها' });
  }
}

/**
 * Delete an exercise from active day in user's plan
 */
export async function deleteExerciseFromPlan(req, res) {
  try {
    const userId = req.userId || req.user?.userId;
    const { dayIndex, exerciseIndex } = req.body;

    if (dayIndex === undefined || exerciseIndex === undefined) {
      return res.status(400).json({ message: 'پارامترهای حذف حرکت نامعتبر است.' });
    }

    const planRes = await pool.query(
      `SELECT * FROM user_plans WHERE user_id = $1 AND is_active = true ORDER BY id DESC LIMIT 1`,
      [userId]
    );

    if (planRes.rows.length === 0) {
      return res.status(404).json({ message: 'برنامه فعالی یافت نشد.' });
    }

    const planRow = planRes.rows[0];
    let planData = planRow.plan_data;
    if (typeof planData === 'string') {
      try { planData = JSON.parse(planData); } catch (e) {}
    }

    const day = planData[dayIndex];
    if (!day || !day.exercises || !day.exercises[exerciseIndex]) {
      return res.status(400).json({ message: 'حرکت مورد نظر یافت نشد.' });
    }

    const removed = day.exercises.splice(exerciseIndex, 1);

    await pool.query(
      `UPDATE user_plans SET plan_data = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3`,
      [JSON.stringify(planData), planRow.id, userId]
    );

    return res.json({
      success: true,
      message: `حرکت «${removed[0]?.nameFa || ''}» از برنامه حذف شد.`,
      days: planData
    });
  } catch (err) {
    console.error('[deleteExerciseFromPlan Error]:', err);
    return res.status(500).json({ message: 'خطا در حذف حرکت از برنامه' });
  }
}

/**
 * Get Smart Progressive Overload Advice & Historical Benchmarks for an Exercise
 */
export async function getSmartWorkoutAdvice(req, res) {
  try {
    const userId = req.userId || req.user?.userId;
    const { exerciseName } = req.query;

    if (!exerciseName) {
      return res.status(400).json({ message: 'نام حرکت الزامی است.' });
    }

    const logsRes = await pool.query(
      `SELECT weight_kg, reps, rir, rpe, log_date 
       FROM workout_logs 
       WHERE user_id = $1 AND (exercise_name = $2 OR exercise_name ILIKE $3)
       ORDER BY log_date DESC LIMIT 5`,
      [userId, exerciseName, `%${exerciseName}%`]
    );

    const rows = logsRes.rows || [];
    if (rows.length === 0) {
      return res.json({
        hasHistory: false,
        message: 'اولین جلسه ثبت این حرکت! با یک وزنه معتدل شروع کنید و روی حفظ ۲ تکرار در ذخیره (RPE 8) تمرکز کنید.',
        lastSession: null,
        suggestion: {
          action: 'start_baseline',
          badge: '🌱 جلسه مبنا (Baseline)',
          text: 'یک وزنه آزمایشی انتخاب کنید و مطمئن شوید فرم حرکت استاندارد و کنترل‌شده باشد.'
        }
      });
    }

    const last = rows[0];
    const lastWeight = Number(last.weight_kg);
    const lastRepsArr = Array.isArray(last.reps) ? last.reps : [Number(last.reps)];
    const lastRpeArr = Array.isArray(last.rpe) ? last.rpe : [];

    let avgRpe = 8;
    if (lastRpeArr.length > 0) {
      const valid = lastRpeArr.filter(v => typeof v === 'number' && !isNaN(v));
      if (valid.length > 0) {
        avgRpe = valid.reduce((a, b) => a + b, 0) / valid.length;
      }
    }

    let suggestion = {
      action: 'maintain',
      badge: '🎯 تثبیت وزنه و افزایش تکرار',
      text: `در جلسه قبل با وزنه ${lastWeight}kg تمرین کردید. تلاش کنید ۱ تکرار به ست دوم یا سوم اضافه کنید.`
    };

    if (avgRpe <= 7.5) {
      suggestion = {
        action: 'increase_weight',
        badge: '⚡ زمان اضافه بار وزنه (+۲.۵kg)',
        text: `در جلسه قبل شدت RPE شما ${avgRpe.toFixed(1)} بود (توان ذخیره بالا). امروز پیشنهاد می‌شود وزنه را به ${(lastWeight + 2.5).toFixed(1)}kg افزایش دهید!`
      };
    } else if (avgRpe >= 9.5) {
      suggestion = {
        action: 'deload_or_form',
        badge: '🛡️ حفظ وزنه و تمرکز بر ریکاوری',
        text: `در جلسه قبل در مرز ناتوانی مطلق (RPE ${avgRpe.toFixed(1)}) بودید. امروز وزنه ${lastWeight}kg را تثبیت کنید و فاز منفی حرکت را با ۳ ثانیه مکث اجرا کنید.`
      };
    } else {
      suggestion = {
        action: 'progressive_rep',
        badge: '🔥 هایپرتروفی طلایی (RPE 8-9)',
        text: `شدت RPE جلسه قبل (${avgRpe.toFixed(1)}) ایده‌آل بود. امروز همان وزنه ${lastWeight}kg را بزنید اما هدف‌تان رساندن تکرار ست آخر به ${Math.max(...lastRepsArr) + 1} باشد.`
      };
    }

    return res.json({
      hasHistory: true,
      lastSession: {
        date: last.log_date,
        weightKg: lastWeight,
        reps: lastRepsArr,
        rpe: lastRpeArr,
        avgRpe
      },
      suggestion
    });
  } catch (err) {
    console.error('[getSmartWorkoutAdvice Error]:', err);
    return res.status(500).json({ message: 'خطا در دریافت مشاوره هوشمند اضافه بار' });
  }
}

/**
 * Save Manual / Custom User Built Plan
 */
export async function saveCustomPlan(req, res) {
  try {
    const userId = req.userId || req.user?.userId || req.user?.id || 2;
    const { planName, goal, location, equipment, experience, daysPerWeek, days } = req.body || {};

    if (!days || !Array.isArray(days) || days.length === 0) {
      return res.status(400).json({ message: 'برنامه باید حداقل شامل یک روز تمرینی باشد.' });
    }

    // Clean and validate days and exercises
    const cleanedDays = days.map((d, dIdx) => {
      const dayNum = Number(d.dayNumber) || (dIdx + 1);
      const exercises = Array.isArray(d.exercises) ? d.exercises.map((ex, exIdx) => {
        const exId = Number(ex.id) || (exIdx + 1);
        const name = ex.name || ex.nameFa || 'تمرین اختصاصی';
        const nameFa = ex.nameFa || ex.name || 'تمرین اختصاصی';
        return {
          id: exId,
          name: name,
          nameFa: nameFa,
          category: ex.category || 'full_body',
          equipment: ex.equipment || 'bodyweight',
          target: ex.target || 'عضلات هدف',
          sets: Number(ex.sets) || 3,
          reps: ex.reps ? String(ex.reps) : '۸ تا ۱۲',
          rpe: Number(ex.rpe) || 8,
          rir: Number(ex.rir) || 2,
          rest: ex.rest ? String(ex.rest) : '۹۰ ثانیه',
          tech: ex.tech || '',
          mistake: ex.mistake || '',
          youtube: ex.youtube || `https://www.youtube.com/results?search_query=${encodeURIComponent(name + ' form exercise')}`
        };
      }) : [];

      return {
        dayNumber: dayNum,
        dayName: d.dayName || `روز ${dayNum}`,
        tag: d.tag || `روز ${dayNum}`,
        focus: d.focus || 'تقویت و اضافه بار عضلات هدف',
        coachTips: d.coachTips || {
          warmup: '۵ تا ۷ دقیقه گرم‌کردن پویا و چرخش مفاصل شانه و ران',
          focus: 'تمرکز بر حفظ فرم صحیح و تکنیک کنترل‌شده در کل دامنه حرکت',
          overload: 'در صورت تکمیل کامل ست‌ها با فرم تمیز، وزنه یا تکرار را افزایش دهید'
        },
        exercises
      };
    });

    // Deactivate previous active plans
    try {
      await pool.query(
        `UPDATE user_plans SET is_active = false WHERE user_id = $1`,
        [userId]
      );
    } catch (deactErr) {
      console.warn('[saveCustomPlan Deactivate Notice]:', deactErr.message);
    }

    const name = planName || 'برنامه تمرینی دست‌ساز من';

    let insertRes = null;
    try {
      insertRes = await pool.query(
        `INSERT INTO user_plans (user_id, plan_name, source, goal, location, equipment, experience, days_per_week, plan_data, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          userId,
          name,
          'manual',
          goal || 'custom',
          location || 'gym',
          JSON.stringify(equipment || []),
          experience || 'intermediate',
          daysPerWeek || cleanedDays.length,
          JSON.stringify(cleanedDays),
          true
        ]
      );
    } catch (dbErr) {
      console.warn('[saveCustomPlan DB Notice]:', dbErr.message);
    }

    const row = insertRes?.rows?.[0];
    const planId = row?.id || Date.now();
    const createdAt = row?.created_at || new Date().toISOString();

    return res.json({
      success: true,
      message: 'برنامه اختصاصی دست‌ساز شما با موفقیت ثبت و فعال شد! 🎉',
      plan: {
        id: planId,
        userId: userId,
        planName: name,
        source: 'manual',
        goal: goal || 'custom',
        location: location || 'gym',
        equipment: equipment || [],
        experience: experience || 'intermediate',
        daysPerWeek: Number(daysPerWeek) || cleanedDays.length,
        days: cleanedDays,
        isActive: true,
        createdAt: createdAt
      }
    });
  } catch (err) {
    console.error('[saveCustomPlan Error]:', err);
    return res.status(500).json({ message: 'خطا در ثبت برنامه تمرینی دست‌ساز' });
  }
}

/**
 * Update existing active plan
 */
export async function updateCurrentPlan(req, res) {
  try {
    const userId = req.userId || req.user?.userId;
    const { id, days, planName } = req.body;

    if (!id || !days) {
      return res.status(400).json({ message: 'شناسه برنامه و لیست روزها الزامی است.' });
    }

    const updateRes = await pool.query(
      `UPDATE user_plans SET plan_data = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3 RETURNING *`,
      [JSON.stringify(days), id, userId]
    );

    if (updateRes.rows.length === 0) {
      return res.status(404).json({ message: 'برنامه مورد نظر یافت نشد.' });
    }

    return res.json({
      success: true,
      message: 'برنامه با موفقیت به‌روزرسانی شد.'
    });
  } catch (err) {
    console.error('[updateCurrentPlan Error]:', err);
    return res.status(500).json({ message: 'خطا در به‌روزرسانی برنامه' });
  }
}

/**
 * Reset / deactivate plan to allow user to take the questionnaire again
 */
export async function resetCurrentPlan(req, res) {
  try {
    const userId = req.userId || req.user?.userId;
    await pool.query(
      `UPDATE user_plans SET is_active = false WHERE user_id = $1`,
      [userId]
    );

    return res.json({
      success: true,
      message: 'برنامه قبلی ریست شد. اکنون می‌توانید برنامه جدیدی طراحی نمایید.'
    });
  } catch (err) {
    console.error('[resetCurrentPlan Error]:', err);
    return res.status(500).json({ message: 'خطا در ریست برنامه تمرینی' });
  }
}
