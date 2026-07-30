// ============================================
// NutriSync — app logic
// Everything here reads/writes real data through Supabase:
// accounts, profile, today's food log, saved meals, the
// accountability leaderboard/group, and admin usage stats.
// Nothing in this file is a fake/placeholder user.
// ============================================

const SUPABASE_URL = 'https://eltglwdtdmzyhcoduwzf.supabase.co';
const SUPABASE_KEY = 'sb_publishable_M3WjnaTU45PmzyUC5Fe68Q_Se1Q_BKS';

let sb = null;
try {
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
} catch (e) {
  // If the Supabase script itself failed to load (e.g. no internet, or the
  // CDN was blocked), this stops that failure from crashing the whole file —
  // which is what was making every button on the page do nothing.
  console.error('Supabase failed to load:', e);
}
function showConnectionError() {
  const banner = document.getElementById('connection-banner');
  if (banner) banner.style.display = 'block';
}
if (!sb) showConnectionError();

let currentUser = null; // the logged-in Supabase user, once signed in

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

const RADIUS = 150;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const MACROS = [
  { key: 'protein', label: 'Protein', hex: '#4B7752', calPerGram: 4 },
  { key: 'carbs',   label: 'Carbs',   hex: '#E8873A', calPerGram: 4 },
  { key: 'fat',     label: 'Fat',     hex: '#A8456B', calPerGram: 9 },
];

const todayKey = () => new Date().toISOString().slice(0, 10);
const CALORIE_BUFFER = 50;
const MIN_CALORIES = 1200; // never recommend or accept a goal below this

let state = {
  goals: { cal: 2000, protein: 120, carbs: 220, fat: 65 },
  todayEntries: [],   // [{id, name, cal, protein, carbs, fat}] — mirrors food_logs rows for today
  activityEntries: [], // [{id, name, calories_burned, discount}] — mirrors activity_logs rows for today
  historyByDate: {},  // {'2026-07-28': totalCal} — for the Progress & History page
  savedMeals: [],      // mirrors saved_meals rows
  goalType: 'maintain',
  isAdmin: false,
  displayName: 'you',
  realName: '',
  email: '',
  currentStreak: 0,
  partners: [],          // rows from get_my_partners() — each an independent pairwise link
  pendingInvites: [],   // rows from get_my_pending_requests() — requests waiting on you
};

// Expanded food database, tagged by which goal each food best supports.
const foodDb = [
  { name: 'Chicken breast (4oz)', cal: 185, protein: 35, carbs: 0, fat: 4, category: 'high_protein' },
  { name: 'Turkey breast (4oz)', cal: 165, protein: 34, carbs: 0, fat: 2, category: 'high_protein' },
  { name: 'Egg whites (1 cup)', cal: 126, protein: 26, carbs: 2, fat: 0, category: 'high_protein' },
  { name: 'Whole eggs (2 large)', cal: 156, protein: 13, carbs: 1, fat: 11, category: 'high_protein' },
  { name: 'Greek yogurt, nonfat (1 cup)', cal: 130, protein: 23, carbs: 9, fat: 0, category: 'high_protein' },
  { name: 'Cottage cheese (1 cup)', cal: 180, protein: 24, carbs: 8, fat: 5, category: 'high_protein' },
  { name: 'Salmon (4oz)', cal: 233, protein: 25, carbs: 0, fat: 14, category: 'high_protein' },
  { name: 'Tuna, canned in water (1 can)', cal: 120, protein: 26, carbs: 0, fat: 1, category: 'high_protein' },
  { name: 'Tofu, firm (1 cup)', cal: 181, protein: 20, carbs: 5, fat: 11, category: 'high_protein' },
  { name: 'Lentils, cooked (1 cup)', cal: 230, protein: 18, carbs: 40, fat: 1, category: 'high_protein' },
  { name: 'Protein shake (1 scoop + water)', cal: 120, protein: 24, carbs: 3, fat: 1, category: 'high_protein' },
  { name: 'Edamame (1 cup)', cal: 189, protein: 17, carbs: 16, fat: 8, category: 'high_protein' },
  { name: 'Whey protein bar', cal: 210, protein: 20, carbs: 22, fat: 7, category: 'high_protein' },
  { name: 'Shrimp (4oz)', cal: 112, protein: 24, carbs: 0, fat: 1, category: 'high_protein' },

  { name: 'Leafy greens, mixed (2 cups)', cal: 20, protein: 2, carbs: 4, fat: 0, category: 'low_calorie' },
  { name: 'Cucumber (1 cup)', cal: 16, protein: 1, carbs: 4, fat: 0, category: 'low_calorie' },
  { name: 'Broccoli, steamed (1 cup)', cal: 55, protein: 4, carbs: 11, fat: 0, category: 'low_calorie' },
  { name: 'Zucchini, sautéed (1 cup)', cal: 33, protein: 2, carbs: 6, fat: 1, category: 'low_calorie' },
  { name: 'Cherry tomatoes (1 cup)', cal: 27, protein: 1, carbs: 6, fat: 0, category: 'low_calorie' },
  { name: 'Bell peppers (1 cup)', cal: 30, protein: 1, carbs: 7, fat: 0, category: 'low_calorie' },
  { name: 'Berries, mixed (1 cup)', cal: 70, protein: 1, carbs: 17, fat: 0, category: 'low_calorie' },
  { name: 'Apple (medium)', cal: 95, protein: 0, carbs: 25, fat: 0, category: 'low_calorie' },
  { name: 'Air-popped popcorn (3 cups)', cal: 93, protein: 3, carbs: 19, fat: 1, category: 'low_calorie' },
  { name: 'Clear vegetable soup (1 bowl)', cal: 80, protein: 3, carbs: 14, fat: 1, category: 'low_calorie' },
  { name: 'Cottage cheese, low-fat (1/2 cup)', cal: 90, protein: 12, carbs: 5, fat: 1, category: 'low_calorie' },
  { name: 'Grilled chicken salad, no dressing', cal: 250, protein: 30, carbs: 12, fat: 8, category: 'low_calorie' },

  { name: 'Brown rice (1 cup)', cal: 216, protein: 5, carbs: 45, fat: 2, category: 'general' },
  { name: 'Quinoa, cooked (1 cup)', cal: 222, protein: 8, carbs: 39, fat: 4, category: 'general' },
  { name: 'Avocado (half)', cal: 120, protein: 1, carbs: 6, fat: 11, category: 'general' },
  { name: 'Almonds (1oz)', cal: 164, protein: 6, carbs: 6, fat: 14, category: 'general' },
  { name: 'Peanut butter (2 tbsp)', cal: 190, protein: 8, carbs: 7, fat: 16, category: 'general' },
  { name: 'Banana', cal: 105, protein: 1, carbs: 27, fat: 0, category: 'general' },
  { name: 'Oats, cooked (1 cup)', cal: 158, protein: 6, carbs: 27, fat: 3, category: 'general' },
  { name: 'Whole milk (1 cup)', cal: 149, protein: 8, carbs: 12, fat: 8, category: 'general' },
  { name: 'Sweet potato, baked (medium)', cal: 112, protein: 2, carbs: 26, fat: 0, category: 'general' },
  { name: 'Whole wheat toast (2 slices)', cal: 160, protein: 8, carbs: 28, fat: 2, category: 'general' },
  { name: 'Hummus (1/4 cup)', cal: 100, protein: 5, carbs: 10, fat: 5, category: 'general' },
  { name: 'Olive oil (1 tbsp)', cal: 119, protein: 0, carbs: 0, fat: 14, category: 'general' },
  { name: 'Granola (1/2 cup)', cal: 250, protein: 6, carbs: 35, fat: 10, category: 'general' },
  { name: 'Trail mix (1/4 cup)', cal: 173, protein: 5, carbs: 16, fat: 11, category: 'general' },
];

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

// ============================================
// LANDING / AUTH NAVIGATION
// ============================================
function showLanding() {
  document.getElementById('landing-screen').style.display = 'block';
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('onboarding-screen').style.display = 'none';
  document.getElementById('app-shell').style.display = 'none';
}
function showAuth(signupMode) {
  document.getElementById('landing-screen').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
  isSignup = !!signupMode;
  applyAuthMode();
}
function backToLanding() { showLanding(); }

function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  btn.querySelector('.eye-open').style.display = showing ? 'block' : 'none';
  btn.querySelector('.eye-closed').style.display = showing ? 'none' : 'block';
  btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
}

let isSignup = false;
function applyAuthMode() {
  showAuthError('');
  document.getElementById('login-form').style.display = isSignup ? 'none' : 'block';
  document.getElementById('signup-form').style.display = isSignup ? 'block' : 'none';
  document.getElementById('auth-subtitle').textContent = isSignup ? 'Create your account to get started.' : 'Log in to see your plate.';
}
function toggleAuthMode() {
  isSignup = !isSignup;
  applyAuthMode();
}

async function handleLogin() {
  showAuthError('');
  if (!sb) { showConnectionError(); return; }
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-pass').value;
  if (!email || !password) { showAuthError('Enter your email and password.'); return; }

  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.message.toLowerCase().includes('invalid login credentials')) {
      // Supabase deliberately returns the same generic error for both a
      // wrong password and a non-existent account (so nobody can use the
      // login form to check which emails are registered). We ask a
      // narrowly-scoped function whether the email exists at all, just to
      // show the right message — it reveals nothing else about the account.
      const { data: exists } = await sb.rpc('email_exists', { check_email: email });
      showAuthError(exists ? 'Incorrect password. Please try again.' : 'Account not found. Please sign up.');
    } else {
      showAuthError(error.message);
    }
    return;
  }
  currentUser = data.user;
  await recordLogin();
  await loadProfileAndEnter();
}

async function handleSignup() {
  showAuthError('');
  if (!sb) { showConnectionError(); return; }
  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-pass').value;
  if (!name || !email || !password) { showAuthError('Fill in your name, email, and password.'); return; }
  if (password.length < 6) { showAuthError('Password needs to be at least 6 characters.'); return; }

  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) { showAuthError(error.message); return; }

  // signUp() alone doesn't always hand back an active, logged-in session
  // (Supabase withholds one until the email is confirmed, if that setting
  // is on). Without a session, every save afterward gets silently blocked.
  // So we immediately try to log in with the same credentials to get a
  // real session going, right away.
  if (data.session) {
    currentUser = data.user;
  } else {
    const signInResult = await sb.auth.signInWithPassword({ email, password });
    if (signInResult.error) {
      showAuthError('Your account was created, but could not log you in automatically — your Supabase project likely still has "Confirm email" turned on. Turn that off in Authentication settings (see the note at the bottom of schema.sql), then try logging in.');
      return;
    }
    currentUser = signInResult.data.user;
  }

  document.getElementById('ob-name').value = name;
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('onboarding-screen').style.display = 'flex';
}

async function recordLogin() {
  if (!currentUser) return;
  try {
    await sb.from('login_events').insert({ user_id: currentUser.id });
    await sb.from('profiles').update({ last_login: new Date().toISOString() }).eq('id', currentUser.id);
  } catch (e) { /* usage tracking should never block sign-in */ }
}

async function logOut() {
  await sb.auth.signOut();
  currentUser = null;
  showLanding();
}

// A profile with no real_name yet means onboarding was never finished.
async function loadProfileAndEnter() {
  const { data: profile, error } = await sb
    .from('profiles')
    .select('*')
    .eq('id', currentUser.id)
    .single();

  if (error || !profile) {
    showAuthError('Could not load your profile. Try again in a moment.');
    return;
  }

  if (!profile.real_name) {
    document.getElementById('ob-name').value = profile.display_name || '';
    document.getElementById('landing-screen').style.display = 'none';
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('onboarding-screen').style.display = 'flex';
    return;
  }

  applyProfile(profile);
  await enterApp();
}

function applyProfile(profile) {
  state.displayName = profile.display_name || 'you';
  state.realName = profile.real_name || '';
  state.email = profile.email || currentUser.email || '';
  state.goalType = profile.goal_type || 'maintain';
  state.isAdmin = profile.role === 'admin';
  state.currentStreak = profile.current_streak || 0;
  state.goals = {
    cal: profile.calorie_goal || 2000,
    protein: profile.protein_goal || 120,
    carbs: profile.carbs_goal || 220,
    fat: profile.fat_goal || 65,
  };
}

// If there's already a logged-in session (from last time), skip straight to the app.
if (sb) {
  sb.auth.getSession().then(async ({ data }) => {
    if (data.session) {
      currentUser = data.session.user;
      await loadProfileAndEnter();
    } else {
      showLanding();
    }
  });
} else {
  showLanding();
}

// ============================================
// ONBOARDING
// ============================================
let onboardStep = 1;
let obGender = 'female';
let obHeightUnit = 'imperial';
let obWeightUnit = 'lbs';
let obTargetWeightUnit = 'lbs';

function selectGender(g, el) {
  obGender = g;
  document.querySelectorAll('.gender-row button').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
}
function selectGoal(g, el) {
  state.goalType = g;
  document.querySelectorAll('.goal-opt').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
}
function setHeightUnit(unit, el) {
  obHeightUnit = unit;
  document.querySelectorAll('#step-2 .field:nth-of-type(1) .unit-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById('height-imperial').style.display = unit === 'imperial' ? 'grid' : 'none';
  document.getElementById('height-metric').style.display = unit === 'metric' ? 'grid' : 'none';
}
function setWeightUnit(unit, el) {
  obWeightUnit = unit;
  el.parentElement.querySelectorAll('.unit-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
}
function setTargetWeightUnit(unit, el) {
  obTargetWeightUnit = unit;
  el.parentElement.querySelectorAll('.unit-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
}

function obNext() {
  if (onboardStep < 4) {
    document.getElementById('step-' + onboardStep).style.display = 'none';
    onboardStep++;
    document.getElementById('step-' + onboardStep).style.display = 'block';
    document.getElementById('ob-back').style.visibility = 'visible';
    for (let i = 1; i <= 4; i++) document.getElementById('dot' + i).classList.toggle('done', i < onboardStep + 1);
    if (onboardStep === 4) {
      computePlan();
      document.getElementById('ob-next').textContent = 'Start tracking';
    }
  } else {
    finishOnboarding();
  }
}

function getHeightCm() {
  if (obHeightUnit === 'metric') {
    return parseFloat(document.getElementById('ob-height-cm').value) || null;
  }
  const ft = parseFloat(document.getElementById('ob-height-ft').value) || 0;
  const inch = parseFloat(document.getElementById('ob-height-in').value) || 0;
  const totalIn = ft * 12 + inch;
  return totalIn ? Math.round(totalIn * 2.54 * 10) / 10 : null;
}
function getWeightKg() {
  const raw = parseFloat(document.getElementById('ob-weight').value);
  if (!raw) return null;
  return obWeightUnit === 'kg' ? raw : Math.round(raw * 0.453592 * 10) / 10;
}

async function finishOnboarding() {
  const name = document.getElementById('ob-name').value.trim() || 'you';
  const heightCm = getHeightCm();
  const weightKg = getWeightKg();

  const { error } = await sb.from('profiles').upsert({
    id: currentUser.id,
    display_name: name,
    real_name: name,
    email: currentUser.email,
    goal_type: state.goalType,
    height_cm: heightCm,
    weight_kg: weightKg,
    height_unit: obHeightUnit,
    weight_unit: obWeightUnit,
    calorie_goal: state.goals.cal,
    protein_goal: state.goals.protein,
    carbs_goal: state.goals.carbs,
    fat_goal: state.goals.fat,
  }, { onConflict: 'id' });

  if (error) {
    alert('Could not save your profile: ' + error.message);
    return;
  }

  state.displayName = name;
  state.realName = name;
  state.email = currentUser.email;
  await recordLogin();
  await enterApp();
}
function obBack() {
  if (onboardStep > 1) {
    document.getElementById('step-' + onboardStep).style.display = 'none';
    onboardStep--;
    document.getElementById('step-' + onboardStep).style.display = 'block';
    document.getElementById('ob-next').textContent = 'Continue';
    if (onboardStep === 1) document.getElementById('ob-back').style.visibility = 'hidden';
  }
}

// Calorie + macro plan. Muscle gain is capped at a max +200 kcal
// surplus over the person's current (maintenance-estimate) calories,
// with protein raised higher than the other goals. No goal is ever
// set below MIN_CALORIES (1200), regardless of goal type.
function computePlan() {
  const weightKg = getWeightKg() || 68; // ~150lb fallback
  const maintenanceCals = parseFloat(document.getElementById('ob-cals').value) || 2000;
  let target = maintenanceCals;

  if (state.goalType === 'lose') target = maintenanceCals - 500;
  else if (state.goalType === 'gain') target = maintenanceCals + 300;
  else if (state.goalType === 'muscle') target = maintenanceCals + 200; // capped surplus
  target = Math.max(MIN_CALORIES, Math.round(target));

  const proteinPerKg = state.goalType === 'muscle' ? 2.2 : (state.goalType === 'lose' ? 1.8 : 1.6);
  const protein = Math.round(weightKg * proteinPerKg);
  const fat = Math.round((target * 0.28) / 9);
  const carbs = Math.round(Math.max(0, target - protein * 4 - fat * 9) / 4);

  state.goals = { cal: target, protein, carbs, fat };

  document.getElementById('ob-summary-cals').textContent = target.toLocaleString() + ' cal / day';
  let macrosHtml = `Protein ${protein}g &nbsp;·&nbsp; Carbs ${carbs}g &nbsp;·&nbsp; Fat ${fat}g`;

  // Rough timeline estimate, only when a target weight and a lose/gain
  // direction are both given. ~3,500 kcal ≈ 1 lb of body weight.
  const targetWeightRaw = parseFloat(document.getElementById('ob-target').value);
  if (targetWeightRaw && (state.goalType === 'lose' || state.goalType === 'gain')) {
    const targetKg = obTargetWeightUnit === 'kg' ? targetWeightRaw : targetWeightRaw * 0.453592;
    const weightDiffKg = Math.abs(weightKg - targetKg);
    const dailyDelta = Math.abs(maintenanceCals - target);
    if (weightDiffKg > 0 && dailyDelta > 0) {
      const totalCaloriesNeeded = weightDiffKg * 7700; // ~7,700 kcal per kg
      const weeks = Math.max(1, Math.round(totalCaloriesNeeded / dailyDelta / 7));
      macrosHtml += `<div style="margin-top:10px; padding-top:10px; border-top:1px solid var(--line);">At this pace, reaching your target could take roughly <strong>${weeks} week${weeks === 1 ? '' : 's'}</strong>. This is a rough estimate, not a guarantee — actual results vary person to person.</div>`;
    }
  }
  document.getElementById('ob-summary-macros').innerHTML = macrosHtml;
}

// ============================================
// ENTER APP — load everything real from Supabase
// ============================================
async function enterApp() {
  document.getElementById('landing-screen').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('onboarding-screen').style.display = 'none';
  document.getElementById('app-shell').style.display = 'block';

  document.getElementById('admin-badge').style.display = state.isAdmin ? 'inline-block' : 'none';
  document.getElementById('admin-panel').style.display = state.isAdmin ? 'block' : 'none';

  document.getElementById('today-date').textContent = new Date().toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric'
  });
  document.getElementById('topbar-greeting').textContent = 'Hi, ' + state.displayName;

  // Sidebar starts open on wide screens (like a normal desktop app), but
  // stays collapsible via the hamburger/× — it just isn't forced open anymore.
  if (window.innerWidth >= 1024) {
    document.getElementById('sidebar').classList.add('open');
    document.body.classList.add('sidebar-open');
  }

  await Promise.all([
    loadTodayEntries(),
    loadTodayActivity(),
    loadSavedMeals(),
    loadHistory(),
    loadLeaderboard(),
    loadPartners(),
    loadPendingInvites(),
  ]);

  await recomputeStreak();

  fillGoalsForm();
  fillAccountForm();
  renderAll();
  renderGoalGuidance();
  renderFoodDb();
  if (state.isAdmin) loadAdminStats();

  // Check for new accountability invites periodically, since there's no
  // live/realtime push — this just keeps the sidebar badge honest without
  // requiring the person to log out and back in.
  setInterval(async () => {
    await loadPendingInvites();
    renderPendingInvites();
  }, 30000);
}

// ============================================
// SIDEBAR NAV
// ============================================
function toggleSidebar() {
  const isOpen = document.getElementById('sidebar').classList.toggle('open');
  document.body.classList.toggle('sidebar-open', isOpen);
  if (window.innerWidth < 1024) {
    document.getElementById('overlay').classList.toggle('show', isOpen);
  }
}
function goPage(p) {
  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
  document.getElementById('page-' + p).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelector(`.nav-item[data-page="${p}"]`).classList.add('active');
  if (window.innerWidth < 1024) toggleSidebar();
}

// ============================================
// FOOD LOG — backed by the food_logs table
// ============================================
async function loadTodayEntries() {
  const { data, error } = await sb.from('food_logs')
    .select('*')
    .eq('user_id', currentUser.id)
    .eq('log_date', todayKey())
    .order('created_at', { ascending: true });
  state.todayEntries = error ? [] : data.map(r => ({
    id: r.id, name: r.name, cal: r.calories, protein: r.protein, carbs: r.carbs, fat: r.fat,
  }));
}

async function loadTodayActivity() {
  const { data, error } = await sb.from('activity_logs')
    .select('*')
    .eq('user_id', currentUser.id)
    .eq('log_date', todayKey())
    .order('created_at', { ascending: true });
  state.activityEntries = error ? [] : data.map(r => ({
    id: r.id, name: r.name || 'Activity', calories_burned: r.calories_burned, discount: r.discount,
  }));
}

function getDiscountedBurn() {
  return state.activityEntries.filter(a => a.discount).reduce((s, a) => s + (Number(a.calories_burned) || 0), 0);
}

function renderActivity() {
  const listEl = document.getElementById('activity-log-list');
  if (!listEl) return;
  if (!state.activityEntries.length) { listEl.innerHTML = ''; return; }
  listEl.innerHTML = state.activityEntries.map(a => `
    <div class="log-item">
      <div>
        <div class="log-item-name">${escapeHtml(a.name)}</div>
        <div class="log-item-macros">${a.discount ? 'Added back to goal' : 'Tracked separately'}</div>
      </div>
      <div class="log-item-right">
        <span class="log-item-cal">-${Math.round(a.calories_burned)} cal</span>
        <button class="log-item-remove" data-id="${a.id}" aria-label="Remove ${escapeHtml(a.name)}">×</button>
      </div>
    </div>`).join('');

  listEl.querySelectorAll('.log-item-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      await sb.from('activity_logs').delete().eq('id', btn.dataset.id);
      state.activityEntries = state.activityEntries.filter(a => String(a.id) !== btn.dataset.id);
      renderActivity();
      renderPlate();
    });
  });
}

document.getElementById('activity-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('activity-name').value.trim() || 'Activity';
  const cal = Number(document.getElementById('activity-cal').value) || 0;
  const discount = document.getElementById('activity-discount').value === 'yes';
  if (cal <= 0) return;

  const { data, error } = await sb.from('activity_logs').insert({
    user_id: currentUser.id, log_date: todayKey(), name, calories_burned: cal, discount,
  }).select().single();

  if (error) {
    alert('Could not log that activity: ' + error.message);
    return;
  }
  state.activityEntries.push({ id: data.id, name, calories_burned: cal, discount });
  renderActivity();
  renderPlate();
  e.target.reset();
});

async function loadHistory() {
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const { data, error } = await sb.from('food_logs')
    .select('log_date, calories')
    .eq('user_id', currentUser.id)
    .gte('log_date', since.toISOString().slice(0, 10));
  state.historyByDate = {};
  if (!error && data) {
    data.forEach(r => {
      state.historyByDate[r.log_date] = (state.historyByDate[r.log_date] || 0) + Number(r.calories || 0);
    });
  }
}

async function recomputeStreak() {
  try {
    const { data, error } = await sb.rpc('recompute_my_streak');
    if (!error && typeof data === 'number') state.currentStreak = data;
  } catch (e) { /* non-fatal */ }
}

document.getElementById('food-save-mode').addEventListener('change', (e) => {
  document.getElementById('existing-meal-wrap').style.display = e.target.value === 'existing' ? 'block' : 'none';
});

document.getElementById('add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('food-name').value.trim();
  const cal = Number(document.getElementById('food-cal').value) || 0;
  const protein = Number(document.getElementById('food-protein').value) || 0;
  const carbs = Number(document.getElementById('food-carbs').value) || 0;
  const fat = Number(document.getElementById('food-fat').value) || 0;
  const saveMode = document.getElementById('food-save-mode').value;

  if (!name || cal <= 0) return;

  const { data, error } = await sb.from('food_logs').insert({
    user_id: currentUser.id, log_date: todayKey(),
    name, calories: cal, protein, carbs, fat,
  }).select().single();

  if (error) {
    alert('Could not add that: ' + error.message);
    return;
  }
  state.todayEntries.push({ id: data.id, name, cal, protein, carbs, fat });

  if (saveMode === 'new') {
    await sb.from('saved_meals').insert({ user_id: currentUser.id, name, calories: cal, protein, carbs, fat });
    await loadSavedMeals();
  } else if (saveMode === 'existing') {
    const mealId = document.getElementById('food-existing-meal').value;
    const meal = state.savedMeals.find(m => String(m.id) === String(mealId));
    if (meal) {
      const updated = {
        calories: Number(meal.cal) + cal,
        protein: Number(meal.protein) + protein,
        carbs: Number(meal.carbs) + carbs,
        fat: Number(meal.fat) + fat,
      };
      await sb.from('saved_meals').update(updated).eq('id', meal.id);
      await loadSavedMeals();
    }
  }

  await recomputeStreak();
  renderAll();
  e.target.reset();
  document.getElementById('existing-meal-wrap').style.display = 'none';
  document.getElementById('food-name').focus();
});

document.getElementById('clear-day').addEventListener('click', async () => {
  if (!confirm('Clear everything logged today?')) return;
  await sb.from('food_logs').delete().eq('user_id', currentUser.id).eq('log_date', todayKey());
  state.todayEntries = [];
  await recomputeStreak();
  renderAll();
});

// ============================================
// GOALS & SETTINGS
// ============================================
function fillGoalsForm() {
  document.getElementById('goal-cal').value = state.goals.cal;
  document.getElementById('goal-protein').value = state.goals.protein;
  document.getElementById('goal-carbs').value = state.goals.carbs;
  document.getElementById('goal-fat').value = state.goals.fat;
}

document.getElementById('goals-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  let enteredCal = Number(document.getElementById('goal-cal').value) || 0;
  if (enteredCal < MIN_CALORIES) {
    alert(`For safety, calorie goals can't go below ${MIN_CALORIES}. Setting it to ${MIN_CALORIES}.`);
    enteredCal = MIN_CALORIES;
    document.getElementById('goal-cal').value = MIN_CALORIES;
  }
  state.goals = {
    cal: enteredCal,
    protein: Number(document.getElementById('goal-protein').value) || 0,
    carbs: Number(document.getElementById('goal-carbs').value) || 0,
    fat: Number(document.getElementById('goal-fat').value) || 0,
  };
  renderAll();
  if (currentUser) {
    await sb.from('profiles').update({
      calorie_goal: state.goals.cal,
      protein_goal: state.goals.protein,
      carbs_goal: state.goals.carbs,
      fat_goal: state.goals.fat,
    }).eq('id', currentUser.id);
    await recomputeStreak();
  }
});

function renderGoalGuidance() {
  const guidance = {
    lose: 'A moderate calorie deficit paired with steady protein keeps you full while losing weight sustainably.',
    gain: 'A calorie surplus with balanced carbs and fat supports steady, healthy weight gain.',
    maintain: 'Match your intake to your output — consistency matters more than precision here.',
    muscle: 'Higher protein plus a capped, modest surplus (max +200 kcal) gives your body what it needs to build muscle without excess fat gain.',
  };
  const categoryForGoal = { muscle: 'high_protein', lose: 'low_calorie', gain: 'general', maintain: 'general' };
  const cat = categoryForGoal[state.goalType] || 'general';
  const suggestions = foodDb.filter(f => f.category === cat).slice(0, 6).map(f => f.name);

  document.getElementById('goal-guidance').textContent = guidance[state.goalType] || guidance.maintain;
  document.getElementById('goal-food-pills').innerHTML = suggestions.map(f => `<span class="pill">${escapeHtml(f)}</span>`).join('');

  const railEl = document.getElementById('rail-suggestions');
  if (railEl) railEl.innerHTML = suggestions.slice(0, 5).map(f => `<span class="pill">${escapeHtml(f)}</span>`).join('');
}

// ============================================
// FOOD DATABASE
// ============================================
function renderFoodDb(filter = '') {
  const list = document.getElementById('food-db-list');
  const items = foodDb.filter(f => f.name.toLowerCase().includes(filter.toLowerCase()));
  list.innerHTML = items.map((f, i) => `
    <li class="log-item">
      <div><div class="log-item-name">${escapeHtml(f.name)}</div><div class="log-item-macros">P ${f.protein}g · C ${f.carbs}g · F ${f.fat}g</div></div>
      <div class="log-item-right">
        <span class="log-item-cal">${f.cal} cal</span>
        <button class="log-item-remove" style="font-size:15px;" title="Log this" onclick="logDbFood(${i}, '${filter.replace(/'/g, "\\'")}')">＋</button>
      </div>
    </li>`).join('');
}
function filterFoodDb(v) { renderFoodDb(v); }
async function logDbFood(i, filter) {
  const items = foodDb.filter(f => f.name.toLowerCase().includes((filter || '').toLowerCase()));
  const f = items[i];
  const { data, error } = await sb.from('food_logs').insert({
    user_id: currentUser.id, log_date: todayKey(),
    name: f.name, calories: f.cal, protein: f.protein, carbs: f.carbs, fat: f.fat,
  }).select().single();
  if (error) { alert('Could not add that: ' + error.message); return; }
  state.todayEntries.push({ id: data.id, name: f.name, cal: f.cal, protein: f.protein, carbs: f.carbs, fat: f.fat });
  await recomputeStreak();
  renderAll();
}

// ============================================
// ACCOUNTABILITY — leaderboard + group, all via Supabase RPCs
// ============================================
let globalLeaderboard = [];

async function loadLeaderboard() {
  const { data, error } = await sb.rpc('get_leaderboard', { limit_n: 10 });
  globalLeaderboard = error ? [] : data;
}

async function loadPartners() {
  const { data, error } = await sb.rpc('get_my_partners');
  if (error) console.error('loadPartners failed:', error.message);
  state.partners = error ? [] : data;
}

async function loadPendingInvites() {
  const { data, error } = await sb.rpc('get_my_pending_requests');
  if (error) console.error('loadPendingInvites failed:', error.message);
  state.pendingInvites = error ? [] : data;
}

function renderPendingInvites() {
  const panel = document.getElementById('pending-invites-panel');
  const listEl = document.getElementById('pending-invites-list');
  const badge = document.getElementById('accountability-badge');
  const count = state.pendingInvites ? state.pendingInvites.length : 0;

  if (badge) {
    badge.style.display = count > 0 ? 'flex' : 'none';
    badge.textContent = count;
  }

  if (!count) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = 'block';
  listEl.innerHTML = state.pendingInvites.map(inv => `
    <div class="leader-row">
      <div style="flex:1; font-weight:600; font-size:13.5px;">${escapeHtml(inv.from_name)} wants to be accountability partners</div>
      <button class="btn-add btn-secondary" style="width:auto; grid-column:auto; margin:0; padding:8px 14px;" onclick="respondToInvite(${inv.request_id}, true)">Accept</button>
      <button class="btn-outline" style="width:auto; margin:0 0 0 8px; padding:8px 14px;" onclick="respondToInvite(${inv.request_id}, false)">Decline</button>
    </div>`).join('');
}

async function respondToInvite(requestId, accept) {
  const { error } = await sb.rpc('respond_to_partner_request', { request_id: requestId, accept });
  if (error) { alert('Something went wrong: ' + error.message); return; }
  await Promise.all([loadPendingInvites(), loadPartners()]);
  renderPendingInvites();
  renderPartners();
}

// Type-ahead partner search (case-insensitive, matches the START of a name)
let partnerSearchTimeout = null;
document.getElementById('partner-username-input').addEventListener('input', (e) => {
  const query = e.target.value.trim();
  clearTimeout(partnerSearchTimeout);
  const dropdown = document.getElementById('partner-search-dropdown');
  if (!query) { dropdown.classList.remove('show'); dropdown.innerHTML = ''; return; }
  partnerSearchTimeout = setTimeout(async () => {
    const { data, error } = await sb.rpc('search_users', { query, limit_n: 8 });
    if (error || !data || !data.length) { dropdown.classList.remove('show'); dropdown.innerHTML = ''; return; }
    dropdown.innerHTML = data.map(u => `<div class="search-dropdown-item" data-name="${escapeHtml(u.display_name)}">${escapeHtml(u.display_name)}</div>`).join('');
    dropdown.classList.add('show');
    dropdown.querySelectorAll('.search-dropdown-item').forEach(item => {
      item.addEventListener('click', () => {
        document.getElementById('partner-username-input').value = item.dataset.name;
        dropdown.classList.remove('show');
        dropdown.innerHTML = '';
      });
    });
  }, 200);
});
document.addEventListener('click', (e) => {
  const dropdown = document.getElementById('partner-search-dropdown');
  if (dropdown && !e.target.closest('#partner-search-dropdown') && e.target.id !== 'partner-username-input') {
    dropdown.classList.remove('show');
  }
});

const STAR_ICON = '<svg viewBox="0 0 18 18" fill="currentColor" width="13" height="13"><path d="M9 1.2l2.2 4.7 5.1.6-3.8 3.5.9 5.1L9 12.6l-4.4 2.5.9-5.1L1.7 6.5l5.1-.6z"/></svg>';

function renderPodium() {
  const top = globalLeaderboard.slice(0, 3);
  const podiumEl = document.getElementById('podium');
  if (!podiumEl) return;
  if (!top.length) { podiumEl.innerHTML = ''; return; }
  const order = ['second', 'first', 'third'];
  const arranged = [top[1], top[0], top[2]].filter(Boolean);
  const classes = arranged.map((_, idx) => order[idx] || 'third');
  podiumEl.innerHTML = `<div class="podium-row">${arranged.map((p, idx) => `
    <div class="podium-col ${classes[idx]}">
      <div class="avatar">${classes[idx] === 'first' && globalLeaderboard.indexOf(p) < 5 ? `<span class="crown">${STAR_ICON}</span>` : ''}${escapeHtml((p.display_name || 'u')[0].toUpperCase())}</div>
      <div class="bar"></div>
      <div class="name">${escapeHtml(p.display_name)}</div>
      <div class="streak">🔥 ${p.current_streak}d</div>
    </div>`).join('')}</div>`;
}

function renderLeaderboard() {
  renderPodium();
  const partnerIds = new Set((state.partners || []).map(p => p.user_id));
  document.getElementById('leaderboard-list').innerHTML = globalLeaderboard.map((d, i) => `
    <div class="leader-row ${d.id === currentUser.id || partnerIds.has(d.id) ? 'partner' : ''}">
      <div class="rank">${i + 1}${i < 5 ? ` ${STAR_ICON}` : ''}</div>
      <div class="avatar-sm">${escapeHtml((d.display_name || 'u')[0].toUpperCase())}</div>
      <div style="flex:1; font-weight:600; font-size:13.5px;">${escapeHtml(d.display_name)}${d.id === currentUser.id ? ' (you)' : ''}</div>
      <div style="font-size:12px; color:var(--ink-soft); font-family:var(--font-mono);">🔥 ${d.current_streak}d</div>
    </div>`).join('');
}

function renderPartners() {
  const partners = state.partners || [];
  const listEl = document.getElementById('partner-list');
  const emptyEl = document.getElementById('partner-empty');

  if (!partners.length) {
    listEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  listEl.innerHTML = partners.map(p => `
    <div class="leader-row" style="flex-wrap:wrap;">
      <div class="avatar-sm">${escapeHtml((p.display_name || 'u')[0].toUpperCase())}</div>
      <div style="flex:1; font-weight:600; font-size:13.5px;">${escapeHtml(p.display_name)}</div>
      <div style="font-size:12px; color:var(--ink-soft); font-family:var(--font-mono); margin-right:10px;">🔥 ${p.current_streak}d</div>
      <label style="display:flex; align-items:center; gap:6px; font-size:11.5px; color:var(--ink-soft); margin-right:8px; cursor:pointer;">
        🔥 Linked streaks
        <button class="toggle partner-link-toggle ${p.link_streaks ? 'on' : ''}" data-partnership-id="${p.partnership_id}" style="width:32px; height:18px;" title="If off, missing your goal won't affect this person's streak (and theirs won't affect yours)">
          <div class="knob" style="width:14px; height:14px;"></div>
        </button>
      </label>
      <button class="log-item-remove" data-partnership-id="${p.partnership_id}" aria-label="Remove ${escapeHtml(p.display_name)}" title="Remove partner">×</button>
    </div>`).join('');

  listEl.querySelectorAll('.partner-link-toggle').forEach(btn => {
    btn.addEventListener('click', async () => {
      const newVal = !btn.classList.contains('on');
      btn.classList.toggle('on', newVal);
      await sb.rpc('set_partner_link_streaks', { target_partnership_id: btn.dataset.partnershipId, new_val: newVal });
      const p = state.partners.find(x => String(x.partnership_id) === btn.dataset.partnershipId);
      if (p) p.link_streaks = newVal;
    });
  });

  listEl.querySelectorAll('.log-item-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Remove this accountability partner? This only affects the two of you.')) return;
      await sb.rpc('remove_partner', { target_partnership_id: btn.dataset.partnershipId });
      await loadPartners();
      renderPartners();
    });
  });
}

async function addPartner() {
  const nameEl = document.getElementById('partner-username-input');
  const username = nameEl.value.trim();
  if (!username) return;
  const { data, error } = await sb.rpc('send_partner_request', { friend_username: username });
  if (error) { alert('Something went wrong sending that request: ' + error.message); console.error('send_partner_request failed:', error); return; }
  if (data === 'not_found') { alert('User not found.'); return; }
  if (data === 'self') { alert("You can't add yourself."); return; }
  if (data === 'full') { alert('You already have 4 accountability partners — the max.'); return; }
  if (data === 'their_full') { alert('That person already has 4 accountability partners.'); return; }
  if (data === 'already') { alert('You already have a pending or accepted request with that person.'); return; }
  nameEl.value = '';
  document.getElementById('partner-search-dropdown').classList.remove('show');
  alert('Request sent — they need to accept it before you show up as partners.');
}

// ============================================
// ADMIN STATS
// ============================================
async function loadAdminStats() {
  const { data, error } = await sb.rpc('get_admin_stats');
  if (error || !data || !data[0]) return;
  const row = data[0];
  document.getElementById('admin-total-users').textContent = row.total_users;
  document.getElementById('admin-active-today').textContent = row.active_today;
  document.getElementById('admin-logins-week').textContent = row.logins_this_week;
}

// ============================================
// ACCOUNT PAGE
// ============================================
function fillAccountForm() {
  document.getElementById('acc-display-name').value = state.displayName;
  document.getElementById('acc-real-name').value = state.realName;
  document.getElementById('acc-email').value = state.email;
}
async function saveAccountProfile() {
  const newDisplayName = document.getElementById('acc-display-name').value.trim() || state.displayName;
  const { error } = await sb.from('profiles').update({ display_name: newDisplayName }).eq('id', currentUser.id);
  if (error) { alert('Could not save: ' + error.message); return; }
  state.displayName = newDisplayName;
  await loadLeaderboard();
  await loadPartners();
  renderLeaderboard();
  renderPartners();
}

// ============================================
// PLATE / TRACKER
// ============================================
function getTodayTotals() {
  return state.todayEntries.reduce((acc, e) => {
    acc.cal += Number(e.cal) || 0;
    acc.protein += Number(e.protein) || 0;
    acc.carbs += Number(e.carbs) || 0;
    acc.fat += Number(e.fat) || 0;
    return acc;
  }, { cal: 0, protein: 0, carbs: 0, fat: 0 });
}

function renderPlate() {
  const totals = getTodayTotals();
  const effectiveGoal = state.goals.cal + getDiscountedBurn();

  document.getElementById('cal-total').textContent = Math.round(totals.cal);
  document.getElementById('cal-goal').textContent = effectiveGoal;
  document.getElementById('topbar-cal').textContent = Math.round(totals.cal);
  document.getElementById('topbar-cal-goal').textContent = effectiveGoal;

  const macroCals = MACROS.map(m => (Number(totals[m.key]) || 0) * m.calPerGram);
  const macroCalSum = macroCals.reduce((a, b) => a + b, 0);

  const arcsGroup = document.getElementById('plate-arcs');
  arcsGroup.innerHTML = '';

  const fillFraction = effectiveGoal > 0 ? Math.min(totals.cal / effectiveGoal, 1) : 0;
  let offsetSoFar = 0;

  MACROS.forEach((m, i) => {
    const share = macroCalSum > 0 ? macroCals[i] / macroCalSum : 0;
    const arcLength = CIRCUMFERENCE * fillFraction * share;
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', 160);
    circle.setAttribute('cy', 160);
    circle.setAttribute('r', RADIUS);
    circle.setAttribute('stroke', m.hex);
    circle.setAttribute('stroke-dasharray', `${arcLength} ${CIRCUMFERENCE - arcLength}`);
    circle.setAttribute('stroke-dashoffset', -offsetSoFar);
    arcsGroup.appendChild(circle);
    offsetSoFar += arcLength;
  });

  renderMacroLegend(totals);
  renderRailStats(totals, effectiveGoal);
}

function renderRailStats(totals, effectiveGoal) {
  const railEl = document.getElementById('rail-stats');
  if (!railEl) return;
  const remainingCal = Math.max(0, effectiveGoal - totals.cal);
  const remainingProtein = Math.max(0, state.goals.protein - totals.protein);
  railEl.innerHTML = `
    <div class="stat-row" style="border-top:none;"><div><div class="lbl">Calories left</div></div><div class="val">${Math.round(remainingCal)}</div></div>
    <div class="stat-row"><div><div class="lbl">Protein left</div></div><div class="val">${Math.round(remainingProtein)}g</div></div>
    <div class="stat-row"><div><div class="lbl">Current streak</div></div><div class="val">🔥 ${state.currentStreak}d</div></div>
  `;
}

function renderMacroLegend(totals) {
  const container = document.getElementById('macro-legend');
  container.innerHTML = '';
  MACROS.forEach(m => {
    const value = Math.round(Number(totals[m.key]) || 0);
    const goal = Number(state.goals[m.key]) || 0;
    const pct = goal > 0 ? Math.min((value / goal) * 100, 100) : 0;

    const card = document.createElement('div');
    card.className = 'macro-card';
    card.innerHTML = `
      <div class="macro-name"><span class="macro-dot" style="background:${m.hex}"></span>${m.label}</div>
      <div class="macro-value">${value}g <span class="macro-goal">/ ${goal}g</span></div>
      <div class="macro-bar-track"><div class="macro-bar-fill" style="width:${pct}%; background:${m.hex}"></div></div>
    `;
    container.appendChild(card);
  });
}

function renderLog() {
  const entries = state.todayEntries;
  const list = document.getElementById('log-list');
  list.innerHTML = '';

  entries.forEach((entry) => {
    const li = document.createElement('li');
    li.className = 'log-item';
    li.innerHTML = `
      <div>
        <div class="log-item-name">${escapeHtml(entry.name)}</div>
        <div class="log-item-macros">P ${entry.protein || 0}g · C ${entry.carbs || 0}g · F ${entry.fat || 0}g</div>
      </div>
      <div class="log-item-right">
        <span class="log-item-cal">${entry.cal} cal</span>
        <button class="log-item-remove" data-id="${entry.id}" aria-label="Remove ${escapeHtml(entry.name)}">×</button>
      </div>
    `;
    list.appendChild(li);
  });

  document.getElementById('log-empty').style.display = entries.length ? 'none' : 'block';

  list.querySelectorAll('.log-item-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      await sb.from('food_logs').delete().eq('id', id);
      state.todayEntries = state.todayEntries.filter(e => String(e.id) !== String(id));
      await recomputeStreak();
      renderAll();
    });
  });
}

// ============================================
// SAVED MEALS
// ============================================
async function loadSavedMeals() {
  const { data, error } = await sb.from('saved_meals').select('*').eq('user_id', currentUser.id).order('name');
  state.savedMeals = error ? [] : data.map(r => ({
    id: r.id, name: r.name, cal: r.calories, protein: r.protein, carbs: r.carbs, fat: r.fat,
  }));
}

function renderSavedMeals() {
  const container = document.getElementById('saved-list');
  const emptyMsg = document.getElementById('saved-empty');
  container.innerHTML = '';

  const existingSelect = document.getElementById('food-existing-meal');
  existingSelect.innerHTML = state.savedMeals.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');

  if (!state.savedMeals.length) {
    emptyMsg.style.display = 'block';
    return;
  }
  emptyMsg.style.display = 'none';

  state.savedMeals.forEach((meal) => {
    const chip = document.createElement('div');
    chip.className = 'saved-chip';
    chip.innerHTML = `
      <span class="saved-chip-name">${escapeHtml(meal.name)}</span>
      <span class="saved-chip-cal">${meal.cal} cal</span>
      <button class="saved-chip-add" data-id="${meal.id}" aria-label="Add ${escapeHtml(meal.name)} to today">+</button>
      <button class="saved-chip-remove" data-id="${meal.id}" aria-label="Delete saved meal ${escapeHtml(meal.name)}">×</button>
    `;
    container.appendChild(chip);
  });

  container.querySelectorAll('.saved-chip-add').forEach(btn => {
    btn.addEventListener('click', async () => {
      const meal = state.savedMeals.find(m => String(m.id) === btn.dataset.id);
      if (!meal) return;
      const { data, error } = await sb.from('food_logs').insert({
        user_id: currentUser.id, log_date: todayKey(),
        name: meal.name, calories: meal.cal, protein: meal.protein, carbs: meal.carbs, fat: meal.fat,
      }).select().single();
      if (error) { alert('Could not add that: ' + error.message); return; }
      state.todayEntries.push({ id: data.id, name: meal.name, cal: meal.cal, protein: meal.protein, carbs: meal.carbs, fat: meal.fat });
      await recomputeStreak();
      renderAll();
    });
  });

  container.querySelectorAll('.saved-chip-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      await sb.from('saved_meals').delete().eq('id', btn.dataset.id);
      state.savedMeals = state.savedMeals.filter(m => String(m.id) !== btn.dataset.id);
      renderSavedMeals();
    });
  });
}

// ============================================
// PROGRESS & HISTORY
// ============================================
function renderProgress() {
  document.getElementById('progress-streak').innerHTML =
    state.currentStreak > 0
      ? `<span class="pill">🔥 ${state.currentStreak}-day streak</span>`
      : `<p class="log-empty" style="padding:4px 0;">No streak yet — hit your calorie goal today to start one.</p>`;

  const dates = Object.keys(state.historyByDate).sort().reverse();
  const historyEl = document.getElementById('progress-history');
  const emptyEl = document.getElementById('progress-empty');

  if (!dates.length) {
    historyEl.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';

  historyEl.innerHTML = dates.map(key => {
    const totalCal = state.historyByDate[key];
    const label = new Date(key + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `
      <div class="log-item">
        <div class="log-item-name">${label}</div>
        <div class="log-item-cal">${Math.round(totalCal)} / ${state.goals.cal} cal</div>
      </div>`;
  }).join('');
}

// ============================================
// RENDER EVERYTHING
// ============================================
function renderAll() {
  renderPlate();
  renderLog();
  renderActivity();
  renderSavedMeals();
  renderProgress();
  renderLeaderboard();
  renderPartners();
  renderPendingInvites();
}
