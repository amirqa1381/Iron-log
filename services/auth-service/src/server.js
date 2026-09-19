import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { register, login, refresh, logout, me } from './controllers/auth.controller.js';
import { verifyAccessToken } from './middlewares/auth.middleware.js';

dotenv.config();

const app = express();

const corsOrigins = process.env.CORS_ORIGIN 
  ? process.env.CORS_ORIGIN.split(',') 
  : ['http://localhost:3000', 'http://127.0.0.1:5500', 'http://localhost:8080'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || corsOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('مسدود شده توسط CORS'));
    }
  },
  credentials: true
}));

app.use(express.json());
app.use(cookieParser());

// محدودیت نرخ درخواست برای مسیرهای حساس
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { message: 'تعداد درخواست‌ها بیش از حد مجاز است. لطفاً ۱۵ دقیقه دیگر مجدداً تلاش کنید.' }
});

app.post('/auth/register', authLimiter, register);
app.post('/auth/login', authLimiter, login);
app.post('/auth/refresh', refresh);
app.post('/auth/logout', logout);
app.get('/auth/me', verifyAccessToken, me);

app.get('/health', (req, res) => res.json({ status: 'healthy', service: 'auth-service' }));

const PORT = process.env.PORT || 4001;
app.listen(PORT, () => {
  console.log(`🚀 سرویس Auth روی پورت ${PORT} آماده به کار است.`);
});