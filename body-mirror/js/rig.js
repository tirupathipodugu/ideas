// Turns 33 pose points and one future's body numbers into "deformers" for the warp: one per body part
// (torso, neck, upper arms, forearms, thighs, calves). Each is an axis in canvas px with a half-width,
// a width scale at four points along it, and how far it reaches. The torso also carries the arms
// outward rigidly (they sit against its surface) and, when you turn side-on, puts more of the change
// in front (the belly) than behind.

export const MAX_DEFORMERS = 12;

// MediaPipe pose indices.
const NOSE = 0, LSH = 11, RSH = 12, LEL = 13, REL = 14, LWR = 15, RWR = 16, LHIP = 23, RHIP = 24, LKN = 25, RKN = 26, LAN = 27, RAN = 28;

/** Pose points (video-normalised) to canvas px, with visibility. */
export function poseToCanvas(points, view) {
  const [ox, oy, w, h] = view.map;
  const out = [];
  for (let i = 0; i < 33; i++) {
    let x = points[i * 3];
    if (view.mirror) x = 1 - x;
    out.push({ x: ox + x * w, y: oy + points[i * 3 + 1] * h, v: points[i * 3 + 2] });
  }
  return out;
}

const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, v: Math.min(a.v, b.v) });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const seen = (v) => Math.max(0, Math.min(1, (v - 0.35) / 0.35));

/**
 * P: canvas points. world: Float32Array of world points (metres). body: bodyParams output.
 * Returns { deformers: [...], torso: {...} | null, unit } where unit is shoulder width in px.
 */
export function buildDeformers(P, world, body, amount) {
  const sh = dist(P[LSH], P[RSH]);
  if (sh < 8) return { deformers: [], torso: null, unit: sh };
  const S = body.scale;
  const out = [];

  // How side-on the body is: 0 facing the camera, 1 in profile (from the shoulders' depth difference).
  const wx = world[LSH * 3] - world[RSH * 3], wz = world[LSH * 3 + 2] - world[RSH * 3 + 2];
  const side = Math.min(1, Math.abs(wz) / (Math.hypot(wx, wz) || 1));
  const shoulders = mid(P[LSH], P[RSH]);
  const hips = mid(P[LHIP], P[RHIP]);
  const axis = { x: hips.x - shoulders.x, y: hips.y - shoulders.y };
  const len = Math.hypot(axis.x, axis.y) || 1;
  const n = { x: -axis.y / len, y: axis.x / len };
  // Which side of the torso axis is the front: the nose leads when turned.
  const lead = (P[NOSE].x - shoulders.x) * n.x + (P[NOSE].y - shoulders.y) * n.y;
  const front = lead >= 0 ? 1 : -1;

  const torsoSeen = seen(Math.min(P[LSH].v, P[RSH].v));
  const hipsSeen = seen(hips.v);
  if (torsoSeen > 0) {
    // Width seen by the camera mixes the body's width and its depth as it turns.
    const widthDepth = (w, depth) => (1 - side) * w + side * depth;
    const belly = body.bellyDepth;
    const k0 = widthDepth(0.6 * S.shoulder + 0.4 * S.chest, S.chest * 0.8);
    const k1 = widthDepth(S.chest, S.chest);
    const k2 = widthDepth(S.waist, belly) * (0.4 + 0.6 * hipsSeen);
    const k3 = widthDepth(S.hips, 0.5 * S.hips + 0.5 * belly) * hipsSeen;
    // In profile the belly goes forward and the back barely moves.
    const asym = side * front;
    const B = { x: hips.x + axis.x * 0.12, y: hips.y + axis.y * 0.12 };
    out.push({
      a: shoulders, b: B,
      keys: [k0, k1, k2, k3],
      asym: [0.2 * asym, 0.35 * asym, 0.75 * asym, 0.55 * asym],
      along: [-0.14, 0.0, 1.0, 1.16],
      edgeA: 0.52 * sh, edgeB: 0.5 * sh * (1 - 0.25 * side),
      fade: [2.3, 3.6], carry: 1, amp: torsoSeen * amount,
    });
  }

  // Neck: from the shoulder line up toward the nose; only the lower part is neck.
  if (torsoSeen > 0 && P[NOSE].v > 0.4) {
    out.push({
      a: shoulders, b: P[NOSE], keys: [S.neck, S.neck, S.neck, 0], asym: [0, 0, 0, 0],
      along: [-0.06, 0.12, 0.45, 0.68], edgeA: 0.17 * sh, edgeB: 0.15 * sh, fade: [1.6, 2.4], carry: 0,
      amp: torsoSeen * amount,
    });
  }

  // Face: from between the eyes down past the mouth to the chin; cheeks and jaw fill out most.
  const eyes = mid(P[2], P[5]), mouth = mid(P[9], P[10]);
  const faceW = dist(P[7], P[8]);
  if (Math.min(eyes.v, mouth.v) > 0.5 && faceW > 6 && S.face) {
    const chin = { x: mouth.x + (mouth.x - eyes.x) * 0.9, y: mouth.y + (mouth.y - eyes.y) * 0.9 };
    out.push({
      a: eyes, b: chin, keys: [0.25 * S.face, 0.75 * S.face, 1.0 * S.face, 0.85 * S.face], asym: [0, 0, 0, 0],
      along: [-0.1, 0.15, 0.95, 1.25], edgeA: 0.5 * faceW, edgeB: 0.36 * faceW, fade: [1.15, 1.7], carry: 0,
      amp: amount * seen(Math.min(eyes.v, mouth.v)),
    });
  }

  const limb = (i, j, s0, s1, w0, w1, along) => {
    const vis = seen(Math.min(P[i].v, P[j].v));
    if (vis <= 0 || dist(P[i], P[j]) < 4) return;
    out.push({
      a: P[i], b: P[j], keys: [s0, (2 * s0 + s1) / 3, (s0 + 2 * s1) / 3, s1], asym: [0, 0, 0, 0],
      along, edgeA: w0 * sh, edgeB: w1 * sh, fade: [1.6, 2.4], carry: 0, amp: vis * amount,
    });
  };
  for (const [s, e, w] of [[LSH, LEL, LWR], [RSH, REL, RWR]]) {
    limb(s, e, S.arm, S.arm * 0.8, 0.15, 0.11, [-0.05, 0.12, 0.9, 1.08]);
    limb(e, w, S.forearm, S.forearm * 0.4, 0.11, 0.08, [-0.05, 0.08, 0.82, 0.98]);
  }
  for (const [h, k, a] of [[LHIP, LKN, LAN], [RHIP, RKN, RAN]]) {
    limb(h, k, S.thigh * 1.1, S.thigh * 0.55, 0.3, 0.19, [0.06, 0.28, 0.92, 1.08]);
    limb(k, a, S.calf, S.calf * 0.3, 0.17, 0.1, [-0.04, 0.1, 0.85, 1.0]);
  }

  return {
    deformers: out.slice(0, MAX_DEFORMERS),
    torso: torsoSeen > 0 ? out[0] : null,
    unit: sh,
  };
}
