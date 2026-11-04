// The stretches, and how each one is checked from a seated webcam view. No DOM here.
//
// Body space: origin between the shoulders, x to the screen's right (the view is mirrored, so the
// player's left is x < 0), y down, 1 unit = the player's shoulder width. Hips are usually out of
// frame at a laptop, so the checks rely on the head, shoulders and arms.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const ramp = (v, lo, hi) => clamp((v - lo) / (hi - lo), 0, 1);
const DEG = 180 / Math.PI;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** A value inside [lo, hi] passes; `soft` is how far outside it fades to zero. */
const band = (v, lo, hi, soft) => Math.min(ramp(v, lo - soft, lo + soft), ramp(-v, -hi - soft, -hi + soft));

const INDEX = { nose: 0, earL: 7, earR: 8, sL: 11, sR: 12, eL: 13, eR: 14, wL: 15, wR: 16, hipL: 23, hipR: 24 };

/**
 * Turn tracked points (video-normalised x, y, visibility) into body space.
 * swRef: shoulder width in video pixels. neutral: the player's resting shoulder midpoint, in mirrored video pixels.
 */
export function bodyFrom(points, vw, vh, swRef, neutral) {
  const px = (i) => [(1 - points[i * 3]) * vw, points[i * 3 + 1] * vh];
  const [ax, ay] = px(INDEX.sL);
  const [bx, by] = px(INDEX.sR);
  const ox = (ax + bx) / 2, oy = (ay + by) / 2;
  const b = {
    shoulderPx: Math.hypot(ax - bx, ay - by),
    origin: { x: ox, y: oy },
    shift: neutral ? (ox - neutral.x) / swRef : 0,
  };
  for (const [name, i] of Object.entries(INDEX)) {
    const [x, y] = px(i);
    b[name] = { x: (x - ox) / swRef, y: (y - oy) / swRef, v: points[i * 3 + 2] };
  }
  return b;
}

const side = (b, s) => ({ shoulder: b['s' + s], elbow: b['e' + s], wrist: b['w' + s], sign: s === 'L' ? -1 : 1 });

/** Degrees above horizontal of the line from one joint to another (up is positive). */
const elevation = (from, to) => Math.atan2(from.y - to.y, Math.abs(to.x - from.x)) * DEG;
const upperElevation = (b, s) => { const a = side(b, s); return elevation(a.shoulder, a.elbow); };
/** The whole arm's elevation; falls back to the upper arm when the hand is out of frame. */
const armElevation = (b, s) => { const a = side(b, s); return a.wrist.v >= 0.25 ? elevation(a.shoulder, a.wrist) : elevation(a.shoulder, a.elbow); };
const outward = (b, s, joint) => { const a = side(b, s); return a.sign * a[joint].x; };

/** Positive when the left side is lower (a tilt to the player's left). */
const shoulderTilt = (b) => Math.atan2(b.sL.y - b.sR.y, b.sR.x - b.sL.x) * DEG;
const earTilt = (b) => Math.atan2(b.earL.y - b.earR.y, b.earR.x - b.earL.x) * DEG;
const neckTilt = (b) => earTilt(b) - shoulderTilt(b);

/** How far the upper body leans to the player's left (positive) or right (negative), 0..1 toward "enough". */
function leanScore(b, dir) {
  const tilt = ramp(dir * shoulderTilt(b), 5, 15);
  const moved = ramp(dir * -b.shift, 0.1, 0.5);
  const hipsSeen = b.hipL.v > 0.5 && b.hipR.v > 0.5;
  const hipX = (b.hipL.x + b.hipR.x) / 2, hipY = (b.hipL.y + b.hipR.y) / 2;
  const torso = hipsSeen ? ramp(dir * Math.atan2(hipX, hipY) * DEG, 4, 14) : 0;
  return Math.max(tilt, moved, torso);
}

const W = { L: 'left', R: 'right' };

const armUp = (s, lo = 45, hi = 75) => ({
  limb: s,
  hint: `Reach your ${W[s]} arm up higher`,
  score: (b) => ramp(armElevation(b, s), lo, hi),
});

const neck = (s) => ({
  id: `neck-${W[s]}`, name: `Neck tilt ${W[s]}`, area: 'neck', group: 'neck',
  how: `Let your ${W[s]} ear drop toward your ${W[s]} shoulder.`,
  pose: { tilt: s === 'L' ? 24 : -24, L: [10, 8], R: [10, 8] },
  checks: [{ limb: 'head', hint: `Drop your ${W[s]} ear a little more`, score: (b) => ramp((s === 'L' ? 1 : -1) * neckTilt(b), 8, 22) }],
});

const sideBend = (s) => {
  const up = s === 'L' ? 'R' : 'L';
  const dir = s === 'L' ? 1 : -1;
  return {
    id: `side-${W[s]}`, name: `Side bend ${W[s]}`, area: 'back', group: 'side',
    how: `Raise your ${W[up]} arm and lean to the ${W[s]}.`,
    pose: { lean: 14 * dir, [up]: [158, 166], [s]: [16, 12] },
    checks: [
      armUp(up, 30, 60),
      { limb: 'torso', hint: `Lean further to the ${W[s]}`, score: (b) => leanScore(b, dir) },
    ],
  };
};

const crossArm = (s) => {
  const dir = s === 'L' ? 1 : -1;
  return {
    id: `cross-${W[s]}`, name: `Cross arm ${W[s]}`, area: 'shoulders', group: 'cross',
    how: `Pull your ${W[s]} arm across your chest.`,
    pose: { [s]: [-50, -70], [s === 'L' ? 'R' : 'L']: [10, 8] },
    checks: [
      { limb: s, hint: `Bring your ${W[s]} hand further across`, score: (b) => ramp(dir * side(b, s).wrist.x, 0, 0.5) },
      { limb: s, hint: `Keep your ${W[s]} arm at chest height`, score: (b) => band(side(b, s).wrist.y, -0.4, 1.7, 0.3) },
    ],
  };
};

const triceps = (s) => ({
  id: `triceps-${W[s]}`, name: `Overhead elbow ${W[s]}`, area: 'arms', group: 'triceps',
  how: `Lift your ${W[s]} elbow up and drop that hand behind your head.`,
  pose: { [s]: [165, -20], [s === 'L' ? 'R' : 'L']: [10, 8] },
  checks: [
    { limb: s, hint: `Point your ${W[s]} elbow at the ceiling`, score: (b) => ramp(upperElevation(b, s), 35, 65) },
    {
      limb: s,
      hint: `Bend your ${W[s]} arm, hand behind your head`,
      score: (b) => { const a = side(b, s); return a.wrist.v < 0.25 ? 1 : ramp(a.wrist.y - a.elbow.y, -0.45, 0.25); },
    },
  ],
});

const both = (make) => [make('L'), make('R')];

export const STRETCHES = [
  {
    id: 'reach-up', name: 'Reach for the ceiling', area: 'back', group: 'reach',
    how: 'Both arms straight up. Grow tall.',
    pose: { L: [170, 176], R: [170, 176] },
    // The upper arms must rise too, or hands behind the head would count as reaching.
    checks: both((s) => ({
      limb: s,
      hint: `Reach your ${W[s]} arm up higher`,
      score: (b) => Math.min(ramp(armElevation(b, s), 45, 75), ramp(upperElevation(b, s), 30, 60)),
    })),
  },
  neck('L'), neck('R'),
  sideBend('L'), sideBend('R'),
  {
    id: 'goalpost', name: 'Goalpost arms', area: 'chest', group: 'goalpost',
    how: 'Elbows out at shoulder height, hands up. Squeeze your shoulder blades.',
    pose: { L: [90, 180], R: [90, 180] },
    checks: both((s) => ({
      limb: s,
      hint: `${W[s] === 'left' ? 'Left' : 'Right'} elbow out at shoulder height, hand up`,
      score: (b) => {
        const a = side(b, s);
        return Math.min(band(upperElevation(b, s), -25, 35, 10), ramp(a.elbow.y - a.wrist.y, 0.1, 0.6), ramp(outward(b, s, 'elbow'), 0.5, 0.9));
      },
    })),
  },
  crossArm('L'), crossArm('R'),
  {
    id: 'elbows-wide', name: 'Hands behind head', area: 'chest', group: 'elbows',
    how: 'Fingers behind your head, elbows wide open.',
    pose: { L: [115, -110], R: [115, -110] },
    checks: both((s) => ({
      limb: s,
      hint: `${W[s] === 'left' ? 'Left' : 'Right'} hand behind your head, elbow wide`,
      score: (b) => {
        const a = side(b, s);
        return Math.min(ramp(-dist(a.wrist, b.nose), -1.5, -0.9), ramp(outward(b, s, 'elbow'), 0.6, 1), band(upperElevation(b, s), -5, 60, 15));
      },
    })),
  },
  triceps('L'), triceps('R'),
  {
    id: 'big-y', name: 'Big Y', area: 'chest', group: 'y',
    how: 'Arms up and wide in a big Y. Chest open.',
    pose: { L: [135, 135], R: [135, 135] },
    checks: both((s) => ({
      limb: s,
      hint: `${W[s] === 'left' ? 'Left' : 'Right'} arm up and out, like a Y`,
      score: (b) => Math.min(band(armElevation(b, s), 20, 68, 12), ramp(outward(b, s, 'wrist'), 0.8, 1.4)),
    })),
  },
  {
    id: 'prayer', name: 'Palms together', area: 'wrists', group: 'prayer',
    how: 'Press your palms together at your chest, elbows out. Good for typing wrists.',
    pose: { L: [20, -95], R: [20, -95] },
    checks: [
      {
        limb: 'both',
        hint: 'Bring your hands together',
        score: (b) => ramp(-dist(b.wL, b.wR), -0.85, -0.25),
      },
      {
        limb: 'both',
        hint: 'Hold your hands in front of your chest',
        score: (b) => {
          const x = (b.wL.x + b.wR.x) / 2, y = (b.wL.y + b.wR.y) / 2;
          return Math.min(ramp(-Math.abs(x), -0.7, -0.3), band(y, 0, 1.7, 0.4));
        },
      },
    ],
  },
];

export const byId = (id) => STRETCHES.find((s) => s.id === id);

/** Score the player against a stretch. Passing every check means score >= 0.5. */
export function evaluate(stretch, b) {
  let score = 1, worst = null;
  const limbs = { head: 1, torso: 1, L: 1, R: 1 };
  for (const c of stretch.checks) {
    const v = c.score(b);
    if (v < score) { score = v; worst = c; }
    if (c.limb === 'both') { limbs.L = Math.min(limbs.L, v); limbs.R = Math.min(limbs.R, v); }
    else limbs[c.limb] = Math.min(limbs[c.limb], v);
  }
  return { score, hint: worst ? worst.hint : '', limbs };
}

/** Endless order: left/right pairs stay together, the same group never repeats back to back. */
export function makeDeck(random = Math.random) {
  let lastGroup = null;
  let queue = ['reach-up'];
  return function next() {
    if (!queue.length) {
      const groups = [...new Set(STRETCHES.map((s) => s.group))];
      for (let i = groups.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [groups[i], groups[j]] = [groups[j], groups[i]];
      }
      if (groups[0] === lastGroup) groups.push(groups.shift());
      queue = groups.flatMap((g) => {
        const ids = STRETCHES.filter((s) => s.group === g).map((s) => s.id);
        return random() < 0.5 ? ids : ids.reverse();
      });
    }
    const id = queue.shift();
    lastGroup = byId(id).group;
    return byId(id);
  };
}

// The figure a pose describes: the shape cut out of the wall, and the guide drawn over the player.
const UPPER = 0.75, FOREARM = 0.65, PIVOT_Y = 2.4;

/** Arm angles: 0 = straight down, 90 = straight out, 180 = straight up, negative = across the body. */
export function figure(pose) {
  const lean = ((pose.lean || 0) / DEG);
  const tilt = ((pose.tilt || 0) / DEG);
  const turn = (p) => {
    const dx = p.x, dy = p.y - PIVOT_Y;
    return { x: dx * Math.cos(lean) + dy * Math.sin(lean), y: -dx * Math.sin(lean) + dy * Math.cos(lean) + PIVOT_Y };
  };
  const arm = (shoulder, sign, [up, fore]) => {
    const dir = (a) => ({ x: sign * Math.sin(a / DEG), y: Math.cos(a / DEG) });
    const u = dir(up), f = dir(fore);
    const elbow = { x: shoulder.x + u.x * UPPER, y: shoulder.y + u.y * UPPER };
    return [elbow, { x: elbow.x + f.x * FOREARM, y: elbow.y + f.y * FOREARM }];
  };
  const sL = { x: -0.5, y: 0 }, sR = { x: 0.5, y: 0 };
  const [eL, wL] = arm(sL, -1, pose.L || [10, 8]);
  const [eR, wR] = arm(sR, 1, pose.R || [10, 8]);
  const neck = { x: 0, y: -0.2 };
  const reach = 0.62;
  const head = { x: neck.x - Math.sin(tilt) * reach, y: neck.y - Math.cos(tilt) * reach };
  const earOff = { x: Math.cos(tilt) * 0.3, y: Math.sin(tilt) * 0.3 };
  const earL = { x: head.x - earOff.x, y: head.y + earOff.y };
  const earR = { x: head.x + earOff.x, y: head.y - earOff.y };
  const parts = { sL, sR, eL, eR, wL, wR, neck, head, earL, earR, hipL: { x: -0.42, y: 2.4 }, hipR: { x: 0.42, y: 2.4 }, baseL: { x: -0.6, y: 9 }, baseR: { x: 0.6, y: 9 } };
  for (const k of Object.keys(parts)) parts[k] = turn(parts[k]);
  parts.headR = 0.4;
  return parts;
}

/** Fill and stroke a figure's silhouette with the context's current style; `grow` is extra margin in body units. */
export function paintSilhouette(ctx, f, cx, cy, U, grow = 0) {
  const X = (p) => cx + p.x * U, Y = (p) => cy + p.y * U;
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(X(f.sL), Y(f.sL)); ctx.lineTo(X(f.sR), Y(f.sR));
  ctx.lineTo(X(f.hipR), Y(f.hipR)); ctx.lineTo(X(f.baseR), Y(f.baseR));
  ctx.lineTo(X(f.baseL), Y(f.baseL)); ctx.lineTo(X(f.hipL), Y(f.hipL));
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = (0.24 + 2 * grow) * U;
  ctx.stroke();
  ctx.lineWidth = (0.42 + 2 * grow) * U;
  for (const [s, e, w] of [[f.sL, f.eL, f.wL], [f.sR, f.eR, f.wR]]) {
    ctx.beginPath();
    ctx.moveTo(X(s), Y(s)); ctx.lineTo(X(e), Y(e)); ctx.lineTo(X(w), Y(w));
    ctx.stroke();
  }
  ctx.lineWidth = (0.36 + 2 * grow) * U;
  ctx.beginPath();
  ctx.moveTo(X(f.neck), Y(f.neck)); ctx.lineTo(X(f.head), Y(f.head));
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(X(f.head), Y(f.head), (f.headR + grow) * U, 0, Math.PI * 2);
  ctx.fill();
}

/** Landmarks for a posed figure: used by the no-camera simulator and the checks' test. */
export function pointsFromPose(pose, vw, vh, neutral, swRef) {
  const f = figure(pose);
  const points = new Float32Array(33 * 3);
  const put = (i, p, v = 1) => {
    points[i * 3] = 1 - (neutral.x + p.x * swRef) / vw;
    points[i * 3 + 1] = (neutral.y + p.y * swRef) / vh;
    points[i * 3 + 2] = v;
  };
  put(INDEX.nose, f.head);
  put(INDEX.earL, f.earL); put(INDEX.earR, f.earR);
  put(INDEX.sL, f.sL); put(INDEX.sR, f.sR);
  put(INDEX.eL, f.eL); put(INDEX.eR, f.eR);
  put(INDEX.wL, f.wL); put(INDEX.wR, f.wR);
  put(INDEX.hipL, f.hipL, 0.2); put(INDEX.hipR, f.hipR, 0.2);
  return points;
}
