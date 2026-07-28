// ============================================
// NutriSync — app logic
// NOTE: this preview keeps everything in memory (no localStorage),
// because files opened as an in-chat preview can't use browser storage.
// See the message below the file list for what that means for you.
// ============================================

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
// AUTH
// ============================================
let isSignup = false;
function toggleAuthMode() {
  isSignup = !isSignup;
  document.getElementById('login-form').style.display = isSignup ? 'none' : 'block';
  document.getElementById('signup-form').style.display = isSignup ? 'block' : 'none';
  document.getElementById('auth-subtitle').textContent = isSignup ? 'Create your account to get started.' : 'Log in to see your plate.';
}
function handleLogin() {
  const email = document.getElementById('login-email').value.trim();
  state.isAdmin = email.toLowerCase().includes('admin');
  enterApp();
}
function handleSignup() {
  const name = document.getElementById('signup-name').value.trim();
  document.getElementById('ob-name').value = name;
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('onboarding-screen').style.display = 'flex';
}
function logOut() {
  document.getElementById('app-shell').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
}

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
    enterApp();
  }
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
  renderAll();
  renderGoalGuidance();
  renderFoodDb();
  renderLeaderboard();
  renderPartners();
}

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
document.getElementById('goals-form').addEventListener('submit', (e) => {
  e.preventDefault();
  state.goals = {
    cal: Number(document.getElementById('goal-cal').value) || 0,
    protein: Number(document.getElementById('goal-protein').value) || 0,
    carbs: Number(document.getElementById('goal-carbs').value) || 0,
    fat: Number(document.getElementById('goal-fat').value) || 0,
  };
  renderAll();
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
// ACCOUNTABILITY (mock data — no real backend)
// ============================================
function renderLeaderboard() {
  const data = [
    { name: 'you', streak: 24, you: true },
    { name: 'sam_runs', streak: 18 },
    { name: 'priya_k', streak: 15 },
    { name: 'maya_g', streak: 11 },
    { name: 'theo_b', streak: 9 },
  ];
  document.getElementById('leaderboard-list').innerHTML = data.map((d, i) => `
    <div class="leader-row ${d.you ? 'partner' : ''}">
      <div class="rank">${i + 1}</div>
      <div class="avatar-sm">${d.name[0].toUpperCase()}</div>
      <div style="flex:1; font-weight:600; font-size:13.5px;">${d.name}${d.you ? ' (you)' : ''}</div>
      <div style="font-size:12px; color:var(--ink-soft); font-family:var(--font-mono);">🔥 ${d.streak}d</div>
    </div>`).join('');
}
function renderPartners() {
  const partners = ['sam_runs', 'priya_k'];
  const rows = partners.map(p => `
    <div class="leader-row">
      <div class="avatar-sm">${p[0].toUpperCase()}</div>
      <div style="flex:1; font-weight:600; font-size:13.5px;">${p}</div>
      <div style="font-size:12px; color:var(--ink-soft);">On goal today ✅</div>
    </div>`).join('');
  document.getElementById('partner-list').innerHTML = rows;
  document.getElementById('account-partner-mgmt').innerHTML = rows;
}
