// Solver: works for any board size, from 2×2 to 20×20. Its solutions aren't the shortest, but it
// always finishes.
// It fixes the top row, then the left column, and repeats, shrinking the unsolved area until only a
// 2×2 corner is left, which just needs turning. To move a tile, it walks the tile home one cell at a
// time and brings the gap round in front of it each step (both paths found by breadth-first search).
// The last two tiles of each row or column go in together with the usual corner trick.

/** Returns the moves that solve the board: each is the cell whose tile slides into the gap. */
export function solve(start, N) {
  const cells = start.slice();
  const G = N * N - 1;
  const where = new Int32Array(N * N);
  cells.forEach((t, i) => { where[t] = i; });
  let gap = where[G];
  const locked = new Uint8Array(N * N);
  const prev = new Int32Array(N * N);
  const path = [gap];       // every position the gap visits

  const move = to => {
    const t = cells[to];
    cells[gap] = t; where[t] = gap;
    cells[to] = G; where[G] = to;
    gap = to;
    // Going straight back where it came from cancels the last move.
    if (path.length > 1 && path[path.length - 2] === to) path.pop(); else path.push(to);
  };

  /** Cells from `from` (excluded) to `to` (included), avoiding locked cells and `avoid`. */
  const route = (from, to, avoid) => {
    if (from === to) return [];
    prev.fill(-1);
    prev[from] = from;
    const q = [from];
    for (let h = 0; h < q.length; h++) {
      const x = q[h], r = (x / N) | 0, c = x % N;
      const next = [];
      if (r > 0) next.push(x - N);
      if (r < N - 1) next.push(x + N);
      if (c > 0) next.push(x - 1);
      if (c < N - 1) next.push(x + 1);
      for (const y of next) {
        if (prev[y] !== -1 || locked[y] || y === avoid) continue;
        prev[y] = x;
        if (y === to) {
          const p = [y];
          for (let z = x; z !== from; z = prev[z]) p.push(z);
          return p.reverse();
        }
        q.push(y);
      }
    }
    return null;
  };

  const gapTo = (target, avoid = -1) => {
    const p = route(gap, target, avoid);
    if (!p) throw new Error('gap is boxed in');
    for (const s of p) move(s);
  };

  const place = (tile, target) => {
    while (where[tile] !== target) {
      const p = route(where[tile], target, -1);
      if (!p) throw new Error('tile is boxed in');
      gapTo(p[0], where[tile]);
      move(where[tile]);
    }
  };

  /**
   * The last two of a line: tile b goes into a's cell, tile a just past it (`beside`), then the gap
   * swings round and both drop into place. If a ends up in b's corner (or the gap is in the corner
   * with a right next to it) nothing can get out, so a is parked out of the way first.
   */
  const lastTwo = (a, b, beside, next, park) => {
    if (where[a] === a && where[b] === b) return;
    const stuck = () => where[a] === b || (gap === b && where[a] === next);
    for (let tries = 0; tries < 8; tries++) {
      place(b, a);
      if (!stuck()) break;
      place(a, park);
      locked[park] = 1;
      place(b, a);
      locked[park] = 0;
      if (!stuck()) break;
    }
    locked[a] = 1;
    place(a, beside);
    locked[beside] = 1;
    gapTo(b);
    locked[a] = locked[beside] = 0;
    move(a);
    move(beside);
  };

  const id = (r, c) => r * N + c;
  let top = 0, left = 0;
  while (N - top > 2 || N - left > 2) {
    if (N - top >= N - left) {
      for (let c = left; c < N - 2; c++) { place(id(top, c), id(top, c)); locked[id(top, c)] = 1; }
      lastTwo(id(top, N - 2), id(top, N - 1), id(top + 1, N - 2), id(top + 1, N - 1), id(top + 2, N - 1));
      locked[id(top, N - 2)] = locked[id(top, N - 1)] = 1;
      top++;
    } else {
      for (let r = top; r < N - 2; r++) { place(id(r, left), id(r, left)); locked[id(r, left)] = 1; }
      lastTwo(id(N - 2, left), id(N - 1, left), id(N - 2, left + 1), id(N - 1, left + 1), id(N - 1, left + 2));
      locked[id(N - 2, left)] = locked[id(N - 1, left)] = 1;
      left++;
    }
  }
  const ring = [id(N - 2, N - 2), id(N - 2, N - 1), id(N - 1, N - 1), id(N - 1, N - 2)];
  for (let k = 0; k < 12 && cells.some((t, i) => t !== i); k++) move(ring[(ring.indexOf(gap) + 1) % 4]);
  if (cells.some((t, i) => t !== i)) throw new Error('not solvable');
  return path.slice(1);
}
