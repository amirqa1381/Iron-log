import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import { register, login, refresh, logout, me } from './services/auth-service/src/controllers/auth.controller.js';
import { verifyAccessToken } from './services/auth-service/src/middlewares/auth.middleware.js';

import { requireAuth } from './services/workout-service/src/middlewares/auth.middleware.js';
import { getWorkouts, createWorkout, deleteWorkout } from './services/workout-service/src/controllers/workout.controller.js';
import { getBodyweights, upsertBodyweight } from './services/workout-service/src/controllers/bodyweight.controller.js';
import { getSettings, updateSettings } from './services/workout-service/src/controllers/settings.controller.js';
import { exportData, importData } from './services/workout-service/src/controllers/sync.controller.js';

dotenv.config();

// Ensure JWT secrets have working defaults for preview / development
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'ironlog-jwt-access-secret-32-chars-long';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'ironlog-jwt-refresh-secret-32-chars-long';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// Rate limiter for authentication endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { message: 'تعداد درخواست‌ها بیش از حد مجاز است. لطفاً کمی بعد مجدداً تلاش کنید.' }
});

// Auth Service Routes
app.post('/auth/register', authLimiter, register);
app.post('/auth/login', authLimiter, login);
app.post('/auth/refresh', refresh);
app.post('/auth/logout', logout);
app.get('/auth/me', verifyAccessToken, me);

// Workout Service Routes (Protected)
app.get('/workouts', requireAuth, getWorkouts);
app.post('/workouts', requireAuth, createWorkout);
app.delete('/workouts/:id', requireAuth, deleteWorkout);

app.get('/bodyweight', requireAuth, getBodyweights);
app.post('/bodyweight', requireAuth, upsertBodyweight);

app.get('/settings', requireAuth, getSettings);
app.put('/settings', requireAuth, updateSettings);

app.get('/export', requireAuth, exportData);
app.post('/import', requireAuth, importData);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', app: 'Iron Log', port: PORT });
});

// Serve frontend static files
const frontendDir = path.join(__dirname, 'frontend');
app.use(express.static(frontendDir));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDir, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Iron Log unified server running on http://0.0.0.0:${PORT}`);
});
