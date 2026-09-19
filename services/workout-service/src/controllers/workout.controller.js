import { pool } from '../config/db.js';
import { workoutLogSchema } from '../schemas/workout.schema.js';

export const getWorkouts = async (req, res) => {
  try {
    const { exercise, from, to } = req.query;
    let query = `SELECT id, program_mode as "programMode", exercise_name as "exerciseName", 
                        TO_CHAR(log_date, 'YYYY-MM-DD') as "logDate", 
                        weight_kg as "weightKg", reps, rir, notes, created_at 
                 FROM workout_logs WHERE user_id = $1`;
    const params = [req.userId];

    if (exercise) {
      params.push(exercise);
      query += ` AND exercise_name = $${params.length}`;
    }
    if (from) {
      params.push(from);
      query += ` AND log_date >= $${params.length}`;
    }
    if (to) {
      params.push(to);
      query += ` AND log_date <= $${params.length}`;
    }

    query += ` ORDER BY log_date ASC, created_at ASC`;
    const result = await pool.query(query, params);
    return res.json(result.rows);
  } catch (err) {
    console.error('getWorkouts error:', err);
    return res.status(500).json({ message: 'خطا در دریافت لیست تمرین‌ها' });
  }
};

export const createWorkout = async (req, res) => {
  try {
    const parsed = workoutLogSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ errors: parsed.error.flatten().fieldErrors });
    }

    const { programMode, exerciseName, logDate, weightKg, reps, rir, notes } = parsed.data;

    const result = await pool.query(
      `INSERT INTO workout_logs (user_id, program_mode, exercise_name, log_date, weight_kg, reps, rir, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, program_mode as "programMode", exercise_name as "exerciseName", 
                 TO_CHAR(log_date, 'YYYY-MM-DD') as "logDate", weight_kg as "weightKg", 
                 reps, rir, notes, created_at`,
      [req.userId, programMode, exerciseName, logDate, weightKg, JSON.stringify(reps), JSON.stringify(rir || []), notes || null]
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('createWorkout error:', err);
    return res.status(500).json({ message: 'خطا در ذخیره ست تمرین' });
  }
};

export const deleteWorkout = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM workout_logs WHERE id = $1 AND user_id = $2 RETURNING id', [id, req.userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'ثبت تمرین یافت نشد' });
    }
    return res.status(204).send();
  } catch (err) {
    console.error('deleteWorkout error:', err);
    return res.status(500).json({ message: 'خطا در حذف تمرین' });
  }
};