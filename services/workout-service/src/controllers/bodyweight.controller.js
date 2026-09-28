import { pool } from '../config/db.js';
import { bodyweightSchema } from '../schemas/workout.schema.js';

export const getBodyweights = async (req, res) => {
  try {
    const userId = req.userId || req.user?.userId;
    const result = await pool.query(
      `SELECT id, TO_CHAR(log_date, 'YYYY-MM-DD') as "logDate", weight_kg as "weightKg", created_at
       FROM bodyweight_logs WHERE user_id = $1 ORDER BY log_date ASC, id ASC`,
      [userId]
    );

    const rows = (result.rows || []).map(r => {
      const w = Number(r.weightKg !== undefined ? r.weightKg : r.weight_kg);
      const d = r.logDate || r.log_date;
      return {
        id: r.id,
        logDate: d,
        weightKg: w,
        date: d,
        weight: w,
        created_at: r.created_at
      };
    });

    // Provide response that works both if client treats it as Array or as Object
    const responsePayload = Object.assign(rows, {
      bodyweights: rows,
      logs: rows,
      rows: rows
    });

    return res.json(responsePayload);
  } catch (err) {
    console.error('getBodyweights error:', err);
    return res.status(500).json({ message: 'خطا در دریافت تاریخچه وزن' });
  }
};

export const upsertBodyweight = async (req, res) => {
  try {
    const parsed = bodyweightSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ 
        message: 'اطلاعات وزن وارد شده معتبر نیست. لطفاً تاریخ و وزن مثبت وارد کنید.',
        errors: parsed.error.flatten().fieldErrors 
      });
    }

    const userId = req.userId || req.user?.userId;
    const logDate = parsed.data.logDate || parsed.data.date || new Date().toISOString().slice(0, 10);
    const weightKg = Number(parsed.data.weightKg !== undefined ? parsed.data.weightKg : parsed.data.weight);

    // Insert as new record so all user weigh-ins are permanently preserved
    const result = await pool.query(
      `INSERT INTO bodyweight_logs (user_id, log_date, weight_kg)
       VALUES ($1, $2, $3)
       RETURNING id, TO_CHAR(log_date, 'YYYY-MM-DD') as "logDate", weight_kg as "weightKg", created_at`,
      [userId, logDate, weightKg]
    );

    const row = result.rows[0];
    const w = Number(row.weightKg !== undefined ? row.weightKg : row.weight_kg);
    const d = row.logDate || row.log_date;

    const formattedLog = {
      id: row.id,
      logDate: d,
      weightKg: w,
      date: d,
      weight: w,
      created_at: row.created_at
    };

    return res.status(200).json({
      ...formattedLog,
      log: formattedLog,
      message: 'وزن با موفقیت ثبت و ذخیره شد.'
    });
  } catch (err) {
    console.error('upsertBodyweight error:', err);
    return res.status(500).json({ message: 'خطا در ذخیره وزن بدن: ' + err.message });
  }
};

export const deleteBodyweight = async (req, res) => {
  try {
    const userId = req.userId || req.user?.userId;
    const { id } = req.params;
    const result = await pool.query('DELETE FROM bodyweight_logs WHERE id = $1 AND user_id = $2 RETURNING id', [id, userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'ثبت وزن یافت نشد' });
    }
    return res.status(200).json({ success: true, message: 'ثبت وزن با موفقیت حذف شد' });
  } catch (err) {
    console.error('deleteBodyweight error:', err);
    return res.status(500).json({ message: 'خطا در حذف وزن' });
  }
};
