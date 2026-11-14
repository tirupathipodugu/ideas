// Clap and rub. A clap knocks the leaves off both hands; a hand sweeping over the other hand or the
// body clears a patch where it touches. Patches regrow (see scarMask in garden.js).

import * as THREE from '../vendor/three/three.module.js';

const WIPERS = [8, 12, 9];                                      // index and middle tips + palm

function segDist2D(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y, len2 = abx * abx + aby * aby || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2));
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

export function createTouch(gardens, falling, sound) {
  const prev = new Map();
  const cool = new Map();
  const contact = new Map();
  let clapD = null, lastClap = -9;
  const pinchAt = [-9, -9], lastSnap = [-9, -9], prevPinch = [null, null];

  const palmCenter = (g) => {
    const J = g.joints, c = new THREE.Vector3();
    for (const i of [0, 5, 9, 13, 17]) c.add(J[i]);
    return c.multiplyScalar(0.2);
  };

  const log = [];
  function clap(t, hands) {
    lastClap = t;
    log.push(['clap', +t.toFixed(2)]);
    for (const g of hands) {
      const unit = g.u.uScale.value, c = palmCenter(g);
      g.addScar(c, unit * 1.45, t);
      falling.burst(c, unit * 0.9, 80, unit, new THREE.Vector2(), g.u);
    }
    sound.shake(1);
  }

  function snap(t, g) {
    log.push(['snap', gardens.indexOf(g), +t.toFixed(2)]);
    if (!g.shed(t)) return;
    const unit = g.u.uScale.value;
    falling.burst(palmCenter(g), unit * 0.7, 30, unit, new THREE.Vector2(), g.u, true);   // moss crumbs
    sound.snap();
  }

  function hit(target, point, radius, unit, push, t, key) {
    const fresh = target.addScar(point, radius, t);
    if (fresh) log.push(['rub', gardens.indexOf(target), +t.toFixed(2)]);
    if ((cool.get(key) ?? -9) > t - 0.07) return;
    cool.set(key, t);
    falling.burst(point, radius * 0.6, fresh ? 16 : 5, unit, push, target.u);
    sound.shake(fresh ? 0.45 : 0.2);
  }

  function update(t, dt) {
    if (dt <= 0) return;
    const [L, R, B] = gardens;
    const hands = [L, R].filter((g) => g.tracked && g.u.uAge.value > 1.2);

    // clap: palms meeting fast
    if (hands.length === 2) {
      const unit = (L.u.uScale.value + R.u.uScale.value) / 2;
      const d = palmCenter(L).distanceTo(palmCenter(R)) / unit;
      const closing = clapD === null ? 0 : (clapD - d) / dt;
      clapD = d;
      if (d < 0.95 && closing > 2.5 && t - lastClap > 0.7) clap(t, hands);
    } else clapD = null;

    // finger snap: thumb and middle finger pinched, then the middle finger flicks into the palm
    [L, R].forEach((g, i) => {
      if (!g.tracked || g.u.uAge.value < 1.2) return;
      const J = g.joints, unit = g.u.uScale.value;
      const pinch = J[4].distanceTo(J[12]) / unit, curl = J[12].distanceTo(J[0]) / unit;
      const opening = (pinch - (prevPinch[i] ?? pinch)) / Math.max(dt, 1 / 120);
      prevPinch[i] = pinch;
      if (pinch < 0.3) pinchAt[i] = t;
      // fast release (> 4 palm/s) with the middle finger slammed into the palm, not a hand slowly opening
      else if (t - pinchAt[i] < 0.25 && pinch > 0.45 && opening > 4 && curl < 1.15 && t - lastSnap[i] > 1.5) {
        lastSnap[i] = t; pinchAt[i] = -9;
        snap(t, g);
      }
    });

    // rub: a fast-moving fingertip or palm over another garden
    hands.forEach((h, hi) => {
      const unit = h.u.uScale.value, wrist = h.joints[0];
      for (const j of WIPERS) {
        const key = `${gardens.indexOf(h)}:${j}`, p = h.joints[j];
        const last = prev.get(key);
        prev.set(key, p.clone());
        if (!last) continue;
        const v = new THREE.Vector2(p.x - last.x, p.y - last.y).divideScalar(dt);
        if (v.length() / unit < 2.5) { contact.set(key, 0); continue; }

        for (const o of hands) {
          if (o === h) continue;
          const ou = o.u.uScale.value;
          let near = Infinity;
          for (let k = 0; k < 21; k++) near = Math.min(near, Math.hypot(o.joints[k].x - p.x, o.joints[k].y - p.y));
          // must stay in contact for 3 frames in a row: a real rub, not hands passing each other
          const c = near < ou * 0.22 ? (contact.get(key) ?? 0) + 1 : 0;
          contact.set(key, c);
          if (c >= 3) hit(o, p, ou * 0.6, ou, v, t, `h${hi}`);
        }
        if (B.tracked && B.u.uAge.value > 1.2) {
          const bu = B.u.uScale.value;
          for (const [a, b, r, , , kind] of B.skel.segs) {
            if (kind === 'crown' || b === 51) continue;
            if (B.vis[a] < 0.5 || B.vis[b] < 0.5) continue;
            const A = B.joints[a], Bj = B.joints[b];
            // ignore the arm this hand belongs to
            if (Math.min(A.distanceTo(wrist), Bj.distanceTo(wrist)) < unit * 1.6) continue;
            const fk = key + ':f', inside = segDist2D(p, A, Bj) < r * bu;
            const c = inside ? (contact.get(fk) ?? 0) + 1 : 0;
            contact.set(fk, c);
            if (c >= 3) {
              hit(B, new THREE.Vector3(p.x, p.y, (A.z + Bj.z) / 2), bu * 0.3, unit, v, t, `b${hi}`);
              break;
            }
          }
        }
      }
    });
  }

  return {
    update, log,
    // test hooks
    clap: (t) => clap(t, gardens.slice(0, 2).filter((g) => g.tracked)),
    snap: (gi, t) => snap(t, gardens[gi]),
    poke: (gi, x, y, t) => { const g = gardens[gi]; const u = g.u.uScale.value * (gi === 2 ? 0.42 : 0.6); hit(g, new THREE.Vector3(x, y, 0), u, g.u.uScale.value, new THREE.Vector2(), t, 'test'); },
  };
}
