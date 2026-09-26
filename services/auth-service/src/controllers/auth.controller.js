import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../config/db.js';
import { registerSchema, loginSchema, changePasswordSchema, forgotPasswordSchema, resetPasswordSchema } from '../schemas/auth.schema.js';
import { sendPasswordResetEmail } from '../../../shared/email.service.js';

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const generateTokens = (user) => {
  const payload = { userId: user.id, email: user.email, role: user.role || 'user' };
  
  const accessToken = jwt.sign(payload, process.env.JWT_ACCESS_SECRET, { expiresIn: '15m' });
  const refreshToken = jwt.sign(payload, process.env.JWT_REFRESH_SECRET, { expiresIn: '30d' });
  
  return { accessToken, refreshToken };
};

export const register = async (req, res) => {
  try {
    const parseResult = registerSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ errors: parseResult.error.flatten().fieldErrors });
    }

    const { email, password, displayName } = parseResult.data;
    const normalizedEmail = email.toLowerCase().trim();

    const userExists = await pool.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [normalizedEmail]);
    if (userExists.rows.length > 0) {
      return res.status(409).json({ message: 'این ایمیل قبلاً ثبت شده است' });
    }

    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);

    const newUser = await pool.query(
      `INSERT INTO users (email, password_hash, display_name) 
       VALUES ($1, $2, $3) RETURNING id, email, display_name, role`,
      [normalizedEmail, passwordHash, displayName || null]
    );

    return res.status(201).json({
      message: 'ثبت‌نام با موفقیت انجام شد',
      userId: newUser.rows[0].id
    });
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ message: 'خطای سرور رخ داده است' });
  }
};

export const login = async (req, res) => {
  try {
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ errors: parseResult.error.flatten().fieldErrors });
    }

    const { email, password } = parseResult.data;
    const normalizedEmail = email.toLowerCase().trim();

    const result = await pool.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [normalizedEmail]);
    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'ایمیل یا رمز عبور اشتباه است' });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ message: 'ایمیل یا رمز عبور اشتباه است' });
    }

    const { accessToken, refreshToken } = generateTokens(user);
    const refreshTokenHash = hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [user.id, refreshTokenHash, expiresAt]
    );

    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: isHttps,
      sameSite: isHttps ? 'none' : 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000
    });

    return res.json({
      accessToken,
      refreshToken,
      expiresIn: 900,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        role: user.role || 'user'
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ message: 'خطای سرور رخ داده است' });
  }
};

export const refresh = async (req, res) => {
  try {
    const token = req.cookies.refreshToken || req.body.refreshToken;
    if (!token) {
      return res.status(401).json({ message: 'توکن یافت نشد' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    } catch {
      return res.status(401).json({ message: 'توکن نامعتبر یا منقضی شده است' });
    }

    const oldHash = hashToken(token);
    const dbToken = await pool.query(
      `SELECT * FROM refresh_tokens WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
      [oldHash]
    );

    if (dbToken.rows.length === 0) {
      return res.status(401).json({ message: 'نشست نامعتبر است' });
    }

    // چرخش توکن (Token Rotation) جهت امنیت حداکثری
    await pool.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [dbToken.rows[0].id]);

    const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [decoded.userId]);
    if (userRes.rows.length === 0) {
      return res.status(401).json({ message: 'کاربر یافت نشد' });
    }

    const user = userRes.rows[0];
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user);
    const newHash = hashToken(newRefreshToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [user.id, newHash, expiresAt]
    );

    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';

    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: isHttps,
      sameSite: isHttps ? 'none' : 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000
    });

    return res.json({ accessToken, refreshToken: newRefreshToken, expiresIn: 900 });
  } catch (err) {
    console.error('Refresh error:', err);
    return res.status(500).json({ message: 'خطای سرور رخ داده است' });
  }
};

export const logout = async (req, res) => {
  try {
    const token = req.cookies.refreshToken || req.body.refreshToken;
    if (token) {
      const hashed = hashToken(token);
      await pool.query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1', [hashed]);
    }
    res.clearCookie('refreshToken');
    return res.status(204).send();
  } catch (err) {
    console.error('Logout error:', err);
    return res.status(500).json({ message: 'خطای سرور رخ داده است' });
  }
};

export const me = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const result = await pool.query('SELECT id, email, display_name, role, created_at FROM users WHERE id = $1', [userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'کاربر یافت نشد' });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    console.error('Me error:', err);
    return res.status(500).json({ message: 'خطای سرور رخ داده است' });
  }
};

export const changePassword = async (req, res) => {
  try {
    const parseResult = changePasswordSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ errors: parseResult.error.flatten().fieldErrors });
    }

    const userId = req.user?.id || req.user?.userId;
    const { currentPassword, newPassword } = parseResult.data;

    const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ message: 'کاربر یافت نشد' });
    }

    const user = userRes.rows[0];
    const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ message: 'رمز عبور فعلی نادرست است' });
    }

    const salt = await bcrypt.genSalt(12);
    const newPasswordHash = await bcrypt.hash(newPassword, salt);

    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newPasswordHash, userId]);
    // Revoke old refresh tokens for security
    await pool.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1', [userId]);

    return res.json({ message: 'رمز عبور با موفقیت تغییر کرد' });
  } catch (err) {
    console.error('Change password error:', err);
    return res.status(500).json({ message: 'خطای سرور در تغییر رمز عبور' });
  }
};

export const forgotPassword = async (req, res) => {
  try {
    const parseResult = forgotPasswordSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ errors: parseResult.error.flatten().fieldErrors });
    }

    const { email } = parseResult.data;
    const normalizedEmail = email.toLowerCase().trim();

    const userRes = await pool.query('SELECT * FROM users WHERE LOWER(email) = LOWER($1)', [normalizedEmail]);
    if (userRes.rows.length === 0) {
      return res.json({
        message: 'اگر این ایمیل در سیستم ثبت شده باشد، کد بازیابی برای آن ارسال شد.',
        emailSent: true
      });
    }

    const user = userRes.rows[0];
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, code, expires_at) VALUES ($1, $2, $3, $4)`,
      [user.id, tokenHash, code, expiresAt]
    );

    const origin = req.headers.origin || `${req.protocol}://${req.get('host')}`;
    const resetUrl = `${origin}/?reset_token=${token}&email=${encodeURIComponent(normalizedEmail)}`;

    const emailResult = await sendPasswordResetEmail({
      to: normalizedEmail,
      code,
      resetUrl,
      displayName: user.display_name
    });

    return res.json({
      message: 'کد و لینک بازیابی رمز عبور ارسال شد.',
      emailSent: emailResult.success,
      provider: emailResult.provider,
      previewCode: emailResult.previewCode,
      resetToken: emailResult.previewCode ? token : undefined
    });
  } catch (err) {
    console.error('Forgot password error:', err);
    return res.status(500).json({ message: 'خطای سرور در ارسال درخواست بازیابی رمز' });
  }
};

export const resetPassword = async (req, res) => {
  try {
    const parseResult = resetPasswordSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ errors: parseResult.error.flatten().fieldErrors });
    }

    const { email, code, token, newPassword } = parseResult.data;
    let resetRecord = null;

    if (token) {
      const tokenHash = hashToken(token);
      const resToken = await pool.query(
        `SELECT * FROM password_reset_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
        [tokenHash]
      );
      if (resToken.rows.length > 0) {
        resetRecord = resToken.rows[0];
      }
    } else if (email && code) {
      const normalizedEmail = email.toLowerCase().trim();
      const userRes = await pool.query('SELECT id FROM users WHERE LOWER(email) = LOWER($1)', [normalizedEmail]);
      if (userRes.rows.length > 0) {
        const userId = userRes.rows[0].id;
        const resCode = await pool.query(
          `SELECT * FROM password_reset_tokens WHERE user_id = $1 AND code = $2 AND used_at IS NULL AND expires_at > now()`,
          [userId, String(code).trim()]
        );
        if (resCode.rows.length > 0) {
          resetRecord = resCode.rows[0];
        }
      }
    }

    if (!resetRecord) {
      return res.status(400).json({ message: 'کد تایید یا لینک بازیابی نامعتبر یا منقضی شده است' });
    }

    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, resetRecord.user_id]);
    await pool.query('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1', [resetRecord.id]);
    await pool.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1', [resetRecord.user_id]);

    return res.json({ message: 'رمز عبور شما با موفقیت تغییر کرد. اکنون می‌توانید وارد حساب شوید.' });
  } catch (err) {
    console.error('Reset password error:', err);
    return res.status(500).json({ message: 'خطای سرور در بازنشانی رمز عبور' });
  }
};

export const deleteAccount = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    if (!userId) {
      return res.status(401).json({ message: 'کاربر شناسایی نشد' });
    }

    // CASCADE delete removes user, refresh tokens, workouts, bodyweights, custom exercises
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);

    res.clearCookie('refreshToken');
    return res.json({ message: 'حساب کاربری با موفقیت حذف شد' });
  } catch (err) {
    console.error('Delete account error:', err);
    return res.status(500).json({ message: 'خطای سرور در حذف حساب' });
  }
};
