import jwt from 'jsonwebtoken';

export const verifyAccessToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'نیاز به احراز هویت است' });
  }

  jwt.verify(token, process.env.JWT_ACCESS_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'توکن نامعتبر یا منقضی شده است' });
    }
    req.user = user;
    next();
  });
};