import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../config/db.js';
import { registerSchema, loginSchema } from '../schemas/auth.schema.js';

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const generateTokens = (user) => {
  const payload = { userId: user.id, email: user.email };
  
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

    const userExists = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (userExists.rows.length > 0) {
      return res.status(409).json({ message: 'این ایمیل قبلاً ثبت شده است' });
    }

    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);

    const newUser = await pool.query(
      `INSERT INTO users (email, password_hash, display_name) 
       VALUES ($1, $2, $3) RETURNING id, email, display_name`,
      [email, passwordHash, displayName || null]
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

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
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
        displayName: user.display_name
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
    const result = await pool.query('SELECT id, email, display_name, created_at FROM users WHERE id = $1', [req.user.userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'کاربر یافت نشد' });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    console.error('Me error:', err);
    return res.status(500).json({ message: 'خطای سرور رخ داده است' });
  }
};