import { z } from 'zod';

function parseFlexibleNumber(val) {
  if (val === null || val === undefined || val === '') return undefined;
  if (typeof val === 'number') return isNaN(val) ? undefined : val;
  let s = String(val).trim()
    .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧۸۹'.indexOf(d))
    .replace(/٫/g, '.')
    .replace(/,/g, '.');
  const n = parseFloat(s);
  return isNaN(n) ? undefined : n;
}

function parseFlexibleDate(val) {
  if (!val || typeof val !== 'string') return new Date().toISOString().slice(0, 10);
  let s = val.trim()
    .replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧۸۹'.indexOf(d));
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return new Date().toISOString().slice(0, 10);
}

export const workoutLogSchema = z.object({
  programMode: z.string().default('ai'),
  exerciseName: z.string().min(1, 'نام حرکت الزامی است'),
  logDate: z.preprocess(parseFlexibleDate, z.string()),
  weightKg: z.preprocess(parseFlexibleNumber, z.number().nonnegative('وزنه باید عددی نامنفی باشد')).default(0),
  reps: z.preprocess(val => {
    if (Array.isArray(val)) {
      return val.map(v => parseFlexibleNumber(v) ?? 0).filter(v => typeof v === 'number');
    }
    const n = parseFlexibleNumber(val);
    return n !== undefined ? [n] : [10];
  }, z.array(z.number().int().nonnegative()).nonempty('حداقل یک ست الزامی است')),
  rir: z.preprocess(val => {
    if (Array.isArray(val)) {
      return val.map(v => parseFlexibleNumber(v) ?? 2).filter(v => typeof v === 'number');
    }
    const n = parseFlexibleNumber(val);
    return n !== undefined ? [n] : [];
  }, z.array(z.number().nonnegative())).optional(),
  rpe: z.preprocess(val => {
    if (Array.isArray(val)) {
      return val.map(v => parseFlexibleNumber(v) ?? 8).filter(v => typeof v === 'number');
    }
    const n = parseFlexibleNumber(val);
    return n !== undefined ? [n] : [];
  }, z.array(z.number().min(1).max(10))).optional(),
  notes: z.string().optional()
});

export const bodyweightSchema = z.object({
  logDate: z.preprocess(parseFlexibleDate, z.string()).optional(),
  date: z.preprocess(parseFlexibleDate, z.string()).optional(),
  weightKg: z.preprocess(parseFlexibleNumber, z.number().positive('وزن باید یک عدد مثبت باشد').optional()),
  weight: z.preprocess(parseFlexibleNumber, z.number().positive('وزن باید یک عدد مثبت باشد').optional())
}).refine(data => (data.weightKg !== undefined || data.weight !== undefined), {
  message: 'لطفاً یک وزن معتبر و مثبت به کیلوگرم وارد کنید'
});

export const settingsSchema = z.object({
  activeMode: z.string().optional().nullable(),
  startWeight: z.preprocess(parseFlexibleNumber, z.number().positive('وزن مبدأ باید یک عدد مثبت باشد').optional().nullable()),
  targetWeight: z.preprocess(parseFlexibleNumber, z.number().positive('وزن هدف باید یک عدد مثبت باشد').optional().nullable())
});
