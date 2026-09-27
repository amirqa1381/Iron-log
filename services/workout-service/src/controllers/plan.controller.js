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
    genAI = new GoogleGenAI();
  }
} catch (err) {
  console.warn('[Gemini Plan Controller] Initialization notice:', err.message);
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
 * Smart Deterministic Fallback Generator
 * Creates an optimal, science-based customized routine using the 220+ exercises library
 */
function generateDeterministicPlan({ location, equipment, goal, experience, daysPerWeek, injuriesNotes }) {
  const isGym = location === 'gym' || (Array.isArray(equipment) && equipment.includes('all_gym'));
  const hasDumbbells = Array.isArray(equipment) && equipment.includes('dumbbell');
  const hasBands = Array.isArray(equipment) && equipment.includes('resistance_band');
  const onlyBodyweight = !isGym && !hasDumbbells && (!equipment || equipment.length === 0 || (equipment.length === 1 && equipment[0] === 'bodyweight'));

  const numDays = Math.min(Math.max(Number(daysPerWeek) || 3, 2), 6);

  // Filter exercises pool by user location/equipment
  const poolExercises = EXERCISES_LIBRARY.filter(e => {
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

  const getExercisesForCategory = (cat, count = 2) => {
    const list = poolExercises.filter(e => e.category === cat);
    if (list.length === 0) {
      return EXERCISES_LIBRARY.filter(e => e.category === cat).slice(0, count);
    }
    return list.slice(0, count);
  };

  const days = [];

  if (numDays === 3) {
    // 3 Days: Full Body A / B / C or Push / Pull / Legs
    days.push({
      dayNumber: 1,
      dayName: 'روز ۱ — بالاتنه فشاری و چهارسر ران',
      tag: 'فشاری A',
      focus: 'سینه، سرشانه، چهارسر ران و پشت بازو',
      exercises: [
        ...getExercisesForCategory('chest', 2),
        ...getExercisesForCategory('shoulders', 2),
        ...getExercisesForCategory('legs_quads', 2),
        ...getExercisesForCategory('triceps', 1),
        ...getExercisesForCategory('abs_core', 1)
      ]
    });

    days.push({
      dayNumber: 2,
      dayName: 'روز ۲ — بالاتنه کششی و زنجیره خلفی',
      tag: 'کششی B',
      focus: 'پشت، زیربغل، همسترینگ و جلو بازو',
      exercises: [
        ...getExercisesForCategory('back', 2),
        ...getExercisesForCategory('legs_hamstrings', 2),
        ...getExercisesForCategory('biceps', 2),
        ...getExercisesForCategory('calves', 1),
        ...getExercisesForCategory('abs_core', 1)
      ]
    });

    days.push({
      dayNumber: 3,
      dayName: 'روز ۳ — فول بادی قدرتی و میان‌تنه',
      tag: 'فول‌بادی C',
      focus: 'تمرین جامع کل بدن، میان‌تنه و استقامت',
      exercises: [
        ...getExercisesForCategory('legs_quads', 1),
        ...getExercisesForCategory('chest', 1),
        ...getExercisesForCategory('back', 1),
        ...getExercisesForCategory('shoulders', 1),
        ...getExercisesForCategory('full_body', 1),
        ...getExercisesForCategory('abs_core', 1)
      ]
    });
  } else if (numDays === 4) {
    // 4 Days: Upper / Lower A & B
    days.push({
      dayNumber: 1,
      dayName: 'روز ۱ — بالاتنه قدرت و حجم (A)',
      tag: 'بالاتنه A',
      focus: 'سینه، پشت، سرشانه و دست‌ها',
      exercises: [
        ...getExercisesForCategory('chest', 2),
        ...getExercisesForCategory('back', 2),
        ...getExercisesForCategory('shoulders', 1),
        ...getExercisesForCategory('triceps', 1),
        ...getExercisesForCategory('biceps', 1)
      ]
    });

    days.push({
      dayNumber: 2,
      dayName: 'روز ۲ — پایین‌تنه و شکم (A)',
      tag: 'پایین‌تنه A',
      focus: 'چهارسر ران، همسترینگ، باسن و شکم',
      exercises: [
        ...getExercisesForCategory('legs_quads', 2),
        ...getExercisesForCategory('legs_hamstrings', 2),
        ...getExercisesForCategory('calves', 1),
        ...getExercisesForCategory('abs_core', 2)
      ]
    });

    days.push({
      dayNumber: 3,
      dayName: 'روز ۳ — بالاتنه هایپرتروفی و تفکیک (B)',
      tag: 'بالاتنه B',
      focus: 'سینه، زیربغل، دلتوئید و بازو',
      exercises: [
        ...getExercisesForCategory('chest', 2),
        ...getExercisesForCategory('back', 2),
        ...getExercisesForCategory('shoulders', 2),
        ...getExercisesForCategory('biceps', 1),
        ...getExercisesForCategory('triceps', 1)
      ]
    });

    days.push({
      dayNumber: 4,
      dayName: 'روز ۴ — پایین‌تنه و میان‌تنه (B)',
      tag: 'پایین‌تنه B',
      focus: 'همسترینگ، باسن، چهارسر و فیله کمر',
      exercises: [
        ...getExercisesForCategory('legs_hamstrings', 2),
        ...getExercisesForCategory('legs_quads', 2),
        ...getExercisesForCategory('calves', 1),
        ...getExercisesForCategory('abs_core', 2)
      ]
    });
  } else {
    // 5 or 6 Days: Push / Pull / Legs Split
    days.push({
      dayNumber: 1,
      dayName: 'روز ۱ — سینه، سرشانه و پشت بازو (Push)',
      tag: 'Push Day',
      focus: 'عضلات فشاری بالاتنه',
      exercises: [
        ...getExercisesForCategory('chest', 3),
        ...getExercisesForCategory('shoulders', 2),
        ...getExercisesForCategory('triceps', 2)
      ]
    });

    days.push({
      dayNumber: 2,
      dayName: 'روز ۲ — پشت، زیربغل و جلو بازو (Pull)',
      tag: 'Pull Day',
      focus: 'عضلات کششی بالاتنه',
      exercises: [
        ...getExercisesForCategory('back', 3),
        ...getExercisesForCategory('shoulders', 1), // Rear delt
        ...getExercisesForCategory('biceps', 2),
        ...getExercisesForCategory('forearms', 1)
      ]
    });

    days.push({
      dayNumber: 3,
      dayName: 'روز ۳ — پا، باسن و شکم (Legs & Core)',
      tag: 'Legs Day',
      focus: 'چهارسر، همسترینگ، ساق و میان‌تنه',
      exercises: [
        ...getExercisesForCategory('legs_quads', 2),
        ...getExercisesForCategory('legs_hamstrings', 2),
        ...getExercisesForCategory('calves', 1),
        ...getExercisesForCategory('abs_core', 2)
      ]
    });

    days.push({
      dayNumber: 4,
      dayName: 'روز ۴ — بالاتنه تخصصی و فرم‌دهی',
      tag: 'Upper Hypertrophy',
      focus: 'حجم عضلانی سینه، پشت و سرشانه',
      exercises: [
        ...getExercisesForCategory('chest', 2),
        ...getExercisesForCategory('back', 2),
        ...getExercisesForCategory('shoulders', 2),
        ...getExercisesForCategory('triceps', 1),
        ...getExercisesForCategory('biceps', 1)
      ]
    });

    days.push({
      dayNumber: 5,
      dayName: 'روز ۵ — پایین‌تنه، شکم و استقامت',
      tag: 'Lower & Abs',
      focus: 'زنجیره خلفی، ساق پا و سیکس‌پک',
      exercises: [
        ...getExercisesForCategory('legs_hamstrings', 2),
        ...getExercisesForCategory('legs_quads', 1),
        ...getExercisesForCategory('calves', 1),
        ...getExercisesForCategory('abs_core', 2),
        ...getExercisesForCategory('full_body', 1)
      ]
    });
  }

  // Ensure default sets/reps format
  const formattedDays = days.map(d => ({
    ...d,
    exercises: d.exercises.map(ex => ({
      id: ex.id,
      name: ex.name,
      nameFa: ex.nameFa,
      category: ex.category,
      equipment: ex.equipment,
      target: ex.target,
      sets: ex.defaultSets || 3,
      reps: ex.defaultReps || '۸ تا ۱۲',
      rir: ex.defaultRir || 2,
      rest: ex.defaultRest || '۹۰ ثانیه',
      tech: ex.tech || '',
      mistake: ex.mistake || '',
      youtube: ex.youtube || `https://www.youtube.com/results?search_query=${encodeURIComponent(ex.name + ' form')}`
    }))
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
    const userId = req.userId || req.user?.userId;
    const { 
      location = 'gym', 
      equipment = [], 
      goal = 'hypertrophy', 
      experience = 'intermediate', 
      daysPerWeek = 4, 
      injuriesNotes = '' 
    } = req.body;

    let generatedPlan = null;

    // Attempt Gemini Generation if available
    if (genAI && process.env.GEMINI_API_KEY) {
      try {
        const candidatePool = EXERCISES_LIBRARY.slice(0, 80).map(e => ({
          id: e.id,
          name: e.name,
          nameFa: e.nameFa,
          category: e.category,
          equipment: e.equipment,
          location: e.location
        }));

        const prompt = `You are a world-class certified strength and conditioning specialist (CSCS).
Create an optimal, highly personalized workout plan in Persian (Farsi) for a fitness app user based on:
- Location: ${location} (gym, home, or hybrid)
- Equipment available: ${Array.isArray(equipment) ? equipment.join(', ') : equipment}
- Goal: ${goal} (hypertrophy, fat_loss, strength, general_fitness, calisthenics)
- Experience Level: ${experience} (beginner, intermediate, advanced)
- Workout Days Per Week: ${daysPerWeek}
- Special Notes / Limitations: ${injuriesNotes || 'None'}

Candidate Exercise Pool (Choose IDs from this pool to match exercises):
${JSON.stringify(candidatePool.slice(0, 60))}

Respond ONLY with a valid JSON object matching this schema:
{
  "planName": "string in Persian",
  "description": "brief 1-2 sentence Persian overview",
  "days": [
    {
      "dayNumber": 1,
      "dayName": "string in Persian (e.g. روز ۱ — بالاتنه فشاری)",
      "tag": "short Persian badge (e.g. بالاتنه A)",
      "focus": "muscle focus in Persian",
      "exerciseIds": [1, 2, 5, 12, 18, 42]
    }
  ]
}`;

        const response = await genAI.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json'
          }
        });

        const text = response.text?.trim();
        if (text) {
          const parsed = JSON.parse(text);
          if (parsed && Array.isArray(parsed.days) && parsed.days.length > 0) {
            const days = parsed.days.map((d, idx) => {
              const matchedExercises = (d.exerciseIds || [])
                .map(id => getExerciseById(id))
                .filter(Boolean);

              // If Gemini picked fewer than 4 exercises, fill from candidate pool
              const finalExercises = matchedExercises.length >= 4 
                ? matchedExercises 
                : [...matchedExercises, ...EXERCISES_LIBRARY.slice(idx * 5, idx * 5 + 4)];

              return {
                dayNumber: d.dayNumber || idx + 1,
                dayName: d.dayName || `روز ${idx + 1}`,
                tag: d.tag || `روز ${idx + 1}`,
                focus: d.focus || 'تقویت عضلات هدف',
                exercises: finalExercises.map(ex => ({
                  id: ex.id,
                  name: ex.name,
                  nameFa: ex.nameFa,
                  category: ex.category,
                  equipment: ex.equipment,
                  target: ex.target,
                  sets: ex.defaultSets || 3,
                  reps: ex.defaultReps || '۸ تا ۱۲',
                  rir: ex.defaultRir || 2,
                  rest: ex.defaultRest || '۹۰ ثانیه',
                  tech: ex.tech || '',
                  mistake: ex.mistake || '',
                  youtube: ex.youtube || `https://www.youtube.com/results?search_query=${encodeURIComponent(ex.name + ' form')}`
                }))
              };
            });

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
      } catch (aiErr) {
        console.warn('[Gemini Plan Generation Error - Engaging Algorithmic Fallback]:', aiErr.message);
      }
    }

    // Fallback if Gemini was not available or had an issue
    if (!generatedPlan) {
      generatedPlan = generateDeterministicPlan({
        location,
        equipment,
        goal,
        experience,
        daysPerWeek,
        injuriesNotes
      });
    }

    // Deactivate previous active plans for this user
    await pool.query(
      `UPDATE user_plans SET is_active = false WHERE user_id = $1`,
      [userId]
    );

    // Save newly generated plan to database
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

    const savedRow = insertRes.rows[0];

    return res.json({
      success: true,
      message: 'برنامه اختصاصی شما با موفقیت توسط هوش مصنوعی طراحی شد!',
      plan: {
        id: savedRow.id,
        userId: savedRow.user_id,
        planName: savedRow.plan_name,
        source: savedRow.source,
        goal: savedRow.goal,
        location: savedRow.location,
        equipment: generatedPlan.equipment,
        experience: savedRow.experience,
        daysPerWeek: savedRow.days_per_week,
        days: generatedPlan.days,
        isActive: true,
        createdAt: savedRow.created_at
      }
    });
  } catch (err) {
    console.error('[generateAiPlan Error]:', err);
    return res.status(500).json({ message: 'خطا در تولید برنامه هوشمند تمرینی' });
  }
}

/**
 * Save Manual / Custom User Built Plan
 */
export async function saveCustomPlan(req, res) {
  try {
    const userId = req.userId || req.user?.userId;
    const { planName, goal, location, equipment, experience, daysPerWeek, days } = req.body;

    if (!days || !Array.isArray(days) || days.length === 0) {
      return res.status(400).json({ message: 'برنامه باید حداقل شامل یک روز تمرینی باشد.' });
    }

    // Deactivate previous active plans
    await pool.query(
      `UPDATE user_plans SET is_active = false WHERE user_id = $1`,
      [userId]
    );

    const name = planName || 'برنامه تمرینی دست‌ساز من';

    const insertRes = await pool.query(
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
        daysPerWeek || days.length,
        JSON.stringify(days),
        true
      ]
    );

    const row = insertRes.rows[0];

    return res.json({
      success: true,
      message: 'برنامه اختصاصی دست‌ساز شما با موفقیت ثبت و فعال شد!',
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
        days,
        isActive: true,
        createdAt: row.created_at
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
