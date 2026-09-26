import jwt from 'jsonwebtoken';
import { pool } from '../config/db.js';

export const verifyAccessToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'نیاز به احراز هویت است' });
  }

  jwt.verify(token, process.env.JWT_ACCESS_SECRET, async (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: 'توکن نامعتبر یا منقضی شده است' });
    }
    
    try {
      const userCheck = await pool.query('SELECT id, email, display_name, role FROM users WHERE id = $1', [decoded.userId]);
      if (userCheck.rows.length === 0) {
        return res.status(401).json({ message: 'حساب کاربری یافت نشد یا حذف شده است' });
      }
      req.user = userCheck.rows[0];
      next();
    } catch (dbErr) {
      console.error('Verify user error:', dbErr);
      return res.status(500).json({ message: 'خطا در بررسی وضعیت حساب کاربری' });
    }
  });
};

export const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'دسترسی غیرمجاز: این بخش فقط مخصوص مدیران سیستم است.' });
  }
  next();
};
