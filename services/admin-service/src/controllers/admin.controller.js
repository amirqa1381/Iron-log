import bcrypt from 'bcryptjs';
import { pool } from '../../../auth-service/src/config/db.js';
import { getEmailConfigStatus, sendTestEmail } from '../../../shared/email.service.js';
import { getDatabaseStatus } from '../../../shared/db.js';

export const getAdminMetrics = async (req, res) => {
  try {
    const usersCountRes = await pool.query('SELECT COUNT(*) as count FROM users');
    const workoutsCountRes = await pool.query('SELECT COUNT(*) as count FROM workout_logs');
    const bwCountRes = await pool.query('SELECT COUNT(*) as count FROM bodyweight_logs');
    const customExRes = await pool.query('SELECT COUNT(*) as count FROM custom_exercises');

    const totalUsers = parseInt(usersCountRes.rows[0]?.count || 0, 10);
    const totalWorkouts = parseInt(workoutsCountRes.rows[0]?.count || 0, 10);
    const totalBodyweights = parseInt(bwCountRes.rows[0]?.count || 0, 10);
    const totalCustomExercises = parseInt(customExRes.rows[0]?.count || 0, 10);

    const emailStatus = getEmailConfigStatus();
    const dbStatus = getDatabaseStatus();

    const mem = process.memoryUsage();

    return res.json({
      metrics: {
        totalUsers,
        totalWorkouts,
        totalBodyweights,
        totalCustomExercises
      },
      emailStatus,
      dbStatus,
      system: {
        uptimeSeconds: Math.round(process.uptime()),
        memoryUsedMB: +(mem.heapUsed / 1024 / 1024).toFixed(1),
        memoryTotalMB: +(mem.heapTotal / 1024 / 1024).toFixed(1)
      }
    });
  } catch (err) {
    console.error('Admin metrics error:', err);
    return res.status(500).json({ message: 'خطا در دریافت آمار مدیریت' });
  }
};

export const getAdminUsers = async (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim().toLowerCase();

    // Query users with workout & bodyweight stats
    const query = `
      SELECT 
        u.id, 
        u.email, 
        u.display_name, 
        u.role, 
        u.created_at,
        COUNT(DISTINCT w.id) as workout_count,
        COUNT(DISTINCT b.id) as bodyweight_count,
        MAX(w.log_date) as last_workout_date
      FROM users u
      LEFT JOIN workout_logs w ON w.user_id = u.id
      LEFT JOIN bodyweight_logs b ON b.user_id = u.id
      GROUP BY u.id, u.email, u.display_name, u.role, u.created_at
      ORDER BY u.created_at DESC
    `;

    const result = await pool.query(query);
    let usersList = result.rows.map(r => ({
      id: r.id,
      email: r.email,
      displayName: r.display_name,
      role: r.role || 'user',
      createdAt: r.created_at,
      workoutCount: parseInt(r.workout_count || 0, 10),
      bodyweightCount: parseInt(r.bodyweight_count || 0, 10),
      lastWorkoutDate: r.last_workout_date || null
    }));

    if (q) {
      usersList = usersList.filter(u => 
        u.email.toLowerCase().includes(q) || 
        (u.displayName && u.displayName.toLowerCase().includes(q))
      );
    }

    return res.json({ users: usersList });
  } catch (err) {
    console.error('Admin get users error:', err);
    return res.status(500).json({ message: 'خطا در دریافت لیست کاربران' });
  }
};

export const updateUserRole = async (req, res) => {
  try {
    const targetUserId = parseInt(req.params.id, 10);
    const { role } = req.body;
    const currentAdminId = req.user?.id;

    if (!role || (role !== 'admin' && role !== 'user')) {
      return res.status(400).json({ message: 'نقش نامعتبر است (باید admin یا user باشد)' });
    }

    if (targetUserId === currentAdminId && role === 'user') {
      return res.status(400).json({ message: 'شما نمی‌توانید نقش مدیریت خود را لغو کنید.' });
    }

    const check = await pool.query('SELECT id, email FROM users WHERE id = $1', [targetUserId]);
    if (check.rows.length === 0) {
      return res.status(404).json({ message: 'کاربر یافت نشد' });
    }

    await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, targetUserId]);
    return res.json({ message: `نقش کاربر به ${role === 'admin' ? 'مدیر (Admin)' : 'کاربر عادی (User)'} تغییر یافت` });
  } catch (err) {
    console.error('Admin update user role error:', err);
    return res.status(500).json({ message: 'خطا در تغییر نقش کاربر' });
  }
};

export const adminResetUserPassword = async (req, res) => {
  try {
    const targetUserId = parseInt(req.params.id, 10);
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ message: 'رمز عبور جدید باید حداقل ۶ کاراکتر باشد' });
    }

    const check = await pool.query('SELECT id, email FROM users WHERE id = $1', [targetUserId]);
    if (check.rows.length === 0) {
      return res.status(404).json({ message: 'کاربر یافت نشد' });
    }

    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, targetUserId]);
    await pool.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1', [targetUserId]);

    return res.json({ message: 'رمز عبور کاربر با موفقیت تغییر داده شد و نشست‌های قبلی منقضی شدند.' });
  } catch (err) {
    console.error('Admin reset password error:', err);
    return res.status(500).json({ message: 'خطا در تغییر رمز کاربر' });
  }
};

export const deleteUserByAdmin = async (req, res) => {
  try {
    const targetUserId = parseInt(req.params.id, 10);
    const currentAdminId = req.user?.id;

    if (targetUserId === currentAdminId) {
      return res.status(400).json({ message: 'شما نمی‌توانید حساب مدیریت فعلی خود را از اینجا حذف کنید.' });
    }

    const check = await pool.query('SELECT id, email FROM users WHERE id = $1', [targetUserId]);
    if (check.rows.length === 0) {
      return res.status(404).json({ message: 'کاربر مورد نظر یافت نشد' });
    }

    await pool.query('DELETE FROM users WHERE id = $1', [targetUserId]);
    return res.json({ message: 'کاربر و کلیه داده‌های تمرینی و رکوردهای او با موفقیت حذف شدند.' });
  } catch (err) {
    console.error('Admin delete user error:', err);
    return res.status(500).json({ message: 'خطا در حذف کاربر' });
  }
};

export const getEmailConfig = async (req, res) => {
  try {
    const status = getEmailConfigStatus();
    return res.json(status);
  } catch (err) {
    console.error('Get email config error:', err);
    return res.status(500).json({ message: 'خطا در بررسی پیکربندی ایمیل' });
  }
};

export const testEmailSending = async (req, res) => {
  try {
    const targetEmail = req.body?.targetEmail || req.user?.email;
    if (!targetEmail) {
      return res.status(400).json({ message: 'ایمیل مقصد مشخص نشده است' });
    }

    const result = await sendTestEmail({ to: targetEmail });
    return res.json({
      message: `ایمیل آزمایشی با موفقیت به ${targetEmail} ارسال شد.`,
      result
    });
  } catch (err) {
    console.error('Test email sending error:', err);
    return res.status(400).json({
      message: err.message || 'خطا در ارسال ایمیل آزمایشی. لطفاً تنظیمات GMAIL_USER و GMAIL_APP_PASS را بررسی کنید.'
    });
  }
};
