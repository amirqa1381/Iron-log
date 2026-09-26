import express, { Request, Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  register,
  login,
  refresh,
  logout,
  me,
  deleteAccount,
  changePassword,
  forgotPassword,
  resetPassword
} from './services/auth-service/src/controllers/auth.controller.js';
import { verifyAccessToken, requireAdmin } from './services/auth-service/src/middlewares/auth.middleware.js';
import {
  getAdminMetrics,
  getAdminUsers,
  updateUserRole,
  adminResetUserPassword,
  deleteUserByAdmin,
  getEmailConfig,
  testEmailSending
} from './services/admin-service/src/controllers/admin.controller.js';

import { requireAuth } from './services/workout-service/src/middlewares/auth.middleware.js';
import { getWorkouts, createWorkout, deleteWorkout } from './services/workout-service/src/controllers/workout.controller.js';
import { getBodyweights, upsertBodyweight, deleteBodyweight } from './services/workout-service/src/controllers/bodyweight.controller.js';
import { getSettings, updateSettings } from './services/workout-service/src/controllers/settings.controller.js';
import { exportData, importData } from './services/workout-service/src/controllers/sync.controller.js';
import { getCustomExercises, createCustomExercise, deleteCustomExercise } from './services/workout-service/src/controllers/custom-exercise.controller.js';
import { initPostgresTables, getDatabaseStatus } from './services/shared/db.js';

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

app.use(compression());
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
app.delete('/auth/me', verifyAccessToken, deleteAccount);

// Password Management Routes
app.post('/auth/change-password', verifyAccessToken, changePassword);
app.post('/auth/forgot-password', authLimiter, forgotPassword);
app.post('/auth/reset-password', authLimiter, resetPassword);

// Admin Service Routes (Protected with Admin Role)
app.get('/admin/metrics', verifyAccessToken, requireAdmin, getAdminMetrics);
app.get('/admin/users', verifyAccessToken, requireAdmin, getAdminUsers);
app.put('/admin/users/:id/role', verifyAccessToken, requireAdmin, updateUserRole);
app.put('/admin/users/:id/reset-password', verifyAccessToken, requireAdmin, adminResetUserPassword);
app.delete('/admin/users/:id', verifyAccessToken, requireAdmin, deleteUserByAdmin);
app.get('/admin/email-config', verifyAccessToken, requireAdmin, getEmailConfig);
app.post('/admin/test-email', verifyAccessToken, requireAdmin, testEmailSending);

// Workout Service Routes (Protected)
app.get('/workouts', requireAuth, getWorkouts);
app.post('/workouts', requireAuth, createWorkout);
app.delete('/workouts/:id', requireAuth, deleteWorkout);

app.get('/bodyweight', requireAuth, getBodyweights);
app.post('/bodyweight', requireAuth, upsertBodyweight);
app.delete('/bodyweight/:id', requireAuth, deleteBodyweight);

app.get('/settings', requireAuth, getSettings);
app.put('/settings', requireAuth, updateSettings);

app.get('/custom-exercises', requireAuth, getCustomExercises);
app.post('/custom-exercises', requireAuth, createCustomExercise);
app.delete('/custom-exercises/:id', requireAuth, deleteCustomExercise);

app.get('/export', requireAuth, exportData);
app.post('/import', requireAuth, importData);

// Health check and database status endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    app: 'Iron Log',
    port: PORT,
    database: getDatabaseStatus()
  });
});

app.get('/db-status', (req: Request, res: Response) => {
  res.json(getDatabaseStatus());
});

// System performance and scalability metrics endpoint
app.get('/api/system-metrics', (req: Request, res: Response) => {
  const mem = process.memoryUsage();
  res.json({
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    memoryUsageMB: {
      rss: +(mem.rss / 1024 / 1024).toFixed(1),
      heapTotal: +(mem.heapTotal / 1024 / 1024).toFixed(1),
      heapUsed: +(mem.heapUsed / 1024 / 1024).toFixed(1)
    },
    architecture: 'Stateless Node.js with Connection Pooling & In-Memory Fallback',
    capacityAdvice: {
      concurrentUsersEstimate: '۵۰ تا ۱۰۰ کاربر همزمان روی پلن رایگان ۵۱۲ مگابایت رم Render / Railway',
      databaseTier: 'Supabase Free Tier (۵۰۰ مگابایت حافظه + ۵۰ هزار کاربر در ماه)',
      optimizations: ['Gzip Compression', 'Composite B-Tree Indexes', 'HTTP Caching', 'Debounced Sync']
    }
  });
});

// Serve frontend static files with no-cache in development to ensure instant preview updates
const frontendDir = path.join(__dirname, 'frontend');
app.use(express.static(frontendDir, {
  maxAge: 0,
  etag: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

// SPA fallback
app.get('*', (req: Request, res: Response) => {
  res.sendFile(path.join(frontendDir, 'index.html'));
});

// Auto-initialize Supabase PostgreSQL tables if connected
initPostgresTables().catch(err => {
  console.warn('[Postgres Init]', err.message);
});

app.listen(PORT, () => {
  console.log(`🚀 Iron Log TypeScript server running on http://0.0.0.0:${PORT}`);
});
