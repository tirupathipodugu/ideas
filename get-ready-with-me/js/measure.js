// One-time "Fit to me" onboarding: measures the user's face and hand from the camera so accessories
// can be scaled to their real proportions. Everything stays on the device; nothing is uploaded.

const KEY = 'grwm:fit';

export function loadFit() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
function saveFit(f) { try { localStorage.setItem(KEY, JSON.stringify(f)); } catch {} }

const STYLES = `
.fitm{position:absolute;left:0;right:0;bottom:0;padding:16px 16px 18px;display:flex;flex-direction:column;gap:9px;
  background:linear-gradient(transparent,rgba(5,5,7,.82) 38%);color:#fff;z-index:6}
.fitm[hidden]{display:none}
.fitm-dots{display:flex;gap:6px}
.fitm-dot{width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,.28)}
.fitm-dot.on{background:#e8dcc4}
.fitm-step{font-size:1.05rem;font-weight:600;margin:0}
.fitm-hint{font-size:.85rem;opacity:.82;margin:0;min-height:1.1em}
.fitm-hint.ok{color:#8fe3a8;opacity:1}
.fitm-hint.warn{color:#f0b37a;opacity:1}
.fitm-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:2px}
`;

/**
 * @param {object} o
 * @param {import('./tryon.js').Stage} o.stage
 * @param {() => Promise<void>} o.ensureCamera  start the live camera if it is not already on
 * @param {(fit:object)=>void} [o.onDone]
 */
export function initMeasure({ stage, ensureCamera, onDone }) {
  if (!document.getElementById('fitm-styles')) {
    const s = document.createElement('style'); s.id = 'fitm-styles'; s.textContent = STYLES;
    document.head.appendChild(s);
  }
  const wrap = document.querySelector('.stage-wrap');
  if (!wrap) return { open() {} };

  const ov = document.createElement('div');
  ov.className = 'fitm'; ov.hidden = true;
  ov.innerHTML =
    '<div class="fitm-dots"><span class="fitm-dot"></span><span class="fitm-dot"></span></div>' +
    '<p class="fitm-step"></p>' +
    '<p class="fitm-hint"></p>' +
    '<div class="fitm-row">' +
      '<button class="button primary" id="fitm-capture" type="button">Capture</button>' +
      '<button class="control" id="fitm-skip" type="button"><span>Skip</span></button>' +
    '</div>';
  wrap.appendChild(ov);

  const stepEl = ov.querySelector('.fitm-step');
  const hintEl = ov.querySelector('.fitm-hint');
  const dots = [...ov.querySelectorAll('.fitm-dot')];
  const captureBtn = ov.querySelector('#fitm-capture');

  const STEPS = [
    { kind: 'face', title: 'Look at the camera', hint: 'Face the camera straight on, then tap Capture.' },
    { kind: 'hand', title: 'Show the back of your hand', hint: 'Hold your hand up, back toward the camera, then tap Capture.' },
  ];
  const result = {};
  let i = 0;

  const setHint = (text, tone = '') => { hintEl.textContent = text; hintEl.className = 'fitm-hint' + (tone ? ' ' + tone : ''); };
  function render() {
    const s = STEPS[i];
    stepEl.textContent = s.title;
    setHint(s.hint);
    dots.forEach((d, k) => d.classList.toggle('on', k <= i));
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function sample(kind) {
    const reads = [];
    for (let n = 0; n < 6; n++) {
      const m = await stage.measure(kind);
      if (m) reads.push(m);
      await wait(120);
    }
    if (reads.length < 3) return null;
    const avg = { kind };
    for (const key of Object.keys(reads[0])) {
      if (key === 'kind') continue;
      avg[key] = reads.reduce((a, r) => a + r[key], 0) / reads.length;
    }
    return avg;
  }

  captureBtn.addEventListener('click', async () => {
    const s = STEPS[i];
    captureBtn.disabled = true;
    setHint('Measuring…');
    const m = await sample(s.kind);
    captureBtn.disabled = false;
    if (!m) {
      setHint(s.kind === 'hand'
        ? "Couldn't see your hand — hold it up with the back facing the camera, then try again."
        : "Couldn't find your face — face the camera, then try again.", 'warn');
      return;
    }
    result[s.kind] = m;
    i++;
    if (i >= STEPS.length) finish();
    else render();
  });
  ov.querySelector('#fitm-skip').addEventListener('click', () => { ov.hidden = true; });

  function finish() {
    const fit = { at: Date.now(), face: result.face || null, hand: result.hand || null };
    saveFit(fit);
    stage.userFit = fit;
    const label = document.getElementById('fitme-label');
    if (label) label.textContent = 'Re-measure';
    ov.hidden = true;
    if (onDone) onDone(fit);
  }

  async function open() {
    i = 0; render(); ov.hidden = false;
    if (!stage.sourceSize()) {
      setHint('Starting camera…');
      try { await ensureCamera(); } catch {}
      for (let n = 0; n < 20 && !stage.sourceSize(); n++) await wait(150);  // wait for the first frame
      render();
    }
  }

  // Add a "Fit to me" button to the try-on controls.
  const controls = document.getElementById('controls');
  if (controls) {
    const btn = document.createElement('button');
    btn.className = 'control'; btn.id = 'fitme'; btn.type = 'button';
    btn.innerHTML =
      '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/>' +
      '<path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg><span id="fitme-label">Fit to me</span>';
    btn.addEventListener('click', open);
    controls.insertBefore(btn, controls.firstChild);
    if (loadFit()) { const l = btn.querySelector('#fitme-label'); if (l) l.textContent = 'Re-measure'; }
  }

  return { open };
}
