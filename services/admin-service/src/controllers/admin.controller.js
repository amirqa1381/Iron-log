import bcrypt from 'bcryptjs';
import { pool } from '../../../auth-service/src/config/db.js';
import { getEmailConfigStatus, sendTestEmail } from '../../../shared/email.service.js';
import { getDatabaseStatus } from '../../../shared/db.js';

// In-memory audit & system logs
const systemLogs = [
  {
    id: 1,
    type: 'system',
    action: 'راه‌اندازی سامانه',
    details: 'سرور Iron Log با موفقیت راه‌اندازی شد.',
    user: 'سیستم',
    timestamp: new Date(Date.now() - 3600000).toISOString()
  },
  {
    id: 2,
    type: 'auth',
    action: 'پیکربندی مدیر سیستم',
    details: 'حساب مدیر amirghasemian1381@gmail.com همگام‌سازی شد.',
    user: 'سیستم',
    timestamp: new Date(Date.now() - 2400000).toISOString()
  },
  {
    id: 3,
    type: 'auth',
    action: 'پیکربندی مدیر سیستم',
    details: 'حساب مدیر amirhusseinghasemian@outlook.com همگام‌سازی شد.',
    user: 'سیستم',
    timestamp: new Date(Date.now() - 1200000).toISOString()
  }
];

let nextLogId = 4;
export const addSystemLog = (type, action, details, user = 'مدیر') => {
  systemLogs.unshift({
    id: nextLogId++,
    type,
    action,
    details,
    user,
    timestamp: new Date().toISOString()
  });
  if (systemLogs.length > 100) systemLogs.pop();
};

// Global announcement state
let globalAnnouncement = {
  enabled: false,
  message: 'به نسخه جدید سامانه‌ی پایش تمرین Iron Log خوش آمدید!',
  level: 'info', // 'info' | 'warning' | 'success'
  updatedAt: new Date().toISOString(),
  updatedBy: 'سیستم'
};

export const getPublicAnnouncement = (req, res) => {
  return res.json({ announcement: globalAnnouncement });
};

export const getAdminAnnouncement = (req, res) => {
  return res.json({ announcement: globalAnnouncement });
};

export const updateAdminAnnouncement = (req, res) => {
  const { enabled, message, level } = req.body;
  globalAnnouncement = {
    enabled: Boolean(enabled),
    message: String(message || '').trim(),
    level: ['info', 'warning', 'success'].includes(level) ? level : 'info',
    updatedAt: new Date().toISOString(),
    updatedBy: req.user?.email || 'مدیر'
  };
  addSystemLog('announcement', 'به‌روزرسانی اطلاعیه همگانی', globalAnnouncement.enabled ? `اطلاعیه فعال شد: "${globalAnnouncement.message}"` : 'اطلاعیه همگانی غیرفعال شد.', req.user?.email);
  return res.json({ message: 'اطلاعیه سراسری با موفقیت به‌روزرسانی شد.', announcement: globalAnnouncement });
};

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

    // Users breakdown by role
    const usersListRes = await pool.query('SELECT role, email FROM users');
    const roleCounts = {
      admin: 0,
      coach: 0,
      vip: 0,
      user: 0
    };
    (usersListRes.rows || []).forEach(u => {
      const r = u.role || 'user';
      if (roleCounts[r] !== undefined) roleCounts[r]++;
      else roleCounts.user++;
    });

    // Workouts breakdown
    const allWorkoutsRes = await pool.query('SELECT program_mode, exercise_name FROM workout_logs');
    const modeCounts = { dumbbell: 0, gym: 0 };
    const exFrequencies = {};

    (allWorkoutsRes.rows || []).forEach(w => {
      const mode = w.program_mode === 'gym' ? 'gym' : 'dumbbell';
      modeCounts[mode]++;
      const ex = w.exercise_name || 'سایر';
      exFrequencies[ex] = (exFrequencies[ex] || 0) + 1;
    });

    const topExercises = Object.entries(exFrequencies)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    const emailStatus = getEmailConfigStatus();
    const dbStatus = getDatabaseStatus();
    const mem = process.memoryUsage();

    return res.json({
      metrics: {
        totalUsers,
        totalWorkouts,
        totalBodyweights,
        totalCustomExercises,
        roleCounts,
        modeCounts,
        topExercises
      },
      emailStatus,
      dbStatus,
      system: {
        uptimeSeconds: Math.round(process.uptime()),
        memoryUsedMB: +(mem.heapUsed / 1024 / 1024).toFixed(1),
        memoryTotalMB: +(mem.heapTotal / 1024 / 1024).toFixed(1),
        nodeVersion: process.version,
        platform: process.platform
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
    const roleFilter = (req.query.role || '').toString().trim().toLowerCase();

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
        (u.displayName && u.displayName.toLowerCase().includes(q)) ||
        String(u.id) === q
      );
    }

    if (roleFilter && roleFilter !== 'all') {
      usersList = usersList.filter(u => (u.role || 'user') === roleFilter);
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

    const validRoles = ['admin', 'coach', 'vip', 'user'];
    if (!role || !validRoles.includes(role)) {
      return res.status(400).json({ message: `نقش نامعتبر است. نقش‌های مجاز: ${validRoles.join('، ')}` });
    }

    const check = await pool.query('SELECT id, email, display_name, role FROM users WHERE id = $1', [targetUserId]);
    if (check.rows.length === 0) {
      return res.status(404).json({ message: 'کاربر یافت نشد' });
    }

    const prevRole = check.rows[0].role || 'user';
    await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, targetUserId]);

    const roleLabels = {
      admin: '👑 مدیر کل (Admin)',
      coach: '🏋️ مربی و آنالیزور (Coach)',
      vip: '⭐ کاربر ویژه (VIP)',
      user: '👤 کاربر عادی (User)'
    };

    addSystemLog(
      'role_change',
      'تغییر نقش کاربر',
      `نقش کاربر ${check.rows[0].email} از "${prevRole}" به "${role}" تغییر یافت.`,
      req.user?.email || 'مدیر'
    );

    return res.json({
      message: `نقش کاربر به ${roleLabels[role] || role} با موفقیت تغییر یافت.`,
      role
    });
  } catch (err) {
    console.error('Admin update user role error:', err);
    return res.status(500).json({ message: 'خطا در تغییر نقش کاربر' });
  }
};

export const createUserByAdmin = async (req, res) => {
  try {
    const { email, password, displayName, role } = req.body;

    if (!email || !email.includes('@')) {
      return res.status(400).json({ message: 'فرمت ایمیل نامعتبر است' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ message: 'رمز عبور باید حداقل ۶ کاراکتر باشد' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existing = await pool.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [normalizedEmail]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: 'این ایمیل قبلاً در سیستم ثبت شده است' });
    }

    const validRoles = ['admin', 'coach', 'vip', 'user'];
    const assignedRole = validRoles.includes(role) ? role : 'user';

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const insertRes = await pool.query(
      `INSERT INTO users (email, password_hash, display_name, role)
       VALUES ($1, $2, $3, $4) RETURNING id, email, display_name, role`,
      [normalizedEmail, passwordHash, displayName || null, assignedRole]
    );

    const newUser = insertRes.rows[0];
    addSystemLog(
      'user_create',
      'ایجاد کاربر جدید توسط مدیر',
      `کاربر ${newUser.email} با نقش ${assignedRole} ساخته شد.`,
      req.user?.email || 'مدیر'
    );

    return res.status(201).json({
      message: 'کاربر جدید با موفقیت ایجاد شد.',
      user: {
        id: newUser.id,
        email: newUser.email,
        displayName: newUser.display_name,
        role: newUser.role
      }
    });
  } catch (err) {
    console.error('Create user by admin error:', err);
    return res.status(500).json({ message: 'خطای سرور در ساخت کاربر جدید' });
  }
};

export const getUserDetails = async (req, res) => {
  try {
    const targetUserId = parseInt(req.params.id, 10);
    const userRes = await pool.query('SELECT id, email, display_name, role, created_at FROM users WHERE id = $1', [targetUserId]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ message: 'کاربر یافت نشد' });
    }

    const user = userRes.rows[0];

    // Fetch user workouts (last 15)
    const workoutsRes = await pool.query(
      'SELECT id, program_mode, exercise_name, log_date, weight_kg, reps, rir, rpe, notes, created_at FROM workout_logs WHERE user_id = $1 ORDER BY log_date DESC LIMIT 15',
      [targetUserId]
    );

    // Fetch user bodyweights (last 10)
    const bwRes = await pool.query(
      'SELECT id, log_date, weight_kg, created_at FROM bodyweight_logs WHERE user_id = $1 ORDER BY log_date DESC LIMIT 10',
      [targetUserId]
    );

    // Fetch user custom exercises
    const customRes = await pool.query(
      'SELECT id, exercise_name, program_mode FROM custom_exercises WHERE user_id = $1',
      [targetUserId]
    );

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role || 'user',
        createdAt: user.created_at
      },
      workouts: workoutsRes.rows || [],
      bodyweights: bwRes.rows || [],
      customExercises: customRes.rows || []
    });
  } catch (err) {
    console.error('Get user details error:', err);
    return res.status(500).json({ message: 'خطا در دریافت پرونده کاربر' });
  }
};

export const getRecentWorkouts = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM workout_logs ORDER BY created_at DESC LIMIT 30');
    return res.json({ workouts: result.rows || [] });
  } catch (err) {
    console.error('Get recent workouts error:', err);
    return res.status(500).json({ message: 'خطا در دریافت تمرینات اخیر' });
  }
};

export const getSystemLogs = (req, res) => {
  return res.json({ logs: systemLogs });
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

    addSystemLog(
      'password_reset',
      'تغییر رمز عبور کاربر توسط مدیر',
      `رمز عبور کاربر ${check.rows[0].email} بازنشانی شد.`,
      req.user?.email || 'مدیر'
    );

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

    const userEmail = check.rows[0].email;
    await pool.query('DELETE FROM users WHERE id = $1', [targetUserId]);

    addSystemLog(
      'user_delete',
      'حذف کاربر توسط مدیر',
      `کاربر ${userEmail} و تمام اطلاعات او حذف شد.`,
      req.user?.email || 'مدیر'
    );

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

    addSystemLog(
      'email_test',
      'ارسال ایمیل آزمایشی',
      `ایمیل تست به ${targetEmail} با موفقیت ارسال شد (${result.provider || 'default'}).`,
      req.user?.email || 'مدیر'
    );

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
