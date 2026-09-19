import jwt from 'jsonwebtoken';

export const requireAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'نیاز به توکن احراز هویت است' });
  }

  jwt.verify(token, process.env.JWT_ACCESS_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: 'توکن نامعتبر یا منقضی شده است' });
    }
    // user_id همیشه از توکن گرفته می‌شود و از کلاینت خوانده نمی‌شود
    req.userId = decoded.userId;
    next();
  });
};