import { pool } from '../config/db.js';
import { settingsSchema } from '../schemas/workout.schema.js';

export const getSettings = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT active_mode as "activeMode", start_weight as "startWeight", target_weight as "targetWeight" FROM user_settings WHERE user_id = $1`,
      [req.userId]
    );
    if (result.rows.length === 0) {
      return res.json({ activeMode: 'dumbbell', startWeight: 78, targetWeight: 85 });
    }
    return res.json({
      activeMode: result.rows[0].activeMode || 'dumbbell',
      startWeight: Number(result.rows[0].startWeight) || 78,
      targetWeight: Number(result.rows[0].targetWeight) || 85
    });
  } catch (err) {
    console.error('getSettings error:', err);
    return res.status(500).json({ message: 'خطا در بارگذاری تنظیمات' });
  }
};

export const updateSettings = async (req, res) => {
  try {
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ 
        message: 'اطلاعات وارد شده نامعتبر است',
        errors: parsed.error.flatten().fieldErrors 
      });
    }

    const { activeMode, startWeight, targetWeight } = parsed.data;

    const currentResult = await pool.query(
      `SELECT active_mode, start_weight, target_weight FROM user_settings WHERE user_id = $1`, 
      [req.userId]
    );
    const current = currentResult.rows[0] || {};

    const newActiveMode = activeMode || current.active_mode || current.activeMode || 'dumbbell';
    
    let newStartWeight = null;
    if (startWeight !== undefined && startWeight !== null && !isNaN(startWeight)) {
      newStartWeight = Number(startWeight);
    } else if (startWeight === undefined) {
      const existingSw = current.start_weight !== undefined ? current.start_weight : current.startWeight;
      newStartWeight = existingSw !== undefined && existingSw !== null ? Number(existingSw) : null;
    }

    let newTargetWeight = null;
    if (targetWeight !== undefined && targetWeight !== null && !isNaN(targetWeight)) {
      newTargetWeight = Number(targetWeight);
    } else if (targetWeight === undefined) {
      const existingTw = current.target_weight !== undefined ? current.target_weight : current.targetWeight;
      newTargetWeight = existingTw !== undefined && existingTw !== null ? Number(existingTw) : null;
    }

    await pool.query(
      `INSERT INTO user_settings (user_id, active_mode, start_weight, target_weight, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (user_id) DO UPDATE SET 
         active_mode = EXCLUDED.active_mode, 
         start_weight = EXCLUDED.start_weight, 
         target_weight = EXCLUDED.target_weight, 
         updated_at = now()`,
      [req.userId, newActiveMode, newStartWeight, newTargetWeight]
    );

    return res.json({
      activeMode: newActiveMode,
      startWeight: newStartWeight,
      targetWeight: newTargetWeight
    });
  } catch (err) {
    console.error('updateSettings error:', err);
    return res.status(500).json({ message: 'خطا در ذخیره تنظیمات: ' + (err.message || 'خطای سرور') });
  }
};