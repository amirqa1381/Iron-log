import jwt from 'jsonwebtoken';
import { pool } from '../config/db.js';

export const requireAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'نیاز به توکن احراز هویت است' });
  }

  jwt.verify(token, process.env.JWT_ACCESS_SECRET, async (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: 'توکن نامعتبر یا منقضی شده است' });
    }
    
    try {
      // Check if the user exists in database (in case user was removed/deleted)
      const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [decoded.userId]);
      if (userCheck.rows.length === 0) {
        return res.status(401).json({ message: 'حساب کاربری یافت نشد یا حذف شده است' });
      }

      req.userId = decoded.userId;
      next();
    } catch (dbErr) {
      console.error('requireAuth user check error:', dbErr);
      return res.status(500).json({ message: 'خطا در اعتبارسنجی کاربر' });
    }
  });
};