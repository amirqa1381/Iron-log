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
  logDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weightKg: z.number().positive()
});

export const settingsSchema = z.object({
  activeMode: z.enum(['dumbbell', 'gym'])
});