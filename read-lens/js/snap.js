// Snap: take one sharp photo of the page, show it still with the key lines highlighted.
// Swipe up -> the highlights as a list. Swipe left -> meanings of the hard words on the page.
// Tapping an item flashes it on the photo. A still photo can't drift, so highlights sit exactly
// on the printed lines.
import { buildText, summarize } from './summarize.js';
import { define, isHardWord, loadCommon } from './words.js';

const $ = (id) => document.getElementById(id);
const HI = '255, 216, 77';

export function initSnap({ capture, ocr, sound, flash, onOpen, onClose }) {
  const view = $('snapView'), cv = $('snapCanvas'), g = cv.getContext('2d');
  const hl = $('hlSheet'), wd = $('wordSheet');
  let img = null, page = null, pulse = null, raf = 0;

  // ---------- capture + read ----------
  async function snap() {
    sound.ready();
    onOpen();
    view.hidden = false;
    hl.classList.remove('open'); wd.classList.remove('open');
    page = null; img = null;
    setState('Hold steady…');
    $('hlList').innerHTML = ''; $('wordList').innerHTML = '';
    const shot = await capture(700); // sharpest frame over ~0.7 s
    if (!shot) { setState('Camera not ready'); return; }
    img = shot;
    sound.shutter(); flash();
    draw();
    setState('Reading the page…');
    try {
      const gray = document.createElement('canvas');
      gray.width = img.width; gray.height = img.height;
      const gg = gray.getContext('2d');
      gg.filter = 'grayscale(1) contrast(1.25)';
      gg.drawImage(img, 0, 0);
      const [data] = await Promise.all([ocr(gray), loadCommon()]);
      page = readPage(data.lines || []);
    } catch (e) { console.error(e); }
    if (!page) { setState('Couldn’t find text. Tap ✕ and try closer.'); return; }
    setState(`${page.keys.length} key line${page.keys.length === 1 ? '' : 's'} highlighted`);
    sound.found();
    fillHighlights();
    fillWords();
    draw();
  }

  function readPage(lines) {
    const { text, words } = buildText(lines);
    if (text.length < 40) return null;
    const { picks } = summarize(text);
    // One highlight rect per printed line a key sentence crosses.
    const byLine = new Map();
    words.forEach((w) => { if (!byLine.has(w.line)) byLine.set(w.line, []); byLine.get(w.line).push(w); });
    const keys = picks.map((p) => {
      const rects = [];
      byLine.forEach((ws) => {
        const inside = ws.filter((w) => w.start >= p.start && w.end <= p.end + 1);
        if (inside.length) rects.push(bounds(inside.map((w) => w.bbox)));
      });
      return { text: text.slice(p.start, p.end).replace(/\s+/g, ' ').trim(), rects };
    }).filter((k) => k.rects.length);
    // Hard words: every word worth explaining, with each place it appears.
    const occ = new Map();
    words.forEach((w) => {
      const t = text.slice(w.start, w.end).toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, '');
      if (!isHardWord(t)) return;
      if (!occ.has(t)) occ.set(t, []);
      occ.get(t).push(w.bbox);
    });
    const hard = [...occ.entries()].map(([word, boxes]) => ({ word, boxes, def: undefined })).slice(0, 30);
    return { text, keys, hard };
  }
  const bounds = (bs) => ({ x0: Math.min(...bs.map((b) => b.x0)), y0: Math.min(...bs.map((b) => b.y0)), x1: Math.max(...bs.map((b) => b.x1)), y1: Math.max(...bs.map((b) => b.y1)) });

  // ---------- panels ----------
  function fillHighlights() {
    const ol = $('hlList');
    ol.innerHTML = '';
    if (!page.keys.length) { ol.innerHTML = '<li class="empty">No key lines found on this page.</li>'; return; }
    page.keys.forEach((k, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = k.text;
      b.addEventListener('click', () => { closePanels(); show(k.rects); });
      li.append(b); ol.append(li);
    });
  }
  function fillWords() {
    const ul = $('wordList');
    ul.innerHTML = '';
    if (!page.hard.length) { ul.innerHTML = '<li class="empty">No hard words on this page.</li>'; return; }
    page.hard.forEach((h) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      const w = document.createElement('b'); w.textContent = h.word;
      const d = document.createElement('span'); d.textContent = 'Looking up…'; d.className = 'muted';
      b.append(w, d);
      b.addEventListener('click', () => { closePanels(); show(h.boxes); });
      li.append(b); ul.append(li);
      h.el = { li, d };
    });
    // Look the words up a few at a time; words with no dictionary entry are dropped from the list.
    let i = 0;
    const next = async () => {
      while (i < page.hard.length) {
        const h = page.hard[i++];
        const cur = page;
        const def = await define(h.word);
        if (cur !== page) return;
        if (def) { h.el.d.textContent = def; h.el.d.className = ''; } else h.el.li.remove();
      }
      if (!$('wordList').children.length) $('wordList').innerHTML = '<li class="empty">No hard words on this page.</li>';
    };
    for (let k = 0; k < 4; k++) next();
  }
  function closePanels() { hl.classList.remove('open'); wd.classList.remove('open'); hints(); }
  function openHl() { if (!page) return; wd.classList.remove('open'); hl.classList.add('open'); sound.tick(); hints(); }
  function openWords() { if (!page) return; hl.classList.remove('open'); wd.classList.add('open'); sound.tick(); hints(); }
  function hints() { $('snapHints').hidden = !page || hl.classList.contains('open') || wd.classList.contains('open'); }

  // ---------- drawing ----------
  function fit() {
    const W = innerWidth, H = innerHeight, top = 56, bottom = 70;
    const s = Math.min(W / img.width, (H - top - bottom) / img.height);
    return { s, ox: (W - img.width * s) / 2, oy: top + (H - top - bottom - img.height * s) / 2 };
  }
  function show(rects) { pulse = { rects, t0: performance.now() }; loop(); }
  function loop() { cancelAnimationFrame(raf); raf = requestAnimationFrame(function f() { draw(); if (pulse) raf = requestAnimationFrame(f); }); }
  function draw() {
    const dpr = Math.min(2, devicePixelRatio || 1), W = innerWidth, H = innerHeight;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#0b0d10'; g.fillRect(0, 0, W, H);
    if (!img) return;
    const f = fit();
    g.drawImage(img, f.ox, f.oy, img.width * f.s, img.height * f.s);
    const R = (b, pad) => [f.ox + b.x0 * f.s - pad, f.oy + b.y0 * f.s - pad, (b.x1 - b.x0) * f.s + pad * 2, (b.y1 - b.y0) * f.s + pad * 2];
    if (page) {
      g.save();
      g.globalCompositeOperation = 'multiply'; // highlighter on paper: text stays dark, paper turns yellow
      g.fillStyle = `rgb(${HI})`;
      page.keys.forEach((k) => k.rects.forEach((b) => { const h = (b.y1 - b.y0) * f.s * 0.18; g.beginPath(); g.roundRect(...R(b, h), 3); g.fill(); }));
      g.restore();
    }
    if (pulse) {
      const t = (performance.now() - pulse.t0) / 1000;
      if (t > 2.2) { pulse = null; return draw(); }
      const a = Math.max(0, 1 - t / 2.2), grow = 3 + Math.sin(t * 9) * 2;
      g.save();
      g.strokeStyle = `rgba(255, 140, 40, ${a})`; g.lineWidth = 3;
      g.shadowColor = `rgba(255, 140, 40, ${a})`; g.shadowBlur = 12;
      pulse.rects.forEach((b) => { g.beginPath(); g.roundRect(...R(b, grow), 5); g.stroke(); });
      g.restore();
    }
  }
  addEventListener('resize', () => { if (!view.hidden) draw(); });

  // ---------- gestures ----------
  let start = null;
  view.addEventListener('pointerdown', (e) => { start = { x: e.clientX, y: e.clientY, inSheet: !!e.target.closest('.sheet, .side') }; });
  view.addEventListener('pointerup', (e) => {
    if (!start) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y, ax = Math.abs(dx), ay = Math.abs(dy);
    const s = start; start = null;
    if (Math.max(ax, ay) < 45) return; // a tap, not a swipe
    if (hl.classList.contains('open')) { if (dy > 0 && ay > ax) closePanels(); return; }
    if (wd.classList.contains('open')) { if (dx > 0 && ax > ay) closePanels(); return; }
    if (s.inSheet) return;
    if (dy < 0 && ay > ax) openHl();
    else if (dx < 0 && ax > ay) openWords();
  });
  $('hintUp').addEventListener('click', openHl);
  $('hintLeft').addEventListener('click', openWords);
  $('hlClose').addEventListener('click', closePanels);
  $('wordClose').addEventListener('click', closePanels);
  $('snapClose').addEventListener('click', () => { view.hidden = true; closePanels(); page = null; img = null; onClose(); });

  function setState(t) { $('snapState').textContent = t; hints(); }
  return { snap };
}
