import { pool } from '../config/db.js';
import { settingsSchema } from '../schemas/workout.schema.js';

export const getSettings = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT active_mode as "activeMode" FROM user_settings WHERE user_id = $1`,
      [req.userId]
    );
    if (result.rows.length === 0) {
      return res.json({ activeMode: 'dumbbell' });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    console.error('getSettings error:', err);
    return res.status(500).json({ message: 'خطا در بارگذاری تنظیمات' });
  }
};

export const updateSettings = async (req, res) => {
  try {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ errors: parsed.error.flatten().fieldErrors });
    }

    const { activeMode } = parsed.data;
    await pool.query(
      `INSERT INTO user_settings (user_id, active_mode, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE SET active_mode = EXCLUDED.active_mode, updated_at = now()`,
      [req.userId, activeMode]
    );

    return res.json({ activeMode });
  } catch (err) {
    console.error('updateSettings error:', err);
    return res.status(500).json({ message: 'خطا در ذخیره تنظیمات' });
  }
};