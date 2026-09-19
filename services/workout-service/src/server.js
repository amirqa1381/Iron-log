import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { requireAuth } from './middlewares/auth.middleware.js';
import { getWorkouts, createWorkout, deleteWorkout } from './controllers/workout.controller.js';
import { getBodyweights, upsertBodyweight } from './controllers/bodyweight.controller.js';
import { getSettings, updateSettings } from './controllers/settings.controller.js';
import { exportData, importData } from './controllers/sync.controller.js';

dotenv.config();

const app = express();

const corsOrigins = process.env.CORS_ORIGIN 
  ? process.env.CORS_ORIGIN.split(',') 
  : ['http://localhost:8080', 'http://127.0.0.1:8080'];

app.use(cors({
  origin: corsOrigins,
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));

// تمام مسیرها نیازمند توکن JWT هستند
app.use(requireAuth);

app.get('/workouts', getWorkouts);
app.post('/workouts', createWorkout);
app.delete('/workouts/:id', deleteWorkout);

app.get('/bodyweight', getBodyweights);
app.post('/bodyweight', upsertBodyweight);

app.get('/settings', getSettings);
app.put('/settings', updateSettings);

app.get('/export', exportData);
app.post('/import', importData);

const PORT = process.env.PORT || 4002;
app.listen(PORT, () => {
  console.log(`🏋️‍♂️ سرویس Workout روی پورت ${PORT} آماده به کار است.`);
});