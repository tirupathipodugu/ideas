// Elon City is downtown Austin, Texas: real streets, buildings, Lady Bird Lake and parks from OpenStreetMap
// (© OpenStreetMap contributors, ODbL), plus Elon's places dropped onto open ground: the Gigafactory,
// The Boring Company and its Loop stations, Starlink, Tesla Service, ElonPD, Rival Motors and Starbase.
import { THREE, V3, scene, renderer, camera, G, canvasTex, solids, posts, rnd, pick, clamp, onUpdate, addPoly, inPoly } from './core.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

export const MAP = await fetch('assets/austin.json').then(r => r.json());
const EXT = MAP.extent;
export const HALF = Math.max(EXT.xmax, EXT.zmax);
export const LANE = 4.5;
export const LAND = { minx: EXT.xmin, maxx: EXT.xmax, minz: EXT.zmin, maxz: EXT.zmax };
G.cityHALF = HALF;

// Same dice every time, so the city looks the same on every visit.
let seed = 20261024;
const srnd = (a = 0, b = 1) => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return a + (b - a) * (((t ^ (t >>> 14)) >>> 0) / 4294967296);
};
const spick = list => list[Math.floor(srnd(0, list.length))];

export const places = {};

/* ---------------- sky, light ---------------- */
// A real sunset sky (Poly Haven, CC0) lights the whole city and fills every reflection.
// Until it loads, a painted gradient stands in.
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  fog: false,
  vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `varying vec3 vD;
    void main(){
      float h = vD.y;
      vec3 c = mix(vec3(1.0, 0.68, 0.42), vec3(0.42, 0.55, 0.78), smoothstep(-0.02, 0.5, h));
      gl_FragColor = vec4(c, 1.0);
    }`,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(4200, 32, 16), skyMat);
scene.add(sky);
scene.fog = new THREE.FogExp2(0xc9a48e, 0.00032);
camera.far = 6000;
camera.updateProjectionMatrix();

const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x4a4038, 0.25);
scene.add(hemi);
export const sun = new THREE.DirectionalLight(0xffdcc0, 1.9);
const sunDir = new V3(-0.8, 0.22, 0.4).normalize();
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -110, right: 110, top: 110, bottom: -110, near: 10, far: 1400 });
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.5;
scene.add(sun, sun.target);
// The shadow box follows the player; the light comes from where the sun is in the sky.
export const followSun = p => {
  sun.position.set(p.x + sunDir.x * 600, sunDir.y * 600, p.z + sunDir.z * 600);
  sun.target.position.set(p.x, 0, p.z);
};

export const skyReady = new RGBELoader().loadAsync('assets/sky.hdr').then(tex => {
  tex.mapping = THREE.EquirectangularReflectionMapping;
  // Find the sun: the brightest texel of the sky (half floats by default).
  const { data, width, height } = tex.image;
  const f = data instanceof Uint16Array ? THREE.DataUtils.fromHalfFloat : x => x;
  let best = -1, bi = 0;
  for (let i = 0; i < width * height; i += 2) {
    const l = f(data[i * 4]) + f(data[i * 4 + 1]) + f(data[i * 4 + 2]);
    if (l > best) {
      best = l;
      bi = i;
    }
  }
  // Same mapping three.js uses for equirectangular skies.
  const a = ((bi % width) / width - 0.5) * Math.PI * 2;
  const el = (0.5 - Math.floor(bi / width) / height) * Math.PI;
  sunDir.set(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el));
  if (sunDir.y < 0.1) sunDir.y = 0.1;
  sunDir.normalize();
  scene.background = tex;
  scene.backgroundIntensity = 0.7;
  scene.backgroundBlurriness = 0.0;
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromEquirectangular(tex).texture;
  pm.dispose();
  sky.visible = false;
}).catch(err => console.warn('sky', err));
{
  const pm = new THREE.PMREMGenerator(renderer);
  const es = new THREE.Scene();
  es.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), skyMat));
  scene.environment = pm.fromScene(es, 0.02).texture;
  pm.dispose();
}

/* ---------------- materials from real textures (Poly Haven, CC0) ---------------- */
const texLoader = new THREE.TextureLoader();
const tex = (file, repeat, srgb = false) => {
  const t = texLoader.load('assets/' + file);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
};
// map + normal + ARM (ambient occlusion, roughness, metalness in one image)
export const pbr = (name, repeat, extra = {}) => {
  const arm = tex(name + '_arm.jpg', repeat);
  return new THREE.MeshStandardMaterial({
    map: tex(name + '_diff.jpg', repeat, true),
    normalMap: tex(name + '_nor.jpg', repeat),
    roughnessMap: arm,
    metalnessMap: arm,
    aoMap: arm,
    metalness: 0,
    ...extra,
  });
};
// Flat things on the ground draw in layers instead of fighting: ground, parks, water, roads, paint.
const layer = (m, k) => {
  m.polygonOffset = true;
  m.polygonOffsetFactor = -k;
  m.polygonOffsetUnits = -k * 4;
  return m;
};

/* ---------------- shapes from the map ---------------- */
// A flat ring [x0, z0, ...] as a ground-level ShapeGeometry with UVs in metres / scale.
const flat = (rings, y, scale) => {
  const geos = [];
  for (const { p, h } of rings) {
    const v = [];
    for (let i = 0; i < p.length; i += 2) v.push(new THREE.Vector2(p[i], -p[i + 1]));
    const shape = new THREE.Shape(v);
    for (const hole of h || []) {
      const hv = [];
      for (let i = 0; i < hole.length; i += 2) hv.push(new THREE.Vector2(hole[i], -hole[i + 1]));
      shape.holes.push(new THREE.Path(hv));
    }
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    g.translate(0, y, 0);
    const pos = g.getAttribute('position'), uv = g.getAttribute('uv');
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / scale, pos.getZ(i) / scale);
    geos.push(g);
  }
  return geos.length ? mergeGeometries(geos) : null;
};

/* ---------------- the ground, the lake and the parks ---------------- */
{
  // Hill-country grass all round; the city itself is paved.
  const grassMat = pbr('grass', 1, { roughness: 1, color: 0x9cc77e });
  const out = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), grassMat);
  for (const k of ['map', 'normalMap', 'roughnessMap', 'aoMap']) grassMat[k].repeat.set(9000 / 8, 9000 / 8);
  out.rotation.x = -Math.PI / 2;
  out.position.y = -0.05;
  out.receiveShadow = true;
  scene.add(out);
  const W = EXT.xmax - EXT.xmin + 60, D = EXT.zmax - EXT.zmin + 60;
  const paveMat = pbr('sidewalk', 1, { roughness: 1, color: 0xc4c0b8 });
  for (const k of ['map', 'normalMap', 'roughnessMap', 'aoMap']) paveMat[k].repeat.set(W / 2.5, D / 2.5);
  const pave = new THREE.Mesh(new THREE.PlaneGeometry(W, D), paveMat);
  pave.rotation.x = -Math.PI / 2;
  pave.position.y = 0;
  pave.receiveShadow = true;
  scene.add(pave);
}
const parkMat = layer(pbr('grass', 1, { roughness: 1, color: 0x9cc77e }), 1);
{
  const g = flat(MAP.parks, 0.02, 6);
  const m = new THREE.Mesh(g, parkMat);
  m.receiveShadow = true;
  scene.add(m);
}
// Lady Bird Lake and the creeks: a deep blue that mirrors the sky, its surface rippling.
const waterNormals = tex('waternormals.jpg', 1);
const waterMat = layer(new THREE.MeshStandardMaterial({ color: 0x1d5866, roughness: 0.06, metalness: 0.1, normalMap: waterNormals, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.2 }), 2);
{
  const m = new THREE.Mesh(flat(MAP.water, 0.03, 40), waterMat);
  scene.add(m);
}
onUpdate(dt => {
  waterNormals.offset.x += dt * 0.004;
  waterNormals.offset.y += dt * 0.0025;
}, 91);

// Is (x, z) water? A grid of the lake's polygons keeps this quick.
const WCELL = 64;
const wcells = new Map();
for (const w of MAP.water) {
  let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
  for (let i = 0; i < w.p.length; i += 2) {
    minx = Math.min(minx, w.p[i]);
    maxx = Math.max(maxx, w.p[i]);
    minz = Math.min(minz, w.p[i + 1]);
    maxz = Math.max(maxz, w.p[i + 1]);
  }
  for (let i = Math.floor(minx / WCELL); i <= Math.floor(maxx / WCELL); i++)
    for (let j = Math.floor(minz / WCELL); j <= Math.floor(maxz / WCELL); j++) {
      const k = i * 10007 + j;
      if (!wcells.has(k)) wcells.set(k, []);
      wcells.get(k).push(w);
    }
}
export const inWater = (x, z) => {
  for (const w of wcells.get(Math.floor(x / WCELL) * 10007 + Math.floor(z / WCELL)) || [])
    if (inPoly(w.p, x, z) && !(w.h || []).some(h => inPoly(h, x, z))) return true;
  return false;
};

/* ---------------- the road graph ---------------- */
// Nodes are junctions and ends; edges carry the polyline, width, lanes and whether it is one way.
export const nodes = MAP.roads.nodes.map(([x, z], id) => ({ id, x, z, out: [], all: [] }));
export const edges = MAP.roads.edges.map((r, id) => {
  const cum = [0];
  for (let i = 2; i < r.p.length; i += 2) cum.push(cum[cum.length - 1] + Math.hypot(r.p[i] - r.p[i - 2], r.p[i + 1] - r.p[i - 1]));
  const e = { id, a: r.a, b: r.b, p: r.p, cum, len: cum[cum.length - 1], w: r.w, c: r.c, lanes: r.l || 1, oneway: !!r.o, name: r.n || '', bridge: !!r.br, drive: r.c !== 'service' };
  nodes[r.a].all.push({ e, dir: 1 });
  nodes[r.b].all.push({ e, dir: -1 });
  nodes[r.a].out.push({ e, dir: 1 });
  if (!e.oneway) nodes[r.b].out.push({ e, dir: -1 });
  return e;
});
// Point and heading at distance s along an edge, measured from a.
export const edgePoint = (e, s, out = {}) => {
  s = clamp(s, 0, e.len);
  let i = 1;
  while (i < e.cum.length - 1 && e.cum[i] < s) i++;
  const p = e.p, t = (s - e.cum[i - 1]) / ((e.cum[i] - e.cum[i - 1]) || 1);
  const ax = p[i * 2 - 2], az = p[i * 2 - 1], bx = p[i * 2], bz = p[i * 2 + 1];
  const l = Math.hypot(bx - ax, bz - az) || 1;
  out.x = ax + (bx - ax) * t;
  out.z = az + (bz - az) * t;
  out.dx = (bx - ax) / l;
  out.dz = (bz - az) / l;
  return out;
};
// Distance along an edge (from a) of the point nearest to (x, z), and how far away it is.
export const projectEdge = (e, x, z) => {
  let best = Infinity, bs = 0;
  const p = e.p;
  for (let i = 0; i < p.length - 2; i += 2) {
    const ax = p[i], az = p[i + 1], vx = p[i + 2] - ax, vz = p[i + 3] - az;
    const L2 = vx * vx + vz * vz || 1e-9;
    const t = clamp(((x - ax) * vx + (z - az) * vz) / L2, 0, 1);
    const d = Math.hypot(x - ax - vx * t, z - az - vz * t);
    if (d < best) {
      best = d;
      bs = e.cum[i / 2] + Math.sqrt(L2) * t;
    }
  }
  return { s: bs, d: best };
};
// Edges sorted into a grid by where they run.
const ECELL = 48;
const ecells = new Map();
for (const e of edges) {
  const seen = new Set();
  for (let i = 0; i < e.p.length; i += 2) {
    const k = Math.floor(e.p[i] / ECELL) * 10007 + Math.floor(e.p[i + 1] / ECELL);
    if (seen.has(k)) continue;
    seen.add(k);
    if (!ecells.has(k)) ecells.set(k, []);
    ecells.get(k).push(e);
  }
  // Long straight pieces: fill the cells between points too.
  for (let i = 2; i < e.p.length; i += 2) {
    const n = Math.ceil(Math.hypot(e.p[i] - e.p[i - 2], e.p[i + 1] - e.p[i - 1]) / (ECELL / 2));
    for (let k2 = 1; k2 < n; k2++) {
      const x = e.p[i - 2] + ((e.p[i] - e.p[i - 2]) * k2) / n, z = e.p[i - 1] + ((e.p[i + 1] - e.p[i - 1]) * k2) / n;
      const k = Math.floor(x / ECELL) * 10007 + Math.floor(z / ECELL);
      if (seen.has(k)) continue;
      seen.add(k);
      if (!ecells.has(k)) ecells.set(k, []);
      ecells.get(k).push(e);
    }
  }
}
// The nearest edge to (x, z) that passes the filter.
export const nearestEdge = (x, z, filter = e => e.drive, maxR = 3) => {
  let best = null;
  for (let r = 0; r <= maxR && !best; r++)
    for (let i = -r; i <= r; i++)
      for (let j = -r; j <= r; j++) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
        for (const e of ecells.get((Math.floor(x / ECELL) + i) * 10007 + Math.floor(z / ECELL) + j) || []) {
          if (!filter(e)) continue;
          const q = projectEdge(e, x, z);
          if (!best || q.d < best.d) best = { e, s: q.s, d: q.d };
        }
      }
  return best;
};
export const nearestNode = (x, z) => {
  const q = nearestEdge(x, z, () => true, 6);
  if (!q) return nodes[0];
  return q.s < q.e.len / 2 ? nodes[q.e.a] : nodes[q.e.b];
};
// A random edge with its middle between min and max metres from p.
const _mid = {};
export const randomEdgeNear = (p, min, max, filter = e => e.drive) => {
  for (let k = 0; k < 40; k++) {
    const e = edges[Math.floor(Math.random() * edges.length)];
    if (!filter(e)) continue;
    edgePoint(e, e.len / 2, _mid);
    const d = Math.hypot(_mid.x - p.x, _mid.z - p.z);
    if (d > min && d < max) return e;
  }
  return null;
};
// Lane offset to the right of travel: two-way roads keep right, one-way roads use the middle.
export const laneOffset = e => (e.oneway ? (e.lanes > 1 ? e.w / 4 : 0) : clamp(e.w / 4, 1.6, 5));
// The sidewalk: just off the edge of the road.
export const walkOffset = e => e.w / 2 + 2.2;

// Is this solid ground (or a bridge) rather than lake?
const bridges = edges.filter(e => e.bridge);
export const onBridge = (x, z) => {
  for (const e of bridges) if (projectEdge(e, x, z).d < e.w / 2 + 1.2) return true;
  return false;
};
export const isLand = (x, z) => !inWater(x, z) || onBridge(x, z);

/* ---------------- roads, junctions and paint ---------------- */
const asphaltMat = layer(pbr('asphalt', 1, { roughness: 1, envMapIntensity: 0.7 }), 3);
{
  const pos = [], uv = [], idx = [];
  const Y = 0.04;
  const push = (x, z) => {
    pos.push(x, Y, z);
    uv.push(x / 7, z / 7);
    return pos.length / 3 - 1;
  };
  for (const e of edges) {
    const p = e.p, n = p.length / 2, hw = e.w / 2;
    let prev = null;
    for (let i = 0; i < n; i++) {
      // Miter between the segments either side of the point.
      const ax = p[Math.max(0, i - 1) * 2], az = p[Math.max(0, i - 1) * 2 + 1];
      const bx = p[Math.min(n - 1, i + 1) * 2], bz = p[Math.min(n - 1, i + 1) * 2 + 1];
      let dx = bx - ax, dz = bz - az;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      let k = hw;
      if (i > 0 && i < n - 1) {
        const ux = p[i * 2] - ax, uz = p[i * 2 + 1] - az, ul = Math.hypot(ux, uz) || 1;
        const cos = (ux / ul) * dx + (uz / ul) * dz;
        k = hw / Math.max(0.5, Math.sqrt((1 + cos) / 2));
      }
      const x = p[i * 2], z = p[i * 2 + 1];
      const L = push(x - dz * k, z + dx * k), R = push(x + dz * k, z - dx * k);
      if (prev) idx.push(prev[0], prev[1], L, prev[1], R, L);
      prev = [L, R];
    }
  }
  // Junctions: a disc as wide as the widest road meeting there.
  for (const nd of nodes) {
    if (!nd.all.length) continue;
    const r = Math.max(...nd.all.map(o => o.e.w)) / 2 + 0.3;
    const c = push(nd.x, nd.z);
    const seg = 14;
    const first = pos.length / 3;
    for (let k = 0; k < seg; k++) push(nd.x + Math.cos((k / seg) * Math.PI * 2) * r, nd.z + Math.sin((k / seg) * Math.PI * 2) * r);
    for (let k = 0; k < seg; k++) idx.push(c, first + ((k + 1) % seg), first + k);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  // Some quads come out facing down; draw both sides rather than chase their winding.
  asphaltMat.side = THREE.DoubleSide;
  g.computeVertexNormals();
  const nrm = g.getAttribute('normal');
  for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
  const roads = new THREE.Mesh(g, asphaltMat);
  roads.receiveShadow = true;
  scene.add(roads);
}

// Paint: yellow centre dashes on two-way streets, white lane dashes on one-way ones, zebra crossings at junctions.
{
  const dash = new THREE.PlaneGeometry(0.16, 3);
  dash.rotateX(-Math.PI / 2);
  const yellow = [], white = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new V3(0, 1, 0), one = new V3(1, 1, 1);
  const pt = {};
  for (const e of edges) {
    if (e.c === 'service' || e.w < 6.5) continue;
    const ra = Math.max(...nodes[e.a].all.map(o => o.e.w)) / 2 + 3, rb = Math.max(...nodes[e.b].all.map(o => o.e.w)) / 2 + 3;
    const offs = e.oneway ? Array.from({ length: Math.max(0, e.lanes - 1) }, (_, k) => -e.w / 2 + (e.w * (k + 1)) / e.lanes) : [0];
    for (let s = ra; s < e.len - rb; s += 9) {
      edgePoint(e, s, pt);
      q.setFromAxisAngle(up, Math.atan2(pt.dx, pt.dz));
      for (const o of offs) {
        m.compose(new V3(pt.x - pt.dz * o, 0.05, pt.z + pt.dx * o), q, one);
        (e.oneway ? white : yellow).push(m.clone());
      }
    }
  }
  const bar = new THREE.PlaneGeometry(0.6, 3.6);
  bar.rotateX(-Math.PI / 2);
  const zebra = [];
  for (const nd of nodes) {
    if (nd.all.length < 3) continue;
    const r = Math.max(...nd.all.map(o => o.e.w)) / 2 + 2.2;
    for (const { e, dir } of nd.all) {
      if (e.c === 'service' || e.c.startsWith('motorway') || e.len < r * 2 + 6) continue;
      edgePoint(e, dir > 0 ? r : e.len - r, pt);
      const yaw = Math.atan2(pt.dx, pt.dz);
      q.setFromAxisAngle(up, yaw);
      for (let o = -e.w / 2 + 0.6; o <= e.w / 2 - 0.5; o += 1.25) {
        m.compose(new V3(pt.x - pt.dz * o, 0.05, pt.z + pt.dx * o), q, one);
        zebra.push(m.clone());
      }
    }
  }
  const paint = (geo, list, color) => {
    if (!list.length) return;
    const mat = layer(new THREE.MeshStandardMaterial({ color, roughness: 0.65 }), 4);
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((x, i) => im.setMatrixAt(i, x));
    im.receiveShadow = true;
    scene.add(im);
  };
  paint(dash, yellow, 0xf2c230);
  paint(dash, white, 0xf0eee8);
  paint(bar, zebra, 0xebe7df);
}

// Bridges get concrete parapets so they read as bridges over the lake.
{
  const parts = [];
  const pt = {}, pt2 = {};
  for (const e of edges) {
    if (!e.bridge) continue;
    for (let s = 0; s < e.len - 0.1; s += 6) {
      edgePoint(e, s, pt);
      edgePoint(e, Math.min(e.len, s + 6), pt2);
      const len = Math.hypot(pt2.x - pt.x, pt2.z - pt.z);
      if (len < 0.2) continue;
      for (const side of [-1, 1]) {
        const o = side * (e.w / 2 + 0.3);
        const g = new THREE.BoxGeometry(0.4, 1.1, len + 0.05);
        g.rotateY(Math.atan2(pt2.x - pt.x, pt2.z - pt.z));
        g.translate((pt.x + pt2.x) / 2 - pt.dz * o, 0.55, (pt.z + pt2.z) / 2 + pt.dx * o);
        parts.push(g);
      }
    }
  }
  if (parts.length) {
    const m = new THREE.Mesh(mergeGeometries(parts), new THREE.MeshStandardMaterial({ color: 0xcfcac2, roughness: 0.85 }));
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  }
}

/* ---------------- buildings ---------------- */
// Facades are drawn in the shader from per-wall coordinates: each wall gets a whole number of window bays
// between corner piers, floors of the right height for its kind of building, a storefront at street level,
// cornices, sills, a coping band at the top, and street-canyon shading. Edges are filtered so distant windows
// blend instead of shimmering. The filtered pulse and canyon shading follow Slop New York by mrdoob (MIT).
// Styles: 0 limestone (punched windows), 1 glass curtain wall, 2 modern ribbon windows, 3 brick.
const wallMat = pbr('plaster', 1, { vertexColors: true, roughness: 1, envMapIntensity: 1 });
wallMat.onBeforeCompile = sh => {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec3 wuv;\nattribute vec4 wall;\nvarying vec3 vW;\nvarying vec4 vWall;')
    .replace('#include <uv_vertex>', '#include <uv_vertex>\nvW = wuv;\nvWall = wall;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>
      varying vec3 vW;
      varying vec4 vWall;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      // Box-filtered pulse train: 1 between a and b in every unit period, averaged over a pixel's width w.
      float I1(float t, float a, float b){ return floor(t) * (b - a) + clamp(fract(t), a, b) - a; }
      float pulse(float x, float a, float b, float fw){ float w = max(fw, 1e-4) * 0.5; return (I1(x + w, a, b) - I1(x - w, a, b)) / (2.0 * w); }
      // x: glass, y: light trim (frames, sills, cornices), z: random per pane, w: dark (recess, mortar)
      vec4 facade(vec3 w, vec4 wl, float fx, float fy){
        if (w.z < -0.5) return vec4(0.0);
        float style = w.z, L = wl.x, bays = wl.y, seed = wl.z, top = wl.w;
        float x = w.x, y = w.y;
        float glassy = step(0.5, style) * step(style, 1.5);
        float pier = glassy > 0.5 ? 0.0 : min(1.2, 0.2 * L);
        float gu = (x - pier) / max(L - 2.0 * pier, 0.01) * bays;
        float fu = fx / max(L - 2.0 * pier, 0.01) * bays;
        float inBays = step(0.0, gu) * step(gu, bays);
        float fh = style < 0.5 ? 3.7 : style < 1.5 ? 3.9 : style < 2.5 ? 3.5 : 3.5;
        float coping = smoothstep(top - 0.45, top - 0.3, y);
        // Street level: big shop windows between pillars, a fascia band above.
        if (y < 4.5) {
          float su = x / 5.2;
          float g = pulse(su, 0.1, 0.9, fx / 5.2) * pulse(y / 4.5, 0.06, 0.72, fy / 4.5);
          float fascia = pulse(y / 4.5, 0.78, 0.9, fy / 4.5);
          return vec4(g, fascia, hash(vec2(floor(su), seed + 7.0)), pulse(su, 0.06, 0.1, fx / 5.2) * step(y, 3.3));
        }
        float gv = (y - 4.5) / fh;
        float fv = fy / fh;
        // A partial top storey is parapet, not windows.
        float lastFloor = floor((top - 4.5) / fh) - 1.0;
        float below = step(floor(gv), lastFloor);
        vec2 cell = vec2(floor(gu), floor(gv));
        float rnd = hash(cell + seed);
        float glass = 0.0, trim = 0.0, dark = 0.0;
        if (glassy > 0.5) {
          // Curtain wall: thin mullions, a spandrel at each floor, a louvred plant floor every 16.
          float mech = step(15.0, mod(floor(gv), 16.0));
          glass = pulse(gu, 0.04, 0.96, fu) * pulse(gv, 0.2, 1.0, fv) * (1.0 - mech);
          trim = (1.0 - glass) * (1.0 - mech) * 0.6;
          dark = mech * (0.5 + 0.5 * step(0.5, fract(y * 3.5)));
        } else if (style < 2.5 && style > 1.5) {
          // Ribbon windows: continuous glass bands, solid bands between.
          glass = pulse(gv, 0.28, 0.86, fv) * pulse(x / 1.8, 0.04, 1.0, fx / 1.8);
          trim = pulse(gv, 0.86, 0.9, fv);
        } else {
          // Punched windows with sills, lintel shadow and cornices every six floors.
          glass = pulse(gu, 0.25, 0.75, fu) * pulse(gv, 0.22, 0.8, fv) * inBays;
          trim = pulse(gu, 0.21, 0.79, fu) * pulse(gv, 0.16, 0.22, fv) * inBays;
          dark = pulse(gu, 0.25, 0.75, fu) * pulse(gv, 0.74, 0.8, fv) * inBays * 0.6;
          trim += pulse(gv / 6.0, 0.965, 1.0, fv / 6.0);
          // A window AC unit now and then.
          float ac = step(0.9, hash(cell + seed + 3.1)) * pulse(gu, 0.33, 0.67, fu) * pulse(gv, 0.22, 0.36, fv) * inBays;
          glass *= 1.0 - ac;
          trim += ac * 0.8;
          // Brick: running bond with mortar lines.
          if (style > 2.5) {
            float row = floor(y / 0.24);
            float bu = x / 0.56 + 0.5 * mod(row, 2.0);
            float mortar = 1.0 - pulse(bu, 0.04, 1.0, fx / 0.56) * pulse(y / 0.24, 0.1, 1.0, fy / 0.24);
            dark = max(dark, mortar * 0.35 * (1.0 - glass));
          }
        }
        glass *= below * (1.0 - coping);
        trim = clamp(trim + coping, 0.0, 1.0);
        return vec4(glass, trim, rnd, dark);
      }`)
    .replace('#include <map_fragment>', `#include <map_fragment>
      float fwx = fwidth(vW.x), fwy = fwidth(vW.y);
      vec4 fac = facade(vW, vWall, fwx, fwy);
      float glassK = fac.x;
      float isGlassWall = step(0.5, vW.z) * step(vW.z, 1.5);
      vec3 tint = mix(vec3(0.05, 0.08, 0.11), vec3(0.10, 0.13, 0.12), fac.z);
      if (isGlassWall > 0.5) tint = mix(vec3(0.07, 0.13, 0.17), diffuseColor.rgb * 0.32, 0.55 + 0.2 * fac.z);
      if (vW.z < -0.5) diffuseColor.rgb = vec3(0.45, 0.44, 0.42) * texture2D(map, vMapUv).rgb;
      // Brick-to-brick colour wobble.
      if (vW.z > 2.5) diffuseColor.rgb *= 0.93 + 0.14 * hash(vec2(floor(vW.x / 0.56 + 0.5 * mod(floor(vW.y / 0.24), 2.0)), floor(vW.y / 0.24)));
      diffuseColor.rgb = mix(diffuseColor.rgb, isGlassWall > 0.5 ? vec3(0.62, 0.66, 0.7) : diffuseColor.rgb * 1.18 + 0.06, fac.y * 0.8);
      diffuseColor.rgb *= 1.0 - fac.w * 0.55;
      // Some rooms have their lights on: warm glass.
      tint = mix(tint, vec3(0.62, 0.47, 0.3), step(0.92, fac.z) * 0.55);
      diffuseColor.rgb = mix(diffuseColor.rgb, tint, glassK);
      // Street canyon: darker low down, light bouncing warm off the buildings across the street.
      if (vW.z > -0.5) {
        float ao = mix(0.5, 1.0, smoothstep(0.0, 68.0, vW.y)) * (0.8 + 0.2 * smoothstep(0.0, 7.5, vW.y));
        diffuseColor.rgb *= ao;
        diffuseColor.rgb += vec3(0.91, 0.61, 0.41) * 0.035 * smoothstep(14.0, 30.0, vW.y) * (1.0 - smoothstep(40.0, 75.0, vW.y));
      }`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, 0.14, glassK);
      roughnessFactor = mix(roughnessFactor, 0.4, fac.y * isGlassWall);`)
    .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
      metalnessFactor = glassK * 0.92 + fac.y * isGlassWall * 0.6;`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      normal = normalize(mix(normal, normalize(vNormal), max(glassK, fac.y)));`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      //EMISSIVE_OFF totalEmissiveRadiance += glassK * step(0.93, fac.z) * vec3(1.0, 0.74, 0.44) * 0.3;`);
};

// Austin colours: limestone and cream below, red and tan brick on the older blocks, blue-green glass up high.
const STONE = [0xe8dcc4, 0xf0e6d2, 0xd8c3a0, 0xc9c6c0, 0xe6d3b8, 0xdcd0bc, 0xcfc4b0];
const BRICK = [0xa65a42, 0x8f4a3a, 0xb7795b, 0x9c6a50, 0xc08a62];
const GLASS = [0x8fa9bd, 0x9fb7c4, 0x7d97a8, 0xb8c6cf, 0x6f8a96, 0xa6b9b0, 0x8a9aa8];
const MODERN = [0xd9d6d0, 0xbfc4c8, 0xe4ddd2, 0x9aa1a8];
export const buildingsByName = {};
{
  const pos = [], nrm = [], uv = [], wuv = [], wl = [], col = [], idx = [];
  const roofGear = [];
  const c = new THREE.Color();
  let wall = [0, 1, 0, 10];
  const vert = (x, y, z, nx, ny, nz, u, v, a, b, s) => {
    pos.push(x, y, z);
    nrm.push(nx, ny, nz);
    uv.push(u, v);
    wuv.push(a, b, s);
    wl.push(wall[0], wall[1], wall[2], wall[3]);
    col.push(c.r, c.g, c.b);
    return pos.length / 3 - 1;
  };
  for (const b of MAP.buildings) {
    const p = b.p, n = p.length / 2;
    if (n < 3) continue;
    const y0 = b.mh || 0;
    const name = b.n || '';
    const capitol = /Texas State Capitol/.test(name);
    let h = Math.max(b.h, y0 + 3);
    const r = srnd();
    const style = capitol ? 0 : h >= 55 ? (r < 0.85 ? 1 : 0) : h < 25 ? (r < 0.45 ? 3 : r < 0.6 ? 2 : 0) : r < 0.3 ? 3 : r < 0.55 ? 2 : 0;
    c.setHex(capitol ? 0xe7c3b0 : style === 1 ? spick(GLASS) : style === 3 ? spick(BRICK) : style === 2 ? spick(MODERN) : spick(STONE));
    if (name) buildingsByName[name] = b;
    const seed = Math.floor(srnd(0, 997));
    // Which way round the ring goes decides which side is outside.
    let area = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1];
    }
    const flip = area > 0;
    const winW = style === 1 ? 1.6 : style === 3 ? 2.4 : 2.6;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = p[i * 2], az = p[i * 2 + 1], bx = p[j * 2], bz = p[j * 2 + 1];
      const ex = bx - ax, ez = bz - az, L = Math.hypot(ex, ez);
      if (L < 0.05) continue;
      let nx = -ez / L, nz = ex / L;
      if (flip) {
        nx = -nx;
        nz = -nz;
      }
      // Whole bays on every wall, with its own dice so neighbours don't match.
      const pier = style === 1 ? 0 : Math.min(1.2, 0.2 * L);
      wall = [L, Math.max(1, Math.round((L - 2 * pier) / winW)), seed + Math.floor(nx * 17 + nz * 37), h];
      const A = vert(ax, y0, az, nx, 0, nz, 0, y0 / 4, 0, y0, style);
      const B = vert(bx, y0, bz, nx, 0, nz, L / 4, y0 / 4, L, y0, style);
      const C = vert(bx, h, bz, nx, 0, nz, L / 4, h / 4, L, h, style);
      const D = vert(ax, h, az, nx, 0, nz, 0, h / 4, 0, h, style);
      if (flip) idx.push(A, C, B, A, D, C);
      else idx.push(A, B, C, A, C, D);
    }
    // Flat roof.
    const contour = [];
    for (let i = 0; i < n; i++) contour.push(new THREE.Vector2(p[i * 2], p[i * 2 + 1]));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const base = pos.length / 3;
    wall = [0, 1, 0, h];
    for (let i = 0; i < n; i++) vert(p[i * 2], h, p[i * 2 + 1], 0, 1, 0, p[i * 2] / 4, p[i * 2 + 1] / 4, 0, 0, -1);
    for (const [a, bb, cc] of tris) {
      const ax = p[a * 2], az = p[a * 2 + 1];
      const cy = (p[bb * 2 + 1] - az) * (p[cc * 2] - ax) - (p[bb * 2] - ax) * (p[cc * 2 + 1] - az);
      if (cy >= 0) idx.push(base + a, base + bb, base + cc);
      else idx.push(base + a, base + cc, base + bb);
    }
    addPoly(p, h);
    // Rooftop plant: a penthouse box lined up with the longest wall, if it fits inside the roof.
    if (h > 14 && !capitol && Math.abs(area) > 500) {
      let li = 0, ll = 0;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, L = Math.hypot(p[j * 2] - p[i * 2], p[j * 2 + 1] - p[i * 2 + 1]);
        if (L > ll) {
          ll = L;
          li = i;
        }
      }
      const j = (li + 1) % n;
      const ux = (p[j * 2] - p[li * 2]) / ll, uz = (p[j * 2 + 1] - p[li * 2 + 1]) / ll;
      let cx = 0, cz = 0, minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (let i = 0; i < n; i++) {
        cx += p[i * 2] / n;
        cz += p[i * 2 + 1] / n;
      }
      for (let i = 0; i < n; i++) {
        const dx = p[i * 2] - cx, dz = p[i * 2 + 1] - cz;
        const a2 = dx * ux + dz * uz, b2 = -dx * uz + dz * ux;
        minA = Math.min(minA, a2);
        maxA = Math.max(maxA, a2);
        minB = Math.min(minB, b2);
        maxB = Math.max(maxB, b2);
      }
      const k = srnd(0.35, 0.55), wA = (maxA - minA) * k, wB = (maxB - minB) * k;
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sa, sb]) => [cx + ux * (sa * wA) / 2 - uz * (sb * wB) / 2, cz + uz * (sa * wA) / 2 + ux * (sb * wB) / 2]);
      if (wA > 3 && wB > 3 && corners.every(([x, z]) => inPoly(p, x, z))) {
        const ph = srnd(3.4, 5.8);
        const g = new THREE.BoxGeometry(wA, ph, wB);
        g.rotateY(Math.atan2(-uz, ux));
        g.translate(cx, h + ph / 2, cz);
        roofGear.push(g);
        if (h > 40 && srnd() < 0.35) {
          const ant = new THREE.CylinderGeometry(0.2, 0.3, srnd(8, 18), 6);
          ant.translate(cx + srnd(-wA, wA) * 0.3, h + ph + 5, cz + srnd(-wB, wB) * 0.3);
          roofGear.push(ant);
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('wuv', new THREE.Float32BufferAttribute(wuv, 3));
  g.setAttribute('wall', new THREE.Float32BufferAttribute(wl, 4));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const city = new THREE.Mesh(g, wallMat);
  city.castShadow = city.receiveShadow = true;
  scene.add(city);
  if (roofGear.length) {
    const gear = new THREE.Mesh(mergeGeometries(roofGear.map(x => (x.deleteAttribute('uv'), x.toNonIndexed()))), new THREE.MeshStandardMaterial({ color: 0x9a9690, roughness: 0.8, metalness: 0.25 }));
    gear.castShadow = gear.receiveShadow = true;
    scene.add(gear);
  }
}

/* ---------------- signs ---------------- */
const sign = (text, x, y, z, yaw, w, color = '#ff2d55', bg = null, parent = scene) => {
  const tex = canvasTex(1024, 192, (g, cw, ch) => {
    if (bg) {
      g.fillStyle = bg;
      g.fillRect(0, 0, cw, ch);
    } else g.clearRect(0, 0, cw, ch);
    g.font = '900 120px "Saira Condensed", Arial Narrow, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = color;
    g.shadowBlur = 24;
    g.fillStyle = color;
    g.fillText(text, cw / 2, ch / 2 + 6);
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, (w * 192) / 1024), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, side: THREE.DoubleSide }));
  m.position.set(x, y, z);
  m.rotation.y = yaw;
  parent.add(m);
  return m;
};

/* ---------------- landmarks of the real city ---------------- */
const plain = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...extra });
const centroid = p => {
  let x = 0, z = 0;
  for (let i = 0; i < p.length; i += 2) {
    x += p[i];
    z += p[i + 1];
  }
  return new V3(x / (p.length / 2), 0, z / (p.length / 2));
};
// The Texas State Capitol's dome, taller than the US Capitol's, topped by the Goddess of Liberty.
{
  const lm = MAP.landmarks.find(l => l.k === 'capitol') || MAP.landmarks.find(l => /Capitol/.test(l.n));
  const b = buildingsByName['Texas State Capitol'];
  const at = b ? centroid(b.p) : new V3(lm.x, 0, lm.z);
  const base = b ? b.h : 35;
  const granite = plain(0xe7c3b0, { roughness: 0.7 });
  const g = new THREE.Group();
  g.position.copy(at);
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(16, 17, 14, 40), granite);
  drum.position.y = base + 7;
  const cols = new THREE.Mesh(new THREE.CylinderGeometry(14.5, 14.5, 9, 24, 1, true), plain(0xf1e3d8, { roughness: 0.6, side: THREE.DoubleSide }));
  cols.position.y = base + 18.5;
  const dome = new THREE.Mesh(new THREE.SphereGeometry(15, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), plain(0xe9dccd, { roughness: 0.5 }));
  dome.scale.y = 1.25;
  dome.position.y = base + 23;
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.2, 8, 16), granite);
  lantern.position.y = base + 23 + 18.75 + 4;
  const goddess = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 5, 8), plain(0x8a7a64));
  goddess.position.y = base + 23 + 18.75 + 10.5;
  for (const m of [drum, cols, dome, lantern, goddess]) {
    m.castShadow = true;
    g.add(m);
  }
  scene.add(g);
  places.capitol = at.clone();
}
// Frost Bank Tower's faceted glass crown.
{
  const b = buildingsByName['Frost Bank Tower'];
  if (b) {
    const c = centroid(b.p);
    let r = 0;
    for (let i = 0; i < b.p.length; i += 2) r = Math.max(r, Math.hypot(b.p[i] - c.x, b.p[i + 1] - c.z));
    const crown = new THREE.Mesh(new THREE.ConeGeometry(r * 0.72, 32, 4), plain(0x7f9fb4, { metalness: 0.85, roughness: 0.12 }));
    crown.position.set(c.x, b.h + 16, c.z);
    crown.rotation.y = Math.PI / 4;
    crown.castShadow = true;
    scene.add(crown);
    places.frost = c.clone().setY(b.h);
  }
}

/* ---------------- Elon's places, on open ground found in the map ---------------- */
// Each spot faces the nearest street; a group placed there with +z towards the road.
const site = sp => {
  const g = new THREE.Group();
  const yaw = Math.atan2(sp.road[0] - sp.x, sp.road[1] - sp.z);
  g.position.set(sp.x, 0, sp.z);
  g.rotation.y = yaw;
  scene.add(g);
  const f = new V3(Math.sin(yaw), 0, Math.cos(yaw)), r = new V3(Math.cos(yaw), 0, -Math.sin(yaw));
  const at = (lx, lz) => new V3(sp.x, 0, sp.z).addScaledVector(r, lx).addScaledVector(f, lz);
  // A box in the site's frame; solid ones collide as rotated rectangles.
  const box = (w, h, d, lx, ly, lz, mat, solid = true) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(lx, ly, lz);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    if (solid) {
      const pts = [];
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const q = at(lx + (a * w) / 2, lz + (b * d) / 2);
        pts.push(q.x, q.z);
      }
      addPoly(pts, ly + h / 2);
    }
    return m;
  };
  return { g, yaw, f, r, at, box, road: new V3(sp.road[0], 0, sp.road[1]) };
};
const S = MAP.spots;

// Gigafactory beside the old Seaholm power plant.
{
  const s = site(S.giga);
  s.box(56, 18, 34, 0, 9, -6, plain(0xf3f5f7));
  s.box(56.2, 2.2, 34.2, 0, 14, -6, plain(0x20232a), false);
  sign('GIGA TEXAS', 0, 21.5, 11.3, 0, 40, '#ff2d2d', null, s.g);
  const red = plain(0xd8262c, { metalness: 0.3 });
  for (let k = 0; k < 6; k++) {
    s.box(0.7, 2, 0.5, -20 + k * 8, 1, 17, red, false);
    const q = s.at(-20 + k * 8, 17);
    posts.push({ x: q.x, z: q.z, r: 0.6 });
  }
  places.giga = s.at(0, 23);
  places.chargers = s.at(0, 17);
  places.spawn = s.at(0, 27);
  places.spawnYaw = s.yaw;
  // Where mission cars and the starter cars wait.
  places.gigaCars = [s.at(-14, 28), s.at(14, 28), s.at(-24, 22), s.at(24, 22), s.at(-34, 30), s.at(34, 30)];
  places.gigaYaw = s.yaw + Math.PI / 2;
  places.gigaSite = s;
}

// Tunnel portals: a concrete mouth with a dark hole and a ring of light, like the Loop.
const portalMat = plain(0x9da3ad);
const holeMat = new THREE.MeshBasicMaterial({ color: 0x050507 });
const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x8fd8ff).multiplyScalar(2), toneMapped: false });
places.loop = [];
const portal = (s, lx, lz, name) => {
  const g = new THREE.Group();
  g.position.set(lx, 0, lz);
  s.g.add(g);
  const wall = (w, h, d, px, py, pz) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), portalMat);
    m.position.set(px, py, pz);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  };
  wall(1.2, 6, 8, -4.6, 3, 0);
  wall(1.2, 6, 8, 4.6, 3, 0);
  wall(10.4, 1.4, 8, 0, 6.7, 0);
  const hole = new THREE.Mesh(new THREE.PlaneGeometry(8, 6), holeMat);
  hole.position.set(0, 3, -1.5);
  g.add(hole);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.12, 8, 40), ringMat);
  ring.position.set(0, 3, -1.2);
  g.add(ring);
  sign('LOOP · ' + name.toUpperCase(), 0, 8.6, 4.05, 0, 9, '#8fd8ff', '#0b0d12', g);
  for (const sx of [-1, 1]) {
    const q = s.at(lx + sx * 4.6, lz);
    posts.push({ x: q.x, z: q.z, r: 0.9 });
  }
  places.loop.push({ name, at: s.at(lx, lz + 2), out: s.at(lx, lz + 9), yaw: s.yaw });
};

// The Boring Company by the Convention Center, with the first Loop station.
{
  const s = site(S.boring);
  s.box(40, 12, 14, 0, 6, -7, plain(0x8b8f99));
  sign('THE BORING COMPANY', 0, 14.5, 0.2, 0, 34, '#f5f5f5', null, s.g);
  places.boring = s.at(-12, 10);
  portal(s, 12, 6, 'Convention Center');
}
// More Loop stations around downtown.
portal(places.gigaSite, 24, 6, 'Seaholm');
portal(site(S.loopCapitol), 0, 0, 'Capitol');
portal(site(S.loopRepublic), 0, 0, 'Republic Square');
portal(site(S.loopRainey), 0, 0, 'Rainey Street');

// Starlink: its dish on top of Frost Bank Tower, the office in the lobby.
{
  const top = places.frost || new V3(120, 150, 180);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(9, 32, 12, 0, Math.PI * 2, 0, 0.9), plain(0xf2f4f8, { side: THREE.DoubleSide, metalness: 0.2 }));
  dish.rotation.x = Math.PI + 0.5;
  dish.position.set(top.x + 6, top.y + 10, top.z + 6);
  scene.add(dish);
  const q = nearestEdge(top.x, top.z);
  const pt = edgePoint(q.e, q.s);
  const side = Math.sign((top.x - pt.x) * -pt.dz + (top.z - pt.z) * pt.dx) || 1;
  places.starlink = new V3(pt.x - pt.dz * side * walkOffset(q.e), 0, pt.z + pt.dx * side * walkOffset(q.e));
}

// Tesla Service: a drive-in bay.
{
  const s = site(S.service);
  const white = plain(0xf0f0f2);
  s.box(40, 10, 10, 0, 5, -8);
  s.box(40, 1, 14, 0, 9.5, 4, white, false);
  s.box(1, 9, 14, -19.5, 4.5, 4, plain(0xe5e5e8));
  s.box(1, 9, 14, 19.5, 4.5, 4, plain(0xe5e5e8));
  sign('TESLA SERVICE', 0, 12, 11.1, 0, 26, '#e82127', '#ffffff', s.g);
  places.service = s.at(0, 4);
}

// ElonPD headquarters, near the real APD on East 8th.
{
  const s = site(S.police);
  s.box(46, 16, 22, 0, 8, -5, plain(0x1d2a4a));
  sign('ELON PD', 0, 13, 6.2, 0, 22, '#4da3ff', null, s.g);
  for (const [dx, colr] of [[-8, 0xff2a3a], [8, 0x2a7bff]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(5, 0.6, 0.6), new THREE.MeshBasicMaterial({ color: colr, toneMapped: false }));
    m.position.set(dx, 16.4, 6.1);
    s.g.add(m);
  }
  places.police = s.at(0, 15);
}

// Rival Motors: a fenced yard with the prototype in it.
{
  const s = site(S.lot);
  const fence = plain(0x6b6f78, { metalness: 0.6 });
  for (const [x, z, w, d] of [[0, -26, 52, 0.4], [-26, 0, 0.4, 52], [26, 0, 0.4, 52]]) s.box(w, 2.4, d, x, 1.2, z, fence);
  sign('RIVAL MOTORS', 0, 4.5, -25.6, 0, 18, '#ffd23c', null, s.g);
  places.lot = s.at(0, 0);
}

// Parks: Republic Square is the one with the side jobs.
{
  const rs = MAP.parks.find(p => p.n === 'Republic Square');
  places.park = rs ? centroid(rs.p) : new V3(-323, 0, 24);
}

/* ---------------- Starbase on Auditorium Shores, across the lake from downtown ---------------- */
export const starbase = {};
{
  const s = site(S.pad);
  const px = S.pad.x, pz = S.pad.z;
  places.pad = new V3(px, 0, pz);
  places.starbase = s.at(0, 46);
  s.box(1, 8, 1, 30, 4, 46, plain(0x222222), false);
  sign('STARBASE', 30, 7, 46.6, 0, 22, '#ffffff', null, s.g);
  const padMesh = new THREE.Mesh(new THREE.CylinderGeometry(34, 34, 0.4, 48), plain(0xbfc3c9, { roughness: 0.9 }));
  padMesh.position.set(px, 0.2, pz);
  padMesh.receiveShadow = true;
  scene.add(padMesh);
  const steel = plain(0x8b9099, { metalness: 0.85, roughness: 0.35 });
  const mount = new THREE.Mesh(new THREE.CylinderGeometry(7, 8, 10, 6, 1, true), steel);
  mount.position.set(px, 5, pz);
  scene.add(mount);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    posts.push({ x: px + Math.cos(a) * 7, z: pz + Math.sin(a) * 7, r: 1.2 });
  }
  const tx = px - 17;
  const tower = new THREE.Group();
  const beam = new THREE.CylinderGeometry(0.35, 0.35, 1, 6);
  const pieces = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new V3(0, 1, 0);
  const bar = (a, b, r = 0.35) => {
    const d = b.clone().sub(a), len = d.length();
    q.setFromUnitVectors(up, d.normalize());
    m4.compose(a.clone().add(b).multiplyScalar(0.5), q, new V3(r / 0.35, len, r / 0.35));
    pieces.push(beam.clone().applyMatrix4(m4));
  };
  const H = 120, sz = 5;
  const cs = [[-sz, -sz], [sz, -sz], [sz, sz], [-sz, sz]];
  for (const [a, b] of cs) bar(new V3(tx + a, 0, pz + b), new V3(tx + a, H, pz + b), 0.6);
  for (let y = 0; y < H; y += 8)
    for (let k = 0; k < 4; k++) {
      const [a1, b1] = cs[k], [a2, b2] = cs[(k + 1) % 4];
      bar(new V3(tx + a1, y + 8, pz + b1), new V3(tx + a2, y + 8, pz + b2));
      bar(new V3(tx + a1, y, pz + b1), new V3(tx + a2, y + 8, pz + b2), 0.25);
    }
  const truss = new THREE.Mesh(mergeGeometries(pieces), steel);
  truss.castShadow = true;
  tower.add(truss);
  scene.add(tower);
  solids.push({ minx: tx - sz - 0.6, maxx: tx + sz + 0.6, minz: pz - sz - 0.6, maxz: pz + sz + 0.6, h: H });
  // The chopsticks: two arms that can swing and slide.
  const sticks = new THREE.Group();
  sticks.position.set(tx + sz, 70, pz);
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(22, 2.4, 1.6), steel);
    arm.position.set(11, 0, side * 6);
    arm.castShadow = true;
    sticks.add(arm);
  }
  scene.add(sticks);
  starbase.sticks = sticks;
  starbase.tower = { x: tx, z: pz };
}

// Starship: booster and ship, stainless steel, standing on the mount.
const stainless = new THREE.MeshStandardMaterial({ color: 0xd7dbe0, metalness: 1, roughness: 0.28, envMapIntensity: 1.3 });
const black = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.7 });
export const makeStarship = () => {
  const g = new THREE.Group();
  const R = 4.5;
  const booster = new THREE.Group();
  const b = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 52, 40), stainless);
  b.position.y = 26;
  b.castShadow = true;
  booster.add(b);
  for (let k = 0; k < 4; k++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.4, 3.2), black);
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    fin.position.set(Math.cos(a) * (R + 1.2), 50, Math.sin(a) * (R + 1.2));
    fin.rotation.y = -a;
    booster.add(fin);
  }
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.05, R + 0.05, 2, 40), black);
  ring.position.y = 52;
  booster.add(ring);
  // Engine plume: a long glowing cone under the booster, shown while the engines burn.
  const plumeMat = new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uK: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float uT; uniform float uK; varying vec2 vUv;
      void main(){
        float along = vUv.y;
        float flick = 0.85 + 0.15 * sin(uT * 60.0 + along * 30.0);
        vec3 col = mix(vec3(1.0, 0.45, 0.12), vec3(1.0, 0.95, 0.85), pow(along, 3.0));
        float a = pow(along, 1.6) * flick * uK;
        gl_FragColor = vec4(col * 2.2, a);
      }`,
  });
  const plume = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.85, R * 1.6, 46, 32, 1, true), plumeMat);
  plume.position.y = -23;
  plume.visible = false;
  booster.add(plume);
  g.add(booster);
  const ship = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 34, 40), stainless);
  body.position.y = 17;
  body.castShadow = true;
  ship.add(body);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(R, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), stainless);
  nose.scale.y = 2.4;
  nose.position.y = 34;
  ship.add(nose);
  // Heat-shield tiles down one side.
  const tiles = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.03, R + 0.03, 34, 40, 1, true, -Math.PI / 2, Math.PI), black);
  tiles.position.y = 17;
  ship.add(tiles);
  for (const [y, w, l] of [[30, 3.2, 5], [4, 4.4, 7]])
    for (const side of [-1, 1]) {
      const flap = new THREE.Mesh(new THREE.BoxGeometry(w, 0.35, l), black);
      flap.position.set(side * (R + w / 2 - 0.4), y, 0);
      flap.rotation.z = side * 0.15;
      ship.add(flap);
    }
  ship.position.y = 54;
  g.add(ship);
  g.userData = { booster, ship, plume };
  return g;
};
export const starship = makeStarship();
starship.position.set(places.pad.x, 10, places.pad.z);
scene.add(starship);

/* ---------------- trees and street lamps ---------------- */
// Live oaks in the parks and along the quieter streets; a few palms by the lake.
{
  const spots = [];
  const pt = {};
  const clear = (x, z) => !inWater(x, z) && !nearestEdgeWithin(x, z, 1.5);
  const nearestEdgeWithin = (x, z, pad) => {
    const q = nearestEdge(x, z, () => true, 1);
    return q && q.d < q.e.w / 2 + pad;
  };
  for (const p of MAP.parks) {
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity, area = 0;
    for (let i = 0; i < p.p.length; i += 2) {
      minx = Math.min(minx, p.p[i]);
      maxx = Math.max(maxx, p.p[i]);
      minz = Math.min(minz, p.p[i + 1]);
      maxz = Math.max(maxz, p.p[i + 1]);
    }
    area = (maxx - minx) * (maxz - minz);
    const n = Math.min(120, Math.floor(area / 380));
    for (let k = 0; k < n; k++) {
      const x = srnd(minx, maxx), z = srnd(minz, maxz);
      if (inPoly(p.p, x, z) && clear(x, z)) spots.push([x, z, 0]);
    }
  }
  for (const e of edges) {
    if (!(e.c === 'residential' || e.c === 'tertiary' || e.c === 'secondary') || e.bridge) continue;
    for (let s = 10; s < e.len - 10; s += 24) {
      if (srnd() < 0.45) continue;
      edgePoint(e, s, pt);
      const side = srnd() < 0.5 ? -1 : 1, o = side * (e.w / 2 + 2.6);
      const x = pt.x - pt.dz * o, z = pt.z + pt.dx * o;
      if (!inWater(x, z)) spots.push([x, z, 0]);
    }
  }
  const trees = spots.slice(0, 4000);
  const trunk = new THREE.CylinderGeometry(0.28, 0.45, 4, 7);
  trunk.translate(0, 2, 0);
  const blobs = [];
  for (const [x, y, z, r] of [[0, 5.2, 0, 3.2], [2.2, 4.6, 0.6, 2.4], [-2, 4.8, -0.8, 2.5], [0.4, 4.4, 2.1, 2.2], [-0.6, 4.5, -2.2, 2.3]]) {
    const b = new THREE.IcosahedronGeometry(r, 1);
    b.scale(1, 0.72, 1);
    b.translate(x, y, z);
    blobs.push(b);
  }
  const crown = mergeGeometries(blobs);
  const trunks = new THREE.InstancedMesh(trunk, plain(0x5b4636, { roughness: 1 }), trees.length);
  const crowns = new THREE.InstancedMesh(crown, plain(0x4f7a3a, { roughness: 0.9, flatShading: true }), trees.length);
  trunks.castShadow = crowns.castShadow = true;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), tint = new THREE.Color();
  trees.forEach(([x, z], k) => {
    const s = srnd(0.8, 1.35);
    q.setFromEuler(e.set(0, srnd(0, 6.28), 0));
    m.compose(new V3(x, 0, z), q, new V3(s, s * srnd(0.85, 1.15), s));
    trunks.setMatrixAt(k, m);
    crowns.setMatrixAt(k, m);
    crowns.setColorAt(k, tint.setHSL(0.27 + srnd(-0.03, 0.03), 0.42, 0.26 + srnd(-0.05, 0.05)));
  });
  scene.add(trunks, crowns);
}
// Street lamps along the main streets.
{
  const pole = new THREE.CylinderGeometry(0.12, 0.16, 8, 6);
  pole.translate(0, 4, 0);
  const head = new THREE.SphereGeometry(0.42, 10, 6);
  head.translate(0, 8.1, 0);
  const spots = [];
  const pt = {};
  for (const e of edges) {
    if (!(e.c === 'primary' || e.c === 'secondary' || e.c === 'tertiary')) continue;
    for (let s = 12; s < e.len - 8; s += 36) {
      edgePoint(e, s, pt);
      const o = (Math.floor(s / 36) % 2 ? 1 : -1) * (e.w / 2 + 0.9);
      const x = pt.x - pt.dz * o, z = pt.z + pt.dx * o;
      if (!inWater(x, z) || e.bridge) spots.push([x, z]);
    }
  }
  const poles = new THREE.InstancedMesh(pole, plain(0x3a3a44, { metalness: 0.6 }), spots.length);
  const heads = new THREE.InstancedMesh(head, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd9a0).multiplyScalar(2), toneMapped: false }), spots.length);
  const m = new THREE.Matrix4();
  spots.forEach(([x, z], k) => {
    m.makeTranslation(x, 0, z);
    poles.setMatrixAt(k, m);
    heads.setMatrixAt(k, m);
  });
  scene.add(poles, heads);
}

/* ---------------- Starlink ground terminals for the uplink mission ---------------- */
places.terminals = ['t0', 't1', 't2', 't3'].map(k => new V3(S[k].x, 0, S[k].z));
export const terminals = places.terminals.map(p => {
  const g = new THREE.Group();
  g.position.copy(p);
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.4, 8), plain(0x333333));
  leg.position.y = 0.7;
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.12, 6), plain(0xf5f5f7));
  dish.position.y = 1.5;
  dish.rotation.x = -0.5;
  g.add(leg, dish);
  scene.add(g);
  return g;
});

// Starlink trains: lines of lights crossing the sky.
{
  const n = 3 * 40;
  const pos = new Float32Array(n * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 3, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.9 }));
  pts.frustumCulled = false;
  scene.add(pts);
  onUpdate(dt => {
    const t = G.t;
    for (let tr = 0; tr < 3; tr++)
      for (let k = 0; k < 40; k++) {
        const i = (tr * 40 + k) * 3;
        const a = ((t * 0.012 + tr * 2.1 - k * 0.012) % (Math.PI * 2)) - 0.6;
        const tilt = 0.5 + tr * 0.4;
        pos[i] = Math.cos(a) * 3400 + camera.position.x;
        pos[i + 1] = Math.sin(a) * 1900 * Math.cos(tilt) + 800;
        pos[i + 2] = Math.sin(a) * 2800 * Math.sin(tilt) - 500 + tr * 600 + camera.position.z;
      }
    geo.attributes.position.needsUpdate = true;
    sky.position.copy(camera.position);
  }, 90);
}
