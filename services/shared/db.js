import pg from 'pg';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

// In-memory data structures for mock mode
let nextUserId = 2;
let nextTokenId = 1;
let nextWorkoutId = 10;
let nextWeightId = 10;

// Pre-seed demo user
const demoPasswordHash = bcrypt.hashSync('123456', 10);
const users = [
  {
    id: 1,
    email: 'demo@ironlog.app',
    password_hash: demoPasswordHash,
    display_name: 'علی (دمو)',
    created_at: new Date()
  }
];

const refreshTokens = [];

const workoutLogs = [
  {
    id: 1,
    user_id: 1,
    program_mode: 'dumbbell',
    exercise_name: 'Dumbbell Bench Press',
    log_date: '2026-09-10',
    weight_kg: 15,
    reps: [10, 10, 8],
    rir: [2, 2, 1],
    notes: 'فرم عالی و تمرکز روی بالاسینه',
    created_at: new Date('2026-09-10T10:00:00Z')
  },
  {
    id: 2,
    user_id: 1,
    program_mode: 'dumbbell',
    exercise_name: 'Dumbbell Incline Press',
    log_date: '2026-09-10',
    weight_kg: 12.5,
    reps: [10, 9, 8],
    rir: [2, 1, 1],
    notes: 'زاویه نیمکت ۳۰ درجه',
    created_at: new Date('2026-09-10T10:30:00Z')
  },
  {
    id: 3,
    user_id: 1,
    program_mode: 'dumbbell',
    exercise_name: 'Dumbbell Bench Press',
    log_date: '2026-09-15',
    weight_kg: 17.5,
    reps: [8, 8, 7],
    rir: [1, 1, 0],
    notes: 'افزایش وزنه نسبت به هفته قبل (رکورد جدید)',
    created_at: new Date('2026-09-15T10:00:00Z')
  }
];

const bodyweightLogs = [
  {
    id: 1,
    user_id: 1,
    log_date: '2026-09-01',
    weight_kg: 78.0,
    created_at: new Date('2026-09-01T08:00:00Z')
  },
  {
    id: 2,
    user_id: 1,
    log_date: '2026-09-08',
    weight_kg: 78.6,
    created_at: new Date('2026-09-08T08:00:00Z')
  },
  {
    id: 3,
    user_id: 1,
    log_date: '2026-09-15',
    weight_kg: 79.2,
    created_at: new Date('2026-09-15T08:00:00Z')
  }
];

const userSettings = [
  {
    user_id: 1,
    active_mode: 'dumbbell',
    updated_at: new Date()
  }
];

// In-memory query router
function executeInMemoryQuery(text, params = []) {
  const sql = text.trim();
  const lower = sql.toLowerCase();

  // Transactions
  if (lower === 'begin' || lower === 'commit' || lower === 'rollback') {
    return { rows: [], rowCount: 0 };
  }

  // USERS queries
  if (lower.startsWith('select id from users where email = $1')) {
    const email = params[0]?.toLowerCase();
    const found = users.filter(u => u.email.toLowerCase() === email);
    return { rows: found.map(u => ({ id: u.id })), rowCount: found.length };
  }

  if (lower.startsWith('insert into users')) {
    // INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id, email, display_name
    const [email, password_hash, display_name] = params;
    const newUser = {
      id: nextUserId++,
      email,
      password_hash,
      display_name: display_name || null,
      created_at: new Date()
    };
    users.push(newUser);
    return {
      rows: [{ id: newUser.id, email: newUser.email, display_name: newUser.display_name }],
      rowCount: 1
    };
  }

  if (lower.startsWith('select * from users where email = $1')) {
    const email = params[0]?.toLowerCase();
    const found = users.filter(u => u.email.toLowerCase() === email);
    return { rows: found, rowCount: found.length };
  }

  if (lower.startsWith('select * from users where id = $1')) {
    const userId = Number(params[0]);
    const found = users.filter(u => Number(u.id) === userId);
    return { rows: found, rowCount: found.length };
  }

  if (lower.includes('from users where id = $1')) {
    const userId = Number(params[0]);
    const found = users.filter(u => Number(u.id) === userId);
    return {
      rows: found.map(u => ({
        id: u.id,
        email: u.email,
        display_name: u.display_name,
        created_at: u.created_at
      })),
      rowCount: found.length
    };
  }

  // REFRESH TOKENS queries
  if (lower.startsWith('insert into refresh_tokens')) {
    const [user_id, token_hash, expires_at] = params;
    const item = {
      id: nextTokenId++,
      user_id: Number(user_id),
      token_hash,
      expires_at: new Date(expires_at),
      revoked_at: null
    };
    refreshTokens.push(item);
    return { rows: [item], rowCount: 1 };
  }

  if (lower.includes('from refresh_tokens where token_hash = $1 and revoked_at is null')) {
    const token_hash = params[0];
    const now = new Date();
    const found = refreshTokens.filter(t => t.token_hash === token_hash && !t.revoked_at && t.expires_at > now);
    return { rows: found, rowCount: found.length };
  }

  if (lower.startsWith('update refresh_tokens set revoked_at = now() where id = $1')) {
    const id = Number(params[0]);
    const token = refreshTokens.find(t => t.id === id);
    if (token) token.revoked_at = new Date();
    return { rows: [], rowCount: token ? 1 : 0 };
  }

  if (lower.startsWith('update refresh_tokens set revoked_at = now() where token_hash = $1')) {
    const token_hash = params[0];
    const token = refreshTokens.find(t => t.token_hash === token_hash);
    if (token) token.revoked_at = new Date();
    return { rows: [], rowCount: token ? 1 : 0 };
  }

  // WORKOUT_LOGS queries
  if (lower.startsWith('insert into workout_logs')) {
    const [user_id, program_mode, exercise_name, log_date, weight_kg, repsRaw, rirRaw, notes] = params;
    const reps = typeof repsRaw === 'string' ? JSON.parse(repsRaw) : (repsRaw || []);
    const rir = typeof rirRaw === 'string' ? JSON.parse(rirRaw) : (rirRaw || []);
    const item = {
      id: nextWorkoutId++,
      user_id: Number(user_id),
      program_mode,
      exercise_name,
      log_date: typeof log_date === 'string' ? log_date : new Date(log_date).toISOString().slice(0, 10),
      weight_kg: Number(weight_kg),
      reps,
      rir,
      notes: notes || null,
      created_at: new Date()
    };
    workoutLogs.push(item);
    return {
      rows: [{
        id: item.id,
        programMode: item.program_mode,
        exerciseName: item.exercise_name,
        logDate: item.log_date,
        weightKg: item.weight_kg,
        reps: item.reps,
        rir: item.rir,
        notes: item.notes,
        created_at: item.created_at
      }],
      rowCount: 1
    };
  }

  if (lower.includes('from workout_logs where user_id = $1')) {
    const userId = Number(params[0]);
    let filtered = workoutLogs.filter(w => Number(w.user_id) === userId);

    if (lower.includes('exercise_name = $')) {
      const exParamIdx = lower.indexOf('exercise_name = $2') !== -1 ? 1 : 1;
      const exName = params[exParamIdx];
      if (exName) filtered = filtered.filter(w => w.exercise_name === exName);
    }

    filtered.sort((a, b) => a.log_date.localeCompare(b.log_date) || (a.created_at - b.created_at));

    if (lower.includes('as "programmode"')) {
      return {
        rows: filtered.map(w => ({
          id: w.id,
          programMode: w.program_mode,
          exerciseName: w.exercise_name,
          logDate: w.log_date,
          weightKg: w.weight_kg,
          reps: w.reps,
          rir: w.rir,
          notes: w.notes,
          created_at: w.created_at
        })),
        rowCount: filtered.length
      };
    } else {
      return {
        rows: filtered.map(w => ({
          program_mode: w.program_mode,
          exercise_name: w.exercise_name,
          log_date: w.log_date,
          weight_kg: w.weight_kg,
          reps: w.reps,
          rir: w.rir,
          notes: w.notes
        })),
        rowCount: filtered.length
      };
    }
  }

  if (lower.startsWith('delete from workout_logs where id = $1 and user_id = $2')) {
    const id = Number(params[0]);
    const userId = Number(params[1]);
    const idx = workoutLogs.findIndex(w => Number(w.id) === id && Number(w.user_id) === userId);
    if (idx !== -1) {
      const removed = workoutLogs.splice(idx, 1);
      return { rows: [{ id: removed[0].id }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }

  // BODYWEIGHT_LOGS queries
  if (lower.includes('into bodyweight_logs')) {
    const [user_id, log_date, weight_kg] = params;
    const userId = Number(user_id);
    const dateStr = typeof log_date === 'string' ? log_date : new Date(log_date).toISOString().slice(0, 10);
    const weightNum = Number(weight_kg);

    const existing = bodyweightLogs.find(b => Number(b.user_id) === userId && b.log_date === dateStr);
    if (existing) {
      existing.weight_kg = weightNum;
      return {
        rows: [{ id: existing.id, logDate: existing.log_date, weightKg: existing.weight_kg }],
        rowCount: 1
      };
    } else {
      const newItem = {
        id: nextWeightId++,
        user_id: userId,
        log_date: dateStr,
        weight_kg: weightNum,
        created_at: new Date()
      };
      bodyweightLogs.push(newItem);
      return {
        rows: [{ id: newItem.id, logDate: newItem.log_date, weightKg: newItem.weight_kg }],
        rowCount: 1
      };
    }
  }

  if (lower.includes('from bodyweight_logs where user_id = $1')) {
    const userId = Number(params[0]);
    const filtered = bodyweightLogs.filter(b => Number(b.user_id) === userId);
    filtered.sort((a, b) => a.log_date.localeCompare(b.log_date));

    if (lower.includes('as "logdate"')) {
      return {
        rows: filtered.map(b => ({
          id: b.id,
          logDate: b.log_date,
          weightKg: b.weight_kg,
          created_at: b.created_at
        })),
        rowCount: filtered.length
      };
    } else {
      return {
        rows: filtered.map(b => ({
          log_date: b.log_date,
          weight_kg: b.weight_kg
        })),
        rowCount: filtered.length
      };
    }
  }

  // SETTINGS queries
  if (lower.includes('from user_settings where user_id = $1')) {
    const userId = Number(params[0]);
    const setting = userSettings.find(s => Number(s.user_id) === userId);
    if (!setting) {
      return { rows: [], rowCount: 0 };
    }
    if (lower.includes('as "activemode"')) {
      return { rows: [{ activeMode: setting.active_mode }], rowCount: 1 };
    }
    return { rows: [{ active_mode: setting.active_mode }], rowCount: 1 };
  }

  if (lower.includes('into user_settings')) {
    const [user_id, active_mode] = params;
    const userId = Number(user_id);
    const existing = userSettings.find(s => Number(s.user_id) === userId);
    if (existing) {
      existing.active_mode = active_mode;
      existing.updated_at = new Date();
    } else {
      userSettings.push({
        user_id: userId,
        active_mode,
        updated_at: new Date()
      });
    }
    return { rows: [{ active_mode }], rowCount: 1 };
  }

  console.warn('[Mock DB] Unhandled SQL query:', sql);
  return { rows: [], rowCount: 0 };
}

// Check if a real DATABASE_URL is available
let realPool = null;
if (process.env.DATABASE_URL) {
  try {
    const { Pool } = pg;
    realPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      max: 10,
      idleTimeoutMillis: 30000,
    });
  } catch (err) {
    console.warn('[AI Studio] PostgreSQL initialization failed, fallback to in-memory store:', err.message);
    realPool = null;
  }
}

export const pool = {
  query: async (text, params) => {
    if (realPool) {
      try {
        return await realPool.query(text, params);
      } catch (dbErr) {
        console.warn('[AI Studio] PostgreSQL query failed, using in-memory mock:', dbErr.message);
        return executeInMemoryQuery(text, params);
      }
    }
    return executeInMemoryQuery(text, params);
  },
  connect: async () => {
    if (realPool) {
      try {
        const client = await realPool.connect();
        return client;
      } catch (err) {
        console.warn('[AI Studio] PostgreSQL connect failed, using mock client');
      }
    }
    return {
      query: async (text, params) => executeInMemoryQuery(text, params),
      release: () => {}
    };
  }
};
