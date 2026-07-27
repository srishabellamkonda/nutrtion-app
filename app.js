// ============================================
// NutriSync — app logic
// Data persists in localStorage, per device.
// ============================================

const STORAGE_KEY = 'nutrisync_state_v1';
const RADIUS = 150;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const MACROS = [
  { key: 'protein', label: 'Protein', color: 'var(--matcha)', hex: '#4B7752', calPerGram: 4 },
  { key: 'carbs',   label: 'Carbs',   color: 'var(--citrus)', hex: '#E8873A', calPerGram: 4 },
  { key: 'fat',     label: 'Fat',     color: 'var(--berry)',  hex: '#A8456B', calPerGram: 9 },
];

const todayKey = () => new Date().toISOString().slice(0, 10);

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  const defaultState = {
    goals: { cal: 2000, protein: 120, carbs: 220, fat: 65 },
    days: {} // { '2026-07-27': [ {name, cal, protein, carbs, fat}, ... ] }
  };
  if (!raw) return defaultState;
  try {
    const parsed = JSON.parse(raw);
    return { ...defaultState, ...parsed, goals: { ...defaultState.goals, ...(parsed.goals || {}) } };
  } catch {
    return defaultState;
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

let state = loadState();

function getTodayEntries() {
  const key = todayKey();
  if (!state.days[key]) state.days[key] = [];
  return state.days[key];
}

// ---------- date display ----------
document.getElementById('today-date').textContent = new Date().toLocaleDateString(undefined, {
  weekday: 'long', month: 'long', day: 'numeric'
});

// ---------- render: plate ----------
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

  // macro calorie contributions, used to segment the plate ring
  const macroCals = MACROS.map(m => (Number(totals[m.key]) || 0) * m.calPerGram);
  const macroCalSum = macroCals.reduce((a, b) => a + b, 0);

  const arcsGroup = document.getElementById('plate-arcs');
  arcsGroup.innerHTML = '';

  // total fill = min(total cal / goal, 1) of the ring, split proportionally among macros
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

// ---------- render: macro legend ----------
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
      <div class="macro-name">
        <span class="macro-dot" style="background:${m.hex}"></span>
        ${m.label}
      </div>
      <div class="macro-value">${value}g <span class="macro-goal">/ ${goal}g</span></div>
      <div class="macro-bar-track">
        <div class="macro-bar-fill" style="width:${pct}%; background:${m.hex}"></div>
      </div>
    `;
    container.appendChild(card);
  });
}

// ---------- render: log ----------
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

  list.querySelectorAll('.log-item-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.index);
      entries.splice(idx, 1);
      saveState();
      renderAll();
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderAll() {
  renderPlate();
  renderLog();
}

// ---------- add food form ----------
document.getElementById('add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = document.getElementById('food-name').value.trim();
  const cal = Number(document.getElementById('food-cal').value) || 0;
  const protein = Number(document.getElementById('food-protein').value) || 0;
  const carbs = Number(document.getElementById('food-carbs').value) || 0;
  const fat = Number(document.getElementById('food-fat').value) || 0;

  if (!name || cal <= 0) return;

  getTodayEntries().push({ name, cal, protein, carbs, fat });
  saveState();
  renderAll();

  e.target.reset();
  document.getElementById('food-name').focus();
});

// ---------- clear day ----------
document.getElementById('clear-day').addEventListener('click', () => {
  if (!confirm('Clear everything logged today?')) return;
  state.days[todayKey()] = [];
  saveState();
  renderAll();
});

// ---------- goals form ----------
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
  saveState();
  renderAll();
});

// ---------- init ----------
fillGoalsForm();
renderAll();
