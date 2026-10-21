// Cut-out: turns a product photo on a plain (usually white) background into a transparent sprite, then finds the
// points the try-on hangs it from. All on a canvas in this page; nothing leaves the device.
//
// 1. Background colour = median of the border pixels.
// 2. Flood fill from the border through pixels close to that colour -> background. Edges get a soft alpha from
//    their colour distance, and are de-fringed (the white mixed into them is taken back out).
// 3. Enclosed pockets of background colour: clear lenses for glasses (kept faintly), holes for hoops and bracelets.
// 4. Anchors per kind (glasses / headwear / earrings / wrist), found from the mask.

const MAX = 640;
const NEAR = 16;    // colour distance still counted as background (tight, so white-ish products survive)
const SOFT = 56;    // above this an edge pixel is fully opaque

const dist = (r, g, b, bg) => Math.hypot(r - bg[0], g - bg[1], b - bg[2]);

function median(values) {
  values.sort((a, b) => a - b);
  return values[values.length >> 1];
}

/** Load an image element from a URL or Blob. crossOrigin is set so CORS-enabled hosts can be read. */
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image failed to load'));
    img.src = src instanceof Blob ? URL.createObjectURL(src) : src;
  });
}

function canvasOf(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/**
 * Build the sprite. `kind` is glasses | headwear | earrings | wrist; `category` refines it (watch vs bracelet).
 * Returns { kind, category, sprite, shadow, w, h, anchors, plainBackground, pieces? }.
 */
export function makeCutout(img, kind, category) {
  const scale = Math.min(1, MAX / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
  const W = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
  const H = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
  const src = canvasOf(W, H);
  const sctx = src.getContext('2d', { willReadFrequently: true });
  sctx.fillStyle = '#fff';                 // transparent PNGs: treat transparency as white
  sctx.fillRect(0, 0, W, H);
  sctx.drawImage(img, 0, 0, W, H);
  const data = sctx.getImageData(0, 0, W, H);   // throws on a tainted (cross-origin) image
  const px = data.data;

  // 1. Background colour from the border
  const rs = [], gs = [], bs = [];
  let spread = 0;
  const border = [];
  for (let x = 0; x < W; x++) border.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) border.push(y * W, y * W + W - 1);
  for (const i of border) { rs.push(px[i * 4]); gs.push(px[i * 4 + 1]); bs.push(px[i * 4 + 2]); }
  const bg = [median(rs), median(gs), median(bs)];
  for (const i of border) if (dist(px[i * 4], px[i * 4 + 1], px[i * 4 + 2], bg) > NEAR) spread++;
  const plainBackground = spread / border.length < 0.12;

  // 2. Flood fill from the border
  const N = W * H;
  const d = new Float32Array(N);
  for (let i = 0; i < N; i++) d[i] = dist(px[i * 4], px[i * 4 + 1], px[i * 4 + 2], bg);
  const outside = new Uint8Array(N);
  const stack = [];
  for (const i of border) if (d[i] < NEAR && !outside[i]) { outside[i] = 1; stack.push(i); }
  while (stack.length) {
    const i = stack.pop();
    const x = i % W, y = (i / W) | 0;
    if (x > 0 && !outside[i - 1] && d[i - 1] < NEAR) { outside[i - 1] = 1; stack.push(i - 1); }
    if (x < W - 1 && !outside[i + 1] && d[i + 1] < NEAR) { outside[i + 1] = 1; stack.push(i + 1); }
    if (y > 0 && !outside[i - W] && d[i - W] < NEAR) { outside[i - W] = 1; stack.push(i - W); }
    if (y < H - 1 && !outside[i + W] && d[i + W] < NEAR) { outside[i + W] = 1; stack.push(i + W); }
  }

  // 3. Enclosed pockets of background colour
  const pocket = new Uint8Array(N);   // 1 = pocket pixel
  const seen = new Uint8Array(N);
  for (let s = 0; s < N; s++) {
    if (seen[s] || outside[s] || d[s] >= NEAR) continue;
    const region = [s];
    seen[s] = 1;
    let strict = 0;
    for (let k = 0; k < region.length; k++) {
      const i = region[k];
      if (d[i] < 6) strict++;
      const x = i % W, y = (i / W) | 0;
      const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
      for (const j of nb) if (j >= 0 && !seen[j] && !outside[j] && d[j] < NEAR) { seen[j] = 1; region.push(j); }
    }
    const big = region.length > N * 0.004;
    // Glasses: any pocket is a lens. Jewellery: only flat, pure background pockets are holes (a hoop's middle),
    // so a pearl's white highlight is kept.
    const clear = kind === 'glasses' ? big : big && strict / region.length > 0.97;
    if (clear) for (const i of region) pocket[i] = 1;
  }

  // Alpha: background 0, pockets (lens 0.1 for glasses, else 0), edges soft by colour distance
  const alpha = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (outside[i]) alpha[i] = 0;
    else if (pocket[i]) alpha[i] = kind === 'glasses' ? 0.1 : 0;
    else alpha[i] = 1;
  }
  // Soften the edge band: pixels next to background take alpha from their distance to the background colour
  const a2 = new Float32Array(alpha);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (alpha[i] < 1) continue;
      const touches = outside[i - 1] || outside[i + 1] || outside[i - W] || outside[i + W];
      if (touches) a2[i] = Math.min(1, Math.max(0.15, (d[i] - NEAR * 0.5) / (SOFT - NEAR * 0.5)));
    }
  }
  // Feather: one light 3x3 blur of the alpha
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      alpha[i] = (a2[i] * 4 + a2[i - 1] + a2[i + 1] + a2[i - W] + a2[i + W]) / 8;
    }
  }

  // Write RGBA, taking the background colour back out of soft edges
  for (let i = 0; i < N; i++) {
    const a = alpha[i];
    const o = i * 4;
    if (a <= 0.01) { px[o + 3] = 0; continue; }
    if (pocket[i] && kind === 'glasses') {               // clear lens: a faint cool sheen
      px[o] = 235; px[o + 1] = 242; px[o + 2] = 250; px[o + 3] = Math.round(a * 255);
      continue;
    }
    if (a < 0.98) {
      for (let c = 0; c < 3; c++) px[o + c] = Math.max(0, Math.min(255, (px[o + c] - bg[c] * (1 - a)) / a));
    }
    px[o + 3] = Math.round(a * 255);
  }

  // Bounding box of the opaque part
  const solid = (i) => px[i * 4 + 3] > 40 && !pocket[i];
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (solid(y * W + x)) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) throw new Error('nothing found in the photo');

  const mask = (x, y) => solid(y * W + x) || pocket[y * W + x];
  const out = { kind, category, plainBackground };
  let anchors;
  if (kind === 'glasses') anchors = glassesAnchors(px, W, mask, solid, { x0, y0, x1, y1 });
  else if (kind === 'headwear') anchors = headwearAnchors(mask, { x0, y0, x1, y1 });
  else if (kind === 'wrist') anchors = wristAnchors(px, W, mask, { x0, y0, x1, y1 }, category);
  else anchors = null;

  sctx.putImageData(data, 0, 0);
  if (kind === 'wrist' && anchors.fade) fadeStrap(sctx, W, H, anchors);
  if (kind === 'glasses' && anchors.trim) {            // erase temple arms seen in the photo
    sctx.clearRect(0, 0, anchors.trim[0], H);
    sctx.clearRect(anchors.trim[1] + 1, 0, W, H);
  }

  if (kind === 'earrings') {
    out.pieces = earringPieces(src, px, W, H);
    return out;
  }
  // Crop to the box (plus a margin) so transforms work in sprite coordinates
  const bx0 = anchors.box[0], by0 = anchors.box[1], bw = anchors.box[2] - bx0 + 1, bh = anchors.box[3] - by0 + 1;
  const pad = 8;
  const sprite = canvasOf(bw + pad * 2, bh + pad * 2);
  sprite.getContext('2d').drawImage(src, bx0, by0, bw, bh, pad, pad, bw, bh);
  const shift = (p) => [p[0] - bx0 + pad, p[1] - by0 + pad];
  for (const key of Object.keys(anchors.points)) anchors.points[key] = shift(anchors.points[key]);
  out.sprite = sprite;
  out.shadow = shadowOf(sprite, kind === 'glasses' ? 5 : 9);
  out.w = sprite.width; out.h = sprite.height;
  out.anchors = anchors;
  return out;
}

function glassesAnchors(px, W, mask, solid, b) {
  // Column profile of the frame + lenses
  const cols = [];
  let max = 0;
  for (let x = b.x0; x <= b.x1; x++) {
    let n = 0;
    for (let y = b.y0; y <= b.y1; y++) if (mask(x, y)) n++;
    cols.push(n);
    if (n > max) max = n;
  }
  // Temple arms seen side-on are thin: trim thin columns from each end
  let l = 0, r = cols.length - 1;
  while (l < r && cols[l] < max * 0.2) l++;
  while (r > l && cols[r] < max * 0.2) r--;
  // Bridge: the thinnest column in the middle third
  const width = r - l;
  let bridge = l + (width >> 1), least = Infinity;
  for (let c = l + Math.round(width * 0.36); c <= l + Math.round(width * 0.64); c++) {
    if (cols[c] < least) { least = cols[c]; bridge = c; }
  }
  // Lens centres: centroid of each side
  const centroid = (c0, c1) => {
    let sx = 0, sy = 0, n = 0;
    for (let c = c0; c <= c1; c++) for (let y = b.y0; y <= b.y1; y++) if (mask(b.x0 + c, y)) { sx += b.x0 + c; sy += y; n++; }
    return n ? [sx / n, sy / n] : [b.x0 + (c0 + c1) / 2, (b.y0 + b.y1) / 2];
  };
  const lc = centroid(l, bridge), rc = centroid(bridge, r);
  const lensY = (lc[1] + rc[1]) / 2;
  const xl = b.x0 + l, xr = b.x0 + r, xb = b.x0 + bridge;
  // Vertical extent of the trimmed frame
  let top = Infinity, bottom = -1;
  for (let x = xl; x <= xr; x++) for (let y = b.y0; y <= b.y1; y++) if (mask(x, y)) { if (y < top) top = y; if (y > bottom) bottom = y; }
  // Frame colour: average of solid pixels near the hinges
  let cr = 0, cg = 0, cb = 0, n = 0;
  for (const x0 of [xl, xr - 6]) for (let x = x0; x < x0 + 6; x++) for (let y = top; y <= bottom; y++) {
    const i = y * W + x;
    if (solid(i)) { cr += px[i * 4]; cg += px[i * 4 + 1]; cb += px[i * 4 + 2]; n++; }
  }
  const color = n ? `rgb(${cr / n | 0},${cg / n | 0},${cb / n | 0})` : '#222';
  return {
    box: [xl, top, xr, bottom],
    trim: [xl, xr],
    color,
    points: { left: [xl, lensY], right: [xr, lensY], bridge: [xb, lensY], hingeL: [xl, top + (bottom - top) * 0.18], hingeR: [xr, top + (bottom - top) * 0.18] },
    frameHeight: bottom - top,
  };
}

function headwearAnchors(mask, b) {
  // The brim line: the lowest rows of the item. The band sits a little above it.
  const w = b.x1 - b.x0, h = b.y1 - b.y0;
  return {
    box: [b.x0, b.y0, b.x1, b.y1],
    points: { base: [(b.x0 + b.x1) / 2, b.y1 - h * 0.06], top: [(b.x0 + b.x1) / 2, b.y0] },
    wide: w / Math.max(1, h) > 1.9,        // wide-brimmed hats sit wider than caps
  };
}

function wristAnchors(px, W, mask, b, category) {
  // First pass: widest row, pixel count and centroid of the opaque shape.
  let max = 0, n = 0, sx = 0, sy = 0;
  for (let y = b.y0; y <= b.y1; y++) {
    let x0 = -1, x1 = -1;
    for (let x = b.x0; x <= b.x1; x++) if (mask(x, y)) { if (x0 < 0) x0 = x; x1 = x; n++; sx += x; sy += y; }
    const w = x0 < 0 ? 0 : x1 - x0 + 1;
    if (w > max) max = w;
  }
  const w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1;
  const isWatch = category === 'watch' || (category !== 'bracelet' && h / w > 1.35);
  if (!isWatch) {
    return { box: [b.x0, b.y0, b.x1, b.y1], isWatch: false, points: { center: [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2] }, span: w };
  }
  // The strap runs along the shape's principal axis. Measure it from the image moments so a watch
  // photographed at any angle is rotated to line up with the forearm, instead of assuming it is
  // strap-vertical. (A strap-vertical catalogue render resolves to axis = PI/2, i.e. no change.)
  const cx = sx / n, cy = sy / n;
  let m20 = 0, m02 = 0, m11 = 0;
  for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) if (mask(x, y)) {
    const dx = x - cx, dy = y - cy; m20 += dx * dx; m02 += dy * dy; m11 += dx * dy;
  }
  let axis = (m20 === m02 && m11 === 0) ? Math.PI / 2 : 0.5 * Math.atan2(2 * m11, m20 - m02);
  if (Math.sin(axis) < 0) axis += Math.PI;                       // keep the dial upright (axis in [0, PI))
  const ux = Math.cos(axis), uy = Math.sin(axis);                // along the strap
  const vx = -uy, vy = ux;                                       // across the wrist (case width)
  let vmin = Infinity, vmax = -Infinity;
  for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) if (mask(x, y)) {
    const vv = (x - cx) * vx + (y - cy) * vy; if (vv < vmin) vmin = vv; if (vv > vmax) vmax = vv;
  }
  const span = Math.max(1, vmax - vmin);                         // case width -> scaled to the wrist
  return {
    box: [b.x0, b.y0, b.x1, b.y1], isWatch: true, span, axis,
    points: { center: [cx, cy] },
    fade: { cx, cy, ux, uy, keep: span * 0.55, soft: span * 0.5 },
  };
}

// The strap wraps round the wrist, so fade it out past the case along the strap (principal) axis.
function fadeStrap(ctx, W, H, a) {
  const { cx, cy, ux, uy, keep, soft } = a.fade;
  const far = keep + soft;
  const g = ctx.createLinearGradient(cx - ux * far, cy - uy * far, cx + ux * far, cy + uy * far);
  const span = 2 * far;
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(soft / span, 'rgba(0,0,0,1)');
  g.addColorStop(1 - soft / span, 'rgba(0,0,0,1)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';
}

// Earrings come in pairs: split the mask into pieces, keep the big ones, hang each from its top.
function earringPieces(src, px, W, H) {
  const step = 2;                 // label on a half-resolution grid for speed
  const gw = Math.ceil(W / step), gh = Math.ceil(H / step);
  const on = (gx, gy) => px[((gy * step) * W + gx * step) * 4 + 3] > 60;
  const label = new Int32Array(gw * gh).fill(-1);
  const comps = [];
  for (let s = 0; s < gw * gh; s++) {
    if (label[s] >= 0 || !on(s % gw, (s / gw) | 0)) continue;
    const id = comps.length, q = [s];
    label[s] = id;
    let x0 = gw, y0 = gh, x1 = 0, y1 = 0;
    for (let k = 0; k < q.length; k++) {
      const i = q[k], x = i % gw, y = (i / gw) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {   // small gaps (hook to drop) still join
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const j = ny * gw + nx;
        if (label[j] < 0 && on(nx, ny)) { label[j] = id; q.push(j); }
      }
    }
    comps.push({ area: q.length, fill: q.length / ((x1 - x0 + 1) * (y1 - y0 + 1)), box: [x0 * step, y0 * step, Math.min(W - 1, x1 * step + step), Math.min(H - 1, y1 * step + step)] });
  }
  comps.sort((a, b) => b.area - a.area);
  const big = comps.filter((c) => c.area > comps[0].area * 0.25).slice(0, 2).sort((a, b) => a.box[0] - b.box[0]);
  return big.map((c) => {
    const [x0, y0, x1, y1] = c.box;
    const pad = 6, w = x1 - x0 + 1, h = y1 - y0 + 1;
    const sprite = canvasOf(w + pad * 2, h + pad * 2);
    sprite.getContext('2d').drawImage(src, x0, y0, w, h, pad, pad, w, h);
    // Hook = the middle of the topmost row
    const aspect = h / w;
    const stud = c.fill > 0.5 && aspect < 1.3;           // a solid, round-ish piece: worn on the lobe itself
    const hoop = !stud && aspect < 1.45;                  // a ring: hangs from its top
    // Rough size as a share of face height (real earrings: studs ~1 cm, hoops ~3-4 cm, drops 3-6 cm)
    const share = stud ? 0.065 : hoop ? 0.24 : Math.min(0.36, 0.2 + 0.05 * (aspect - 1.45));
    return { sprite, w: sprite.width, h: sprite.height, hook: stud ? [pad + w / 2, pad + h / 2] : [pad + w / 2, pad], length: h, share, stud };
  });
}

// A soft dark silhouette for contact shadows.
function shadowOf(sprite, blur) {
  const c = canvasOf(sprite.width + blur * 4, sprite.height + blur * 4);
  const ctx = c.getContext('2d');
  if ('filter' in ctx) {
    ctx.filter = `blur(${blur}px) brightness(0)`;
    ctx.drawImage(sprite, blur * 2, blur * 2);
  } else {
    ctx.drawImage(sprite, blur * 2, blur * 2);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);
  }
  c.offset = blur * 2;
  return c;
}
