const KEY = 'launcher.v1';
const DOCK_SIZE = 4;
const LONG_PRESS_MS = 480;
const DRAG_START_PX = 6;
const OPEN_FAIL_MS = 2500;
const BLOCKED_SCHEMES = ['javascript', 'data', 'vbscript', 'file', 'blob'];

const WALLS = [
  'linear-gradient(160deg, #1b2a6b, #5b2a86 55%, #c2476b)',
  'linear-gradient(165deg, #06121f, #0c3b4f 55%, #16806f)',
  'linear-gradient(165deg, #2a1206, #8a3412 55%, #e0962f)',
  'linear-gradient(165deg, #101014, #26262e 60%, #4a4a58)',
  'linear-gradient(165deg, #0b1a12, #1d4a33 55%, #6b8f3a)',
  'linear-gradient(165deg, #1a0b24, #47206f 50%, #1f6fb5)',
];

// name, link, icon, colour
const CATALOG = [
  ['Phone', 'mobilephone://', '📞', '#31c75a'],
  ['Messages', 'sms:', '💬', '#31c75a'],
  ['Safari', 'x-safari-https://www.google.com', '🧭', '#1c8ef2'],
  ['Mail', 'message://', '✉️', '#1c8ef2'],
  ['Music', 'music://', '🎵', '#fa3b55'],
  ['Maps', 'maps://', '🗺️', '#4cb56a'],
  ['Calendar', 'calshow://', '📅', '#f4f4f6'],
  ['Notes', 'mobilenotes://', '📝', '#f6c945'],
  ['Reminders', 'x-apple-reminderkit://', '☑️', '#f4f4f6'],
  ['Photos', 'photos-redirect://', '🌸', '#f4f4f6'],
  ['Clock', 'clock-worldclock://', '🕒', '#1b1b20'],
  ['Weather', 'weather://', '⛅', '#2d8df0'],
  ['Calculator', 'calc://', '🧮', '#2b2b31'],
  ['Files', 'shareddocuments://', '📁', '#1c8ef2'],
  ['Wallet', 'shoebox://', '💳', '#1b1b20'],
  ['Health', 'x-apple-health://', '❤️', '#f4f4f6'],
  ['Find My', 'findmy://', '📍', '#31c75a'],
  ['App Store', 'itms-apps://', '🅰️', '#1c8ef2'],
  ['Podcasts', 'podcasts://', '🎙️', '#9a4be0'],
  ['Books', 'ibooks://', '📚', '#f28a1c'],
  ['Shortcuts', 'shortcuts://', '⚡', '#3b4bd8'],
  ['WhatsApp', 'whatsapp://', 'W', '#25d366'],
  ['Instagram', 'instagram://', 'I', '#d6316f'],
  ['X', 'twitter://', 'X', '#111114'],
  ['YouTube', 'youtube://', 'Y', '#f00f1e'],
  ['Spotify', 'spotify://', 'S', '#1db954'],
  ['Gmail', 'googlegmail://', 'G', '#d9402f'],
  ['Google Maps', 'comgooglemaps://', 'M', '#2f9e5b'],
  ['Chrome', 'googlechrome://', 'C', '#3a7ff0'],
  ['Telegram', 'tg://', 'T', '#2aa3df'],
  ['Facebook', 'fb://', 'f', '#1877f2'],
  ['Threads', 'barcelona://', '@', '#111114'],
  ['Snapchat', 'snapchat://', 'S', '#fffc00'],
  ['LinkedIn', 'linkedin://', 'in', '#0a66c2'],
  ['Reddit', 'reddit://', 'R', '#ff4500'],
  ['Netflix', 'nflx://', 'N', '#d81f26'],
  ['Discord', 'discord://', 'D', '#5865f2'],
  ['Slack', 'slack://', 'S', '#4a154b'],
  ['Zoom', 'zoomus://', 'Z', '#2d8cff'],
  ['Outlook', 'ms-outlook://', 'O', '#0f6cbd'],
  ['Teams', 'msteams://', 'T', '#5b5fc7'],
  ['Notion', 'notion://', 'N', '#f4f4f6'],
  ['ChatGPT', 'chatgpt://', 'G', '#10a37f'],
  ['Claude', 'claude://', 'C', '#d97757'],
  ['Uber', 'uber://', 'U', '#111114'],
  ['Amazon', 'com.amazon.mobile.shopping://', 'a', '#f19e39'],
  ['Swiggy', 'swiggy://', 'S', '#fc8019'],
  ['Zomato', 'zomato://', 'Z', '#e23744'],
  ['PhonePe', 'phonepe://', 'P', '#5f259f'],
  ['Paytm', 'paytmmp://', 'P', '#00baf2'],
  ['Google Pay', 'gpay://', 'G', '#3a7ff0'],
];

const DEFAULT_APPS = [
  'Phone', 'Messages', 'Safari', 'Spotify',
  'WhatsApp', 'Instagram', 'X', 'YouTube',
  'Gmail', 'Maps', 'Calendar', 'Photos',
  'Notes', 'Clock', 'Shortcuts', 'App Store',
];

const $ = (selector) => document.querySelector(selector);
const dom = {
  grid: $('#grid'), dock: $('#dock'), scroller: $('#scroller'), q: $('#q'),
  web: $('#webResult'), hint: $('#editHint'), toast: $('#toast'),
  normal: $('#normalControls'), edit: $('#editControls'),
  catalog: $('#catalogSheet'), catalogQ: $('#catalogQ'), catalogList: $('#catalogList'),
  form: $('#formSheet'), fName: $('#fName'), fLink: $('#fLink'), fGlyph: $('#fGlyph'),
  fColor: $('#fColor'), fError: $('#fError'), fRemove: $('#fRemove'), fTitle: $('#formTitle'),
};

const tiles = new Map();
let editing = false;
let formTargetId = null;

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function fromCatalog([name, url, glyph, color]) {
  return { id: newId(), name, url, glyph, color };
}

// Accepts a full link, a bare website, or the name of an iOS Shortcut.
function normalizeLink(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  const scheme = value.match(/^([a-z][a-z0-9+.-]*):/i);
  if (scheme) return BLOCKED_SCHEMES.includes(scheme[1].toLowerCase()) ? null : value;
  if (/^\S+\.[a-z]{2,}(\/\S*)?$/i.test(value)) return `https://${value}`;
  return `shortcuts://run-shortcut?name=${encodeURIComponent(value)}`;
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved && Array.isArray(saved.apps)) {
      return {
        wall: Number(saved.wall) || 0,
        apps: saved.apps.filter((a) => a && a.id && a.name && normalizeLink(a.url)),
      };
    }
  } catch { /* unreadable storage falls through to the defaults */ }
  const byName = new Map(CATALOG.map((entry) => [entry[0], entry]));
  return { wall: 0, apps: DEFAULT_APPS.map((name) => fromCatalog(byName.get(name))) };
}

const state = load();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    showToast("Couldn't save your changes on this device.");
  }
}

function inkFor(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  if (Number.isNaN(n)) return '#fff';
  const luminance = (0.299 * (n >> 16 & 255) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255;
  return luminance > 0.68 ? '#15171f' : '#fff';
}

function makeIcon(app) {
  const icon = document.createElement('span');
  icon.className = 'icon';
  icon.style.backgroundColor = app.color;
  icon.style.color = inkFor(app.color);
  icon.textContent = app.glyph || app.name.slice(0, 1).toUpperCase();
  return icon;
}

function makeTile(app) {
  const tile = document.createElement('a');
  tile.className = 'tile';
  tile.href = app.url;
  tile.draggable = false;
  tile.dataset.id = app.id;
  tile.setAttribute('aria-label', app.name);
  if (/^https?:/i.test(app.url)) {
    tile.target = '_blank';
    tile.rel = 'noopener';
  }
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = app.name;
  tile.append(makeIcon(app), label);
  return tile;
}

function syncChildren(parent, ids) {
  ids.forEach((id, index) => {
    const tile = tiles.get(id);
    if (parent.children[index] !== tile) parent.insertBefore(tile, parent.children[index] ?? null);
  });
}

// Moves existing nodes rather than rebuilding them, so a drag in progress keeps its touch.
function placeTiles(dockCount = DOCK_SIZE) {
  const ids = state.apps.map((app) => app.id);
  syncChildren(dom.dock, ids.slice(0, dockCount));
  syncChildren(dom.grid, ids.slice(dockCount));
}

function render() {
  tiles.clear();
  dom.grid.replaceChildren();
  dom.dock.replaceChildren();
  state.apps.forEach((app) => tiles.set(app.id, makeTile(app)));
  placeTiles();
  applySearch();
}

function applyWall() {
  document.documentElement.style.setProperty('--wall', WALLS[state.wall % WALLS.length]);
}

function applySearch() {
  const raw = dom.q.value.trim();
  const needle = raw.toLowerCase();
  const searching = needle.length > 0;
  dom.dock.hidden = searching;
  placeTiles(searching ? 0 : DOCK_SIZE);
  state.apps.forEach((app) => {
    tiles.get(app.id).hidden = searching && !app.name.toLowerCase().includes(needle);
  });
  dom.web.hidden = !searching;
  if (searching) {
    dom.web.href = `https://www.google.com/search?q=${encodeURIComponent(raw)}`;
    dom.web.textContent = `Search the web for “${raw}”`;
  }
}

function clearSearch() {
  if (!dom.q.value) return;
  dom.q.value = '';
  applySearch();
}

let toastTimer;
function showToast(message) {
  clearTimeout(toastTimer);
  dom.toast.textContent = message;
  dom.toast.hidden = false;
  toastTimer = setTimeout(() => { dom.toast.hidden = true; }, 4000);
}

// iOS gives no signal that a link failed, so assume it did if the page never loses focus.
function watchForFailedOpen(app) {
  if (/^https?:/i.test(app.url)) return;
  let timer = 0;
  const stop = () => {
    clearTimeout(timer);
    window.removeEventListener('pagehide', stop);
    window.removeEventListener('blur', stop);
    document.removeEventListener('visibilitychange', stop);
  };
  window.addEventListener('pagehide', stop);
  window.addEventListener('blur', stop);
  document.addEventListener('visibilitychange', stop);
  timer = setTimeout(() => {
    stop();
    if (!document.hidden) showToast(`${app.name} didn't open. It may not be installed, or its link needs changing in Edit.`);
  }, OPEN_FAIL_MS);
}

function setEditing(next) {
  editing = next;
  document.body.classList.toggle('editing', next);
  dom.normal.hidden = next;
  dom.edit.hidden = !next;
  dom.hint.hidden = !next;
  if (next) {
    dom.q.blur();
    clearSearch();
  }
}

function findApp(id) {
  return state.apps.find((app) => app.id === id);
}

function moveApp(id, beforeId) {
  const from = state.apps.findIndex((app) => app.id === id);
  const to = state.apps.findIndex((app) => app.id === beforeId);
  if (from < 0 || to < 0 || from === to) return;
  const [app] = state.apps.splice(from, 1);
  state.apps.splice(to, 0, app);
  placeTiles();
}

/* Long press enters edit mode; in edit mode a pointer drag reorders. */
let press = null;
let suppressClick = false;

function endPress() {
  if (!press) return;
  clearTimeout(press.timer);
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', onPointerUp);
  press.tile.classList.remove('dragging');
  press = null;
}

function autoScroll(y) {
  const box = dom.scroller.getBoundingClientRect();
  if (y < box.top + 40) dom.scroller.scrollBy(0, -10);
  else if (y > box.bottom - 40 && y < box.bottom + 20) dom.scroller.scrollBy(0, 10);
}

function onPointerMove(event) {
  if (!press) return;
  const distance = Math.hypot(event.clientX - press.x, event.clientY - press.y);
  if (!editing) {
    if (distance > DRAG_START_PX * 2) endPress();
    return;
  }
  if (!press.dragging) {
    if (distance < DRAG_START_PX) return;
    press.dragging = true;
    press.tile.classList.add('dragging');
    suppressClick = true;
  }
  event.preventDefault();
  autoScroll(event.clientY);
  const under = document.elementFromPoint(event.clientX, event.clientY)?.closest('.tile');
  if (under && under !== press.tile) moveApp(press.tile.dataset.id, under.dataset.id);
}

function onPointerUp() {
  if (!press) return;
  const dragged = press.dragging;
  endPress();
  if (dragged) save();
}

document.addEventListener('pointerdown', (event) => {
  const tile = event.target.closest('.tile');
  if (!tile || event.button > 0) return;
  endPress();
  suppressClick = false;
  press = { tile, x: event.clientX, y: event.clientY, dragging: false, timer: 0 };
  if (!editing) {
    press.timer = setTimeout(() => {
      suppressClick = true;
      setEditing(true);
      endPress();
    }, LONG_PRESS_MS);
  }
  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
});

document.addEventListener('click', (event) => {
  const tile = event.target.closest('.tile');
  if (!tile) return;
  if (suppressClick) {
    suppressClick = false;
    event.preventDefault();
    return;
  }
  if (editing) {
    event.preventDefault();
    openForm(findApp(tile.dataset.id));
    return;
  }
  watchForFailedOpen(findApp(tile.dataset.id));
});

document.addEventListener('contextmenu', (event) => {
  if (event.target.closest('.tile')) event.preventDefault();
});

/* Add sheet */
function renderCatalog() {
  const needle = dom.catalogQ.value.trim().toLowerCase();
  const added = new Set(state.apps.map((app) => app.url));
  const rows = CATALOG.filter(([name]) => name.toLowerCase().includes(needle)).map((entry) => {
    const [name, url, glyph, color] = entry;
    const row = document.createElement('li');
    const label = document.createElement('span');
    label.className = 'name';
    label.textContent = name;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pill';
    button.disabled = added.has(url);
    button.textContent = button.disabled ? 'Added' : 'Add';
    button.setAttribute('aria-label', `${button.textContent} ${name}`);
    button.addEventListener('click', () => {
      state.apps.push(fromCatalog(entry));
      save();
      render();
      renderCatalog();
    });
    row.append(makeIcon({ name, glyph, color }), label, button);
    return row;
  });
  dom.catalogList.replaceChildren(...rows);
}

function openCatalog() {
  dom.catalogQ.value = '';
  renderCatalog();
  dom.catalog.showModal();
}

/* Add-your-own and edit form */
function openForm(app) {
  formTargetId = app ? app.id : null;
  dom.fTitle.textContent = app ? `Edit ${app.name}` : 'Add your own';
  dom.fName.value = app ? app.name : '';
  dom.fLink.value = app ? app.url : '';
  dom.fGlyph.value = app ? app.glyph : '';
  dom.fColor.value = app && /^#[0-9a-f]{6}$/i.test(app.color) ? app.color : '#4f6ef7';
  dom.fRemove.hidden = !app;
  dom.fError.hidden = true;
  dom.form.showModal();
}

function formError(message) {
  dom.fError.textContent = message;
  dom.fError.hidden = false;
}

$('#appForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = dom.fName.value.trim();
  const url = normalizeLink(dom.fLink.value);
  if (!name) return formError('Give it a name.');
  if (!url) return formError('Enter an app link, a website, or a Shortcut name.');
  const fields = { name, url, glyph: dom.fGlyph.value.trim(), color: dom.fColor.value };
  const app = findApp(formTargetId);
  if (app) Object.assign(app, fields);
  else state.apps.push({ id: newId(), ...fields });
  save();
  render();
  dom.form.close();
  dom.catalog.close();
});

dom.fRemove.addEventListener('click', () => {
  state.apps = state.apps.filter((app) => app.id !== formTargetId);
  save();
  render();
  dom.form.close();
});

/* Controls */
$('#editBtn').addEventListener('click', () => setEditing(true));
$('#doneBtn').addEventListener('click', () => setEditing(false));
$('#addBtn').addEventListener('click', openCatalog);
$('#wallBtn').addEventListener('click', () => {
  state.wall = (state.wall + 1) % WALLS.length;
  applyWall();
  save();
});
$('#catalogClose').addEventListener('click', () => dom.catalog.close());
$('#formClose').addEventListener('click', () => dom.form.close());
$('#customBtn').addEventListener('click', () => openForm(null));
dom.catalogQ.addEventListener('input', renderCatalog);

dom.q.addEventListener('input', applySearch);
$('#searchForm').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!dom.q.value.trim()) return;
  const first = [...dom.grid.children].find((tile) => !tile.hidden);
  (first ?? dom.web).click();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearSearch();
});

/* Clock */
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

function tick() {
  const now = new Date();
  $('#time').textContent = timeFormat.format(now);
  $('#date').textContent = dateFormat.format(now);
  setTimeout(tick, 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()));
}

/* Install prompt, shown only in a normal browser tab */
const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const banner = $('#installBanner');
banner.hidden = standalone;
$('#installOk').addEventListener('click', () => { banner.hidden = true; });

applyWall();
render();
tick();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* the app still works online */ });
}
