// Lift a drawing off paper. The page colour is estimated per cell from its brightest pixels, so shadows and
// warm lamps don't count as ink. Anything clearly darker or more colourful than the page is ink; ink touching
// the edge of the box (fingers, the table, the paper's edge) is dropped. What's left is cut out like a sticker:
// the ink, the paper it encloses and a round white border, cleaned up to look scanned.

const MAX = 360;

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Page colour for every pixel, from a coarse grid of "bright pixel" averages. */
function pageColour(R, G, B, L, w, h) {
  const cs = Math.max(8, Math.round(Math.max(w, h) / 10));
  const cols = Math.ceil(w / cs), rows = Math.ceil(h / cs);
  const cell = new Float32Array(cols * rows * 4);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x0 = cx * cs, y0 = cy * cs, x1 = Math.min(w, x0 + cs), y1 = Math.min(h, y0 + cs);
      let sum = 0, cnt = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { sum += L[y * w + x]; cnt++; }
      const mean = sum / cnt;
      let r = 0, g = 0, b = 0, l = 0, k = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = y * w + x;
          if (L[i] >= mean) { r += R[i]; g += G[i]; b += B[i]; l += L[i]; k++; }
        }
      }
      const o = (cy * cols + cx) * 4;
      cell[o] = r / k; cell[o + 1] = g / k; cell[o + 2] = b / k; cell[o + 3] = l / k;
    }
  }
  // A cell that's mostly ink (a filled-in shape) borrows its brightest neighbour.
  const fixed = cell.slice();
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const o = (cy * cols + cx) * 4;
      let best = o;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const n = (ny * cols + nx) * 4;
          if (cell[n + 3] > cell[best + 3]) best = n;
        }
      }
      if (cell[best + 3] > cell[o + 3] * 1.15) for (let c = 0; c < 4; c++) fixed[o + c] = cell[best + c];
    }
  }
  // Bilinear between cell centres.
  const out = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(rows - 1, Math.max(0, (y + 0.5) / cs - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(rows - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(cols - 1, Math.max(0, (x + 0.5) / cs - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(cols - 1, x0 + 1), tx = fx - x0;
      const a = (y0 * cols + x0) * 4, b = (y0 * cols + x1) * 4, c = (y1 * cols + x0) * 4, d = (y1 * cols + x1) * 4;
      const o = (y * w + x) * 4;
      for (let k = 0; k < 4; k++) {
        const top = fixed[a + k] + (fixed[b + k] - fixed[a + k]) * tx;
        const bot = fixed[c + k] + (fixed[d + k] - fixed[c + k]) * tx;
        out[o + k] = top + (bot - top) * ty;
      }
    }
  }
  return out;
}

/** Chamfer (3-4) distance to the nearest set pixel, in thirds of a pixel. */
function distance(mask, w, h) {
  const INF = 1e9, D = new Float32Array(w * h);
  for (let i = 0; i < D.length; i++) D[i] = mask[i] ? 0 : INF;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let v = D[i];
      if (x > 0) v = Math.min(v, D[i - 1] + 3);
      if (y > 0) {
        v = Math.min(v, D[i - w] + 3);
        if (x > 0) v = Math.min(v, D[i - w - 1] + 4);
        if (x < w - 1) v = Math.min(v, D[i - w + 1] + 4);
      }
      D[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      let v = D[i];
      if (x < w - 1) v = Math.min(v, D[i + 1] + 3);
      if (y < h - 1) {
        v = Math.min(v, D[i + w] + 3);
        if (x < w - 1) v = Math.min(v, D[i + w + 1] + 4);
        if (x > 0) v = Math.min(v, D[i + w - 1] + 4);
      }
      D[i] = v;
    }
  }
  return D;
}

/**
 * Cut the drawing out of a region of `source` (video or canvas).
 * Returns { sprite, eyes, crop } or { error } when nothing drawing-like is there.
 * `crop` is the sticker's rectangle in source pixels, for the peel animation.
 */
export function extractDoodle(source, sx, sy, sw, sh) {
  const k = Math.min(1, MAX / Math.max(sw, sh));
  const w = Math.max(16, Math.round(sw * k)), h = Math.max(16, Math.round(sh * k));
  const c = canvas(w, h), x2d = c.getContext('2d', { willReadFrequently: true });
  x2d.drawImage(source, sx, sy, sw, sh, 0, 0, w, h);
  const px = x2d.getImageData(0, 0, w, h).data;
  const n = w * h;
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n), L = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    R[i] = px[i * 4]; G[i] = px[i * 4 + 1]; B[i] = px[i * 4 + 2];
    L[i] = 0.299 * R[i] + 0.587 * G[i] + 0.114 * B[i];
  }
  const page = pageColour(R, G, B, L, w, h);

  let pageSum = 0;
  for (let i = 0; i < n; i++) pageSum += page[i * 4 + 3];
  if (pageSum / n < 55) return { error: 'Too dark to see the paper. Find some light.' };

  // Normalised colour (page = 1) and ink.
  const NR = new Float32Array(n), NG = new Float32Array(n), NB = new Float32Array(n);
  const ink = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    const nr = R[i] / Math.max(1, page[p]), ng = G[i] / Math.max(1, page[p + 1]), nb = B[i] / Math.max(1, page[p + 2]);
    NR[i] = nr; NG[i] = ng; NB[i] = nb;
    const dark = 1 - L[i] / Math.max(1, page[p + 3]);
    const sat = Math.max(nr, ng, nb) - Math.min(nr, ng, nb);
    ink[i] = dark > 0.26 || sat > 0.26 ? 1 : 0;
  }

  // Connected pieces of ink; keep the ones that sit inside the box and aren't specks.
  const label = new Int32Array(n).fill(-1);
  const keep = new Uint8Array(n);
  const stack = new Int32Array(n);
  const margin = 3, minSize = Math.max(12, n * 0.0006);
  let kept = 0;
  for (let s = 0; s < n; s++) {
    if (!ink[s] || label[s] >= 0) continue;
    let top = 0, size = 0, edge = false;
    stack[top++] = s;
    label[s] = s;
    const members = [];
    while (top) {
      const i = stack[--top];
      members.push(i);
      size++;
      const x = i % w, y = (i / w) | 0;
      if (x < margin || y < margin || x >= w - margin || y >= h - margin) edge = true;
      if (x > 0 && ink[i - 1] && label[i - 1] < 0) { label[i - 1] = s; stack[top++] = i - 1; }
      if (x < w - 1 && ink[i + 1] && label[i + 1] < 0) { label[i + 1] = s; stack[top++] = i + 1; }
      if (y > 0 && ink[i - w] && label[i - w] < 0) { label[i - w] = s; stack[top++] = i - w; }
      if (y < h - 1 && ink[i + w] && label[i + w] < 0) { label[i + w] = s; stack[top++] = i + w; }
    }
    if (!edge && size >= minSize) { for (const i of members) keep[i] = 1; kept += size; }
  }
  if (kept < n * 0.002) return { error: 'No drawing found. Use a dark pen and keep it inside the box.' };

  // Sticker shape: ink grown by a round border, plus every hole it encloses.
  const border = Math.round(Math.max(w, h) * 0.022) + 2;
  const dist = distance(keep, w, h);
  const solid = new Uint8Array(n);
  for (let i = 0; i < n; i++) solid[i] = dist[i] <= border * 3 ? 1 : 0;
  const outside = new Uint8Array(n);
  let top = 0;
  const push = (i) => { if (!solid[i] && !outside[i]) { outside[i] = 1; stack[top++] = i; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (top) {
    const i = stack[--top], x = i % w, y = (i / w) | 0;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }

  let minX = w, minY = h, maxX = -1, maxY = -1;
  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let a = 0;
    if (!outside[i]) a = 1;
    else a = Math.max(0, Math.min(1, (border * 3 + 3 - dist[i]) / 3));
    alpha[i] = a;
    if (a > 0) {
      const x = i % w, y = (i / w) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const cw = maxX - minX + 1, ch = maxY - minY + 1;
  const out = canvas(cw, ch), octx = out.getContext('2d');
  const img = octx.createImageData(cw, ch);
  const o = img.data;
  const tone = (v) => 255 * Math.max(0, Math.min(1, 1 - (1 - Math.min(1, v * 1.05)) * 1.55));
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const i = (y + minY) * w + (x + minX), q = (y * cw + x) * 4;
      o[q] = tone(NR[i]) * 0.99;
      o[q + 1] = tone(NG[i]) * 0.98;
      o[q + 2] = tone(NB[i]) * 0.955;
      o[q + 3] = alpha[i] * 255;
    }
  }
  octx.putImageData(img, 0, 0);

  // Googly eyes sit across the upper part of the shape.
  const row = Math.round(ch * 0.27);
  let l = -1, r = -1;
  for (let x = 0; x < cw; x++) {
    if (alpha[(row + minY) * w + x + minX] > 0.5) { if (l < 0) l = x; r = x; }
  }
  if (l < 0) { l = cw * 0.3; r = cw * 0.7; }
  const span = r - l;
  const er = Math.max(cw * 0.06, Math.min(span * 0.17, ch * 0.1, cw * 0.14));
  const mid = (l + r) / 2;
  const eyes = [
    { x: mid - er * 1.12, y: row, r: er },
    { x: mid + er * 1.12, y: row, r: er },
  ];

  return {
    sprite: out,
    eyes,
    crop: { x: sx + minX / k, y: sy + minY / k, w: cw / k, h: ch / k },
  };
}
