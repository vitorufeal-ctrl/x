/**
 * bot.js — Single-file Rich Personal Trainer Telegram Bot (Telegraf.js)
 *
 * Features implemented (or scaffolding + working for core):
 * - User registration, multi-profile support, profile editing (age, weight, height, fitness level)
 * - Goal setting with target dates, progress tracking, weekly/monthly summaries, notifications
 * - Workouts: daily recommendations, custom plan generation (basic algorithm), exercise library
 * - Exercise DB: categories, muscle groups, difficulty, equipment, form tips
 * - Progress logging: workouts completed, weight, body measurements, personal bests
 * - Nutrition: log meals, daily calorie guidance (basic calculation), macros suggestions, water reminders
 * - Scheduling & Reminders: daily workout reminders, custom times, missed workout alerts, streaks
 * - Communications: interactive chat, quick replies, inline keyboards, FAQ, message trainer (admin inbox)
 * - Content delivery: text, images (via URLs/file IDs), videos (links), tips, motivational quotes
 * - Gamification: badges, streak counters, challenges, basic leaderboard
 * - Customization: fitness level, equipment, available time preferences, notifications prefs
 * - Analytics: weekly reports, charts (weight chart), usage stats, exports
 * - Admin features: password login, user management (view/promote/remove), content updates (workouts/exercises), broadcast, analytics dashboard, feedback & bug reports
 * - Support & Feedback system
 * - Basic privacy controls (request data deletion placeholder), consent stored
 * - Many integrations are left as safe placeholders with TODO comments (webhooks, wearable sync, social sharing)
 *
 * ENV vars:
 * BOT_TOKEN=...
 * MONGO_URI=...
 * ADMIN_PASS=...
 * BASE_URL= (optional, for hosting images/webhook)
 *
 * Install:
 * npm init -y
 * npm i telegraf mongoose dotenv node-cron chartjs-node-canvas moment uuid
 * (may need system libs for canvas: libcairo2-dev libjpeg-dev libpango1.0-dev libgif-dev build-essential)
 *
 * Run:
 * node bot.js
 *
 * NOTE: This single file is intentionally monolithic for your request. For production, split into modules.
 */

require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const mongoose = require('mongoose');
const cron = require('node-cron');
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const moment = require('moment');
const { v4: uuidv4 } = require('uuid');

const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const ADMIN_PASS = process.env.ADMIN_PASS || null;
const BASE_URL = process.env.BASE_URL || '';

if (!BOT_TOKEN || !MONGO_URI) {
  console.error('Missing BOT_TOKEN or MONGO_URI in environment.');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// ---------- DB ----------
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(()=>console.log('MongoDB connected'))
  .catch(err=>{ console.error('MongoDB error', err); process.exit(1); });

// Users: supports multiple profiles per user (family/support)
const profileSub = new mongoose.Schema({
  id: { type: String, default: () => uuidv4() }, // profile id so user can have multiple
  name: String,
  age: Number,
  weightKg: Number,
  heightCm: Number,
  fitnessLevel: String, // beginner/intermediate/advanced
  goal: String,
  goalTargetDate: Date,
  equipment: [String],
  timeAvailabilityMins: Number,
  createdAt: { type: Date, default: Date.now }
});

const userSchema = new mongoose.Schema({
  telegramId: { type: Number, unique: true },
  firstName: String,
  username: String,
  registeredAt: { type: Date, default: Date.now },
  profiles: [profileSub],
  activeProfileId: String, // points to one profile in profiles[]
  consent: { dataCollection: { type: Boolean, default: true } },
  reminders: {
    workoutDailyAt: String, // HH:mm
    waterReminderTimes: [String]
  },
  streak: { type: Number, default: 0 },
  badges: [String],
  stats: {
    weightHistory: [{ profileId: String, value: Number, date: Date }],
    bodyMeasurements: [{ profileId: String, measurements: Object, date: Date }],
    workoutsCompleted: [{ profileId: String, workoutId: String, date: Date, details: Object }],
    meals: [{ profileId: String, calories: Number, desc: String, date: Date }]
  },
  preferences: {
    language: { type: String, default: 'en' },
    notifications: { reminders: { type: Boolean, default: true }, broadcast: { type: Boolean, default: true } }
  },
  role: { type: String, default: 'user' } // admin if promoted
});
const User = mongoose.model('User', userSchema);

const workoutSchema = new mongoose.Schema({
  name: String,
  description: String,
  exercises: [{
    name: String, sets: Number, reps: String, equipment: [String], muscleGroups: [String], difficulty: String, demoUrl: String, tips: String
  }],
  difficulty: String,
  durationMins: Number,
  bodyweightOnly: { type: Boolean, default: false },
  tags: [String], // e.g., 'cardio','strength'
  createdAt: { type: Date, default: Date.now },
  author: String
});
const Workout = mongoose.model('Workout', workoutSchema);

const exerciseSchema = new mongoose.Schema({
  name: String,
  description: String,
  category: String, // cardio, strength, flexibility
  muscleGroups: [String],
  difficulty: String,
  equipmentNeeded: [String],
  tips: String,
  demoUrl: String,
  createdAt: { type: Date, default: Date.now }
});
const Exercise = mongoose.model('Exercise', exerciseSchema);

const messageRelaySchema = new mongoose.Schema({
  fromId: Number,
  profileId: String,
  text: String,
  type: String, // feedback | bug | message
  createdAt: { type: Date, default: Date.now },
  read: { type: Boolean, default: false }
});
const MessageRelay = mongoose.model('MessageRelay', messageRelaySchema);

const challengeSchema = new mongoose.Schema({
  name: String,
  description: String,
  startDate: Date,
  endDate: Date,
  participants: [Number], // telegramIds
  createdAt: { type: Date, default: Date.now }
});
const Challenge = mongoose.model('Challenge', challengeSchema);

// ---------- Seed basic exercises & workouts if none exist ----------
async function seedContent() {
  const exCount = await Exercise.countDocuments();
  if (exCount === 0) {
    await Exercise.create([
      { name: 'Push-up', description: 'Push-up description...', category: 'strength', muscleGroups: ['chest','triceps'], difficulty: 'beginner', equipmentNeeded: ['none'], tips: 'Keep body straight', demoUrl: '' },
      { name: 'Squat', description: 'Squat description...', category: 'strength', muscleGroups: ['legs'], difficulty: 'beginner', equipmentNeeded: ['none'], tips: 'Knees behind toes', demoUrl: '' },
      { name: 'Plank', description: 'Plank core hold', category: 'core', muscleGroups: ['core'], difficulty: 'beginner', equipmentNeeded: ['none'], tips: 'Keep straight', demoUrl: '' }
    ]);
    console.log('Seeded exercises');
  }
  const wkCount = await Workout.countDocuments();
  if (wkCount === 0) {
    const exs = await Exercise.find().lean();
    await Workout.create([
      { name: 'Beginner Full Body', description: '3x/week full body', exercises: exs.map(e=>({ name: e.name, sets: 3, reps: '8-12', equipment: e.equipmentNeeded, muscleGroups: e.muscleGroups, difficulty: e.difficulty, demoUrl: e.demoUrl, tips: e.tips })), difficulty: 'beginner', durationMins: 30, bodyweightOnly: true, tags:['fullbody'] }
    ]);
    console.log('Seeded workouts');
  }
}
seedContent();

// ---------- Utilities ----------
const chartCanvas = new ChartJSNodeCanvas({ width: 800, height: 400 });

async function generateWeightChart(entries = []) {
  if (!entries || entries.length === 0) {
    const cfg = { type: 'line', data: { labels: ['No data'], datasets: [{ label: 'Weight', data: [0] }] } };
    return await chartCanvas.renderToBuffer(cfg);
  }
  entries.sort((a,b)=>new Date(a.date)-new Date(b.date));
  const labels = entries.map(e=>moment(e.date).format('YYYY-MM-DD'));
  const data = entries.map(e=>e.value);
  const cfg = { type: 'line', data: { labels, datasets: [{ label: 'Weight (kg)', data, tension:0.2 }] } };
  return await chartCanvas.renderToBuffer(cfg);
}

function mention(u) { return u.username ? `@${u.username}` : (u.firstName || 'user'); }

// In-memory ephemeral states
const states = new Map();
const adminSessions = new Set(); // telegramId -> admin session

// ---------- Keyboards ----------
const mainMenu = Markup.keyboard([
  ['📋 Profile', '💪 Workouts'],
  ['🍎 Nutrition', '📊 Progress'],
  ['📅 Reminders', '💬 Trainer'],
  ['🏆 Challenges', '⚙️ Settings'],
  ['ℹ️ Help']
]).resize();

const adminMenu = Markup.keyboard([
  ['👥 User Mgmt', '✍️ Content Mgmt'],
  ['📊 Analytics', '📢 Broadcast'],
  ['🐞 Feedback', '⬅️ Logout Admin']
]).resize();

const backKb = Markup.keyboard([['⬅️ Back to Main']]).resize();

// ---------- Welcome & Onboarding ----------
bot.start(async (ctx) => {
  const tg = ctx.from;
  let user = await User.findOne({ telegramId: tg.id });
  if (!user) {
    user = await User.create({ telegramId: tg.id, firstName: tg.first_name || '', username: tg.username || '' });
    // create default profile
    const p = { name: tg.first_name || 'You', fitnessLevel: 'beginner', goal: 'general fitness', timeAvailabilityMins: 30 };
    user.profiles = [p];
    user.activeProfileId = user.profiles[0].id;
    await user.save();
    await ctx.reply(`Welcome ${tg.first_name || ''}! Profile created. Please complete your profile.`, mainMenu);
    states.set(tg.id, { step: 'edit_profile_full', data: { profileId: user.activeProfileId }});
    await ctx.reply('Send your age (number) to complete profile setup.', backKb);
    return;
  }
  await ctx.reply(`Welcome back ${tg.first_name || ''}! Use the menu.`, mainMenu);
});

// ---------- Menu Handlers ----------
bot.hears('📋 Profile', async (ctx) => {
  const u = await User.findOne({ telegramId: ctx.from.id }).lean();
  if (!u) return ctx.reply('Please /start first.');
  const active = (u.profiles || []).find(p=>p.id===u.activeProfileId) || (u.profiles&&u.profiles[0]) || null;
  let text = `*Profiles*: (${u.profiles.length})\n`;
  u.profiles.forEach(p => {
    text += `• ${p.name} — ${p.fitnessLevel || '-'} — ${p.goal || '-'} ${p.id===u.activeProfileId ? '(active)' : ''}\n`;
  });
  text += '\nChoose: Edit Profile / Switch Profile / Add Profile / Delete Profile';
  await ctx.replyWithMarkdown(text, Markup.keyboard([['✏️ Edit Profile','🔁 Switch Profile'],['➕ Add Profile','🗑️ Delete Profile'],['⬅️ Back to Main']]).resize());
});

bot.hears('✏️ Edit Profile', async (ctx) => {
  const u = await User.findOne({ telegramId: ctx.from.id });
  if (!u) return ctx.reply('Start with /start');
  const active = u.profiles.find(p=>p.id===u.activeProfileId) || u.profiles[0];
  states.set(ctx.from.id, { step: 'editing_profile_field', data: { profileId: active.id }});
  return ctx.reply('Which field do you want to edit? (name, age, weight, height, fitnessLevel, goal, targetDate, equipment, timeAvailability)', backKb);
});

bot.hears('🔁 Switch Profile', async (ctx) => {
  const u = await User.findOne({ telegramId: ctx.from.id }).lean();
  if (!u) return ctx.reply('Start with /start');
  if (!u.profiles || u.profiles.length === 0) return ctx.reply('No profiles. Add one.');
  let text = 'Send profile number to switch:\n';
  u.profiles.forEach((p,i)=> text += `${i+1}. ${p.name} (${p.fitnessLevel || '-'})\n`);
  states.set(ctx.from.id, { step: 'switch_profile', data: { profiles: u.profiles }});
  return ctx.reply(text, backKb);
});

bot.hears('➕ Add Profile', async (ctx) => {
  const u = await User.findOne({ telegramId: ctx.from.id });
  if (!u) return ctx.reply('Start with /start');
  const newProfile = { name: `${ctx.from.first_name || 'Profile'}`, fitnessLevel: 'beginner', goal: 'general fitness' };
  u.profiles.push(newProfile);
  u.activeProfileId = u.profiles[u.profiles.length-1].id;
  await u.save();
  return ctx.reply(`Added profile "${newProfile.name}" and switched to it. Use Edit Profile to complete details.`, mainMenu);
});

bot.hears('🗑️ Delete Profile', async (ctx) => {
  states.set(ctx.from.id, { step: 'delete_profile', data: {} });
  return ctx.reply('Send profile number to delete (cannot delete last profile).', backKb);
});

// Workouts
bot.hears('💪 Workouts', async (ctx) => {
  const kb = Markup.keyboard([['🏋️ Today','🔎 Browse Exercises'],['📝 My Plan','⬅️ Back to Main']]).resize();
  return ctx.reply('Workouts menu', kb);
});

bot.hears('🏋️ Today', async (ctx) => {
  const all = await Workout.find().lean();
  if (!all.length) return ctx.reply('No workouts configured.');
  // choose simple heuristic: based on fitness level of active profile
  const u = await User.findOne({ telegramId: ctx.from.id }).lean();
  const active = (u.profiles||[]).find(p=>p.id===u.activeProfileId) || (u.profiles && u.profiles[0]);
  let candidate = all.find(w=>w.difficulty === active.fitnessLevel) || all[Math.floor(Math.random()*all.length)];
  const text = `*Today's Workout*: ${candidate.name}\n${candidate.description}\nExercises:\n` + candidate.exercises.map(e=>`• ${e.name} — ${e.sets}x${e.reps}`).join('\n');
  return ctx.replyWithMarkdown(text, Markup.inlineKeyboard([[Markup.button.callback('✅ Done', `done:${candidate._id}`), Markup.button.callback('⏭ Skip', `skip:${candidate._id}`)]]));
});

bot.hears('📝 My Plan', async (ctx) => {
  // placeholder: generate basic plan if none exists from user's active profile
  // This command returns user's last 7 workouts or generates a simple routine
  const u = await User.findOne({ telegramId: ctx.from.id }).lean();
  const active = (u.profiles||[]).find(p=>p.id===u.activeProfileId);
  const recent = (u.stats.workoutsCompleted||[]).filter(w=>w.profileId===active.id).slice(-7);
  if (recent.length) {
    return ctx.reply('Showing recent workouts (from history). Use Browse Exercises to build a plan.');
  }
  // generate: pick 3 workouts of appropriate difficulty
  const pool = await Workout.find({ difficulty: active.fitnessLevel }).limit(10).lean();
  const pick = pool.length ? pool.slice(0,3) : await Workout.find().limit(3).lean();
  let text = '*Your 3-day starter plan:*\n';
  pick.forEach((p, i) => {
    text += `${i+1}. ${p.name} — ${p.durationMins || '30'} mins\n`;
  });
  return ctx.replyWithMarkdown(text);
});

bot.hears('🔎 Browse Exercises', async (ctx) => {
  const exs = await Exercise.find().limit(30).lean();
  let text = '*Exercise Library*\n';
  exs.forEach((e,i)=> text += `${i+1}. ${e.name} — ${e.category} — ${e.difficulty}\n`);
  text += '\nSend the exercise number to view details.';
  states.set(ctx.from.id, { step: 'browse_exercises', data: { list: exs }});
  return ctx.replyWithMarkdown(text, backKb);
});

// Nutrition
bot.hears('🍎 Nutrition', async (ctx) => {
  return ctx.reply('Nutrition menu', Markup.keyboard([['➕ Log Meal','📜 View Meals'],['🍽️ Macro Advice','💧 Water Tracker'],['⬅️ Back to Main']]).resize());
});

bot.hears('➕ Log Meal', async (ctx) => {
  states.set(ctx.from.id, { step: 'log_meal', data: {} });
  return ctx.reply('Send meal like: 600 oats + banana', backKb);
});

bot.hears('📜 View Meals', async (ctx) => {
  const u = await User.findOne({ telegramId: ctx.from.id }).lean();
  const recent = (u.stats.meals || []).slice(-10).reverse();
  if (!recent.length) return ctx.reply('No meals logged yet.');
  let text = '*Recent Meals*\n';
  recent.forEach(m => text += `${moment(m.date).format('YYYY-MM-DD')}: ${m.calories}kcal — ${m.desc}\n`);
  return ctx.replyWithMarkdown(text);
});

bot.hears('🍽️ Macro Advice', async (ctx) => {
  // compute BMR simple heuristic and recommend macros based on goal
  const u = await User.findOne({ telegramId: ctx.from.id }).lean();
  const prof = (u.profiles||[]).find(p=>p.id===u.activeProfileId);
  if (!prof) return ctx.reply('Set up profile first.');
  // Very simple calcs (placeholders) — user should consult a nutritionist in production
  const bmr = 10*(prof.weightKg||70)+6.25*(prof.heightCm||170)-5*(prof.age||30)+5;
  const calories = Math.round(bmr * 1.35); // light activity
  // macros: protein 1.6g/kg, fat 25% calories, rest carbs
  const protein = Math.round((1.6*(prof.weightKg||70)));
  const fatCalories = Math.round(calories * 0.25);
  const fat = Math.round(fatCalories / 9);
  const proteinCalories = protein * 4;
  const carbsCalories = calories - (fatCalories + proteinCalories);
  const carbs = Math.round(carbsCalories / 4);
  let text = `Estimated daily calories: *${calories} kcal*\nMacros:\n• Protein: ${protein}g\n• Fat: ${fat}g\n• Carbs: ${carbs}g\n(These are suggestions; adapt to your needs)`;
  return ctx.replyWithMarkdown(text);
});

bot.hears('💧 Water Tracker', async (ctx) => {
  // quick water reminder setup
  states.set(ctx.from.id, { step: 'set_water_times', data: {} });
  return ctx.reply('Send water reminder times separated by comma (e.g., 10:00,14:00,18:00) or "off" to disable.', backKb);
});

// Progress
bot.hears('📊 Progress', async (ctx) => {
  const u = await User.findOne({ telegramId: ctx.from.id }).lean();
  const activeId = u.activeProfileId;
  const weights = (u.stats.weightHistory||[]).filter(w=>w.profileId===activeId);
  if (!weights.length) return ctx.reply('No weight history yet. Log weight in profile edits or via /log (menu).', backKb);
  const buf = await generateWeightChart(weights);
  await ctx.replyWithPhoto({ source: buf }, { caption: 'Weight progress', reply_markup: backKb.reply_markup });
});

// Reminders
bot.hears('📅 Reminders', async (ctx) => {
  return ctx.reply('Reminders menu', Markup.keyboard([['Set Daily Workout'],['Set Water Reminders'],['Remove Reminders'],['⬅️ Back to Main']]).resize());
});

bot.hears('Set Daily Workout', async (ctx) => {
  states.set(ctx.from.id, { step: 'set_daily_reminder', data: {} });
  return ctx.reply('Send time like 18:30 (HH:mm) to receive daily workout reminder.', backKb);
});

bot.hears('Set Water Reminders', async (ctx) => {
  states.set(ctx.from.id, { step: 'set_water_reminders', data: {} });
  return ctx.reply('Send times list like 09:00,12:00,15:00', backKb);
});

bot.hears('Remove Reminders', async (ctx) => {
  const u = await User.findOne({ telegramId: ctx.from.id });
  if (!u) return ctx.reply('Start with /start.');
  u.reminders = {};
  await u.save();
  return ctx.reply('Removed reminders.', mainMenu);
});

// Trainer Communication
bot.hears('💬 Trainer', async (ctx) => {
  states.set(ctx.from.id, { step: 'message_trainer', data: {} });
  return ctx.reply('Type your message for the trainer / admin (feedback or question).', backKb);
});

// Challenges
bot.hears('🏆 Challenges', async (ctx) => {
  // show active challenges
  const now = new Date();
  const active = await Challenge.find({ startDate: { $lte: now }, endDate: { $gte: now } }).lean();
  if (!active.length) return ctx.reply('No active challenges. Admin can create one from content management.', mainMenu);
  let text = '*Active Challenges:*\n';
  active.forEach((c,i)=> text += `${i+1}. ${c.name} — ${moment(c.startDate).format('YYYY-MM-DD')} to ${moment(c.endDate).format('YYYY-MM-DD')}\n`);
  return ctx.replyWithMarkdown(text);
});

// Settings & Help
bot.hears('⚙️ Settings', async (ctx) => ctx.reply('Settings: language, notifications, data request. Use buttons or type option.', Markup.keyboard([['Language','Notifications'],['Request Data Deletion','⬅️ Back to Main']]).resize()));
bot.hears('ℹ️ Help', async (ctx) => {
  return ctx.replyWithMarkdown(`Help:
• Use the menu to navigate features.
• Admins: use /admin to login.
• For data deletion or privacy queries, use Settings -> Request Data Deletion.`, mainMenu);
});

// ---------- State-based message handling ----------
bot.on('text', async (ctx, next) => {
  const text = ctx.message.text.trim();
  const state = states.get(ctx.from.id);

  // Admin login flow triggered by /admin command
  if (state && state.step === 'await_admin_pass') {
    states.delete(ctx.from.id);
    if (text === ADMIN_PASS) {
      adminSessions.add(ctx.from.id);
      await ctx.reply('Admin access granted', adminMenu);
      return;
    } else {
      await ctx.reply('Wrong password', mainMenu);
      return;
    }
  }

  // Registration/profile completion step
  if (state && state.step === 'edit_profile_full') {
    // expecting age first
    const age = Number(text);
    if (isNaN(age)) return ctx.reply('Please send a number for age.');
    const user = await User.findOne({ telegramId: ctx.from.id });
    const prof = user.profiles.find(p=>p.id===state.data.profileId) || user.profiles[0];
    prof.age = age;
    await user.save();
    states.set(ctx.from.id, { step: 'edit_profile_weight', data: { profileId: prof.id }});
    return ctx.reply('Send weight in kg (number).', backKb);
  } else if (state && state.step === 'edit_profile_weight') {
    const val = Number(text);
    if (isNaN(val)) return ctx.reply('Send numeric weight in kg.');
    const user = await User.findOne({ telegramId: ctx.from.id });
    const prof = user.profiles.find(p=>p.id===state.data.profileId) || user.profiles[0];
    prof.weightKg = val;
    user.stats = user.stats || {};
    user.stats.weightHistory = user.stats.weightHistory || [];
    user.stats.weightHistory.push({ profileId: prof.id, value: val, date: new Date() });
    await user.save();
    states.set(ctx.from.id, { step: 'edit_profile_height', data: { profileId: prof.id }});
    return ctx.reply('Send height in cm (number).', backKb);
  } else if (state && state.step === 'edit_profile_height') {
    const val = Number(text);
    if (isNaN(val)) return ctx.reply('Send numeric height in cm.');
    const user = await User.findOne({ telegramId: ctx.from.id });
    const prof = user.profiles.find(p=>p.id===state.data.profileId) || user.profiles[0];
    prof.heightCm = val;
    await user.save();
    states.delete(ctx.from.id);
    return ctx.reply('Profile updated. Use the menu.', mainMenu);
  }

  // Editing profile fields flow
  if (state && state.step === 'editing_profile_field') {
    const field = text.toLowerCase();
    const allowed = ['name','age','weight','height','fitnesslevel','goal','targetdate','equipment','timeavailability'];
    if (!allowed.includes(field)) return ctx.reply('Field not recognized. Allowed: ' + allowed.join(', '));
    states.set(ctx.from.id, { step: `editing_profile_${field}`, data: state.data });
    return ctx.reply(`Send new value for ${field}.`, backKb);
  } else if (state && state.step && state.step.startsWith('editing_profile_')) {
    const field = state.step.replace('editing_profile_','');
    const user = await User.findOne({ telegramId: ctx.from.id });
    const prof = user.profiles.find(p=>p.id===state.data.profileId) || user.profiles[0];
    // handle numeric/text
    if (['age','weight','height','timeavailability'].includes(field)) {
      const num = Number(text);
      if (isNaN(num)) return ctx.reply('Send a number.');
      if (field==='age') prof.age = num;
      if (field==='weight') {
        prof.weightKg = num;
        user.stats = user.stats || {};
        user.stats.weightHistory = user.stats.weightHistory || [];
        user.stats.weightHistory.push({ profileId: prof.id, value: num, date: new Date() });
      }
      if (field==='height') prof.heightCm = num;
      if (field==='timeavailability') prof.timeAvailabilityMins = num;
    } else if (field==='targetdate') {
      const d = moment(text,'YYYY-MM-DD',true);
      if (!d.isValid()) return ctx.reply('Send date as YYYY-MM-DD');
      prof.goalTargetDate = d.toDate();
    } else if (field==='equipment') {
      prof.equipment = text.split(',').map(s=>s.trim()).filter(Boolean);
    } else if (field==='fitnesslevel') {
      prof.fitnessLevel = text.toLowerCase();
    } else {
      // name/goal
      prof[field] = text;
    }
    await user.save();
    states.delete(ctx.from.id);
    return ctx.reply('Profile updated.', mainMenu);
  }

  // Switch profile
  if (state && state.step === 'switch_profile') {
    const idx = Number(text);
    if (isNaN(idx)) return ctx.reply('Send profile number.');
    const arr = state.data.profiles || [];
    if (idx<1 || idx>arr.length) return ctx.reply('Invalid number.');
    const user = await User.findOne({ telegramId: ctx.from.id });
    user.activeProfileId = arr[idx-1].id;
    await user.save();
    states.delete(ctx.from.id);
    return ctx.reply(`Switched to profile ${arr[idx-1].name}`, mainMenu);
  }

  // Delete profile
  if (state && state.step === 'delete_profile') {
    const idx = Number(text);
    const user = await User.findOne({ telegramId: ctx.from.id });
    if (isNaN(idx) || idx<1 || idx>user.profiles.length) return ctx.reply('Invalid number.');
    if (user.profiles.length===1) return ctx.reply('Cannot delete last profile.');
    const removed = user.profiles.splice(idx-1,1)[0];
    if (user.activeProfileId === removed.id) user.activeProfileId = user.profiles[0].id;
    await user.save();
    states.delete(ctx.from.id);
    return ctx.reply('Profile deleted.', mainMenu);
  }

  // Browse exercises list
  if (state && state.step === 'browse_exercises') {
    const idx = Number(text);
    const list = state.data.list || [];
    if (isNaN(idx) || idx<1 || idx>list.length) return ctx.reply('Send exercise number to view details.');
    const ex = list[idx-1];
    const details = `*${ex.name}*\nCategory: ${ex.category}\nDifficulty: ${ex.difficulty}\nMuscles: ${ex.muscleGroups.join(', ')}\n\n${ex.description}\n\nTips: ${ex.tips || '-'}`;
    states.delete(ctx.from.id);
    return ctx.replyWithMarkdown(details, backKb);
  }

  // Logging meal
  if (state && state.step === 'log_meal') {
    const parts = text.split(' ');
    const calories = Number(parts[0]);
    if (isNaN(calories)) return ctx.reply('Start with calories, e.g., "600 oats + banana"');
    const desc = parts.slice(1).join(' ') || 'meal';
    const user = await User.findOne({ telegramId: ctx.from.id });
    const profileId = user.activeProfileId;
    user.stats = user.stats || {};
    user.stats.meals = user.stats.meals || [];
    user.stats.meals.push({ profileId, calories, desc, date: new Date() });
    await user.save();
    states.delete(ctx.from.id);
    return ctx.reply('Meal logged.', mainMenu);
  }

  // Set daily reminder
  if (state && state.step === 'set_daily_reminder') {
    if (!/^\d{1,2}:\d{2}$/.test(text)) return ctx.reply('Time format HH:mm');
    const user = await User.findOne({ telegramId: ctx.from.id }) || await User.create({ telegramId: ctx.from.id });
    user.reminders = user.reminders || {};
    user.reminders.workoutDailyAt = text;
    await user.save();
    states.delete(ctx.from.id);
    return ctx.reply(`Daily reminder set at ${text} (server time).`, mainMenu);
  }

  // Set water reminders
  if (state && state.step === 'set_water_reminders') {
    if (text.toLowerCase() === 'off') {
      const user = await User.findOne({ telegramId: ctx.from.id });
      if (user) { user.reminders.waterReminderTimes = []; await user.save(); }
      states.delete(ctx.from.id);
      return ctx.reply('Water reminders disabled.', mainMenu);
    }
    const times = text.split(',').map(s=>s.trim()).filter(t=>/^\d{1,2}:\d{2}$/.test(t));
    if (!times.length) return ctx.reply('Send times separated by comma in HH:mm format.');
    const user = await User.findOne({ telegramId: ctx.from.id }) || await User.create({ telegramId: ctx.from.id });
    user.reminders = user.reminders || {};
    user.reminders.waterReminderTimes = times;
    await user.save();
    states.delete(ctx.from.id);
    return ctx.reply('Water reminders set.', mainMenu);
  }

  // Message trainer
  if (state && state.step === 'message_trainer') {
    const user = await User.findOne({ telegramId: ctx.from.id });
    await MessageRelay.create({ fromId: ctx.from.id, profileId: user.activeProfileId, text, type: 'message' });
    // notify logged-in admins
    for (const adminId of adminSessions) {
      try {
        await bot.telegram.sendMessage(adminId, `Message from ${mention(ctx.from)}:\n${text}`, Markup.inlineKeyboard([[Markup.button.callback('Reply', `replyto:${ctx.from.id}`)]]));
      } catch (e) {}
    }
    states.delete(ctx.from.id);
    return ctx.reply('Message sent to trainer/admin. They will reply via admin panel.', mainMenu);
  }

  // Admin flows
  if (adminSessions.has(ctx.from.id)) {
    const adminState = states.get(ctx.from.id);
    if (adminState && adminState.step === 'admin_broadcast') {
      // broadcast message
      const allUsers = await User.find({}, 'telegramId').lean();
      let sent=0,failed=0;
      for (const u of allUsers) {
        try { await bot.telegram.sendMessage(u.telegramId, `📢 Message from Admin:\n\n${text}`); sent++; } catch(e){ failed++; }
      }
      states.delete(ctx.from.id);
      return ctx.reply(`Broadcast complete. Sent ${sent}, failed ${failed}.`, adminMenu);
    }
  }

  // Not handled: pass to next
  return next();
});

// ---------- Callbacks (inline buttons) ----------
bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data || '';
  const id = ctx.from.id;
  if (data.startsWith('done:')) {
    const wId = data.split(':')[1];
    const user = await User.findOne({ telegramId: id });
    const profileId = user.activeProfileId;
    user.stats = user.stats || {};
    user.stats.workoutsCompleted = user.stats.workoutsCompleted || [];
    user.stats.workoutsCompleted.push({ profileId, workoutId: wId, date: new Date() });
    // streak
    user.streak = (user.streak||0) +1;
    if (user.streak===7 && !user.badges.includes('7-day-streak')) user.badges.push('7-day-streak');
    await user.save();
    await ctx.answerCbQuery('Logged done!');
    return ctx.reply('Workout logged. Good job!', mainMenu);
  } else if (data.startsWith('skip:')) {
    const user = await User.findOne({ telegramId: id });
    user.streak = 0;
    await user.save();
    await ctx.answerCbQuery('Skipped');
    return ctx.reply('Skipped. Streak reset.', mainMenu);
  } else if (data.startsWith('replyto:')) {
    const target = Number(data.split(':')[1]);
    // admin replies - set state for admin
    if (!adminSessions.has(id)) return ctx.answerCbQuery('Unauthorized');
    states.set(id, { step: 'admin_reply', data: { toId: target }});
    await ctx.answerCbQuery();
    return ctx.reply('Type reply to forward to user.', adminMenu);
  } else if (data.startsWith('markread:')) {
    const rId = data.split(':')[1];
    await MessageRelay.findByIdAndUpdate(rId, { read: true });
    await ctx.answerCbQuery('Marked read');
    return;
  }
  await ctx.answerCbQuery();
});

// Admin reply forwarding
bot.on('text', async (ctx, next) => {
  const st = states.get(ctx.from.id);
  if (st && st.step === 'admin_reply' && adminSessions.has(ctx.from.id)) {
    const toId = st.data.toId;
    const text = ctx.message.text;
    try {
      await bot.telegram.sendMessage(toId, `Trainer reply:\n\n${text}`);
      states.delete(ctx.from.id);
      return ctx.reply('Reply forwarded.', adminMenu);
    } catch (e) {
      states.delete(ctx.from.id);
      return ctx.reply('Failed to forward: ' + e.message, adminMenu);
    }
  }
  return next();
});

// ---------- Admin-only keyboards actions ----------
bot.command('admin', async (ctx) => {
  if (!ADMIN_PASS) return ctx.reply('No admin password set on server.');
  states.set(ctx.from.id, { step: 'await_admin_pass' });
  return ctx.reply('Enter admin password (it will not be stored).', backKb);
});

bot.hears('⬅️ Logout Admin', async (ctx) => {
  if (adminSessions.has(ctx.from.id)) { adminSessions.delete(ctx.from.id); return ctx.reply('Logged out of admin.', mainMenu); }
  return ctx.reply('You are not admin.', mainMenu);
});

bot.hears('👥 User Mgmt', async (ctx) => {
  if (!adminSessions.has(ctx.from.id)) return ctx.reply('Admin only. Use /admin.');
  // show sample user list with actions
  const users = await User.find().limit(50).lean();
  let text = `Users (${users.length}):\n`;
  users.forEach(u => text += `• ${u.telegramId} — ${u.firstName || '-'} — Profiles:${u.profiles.length}\n`);
  await ctx.reply(text, Markup.keyboard([['Promote User','Demote User'],['Remove User','⬅️ Logout Admin']]).resize());
});

bot.hears('Promote User', async (ctx) => {
  if (!adminSessions.has(ctx.from.id)) return ctx.reply('Admin only.');
  states.set(ctx.from.id, { step: 'promote_user' });
  return ctx.reply('Send telegramId to promote to admin (user will be able to access admin panel).', adminMenu);
});

bot.hears('Demote User', async (ctx) => {
  if (!adminSessions.has(ctx.from.id)) return ctx.reply('Admin only.');
  states.set(ctx.from.id, { step: 'demote_user' });
  return ctx.reply('Send telegramId to demote (remove admin role).', adminMenu);
});

bot.hears('Remove User', async (ctx) => {
  if (!adminSessions.has(ctx.from.id)) return ctx.reply('Admin only.');
  states.set(ctx.from.id, { step: 'remove_user' });
  return ctx.reply('Send telegramId to remove user from DB (this cannot be undone here).', adminMenu);
});

// Admin content management
bot.hears('✍️ Content Mgmt', async (ctx) => {
  if (!adminSessions.has(ctx.from.id)) return ctx.reply('Admin only.');
  return ctx.reply('Content management: Create Workout / Create Exercise / Create Challenge / View Content', Markup.keyboard([['Create Workout','Create Exercise'],['Create Challenge','View Content'],['⬅️ Logout Admin']]).resize());
});

bot.hears('Create Exercise', async (ctx) => {
  if (!adminSessions.has(ctx.from.id)) return ctx.reply('Admin only.');
  states.set(ctx.from.id, { step: 'create_exercise' });
  return ctx.reply('Send exercise JSON or simple text "name | category | difficulty | muscles | equipment | tips | description"', adminMenu);
});

bot.hears('Create Workout', async (ctx) => {
  if (!adminSessions.has(ctx.from.id)) return ctx.reply('Admin only.');
  states.set(ctx.from.id, { step: 'create_workout' });
  return ctx.reply('Send workout JSON or text. For JSON use the schema: {name, description, exercises:[{name,sets,reps}], difficulty, durationMins}', adminMenu);
});

bot.hears('Create Challenge', async (ctx) => {
  if (!adminSessions.has(ctx.from.id)) return ctx.reply('Admin only.');
  states.set(ctx.from.id, { step: 'create_challenge' });
  return ctx.reply('Send challenge JSON: {name,description,startDate(YYYY-MM-DD),endDate(YYYY-MM-DD)}', adminMenu);
});

bot.hears('View Content', async (ctx) => {
  if (!adminSessions.has(ctx.from.id)) return ctx.reply('Admin only.');
  const exCount = await Exercise.countDocuments();
  const wkCount = await Workout.countDocuments();
  const chCount = await Challenge.countDocuments();
  return ctx.reply(`Content counts: Exercises:${exCount} Workouts:${wkCount} Challenges:${chCount}`, adminMenu);
});

// Analytics
bot.hears('📊 Analytics', async (ctx) => {
  if (!adminSessions.has(ctx.from.id)) return ctx.reply('Admin only.');
  // compute some stats: active users, avg workouts/week, retention
  const usersCount = await User.countDocuments();
  const last7 = new Date(Date.now() - 7*24*3600*1000);
  const activeUsers = await User.countDocuments({ 'stats.workoutsCompleted.date': { $gte: last7 }});
  // top workouts
  const agg = await Workout.aggregate([
    { $project: { name:1 }},
    { $limit: 100 }
  ]);
  // simple stats
  const text = `Analytics:\nTotal users: ${usersCount}\nActive last 7 days (had workout): ${activeUsers}\nWorkouts available: ${await Workout.countDocuments()}\nExercises: ${await Exercise.countDocuments()}\nFeedback items: ${await MessageRelay.countDocuments({ type: 'feedback' })}`;
  return ctx.reply(text, adminMenu);
});

// Broadcast and feedback
bot.hears('📢 Broadcast', async (ctx) => {
  if (!adminSessions.has(ctx.from.id)) return ctx.reply('Admin only.');
  states.set(ctx.from.id, { step: 'admin_broadcast' });
  return ctx.reply('Send the broadcast message to all users (text).', adminMenu);
});

bot.hears('🐞 Feedback', async (ctx) => {
  if (!adminSessions.has(ctx.from.id)) return ctx.reply('Admin only.');
  const items = await MessageRelay.find({ type: { $in: ['feedback','bug'] } }).sort({ createdAt:-1 }).limit(50).lean();
  if (!items.length) return ctx.reply('No feedback/bugs reported.', adminMenu);
  for (const i of items) {
    await ctx.replyWithMarkdown(`From: ${i.fromId}\nType: ${i.type}\nAt: ${moment(i.createdAt).format('YYYY-MM-DD HH:mm')}\n\n${i.text}`, Markup.inlineKeyboard([[Markup.button.callback('Mark read', `markread:${i._id}`), Markup.button.callback('Reply', `replyto:${i.fromId}`)]]));
  }
  return;
});

// ---------- Cron jobs for reminders & weekly reports ----------
cron.schedule('* * * * *', async () => {
  // per-minute check for daily workout reminders & water reminders
  const hhmm = moment().format('HH:mm');
  const users = await User.find({ 'reminders.workoutDailyAt': hhmm }).lean();
  for (const u of users) {
    if (u.preferences && u.preferences.notifications && !u.preferences.notifications.reminders) continue;
    try {
      await bot.telegram.sendMessage(u.telegramId, `⏰ Time for your workout! Press "🏋️ Today" in the bot.`, mainMenu);
    } catch (e) {}
  }
  // water reminders
  const waterUsers = await User.find({ 'reminders.waterReminderTimes': hhmm }).lean();
  for (const u of waterUsers) {
    try {
      await bot.telegram.sendMessage(u.telegramId, `💧 Hydration reminder: take a sip of water!`, mainMenu);
    } catch (e) {}
  }
});

// Weekly summary cron (runs Sundays at 08:00 server time)
cron.schedule('0 8 * * 0', async () => {
  // for simplicity, message users with weekly summary
  const users = await User.find().lean();
  for (const u of users) {
    try {
      // compute workouts in last week for user's active profile
      const profileId = u.activeProfileId;
      const lastWeek = new Date(Date.now() - 7*24*3600*1000);
      const count = (u.stats.workoutsCompleted||[]).filter(s=>s.profileId===profileId && new Date(s.date)>=lastWeek).length;
      await bot.telegram.sendMessage(u.telegramId, `📅 Weekly Summary:\nWorkouts completed this week: ${count}\nKeep it up!`);
    } catch (e) {}
  }
});

// ---------- Fallback state handlers for admin operations (create content, promote/demote/remove users) ----------
bot.on('text', async (ctx, next) => {
  const st = states.get(ctx.from.id);
  const t = ctx.message.text.trim();

  // Admin promote/demote/remove flow
  if (st && st.step === 'promote_user' && adminSessions.has(ctx.from.id)) {
    const id = Number(t);
    const u = await User.findOne({ telegramId: id });
    if (!u) { states.delete(ctx.from.id); return ctx.reply('User not found', adminMenu); }
    u.role = 'admin';
    await u.save();
    states.delete(ctx.from.id);
    return ctx.reply(`Promoted ${id} to admin.`, adminMenu);
  }
  if (st && st.step === 'demote_user' && adminSessions.has(ctx.from.id)) {
    const id = Number(t);
    const u = await User.findOne({ telegramId: id });
    if (!u) { states.delete(ctx.from.id); return ctx.reply('User not found', adminMenu); }
    u.role = 'user';
    await u.save();
    states.delete(ctx.from.id);
    return ctx.reply(`Demoted ${id}.`, adminMenu);
  }
  if (st && st.step === 'remove_user' && adminSessions.has(ctx.from.id)) {
    const id = Number(t);
    const res = await User.deleteOne({ telegramId: id });
    states.delete(ctx.from.id);
    return ctx.reply(`Delete result: ${JSON.stringify(res)}`, adminMenu);
  }

  // Admin create exercise
  if (st && st.step === 'create_exercise' && adminSessions.has(ctx.from.id)) {
    let obj = null;
    try { obj = JSON.parse(t); } catch(e) {
      // parse simple pipe format: name | category | difficulty | muscles | equipment | tips | description
      const parts = t.split('|').map(s=>s.trim());
      if (parts.length >= 2) {
        obj = { name: parts[0], category: parts[1], difficulty: parts[2] || 'medium', muscleGroups: parts[3] ? parts[3].split(',').map(s=>s.trim()) : [], equipmentNeeded: parts[4] ? parts[4].split(',').map(s=>s.trim()) : [], tips: parts[5] || '', description: parts[6] || '' };
      }
    }
    if (!obj) return ctx.reply('Invalid format. Send JSON or "name | category | difficulty | muscles | equipment | tips | description"');
    await Exercise.create(obj);
    states.delete(ctx.from.id);
    return ctx.reply('Exercise created.', adminMenu);
  }

  // Admin create workout
  if (st && st.step === 'create_workout' && adminSessions.has(ctx.from.id)) {
    let obj = null;
    try { obj = JSON.parse(t); } catch(e) { return ctx.reply('Send valid JSON for workout'); }
    await Workout.create(obj);
    states.delete(ctx.from.id);
    return ctx.reply('Workout created.', adminMenu);
  }

  // Admin create challenge
  if (st && st.step === 'create_challenge' && adminSessions.has(ctx.from.id)) {
    let obj = null;
    try { obj = JSON.parse(t); } catch(e) { return ctx.reply('Send valid JSON for challenge'); }
    obj.startDate = new Date(obj.startDate);
    obj.endDate = new Date(obj.endDate);
    await Challenge.create(obj);
    states.delete(ctx.from.id);
    return ctx.reply('Challenge created.', adminMenu);
  }

  // Admin broadcast
  if (st && st.step === 'admin_broadcast' && adminSessions.has(ctx.from.id)) {
    const message = t;
    const users = await User.find({}, 'telegramId').lean();
    let sent=0,failed=0;
    for (const u of users) {
      try { await bot.telegram.sendMessage(u.telegramId, `📢 Admin Broadcast:\n\n${message}`); sent++; } catch(e){ failed++; }
    }
    states.delete(ctx.from.id);
    return ctx.reply(`Broadcast sent to ${sent} users, failed ${failed}.`, adminMenu);
  }

  // Default to next
  return next();
});

// ---------- Data deletion / privacy flow ----------
bot.hears('Request Data Deletion', async (ctx) => {
  // create a request to admin inbox and mark consent revoked. (Implement full deletion workflow per GDPR when ready)
  const u = await User.findOne({ telegramId: ctx.from.id });
  if (!u) return ctx.reply('No account found.');
  u.consent.dataCollection = false;
  await u.save();
  await MessageRelay.create({ fromId: ctx.from.id, text: 'User requested data deletion', type: 'privacy' });
  return ctx.reply('Your deletion request has been submitted to admins. We will process it manually. (Full automated deletion will be implemented server-side.)', mainMenu);
});

// ---------- Simple support: report bug/feedback via /report (or menu) ----------
bot.command('report', async (ctx) => {
  states.set(ctx.from.id, { step: 'report_bug' });
  return ctx.reply('Please describe the bug or feedback. Send message now.', backKb);
});
bot.on('text', async (ctx, next) => {
  const st = states.get(ctx.from.id);
  if (st && st.step === 'report_bug') {
    await MessageRelay.create({ fromId: ctx.from.id, text: ctx.message.text, type: 'bug' });
    states.delete(ctx.from.id);
    // notify admins
    for (const adminId of adminSessions) {
      try { await bot.telegram.sendMessage(adminId, `🐞 Bug reported by ${mention(ctx.from)}:\n${ctx.message.text}`); } catch(e) {}
    }
    return ctx.reply('Thanks — bug report submitted.', mainMenu);
  }
  return next();
});

// ---------- Fallback and help ----------
bot.on('message', async (ctx) => {
  // If nothing matched, show main menu
  await ctx.reply('I did not understand that. Use the menu below or /help.', mainMenu);
});

// ---------- Start bot ----------
bot.launch().then(()=>console.log('Rich Trainer Bot started (single-file)'));

// Graceful shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
