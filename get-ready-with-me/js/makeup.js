// Makeup mode: pick a colour and tap Lips / Cheeks to tint them live on the camera. On-device only.

const PRESETS = [
  // classic reds
  '#c0304f', '#b11226', '#d12e3f', '#e23744', '#8b1a2b', '#a0122f',
  // pinks
  '#e06a86', '#f28ab2', '#ff6f91', '#ff9eb5', '#e75a8a', '#d46a9f',
  // corals / oranges
  '#ff6f61', '#f4795b', '#e2583e', '#ff8c69', '#f08a5d',
  // nudes / browns
  '#b5695a', '#c98a7a', '#a9746e', '#9b5e4e', '#7a4a3a', '#c08497',
  // berries / plums
  '#7a2f4f', '#8e2d6b', '#5e2750', '#9b2d6b', '#6d1f3e',
  // bold
  '#a0124f', '#d4006a', '#c2185b', '#7b1fa2', '#5c2a9d',
];

const STYLES = `
.mkp{position:absolute;left:0;right:0;bottom:0;padding:14px 16px 16px;display:flex;flex-direction:column;gap:10px;
  background:linear-gradient(transparent,rgba(5,5,7,.84) 40%);color:#fff;z-index:6}
.mkp[hidden]{display:none}
.mkp-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.mkp-label{font-size:.8rem;opacity:.8}
.mkp input[type=color]{width:38px;height:30px;padding:0;border:1px solid rgba(255,255,255,.3);border-radius:8px;background:none;cursor:pointer}
.mkp-swatches{display:flex;flex-wrap:wrap;gap:6px;max-height:88px;overflow-y:auto;flex:1 1 100%}
.mkp-range{flex:1;min-width:140px;accent-color:#e8dcc4}
.mkp-swatch{width:26px;height:26px;border-radius:50%;border:2px solid rgba(255,255,255,.35);cursor:pointer;padding:0}
.mkp-region[aria-pressed="true"]{outline:2px solid #e8dcc4;outline-offset:1px}
`;

export function initMakeup({ stage, ensureCamera }) {
  if (!document.getElementById('mkp-styles')) {
    const s = document.createElement('style'); s.id = 'mkp-styles'; s.textContent = STYLES;
    document.head.appendChild(s);
  }
  stage.makeup = stage.makeup || { lips: null, cheeks: null, intensity: 0.55 };
  if (stage.makeup.intensity == null) stage.makeup.intensity = 0.55;
  const wrap = document.querySelector('.stage-wrap');
  if (!wrap) return { open() {} };

  const ov = document.createElement('div');
  ov.className = 'mkp'; ov.hidden = true;
  ov.innerHTML =
    '<div class="mkp-row">' +
      '<span class="mkp-label">Colour</span>' +
      '<input type="color" id="mkp-color" value="#c0304f" aria-label="Makeup colour">' +
      '<span class="mkp-swatches" id="mkp-sw"></span>' +
    '</div>' +
    '<div class="mkp-row">' +
      '<span class="mkp-label">Intensity</span>' +
      '<input type="range" id="mkp-intensity" class="mkp-range" min="0" max="100" value="55" aria-label="Makeup intensity">' +
    '</div>' +
    '<div class="mkp-row">' +
      '<button class="control mkp-region" type="button" data-region="lips" aria-pressed="false">Lips</button>' +
      '<button class="control mkp-region" type="button" data-region="cheeks" aria-pressed="false">Cheeks</button>' +
      '<button class="control" type="button" id="mkp-clear">Clear</button>' +
      '<button class="control" type="button" id="mkp-done">Done</button>' +
    '</div>';
  wrap.appendChild(ov);

  const colorEl = ov.querySelector('#mkp-color');
  const sw = ov.querySelector('#mkp-sw');
  PRESETS.forEach((c) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'mkp-swatch'; b.style.background = c; b.setAttribute('aria-label', 'Colour ' + c);
    b.addEventListener('click', () => { colorEl.value = c; applyColor(); });
    sw.appendChild(b);
  });

  function refreshRegions() {
    ov.querySelectorAll('.mkp-region').forEach((b) => b.setAttribute('aria-pressed', String(!!stage.makeup[b.dataset.region])));
  }
  function applyColor() {                       // recolour whichever regions are currently on
    const c = colorEl.value;
    if (stage.makeup.lips) stage.makeup.lips = c;
    if (stage.makeup.cheeks) stage.makeup.cheeks = c;
  }
  async function needCamera() { if (!stage.sourceSize()) { try { await ensureCamera(); } catch (_) {} } }

  colorEl.addEventListener('input', applyColor);
  const intensityEl = ov.querySelector('#mkp-intensity');
  intensityEl.value = Math.round(stage.makeup.intensity * 100);
  intensityEl.addEventListener('input', (e) => { stage.makeup.intensity = (+e.target.value) / 100; });
  ov.querySelectorAll('.mkp-region').forEach((b) => b.addEventListener('click', async () => {
    const r = b.dataset.region;
    stage.makeup[r] = stage.makeup[r] ? null : colorEl.value;   // toggle this region on/off
    refreshRegions();
    if (stage.makeup.lips || stage.makeup.cheeks) await needCamera();
  }));
  ov.querySelector('#mkp-clear').addEventListener('click', () => { stage.makeup.lips = null; stage.makeup.cheeks = null; refreshRegions(); });
  ov.querySelector('#mkp-done').addEventListener('click', () => { ov.hidden = true; });

  async function open() {
    ov.hidden = !ov.hidden;
    if (!ov.hidden) { refreshRegions(); await needCamera(); }
  }

  const controls = document.getElementById('controls');
  if (controls) {
    const btn = document.createElement('button');
    btn.className = 'control'; btn.type = 'button'; btn.id = 'mkp-open';
    btn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 21V10l4-5 4 5v11z"/><path d="M8 14h8"/></svg><span>Makeup</span>';
    btn.addEventListener('click', open);
    controls.insertBefore(btn, controls.firstChild);
  }
  return { open };
}
