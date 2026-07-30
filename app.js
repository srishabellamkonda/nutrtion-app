// ============================================
// NutriSync — app logic
// Food logs/saved meals still live in memory only for now (that part
// isn't connected to the database yet). Accounts, login, and profile
// info (name, goals, admin role) ARE real now, via Supabase.
// ============================================

const SUPABASE_URL = 'https://eltglwdtdmzyhcoduwzf.supabase.co';
const SUPABASE_KEY = 'sb_publishable_M3WjnaTU45PmzyUC5Fe68Q_Se1Q_BKS';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

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

let state = {
  goals: { cal: 2000, protein: 120, carbs: 220, fat: 65 },
  days: {},          // { '2026-07-28': [ {name, cal, protein, carbs, fat}, ... ] }
  savedMeals: [],
  goalType: 'lose',  // lose | gain | maintain | muscle
  isAdmin: false,
  displayName: 'you',
  realName: '',
  email: '',
  accountabilityPartners: [], // starts empty — nobody is added until a real account system exists
};

const foodDb = [
  { name: 'Chicken breast (4oz)', cal: 185, protein: 35, carbs: 0, fat: 4 },
  { name: 'Brown rice (1 cup)', cal: 216, protein: 5, carbs: 45, fat: 2 },
  { name: 'Avocado (half)', cal: 120, protein: 1, carbs: 6, fat: 11 },
  { name: 'Greek yogurt (1 cup)', cal: 150, protein: 20, carbs: 9, fat: 4 },
  { name: 'Almonds (1oz)', cal: 164, protein: 6, carbs: 6, fat: 14 },
  { name: 'Banana', cal: 105, protein: 1, carbs: 27, fat: 0 },
  { name: 'Oats (1 cup cooked)', cal: 158, protein: 6, carbs: 27, fat: 3 },
  { name: 'Salmon (4oz)', cal: 233, protein: 25, carbs: 0, fat: 14 },
];

function getTodayEntries() {
  const key = todayKey();
  if (!state.days[key]) state.days[key] = [];
  return state.days[key];
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============================================
// AUTH — real Supabase accounts
// ============================================
let isSignup = false;

function setAuthMode(signup) {
  isSignup = signup;
  showAuthError('');
  document.getElementById('login-form').style.display = isSignup ? 'none' : 'block';
  document.getElementById('signup-form').style.display = isSignup ? 'block' : 'none';
  document.getElementById('auth-subtitle').textContent = isSignup ? 'Create your account to get started.' : 'Log in to see your plate.';
}
function toggleAuthMode() {
  setAuthMode(!isSignup);
}

// Landing page <-> auth screen navigation
function showLanding() {
  document.getElementById('landing-screen').style.display = 'block';
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('onboarding-screen').style.display = 'none';
  document.getElementById('app-shell').style.display = 'none';
}
function goToAuth(mode) {
  document.getElementById('landing-screen').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
  setAuthMode(mode === 'signup');
}

async function handleLogin() {
  showAuthError('');
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-pass').value;
  if (!email || !password) { showAuthError('Enter your email and password.'); return; }

  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.message.toLowerCase().includes('invalid login credentials')) {
      showAuthError('Account not found. Please sign up.');
    } else {
      showAuthError(error.message);
    }
    return;
  }
  currentUser = data.user;
  await loadProfileAndEnter();
}

async function handleSignup() {
  showAuthError('');
  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-pass').value;
  if (!name || !email || !password) { showAuthError('Fill in your name, email, and password.'); return; }
  if (password.length < 6) { showAuthError('Password needs to be at least 6 characters.'); return; }

  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { display_name: name } },
  });
  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('already registered') || msg.includes('already exists') || msg.includes('already been registered')) {
      showAuthError('An account with this email already exists. Please log in instead.');
    } else {
      showAuthError(error.message);
    }
    return;
  }
  currentUser = data.user;

  // The profile row itself is created by a database trigger on signup; store the
  // name and email we already have on it right away, rather than waiting for
  // onboarding to finish.
  if (currentUser) {
    await sb.from('profiles').update({
      display_name: name,
      email: email,
    }).eq('id', currentUser.id);
  }

  document.getElementById('ob-name').value = name;
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('onboarding-screen').style.display = 'flex';
}

async function logOut() {
  await sb.auth.signOut();
  currentUser = null;
  document.getElementById('app-shell').style.display = 'none';
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
    // never finished onboarding
    document.getElementById('ob-name').value = profile.display_name || '';
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('onboarding-screen').style.display = 'flex';
    return;
  }

  applyProfile(profile);
  enterApp();
}

function applyProfile(profile) {
  state.displayName = profile.display_name || 'you';
  state.realName = profile.real_name || '';
  state.email = profile.email || (currentUser && currentUser.email) || '';
  state.goalType = profile.goal_type || 'maintain';
  state.isAdmin = profile.role === 'admin';
  state.goals = {
    cal: profile.calorie_goal || 2000,
    protein: profile.protein_goal || 120,
    carbs: profile.carbs_goal || 220,
    fat: profile.fat_goal || 65,
  };
}

// If there's already a logged-in session (from last time), skip straight into the
// app — users stay logged in until they explicitly sign out. Otherwise show the
// public landing page.
sb.auth.getSession().then(async ({ data }) => {
  if (data.session) {
    currentUser = data.session.user;
    await loadProfileAndEnter();
  } else {
    showLanding();
  }
});

// ============================================
// ONBOARDING
// ============================================
let onboardStep = 1;
let obGender = 'female';

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

async function finishOnboarding() {
  const name = document.getElementById('ob-name').value.trim() || 'you';
  const heightIn = parseFloat(document.getElementById('ob-height').value) || null;
  const weightLb = parseFloat(document.getElementById('ob-weight').value) || null;

  const { error } = await sb.from('profiles').update({
    display_name: name,
    real_name: name,
    goal_type: state.goalType,
    height_cm: heightIn ? Math.round(heightIn * 2.54 * 10) / 10 : null,
    weight_kg: weightLb ? Math.round(weightLb * 0.453592 * 10) / 10 : null,
    calorie_goal: state.goals.cal,
    protein_goal: state.goals.protein,
    carbs_goal: state.goals.carbs,
    fat_goal: state.goals.fat,
  }).eq('id', currentUser.id);

  if (error) {
    alert('Could not save your profile: ' + error.message);
    return;
  }

  state.displayName = name;
  enterApp();
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
function computePlan() {
  const weight = parseFloat(document.getElementById('ob-weight').value) || 150;
  const cals = parseFloat(document.getElementById('ob-cals').value) || 2000;
  let target = cals;
  if (state.goalType === 'lose') target = Math.max(1200, cals - 500);
  if (state.goalType === 'gain' || state.goalType === 'muscle') target = cals + 300;
  target = Math.round(target);

  const protein = Math.round(state.goalType === 'muscle' ? weight * 1.0 : weight * 0.7);
  const fat = Math.round((target * 0.28) / 9);
  const carbs = Math.round((target - protein * 4 - fat * 9) / 4);

  state.goals = { cal: target, protein, carbs, fat };

  document.getElementById('ob-summary-cals').textContent = target.toLocaleString() + ' cal / day';
  document.getElementById('ob-summary-macros').innerHTML =
    `Protein ${protein}g &nbsp;·&nbsp; Carbs ${carbs}g &nbsp;·&nbsp; Fat ${fat}g`;
}

function enterApp() {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('onboarding-screen').style.display = 'none';
  document.getElementById('app-shell').style.display = 'block';

  if (state.isAdmin) {
    document.getElementById('admin-badge').style.display = 'inline-block';
    document.getElementById('admin-panel').style.display = 'block';
  }

  document.getElementById('today-date').textContent = new Date().toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric'
  });

  fillGoalsForm();
  fillAccountForm();
  renderAll();
  renderGoalGuidance();
  renderFoodDb();
  renderPartners();
}

function fillAccountForm() {
  document.getElementById('acc-display-name').value = state.displayName || '';
  document.getElementById('acc-real-name').value = state.realName || '';
  document.getElementById('acc-email').value = state.email || '';
}

document.getElementById('acc-save').addEventListener('click', async () => {
  if (!currentUser) return;
  const displayName = document.getElementById('acc-display-name').value.trim() || 'you';
  const realName = document.getElementById('acc-real-name').value.trim();

  const { error } = await sb.from('profiles').update({
    display_name: displayName,
    real_name: realName,
  }).eq('id', currentUser.id);

  if (error) { alert('Could not save your profile: ' + error.message); return; }

  state.displayName = displayName;
  state.realName = realName;
  renderAll();
  alert('Profile updated.');
});

// ============================================
// SIDEBAR NAV
// ============================================
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('overlay').classList.toggle('show');
}
function goPage(p) {
  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
  document.getElementById('page-' + p).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  document.querySelector(`.nav-item[data-page="${p}"]`).classList.add('active');
  toggleSidebar();
}

// ============================================
// PLATE / TRACKER (kept from original)
// ============================================
function renderPlate() {
  const entries = getTodayEntries();
  const totals = entries.reduce((acc, e) => {
    acc.cal += Number(e.cal) || 0;
    acc.protein += Number(e.protein) || 0;
    acc.carbs += Number(e.carbs) || 0;
    acc.fat += Number(e.fat) || 0;
    return acc;
  }, { cal: 0, protein: 0, carbs: 0, fat: 0 });

  document.getElementById('cal-total').textContent = Math.round(totals.cal);
  document.getElementById('cal-goal').textContent = state.goals.cal;

  const macroCals = MACROS.map(m => (Number(totals[m.key]) || 0) * m.calPerGram);
  const macroCalSum = macroCals.reduce((a, b) => a + b, 0);

  const arcsGroup = document.getElementById('plate-arcs');
  arcsGroup.innerHTML = '';

  const fillFraction = state.goals.cal > 0 ? Math.min(totals.cal / state.goals.cal, 1) : 0;
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
  const entries = getTodayEntries();
  const list = document.getElementById('log-list');
  list.innerHTML = '';

  entries.forEach((entry, index) => {
    const li = document.createElement('li');
    li.className = 'log-item';
    li.innerHTML = `
      <div>
        <div class="log-item-name">${escapeHtml(entry.name)}</div>
        <div class="log-item-macros">P ${entry.protein || 0}g · C ${entry.carbs || 0}g · F ${entry.fat || 0}g</div>
      </div>
      <div class="log-item-right">
        <span class="log-item-cal">${entry.cal} cal</span>
        <button class="log-item-remove" data-index="${index}" aria-label="Remove ${escapeHtml(entry.name)}">×</button>
      </div>
    `;
    list.appendChild(li);
  });

  document.getElementById('log-empty').style.display = entries.length ? 'none' : 'block';

  list.querySelectorAll('.log-item-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.index);
      entries.splice(idx, 1);
      renderAll();
    });
  });
}

function renderSavedMeals() {
  const container = document.getElementById('saved-list');
  const emptyMsg = document.getElementById('saved-empty');
  container.innerHTML = '';

  if (!state.savedMeals.length) {
    emptyMsg.style.display = 'block';
    return;
  }
  emptyMsg.style.display = 'none';

  state.savedMeals.forEach((meal, index) => {
    const chip = document.createElement('div');
    chip.className = 'saved-chip';
    chip.innerHTML = `
      <span class="saved-chip-name">${escapeHtml(meal.name)}</span>
      <span class="saved-chip-cal">${meal.cal} cal</span>
      <button class="saved-chip-add" data-index="${index}" aria-label="Add ${escapeHtml(meal.name)} to today">+</button>
      <button class="saved-chip-remove" data-index="${index}" aria-label="Delete saved meal ${escapeHtml(meal.name)}">×</button>
    `;
    container.appendChild(chip);
  });

  container.querySelectorAll('.saved-chip-add').forEach(btn => {
    btn.addEventListener('click', () => {
      const meal = state.savedMeals[Number(btn.dataset.index)];
      getTodayEntries().push({ ...meal });
      renderAll();
    });
  });

  container.querySelectorAll('.saved-chip-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      state.savedMeals.splice(Number(btn.dataset.index), 1);
      renderAll();
    });
  });
}

function renderAll() {
  renderPlate();
  renderLog();
  renderSavedMeals();
  renderProgress();
  renderLeaderboard();
}

document.getElementById('add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = document.getElementById('food-name').value.trim();
  const cal = Number(document.getElementById('food-cal').value) || 0;
  const protein = Number(document.getElementById('food-protein').value) || 0;
  const carbs = Number(document.getElementById('food-carbs').value) || 0;
  const fat = Number(document.getElementById('food-fat').value) || 0;

  if (!name || cal <= 0) return;

  const newEntry = { name, cal, protein, carbs, fat };
  getTodayEntries().push(newEntry);

  if (document.getElementById('food-save').checked) {
    const alreadySaved = state.savedMeals.some(m => m.name.toLowerCase() === name.toLowerCase());
    if (!alreadySaved) state.savedMeals.push({ ...newEntry });
  }

  renderAll();
  e.target.reset();
  document.getElementById('food-name').focus();
});

document.getElementById('clear-day').addEventListener('click', () => {
  if (!confirm('Clear everything logged today?')) return;
  state.days[todayKey()] = [];
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
  state.goals = {
    cal: Number(document.getElementById('goal-cal').value) || 0,
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
  }
});

function renderGoalGuidance() {
  const guidance = {
    lose: 'A moderate calorie deficit paired with steady protein keeps you full while losing weight sustainably.',
    gain: 'A calorie surplus with balanced carbs and fat supports steady, healthy weight gain.',
    maintain: 'Match your intake to your output — consistency matters more than precision here.',
    muscle: 'Higher protein plus a slight surplus gives your body what it needs to build muscle.',
  };
  const foods = {
    lose: ['Leafy greens', 'Grilled chicken', 'Greek yogurt', 'Berries', 'Lentils'],
    gain: ['Nut butters', 'Whole milk', 'Oats', 'Avocado', 'Salmon'],
    maintain: ['Whole grains', 'Mixed vegetables', 'Lean protein', 'Olive oil'],
    muscle: ['Chicken breast', 'Eggs', 'Cottage cheese', 'Quinoa', 'Salmon'],
  };
  document.getElementById('goal-guidance').textContent = guidance[state.goalType] || guidance.lose;
  document.getElementById('goal-food-pills').innerHTML =
    (foods[state.goalType] || foods.lose).map(f => `<span class="pill">${f}</span>`).join('');
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
function logDbFood(i, filter) {
  const items = foodDb.filter(f => f.name.toLowerCase().includes((filter || '').toLowerCase()));
  getTodayEntries().push({ ...items[i] });
  renderAll();
  alert('Added to today\'s log');
}

// ============================================
// ACCOUNTABILITY — real data only.
// state.accountabilityPartners starts empty. There's no account
// system behind "Invite a partner" yet, so it can't add anyone for
// real — nothing here is invented to make it look populated.
// ============================================
const CALORIE_BUFFER = 50;

function computeStreak() {
  const dates = Object.keys(state.days);
  if (!dates.length) return 0;
  let streak = 0;
  let d = new Date();
  while (true) {
    const key = d.toISOString().slice(0, 10);
    const entries = state.days[key];
    if (!entries || entries.length === 0) break;
    const totalCal = entries.reduce((s, e) => s + (Number(e.cal) || 0), 0);
    const goalCal = state.goals.cal;
    let onGoal;
    if (state.goalType === 'lose') onGoal = totalCal <= goalCal + CALORIE_BUFFER;
    else if (state.goalType === 'gain' || state.goalType === 'muscle') onGoal = totalCal >= goalCal - CALORIE_BUFFER;
    else onGoal = Math.abs(totalCal - goalCal) <= CALORIE_BUFFER;
    if (!onGoal) break;
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function renderLeaderboard() {
  const streak = computeStreak();
  const rows = [{ name: state.displayName || 'you', streak, you: true }, ...state.accountabilityPartners];
  rows.sort((a, b) => b.streak - a.streak);
  document.getElementById('leaderboard-list').innerHTML = rows.map((d, i) => `
    <div class="leader-row ${d.you ? 'partner' : ''}">
      <div class="rank">${i + 1}</div>
      <div class="avatar-sm">${d.name[0].toUpperCase()}</div>
      <div style="flex:1; font-weight:600; font-size:13.5px;">${escapeHtml(d.name)}${d.you ? ' (you)' : ''}</div>
      <div style="font-size:12px; color:var(--ink-soft); font-family:var(--font-mono);">🔥 ${d.streak}d</div>
    </div>`).join('');
}

function renderPartners() {
  const partners = state.accountabilityPartners;
  const listEl = document.getElementById('partner-list');
  const emptyEl = document.getElementById('partner-empty');
  const mgmtEl = document.getElementById('account-partner-mgmt');

  if (!partners.length) {
    listEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'block';
    mgmtEl.innerHTML = '<p class="log-empty" style="padding:0;">No partners yet.</p>';
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';

  const rows = partners.map(p => `
    <div class="leader-row">
      <div class="avatar-sm">${p.name[0].toUpperCase()}</div>
      <div style="flex:1; font-weight:600; font-size:13.5px;">${escapeHtml(p.name)}</div>
      <div style="font-size:12px; color:var(--ink-soft); font-family:var(--font-mono);">🔥 ${p.streak}d</div>
    </div>`).join('');
  listEl.innerHTML = rows;
  mgmtEl.innerHTML = rows;
}

// ============================================
// PROGRESS & HISTORY — real data only
// ============================================
function renderProgress() {
  const streak = computeStreak();
  document.getElementById('progress-streak').innerHTML =
    streak > 0
      ? `<span class="pill">🔥 ${streak}-day streak</span>`
      : `<p class="log-empty" style="padding:4px 0;">No streak yet — hit your calorie goal today to start one.</p>`;

  const dates = Object.keys(state.days).sort().reverse();
  const historyEl = document.getElementById('progress-history');
  const emptyEl = document.getElementById('progress-empty');

  if (!dates.length) {
    historyEl.innerHTML = '';
    emptyEl.style.display = 'block';
    return;
  }
  emptyEl.style.display = 'none';

  historyEl.innerHTML = dates.map(key => {
    const entries = state.days[key];
    const totalCal = entries.reduce((s, e) => s + (Number(e.cal) || 0), 0);
    const label = new Date(key + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `
      <div class="log-item">
        <div class="log-item-name">${label}</div>
        <div class="log-item-cal">${Math.round(totalCal)} / ${state.goals.cal} cal</div>
      </div>`;
  }).join('');
}
