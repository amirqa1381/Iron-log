import { z } from 'zod';

export const workoutLogSchema = z.object({
  programMode: z.enum(['dumbbell', 'gym']),
  exerciseName: z.string().min(1),
  logDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'فرمت تاریخ باید YYYY-MM-DD باشد'),
  weightKg: z.number().positive(),
  reps: z.array(z.number().int().nonnegative()).nonempty(),
  rir: z.array(z.number().nonnegative()).optional(),
  notes: z.string().optional()
});

export const bodyweightSchema = z.object({
  logDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'فرمت تاریخ باید YYYY-MM-DD باشد'),
  weightKg: z.coerce.number().positive('وزن باید یک عدد مثبت باشد')
});

export const settingsSchema = z.object({
  activeMode: z.enum(['dumbbell', 'gym']).optional().nullable(),
  startWeight: z.coerce.number().positive('وزن مبدأ باید یک عدد مثبت باشد').optional().nullable(),
  targetWeight: z.coerce.number().positive('وزن هدف باید یک عدد مثبت باشد').optional().nullable()
});