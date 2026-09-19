import { pool } from '../config/db.js';

export const exportData = async (req, res) => {
  try {
    const settings = await pool.query('SELECT active_mode FROM user_settings WHERE user_id = $1', [req.userId]);
    const workouts = await pool.query(
      `SELECT program_mode, exercise_name, TO_CHAR(log_date, 'YYYY-MM-DD') as log_date, weight_kg, reps, rir, notes 
       FROM workout_logs WHERE user_id = $1 ORDER BY log_date ASC`, 
      [req.userId]
    );
    const bodyweight = await pool.query(
      `SELECT TO_CHAR(log_date, 'YYYY-MM-DD') as log_date, weight_kg 
       FROM bodyweight_logs WHERE user_id = $1 ORDER BY log_date ASC`, 
      [req.userId]
    );

    return res.json({
      exportedAt: new Date().toISOString(),
      activeMode: settings.rows[0]?.active_mode || 'dumbbell',
      workoutLogs: workouts.rows,
      bodyWeightLogs: bodyweight.rows
    });
  } catch (err) {
    console.error('exportData error:', err);
    return res.status(500).json({ message: 'خطا در خروجی گرفتن داده‌ها' });
  }
};

export const importData = async (req, res) => {
  const client = await pool.connect();
  try {
    const { workoutLogs = [], bodyWeightLogs = [] } = req.body;
    await client.query('BEGIN');

    let addedWorkouts = 0;
    for (const w of workoutLogs) {
      await client.query(
        `INSERT INTO workout_logs (user_id, program_mode, exercise_name, log_date, weight_kg, reps, rir, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          req.userId,
          w.program_mode || w.programMode || 'dumbbell',
          w.exercise_name || w.exerciseName || w.exercise,
          w.log_date || w.logDate || w.date,
          w.weight_kg || w.weightKg || w.weight,
          JSON.stringify(w.reps || []),
          JSON.stringify(w.rir || []),
          w.notes || null
        ]
      );
      addedWorkouts++;
    }

    let upsertedWeights = 0;
    for (const b of bodyWeightLogs) {
      await client.query(
        `INSERT INTO bodyweight_logs (user_id, log_date, weight_kg)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, log_date) DO UPDATE SET weight_kg = EXCLUDED.weight_kg`,
        [req.userId, b.log_date || b.logDate || b.date, b.weight_kg || b.weightKg || b.weight]
      );
      upsertedWeights++;
    }

    await client.query('COMMIT');
    return res.json({ message: 'داده‌ها با موفقیت ایمپورت شدند', addedWorkouts, upsertedWeights });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('importData error:', err);
    return res.status(500).json({ message: 'خطا در بازیابی داده‌ها' });
  } finally {
    client.release();
  }
};