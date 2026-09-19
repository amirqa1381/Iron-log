import { pool } from '../config/db.js';

export const getCustomExercises = async (req, res) => {
  try {
    const { programMode } = req.query;
    let query = `SELECT id, program_mode as "programMode", day_number as "dayNumber",
                        name, name_fa as "nameFa", equip, sets, reps, rest, rir, weight,
                        tech, mistake, created_at as "createdAt"
                 FROM custom_exercises WHERE user_id = $1`;
    const params = [req.userId];
    if (programMode) {
      params.push(programMode);
      query += ` AND program_mode = $2`;
    }
    query += ` ORDER BY id ASC`;
    const result = await pool.query(query, params);
    return res.json(result.rows);
  } catch (err) {
    console.error('getCustomExercises error:', err);
    return res.status(500).json({ message: 'خطا در دریافت حرکات اختصاصی' });
  }
};

export const createCustomExercise = async (req, res) => {
  try {
    const { programMode, dayNumber, name, nameFa, equip, sets, reps, rest, rir, weight, tech, mistake } = req.body;
    if (!nameFa || !dayNumber) {
      return res.status(400).json({ message: 'نام حرکت و روز تمرین الزامی است' });
    }

    const finalName = name && name.trim() ? name.trim() : nameFa.trim();
    const result = await pool.query(
      `INSERT INTO custom_exercises 
       (user_id, program_mode, day_number, name, name_fa, equip, sets, reps, rest, rir, weight, tech, mistake)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, program_mode as "programMode", day_number as "dayNumber",
                 name, name_fa as "nameFa", equip, sets, reps, rest, rir, weight,
                 tech, mistake, created_at as "createdAt"`,
      [
        req.userId,
        programMode || 'dumbbell',
        Number(dayNumber),
        finalName,
        nameFa.trim(),
        equip || 'دمبل',
        Number(sets) || 3,
        reps || '۸ تا ۱۲',
        rest || '۹۰ ثانیه',
        Number(rir) || 2,
        weight || 'متوسط',
        tech || '',
        mistake || ''
      ]
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('createCustomExercise error:', err);
    return res.status(500).json({ message: 'خطا در ثبت حرکت اختصاصی' });
  }
};

export const deleteCustomExercise = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `DELETE FROM custom_exercises WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, req.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'حرکت یافت نشد' });
    }
    return res.status(204).send();
  } catch (err) {
    console.error('deleteCustomExercise error:', err);
    return res.status(500).json({ message: 'خطا در حذف حرکت اختصاصی' });
  }
};
