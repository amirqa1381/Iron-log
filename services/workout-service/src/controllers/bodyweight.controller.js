import { pool } from '../config/db.js';
import { bodyweightSchema } from '../schemas/workout.schema.js';

export const getBodyweights = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, TO_CHAR(log_date, 'YYYY-MM-DD') as "logDate", weight_kg as "weightKg", created_at
       FROM bodyweight_logs WHERE user_id = $1 ORDER BY log_date ASC`,
      [req.userId]
    );
    return res.json(result.rows);
  } catch (err) {
    console.error('getBodyweights error:', err);
    return res.status(500).json({ message: 'خطا در دریافت تاریخچه وزن' });
  }
};

export const upsertBodyweight = async (req, res) => {
  try {
    const parsed = bodyweightSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ errors: parsed.error.flatten().fieldErrors });
    }

    const { logDate, weightKg } = parsed.data;

    const result = await pool.query(
      `INSERT INTO bodyweight_logs (user_id, log_date, weight_kg)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, log_date) DO UPDATE SET weight_kg = EXCLUDED.weight_kg
       RETURNING id, TO_CHAR(log_date, 'YYYY-MM-DD') as "logDate", weight_kg as "weightKg"`,
      [req.userId, logDate, weightKg]
    );

    return res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('upsertBodyweight error:', err);
    return res.status(500).json({ message: 'خطا در ذخیره وزن بدن' });
  }
};

export const deleteBodyweight = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM bodyweight_logs WHERE id = $1 AND user_id = $2 RETURNING id', [id, req.userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'ثبت وزن یافت نشد' });
    }
    return res.status(204).send();
  } catch (err) {
    console.error('deleteBodyweight error:', err);
    return res.status(500).json({ message: 'خطا در حذف وزن' });
  }
};