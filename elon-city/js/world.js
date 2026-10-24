// Elon City: a grid of neon blocks on a sunset coast, the landmarks, the sky and the sea.
import { THREE, V3, scene, renderer, camera, G, canvasTex, solids, posts, rnd, pick, clamp, onUpdate } from './core.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

export const N = 8;            // blocks across
export const BLOCK = 64;
export const ROAD = 18;
export const PITCH = BLOCK + ROAD;
export const HALF = (N * PITCH) / 2;
export const LANE = 4.5;
export const road = i => -HALF + i * PITCH;            // road centre lines, i = 0..N
export const blockC = i => -HALF + (i + 0.5) * PITCH;  // block centres, i = 0..N-1
G.cityHALF = HALF;

// The land: the city plus a beach all round, and Starbase's wide beach to the east.
export const LAND = { minx: -HALF - 45, maxx: HALF + 240, minz: -HALF - 45, maxz: HALF + 45 };
export const isLand = (x, z) => x > LAND.minx && x < LAND.maxx && z > LAND.minz && z < LAND.maxz;
export const onRoad = (x, z) => {
  const inBand = v => {
    const k = Math.round((v + HALF) / PITCH);
    return k >= 0 && k <= N && Math.abs(v - road(k)) < ROAD / 2;
  };
  const inCity = Math.abs(x) <= HALF + ROAD / 2 && Math.abs(z) <= HALF + ROAD / 2;
  return (inCity && (inBand(x) || inBand(z))) || (x > HALF && x < HALF + 150 && Math.abs(z) < ROAD / 2);
};

// Special blocks [i, j].
const SPECIAL = {
  '1,6': 'giga',
  '6,1': 'boring',
  '3,3': 'starlink',
  '4,4': 'park',
  '2,1': 'service',
  '5,5': 'police',
  '6,6': 'lot',
  '0,3': 'park2',
};

export const places = {};
const at = (i, j) => new V3(blockC(i), 0, blockC(j));

/* ---------------- sky, light, sea ---------------- */
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
const sky = new THREE.Mesh(new THREE.SphereGeometry(2400, 32, 16), skyMat);
scene.add(sky);
scene.fog = new THREE.FogExp2(0xc9a48e, 0.00045);

const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x4a4038, 0.25);
scene.add(hemi);
export const sun = new THREE.DirectionalLight(0xffdcc0, 2.4);
const sunDir = new V3(-0.8, 0.22, 0.4).normalize();
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 10, far: 900 });
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.5;
scene.add(sun, sun.target);
// The shadow box follows the player; the light comes from where the sun is in the sky.
export const followSun = p => {
  sun.position.set(p.x + sunDir.x * 400, sunDir.y * 400, p.z + sunDir.z * 400);
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
  if (sunDir.y < 0.08) sunDir.y = 0.08;
  sunDir.normalize();
  scene.background = tex;
  scene.backgroundIntensity = 1;
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

// The sea: a deep blue that mirrors the sky, its surface rippling.
const waterNormals = tex('waternormals.jpg', 60);
const seaMat = new THREE.MeshStandardMaterial({ color: 0x0e4a63, roughness: 0.06, metalness: 0.1, normalMap: waterNormals, normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.2 });
const sea = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000, 1, 1), seaMat);
sea.rotation.x = -Math.PI / 2;
sea.position.y = -0.7;
scene.add(sea);
onUpdate(dt => {
  waterNormals.offset.x += dt * 0.004;
  waterNormals.offset.y += dt * 0.0025;
}, 91);

// Sand under everything, with a soft line of surf.
{
  const W = LAND.maxx - LAND.minx, D = LAND.maxz - LAND.minz;
  const sandMat = pbr('sand', 1, { roughness: 1 });
  for (const k of ['map', 'normalMap', 'roughnessMap', 'aoMap']) sandMat[k].repeat.set(W / 12, D / 12);
  const sand = new THREE.Mesh(new THREE.BoxGeometry(W, 2, D), sandMat);
  sand.position.set((LAND.minx + LAND.maxx) / 2, -1, (LAND.minz + LAND.maxz) / 2);
  sand.receiveShadow = true;
  scene.add(sand);
  const foam = new THREE.Mesh(
    new THREE.BoxGeometry(W + 6, 0.1, D + 6),
    new THREE.MeshStandardMaterial({ color: 0xf6fbff, roughness: 0.6, transparent: true, opacity: 0.45 }),
  );
  foam.position.set(sand.position.x, -0.64, sand.position.z);
  scene.add(foam);
}

/* ---------------- roads ---------------- */
const asphaltMat = pbr('asphalt', 1, { roughness: 1, envMapIntensity: 0.7 });
{
  const W = 2 * HALF + ROAD;
  for (const k of ['map', 'normalMap', 'roughnessMap', 'aoMap']) asphaltMat[k].repeat.set(W / 7, W / 7);
  const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(W, W), asphaltMat);
  asphalt.rotation.x = -Math.PI / 2;
  asphalt.position.y = 0.01;
  asphalt.receiveShadow = true;
  scene.add(asphalt);
  // The Starbase road out east.
  const outMat = asphaltMat.clone();
  for (const k of ['map', 'normalMap', 'roughnessMap', 'aoMap']) {
    outMat[k] = asphaltMat[k].clone();
    outMat[k].repeat.set(160 / 7, ROAD / 7);
  }
  const out = new THREE.Mesh(new THREE.PlaneGeometry(160, ROAD), outMat);
  out.rotation.x = -Math.PI / 2;
  out.position.set(HALF + 80, 0.012, 0);
  out.receiveShadow = true;
  scene.add(out);
}

// Zebra crossings at every intersection.
{
  const bar = new THREE.PlaneGeometry(0.7, 5.5);
  bar.rotateX(-Math.PI / 2);
  const parts = [];
  const m = new THREE.Matrix4();
  for (let i = 0; i <= N; i++)
    for (let j = 0; j <= N; j++)
      for (const side of [-1, 1])
        for (let k = -6; k <= 6; k++) {
          const off = side * (ROAD / 2 + 3.2);
          parts.push(m.clone().makeTranslation(road(i) + k * 1.3, 0.021, road(j) + off));
          parts.push(m.clone().makeRotationY(Math.PI / 2).setPosition(road(i) + off, 0.021, road(j) + k * 1.3));
        }
  const zebra = new THREE.InstancedMesh(bar, new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.7 }), parts.length);
  parts.forEach((p, i) => zebra.setMatrixAt(i, p));
  zebra.receiveShadow = true;
  scene.add(zebra);
}

// Dashed centre lines and a white edge line.
{
  const dash = new THREE.PlaneGeometry(0.35, 4);
  dash.rotateX(-Math.PI / 2);
  const parts = [];
  const m = new THREE.Matrix4();
  for (let i = 0; i <= N; i++) {
    for (let s = -HALF; s < HALF; s += 9) {
      const k = Math.round((s + HALF) / PITCH);
      if (Math.abs(s - road(k)) < ROAD / 2 + 2) continue;
      parts.push(m.clone().makeTranslation(road(i), 0.02, s + 2));
      parts.push(m.clone().makeRotationY(Math.PI / 2).setPosition(s + 2, 0.02, road(i)));
    }
  }
  for (let s = HALF + 12; s < HALF + 150; s += 9) parts.push(m.clone().makeRotationY(Math.PI / 2).setPosition(s, 0.02, 0));
  const lines = new THREE.InstancedMesh(dash, new THREE.MeshStandardMaterial({ color: 0xffd23c, emissive: 0x7a5a00, roughness: 0.6 }), parts.length);
  parts.forEach((p, i) => lines.setMatrixAt(i, p));
  scene.add(lines);
}

/* ---------------- buildings ---------------- */
// Real plaster walls, tinted per building; windows drawn by the shader in metres, so every
// facade has proper floors: glass that reflects the sky, frames, shopfronts at street level.
// Styles: 0 apartments (punched windows), 1 glass tower (curtain wall), 2 Miami deco hotel (ribbon windows).
const wallMat = pbr('plaster', 1, { vertexColors: true, roughness: 1, envMapIntensity: 1 });
wallMat.onBeforeCompile = sh => {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec3 wuv;\nvarying vec3 vW;')
    .replace('#include <uv_vertex>', '#include <uv_vertex>\nvW = wuv;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>
      varying vec3 vW;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float box(vec2 p, vec2 a, vec2 b){ vec2 s = step(a, p) * step(p, b); return s.x * s.y; }
      // x: 1 inside glass; y: frame; z: a random number per pane.
      vec3 windowAt(vec3 w){
        if (w.z < -0.5) return vec3(0.0);
        float style = w.z;
        vec2 cell; vec2 f; float glass = 0.0, frame = 0.0;
        if (w.y < 4.2) {
          // Street level: big shop windows between pillars.
          cell = vec2(floor(w.x / 6.0), 0.0); f = vec2(mod(w.x, 6.0), w.y);
          glass = box(f, vec2(0.6, 0.35), vec2(5.4, 3.4));
          frame = box(f, vec2(0.45, 0.2), vec2(5.55, 3.55)) - glass;
          return vec3(glass, frame, hash(cell + 7.0));
        }
        if (style < 0.5) {
          cell = floor(vec2(w.x / 3.2, (w.y - 4.2) / 3.4)); f = vec2(mod(w.x, 3.2), mod(w.y - 4.2, 3.4));
          glass = box(f, vec2(0.75, 0.95), vec2(2.45, 2.75));
          frame = box(f, vec2(0.62, 0.8), vec2(2.58, 2.9)) - glass;
          frame += box(f, vec2(0.5, 0.62), vec2(2.7, 0.8));
        } else if (style < 1.5) {
          cell = floor(vec2(w.x / 1.6, (w.y - 4.2) / 3.4)); f = vec2(mod(w.x, 1.6), mod(w.y - 4.2, 3.4));
          glass = box(f, vec2(0.06, 0.0), vec2(1.54, 2.7));
          frame = 1.0 - glass;
        } else {
          cell = floor(vec2(w.x / 5.0, (w.y - 4.2) / 3.4)); f = vec2(mod(w.x, 5.0), mod(w.y - 4.2, 3.4));
          glass = box(f, vec2(0.0, 1.05), vec2(4.3, 2.6));
          frame = box(f, vec2(0.0, 0.85), vec2(5.0, 1.05));
        }
        return vec3(glass, clamp(frame, 0.0, 1.0), hash(cell));
      }`)
    .replace('#include <map_fragment>', `#include <map_fragment>
      vec3 win = windowAt(vW);
      float glassK = win.x;
      vec3 tint = mix(vec3(0.05, 0.08, 0.11), vec3(0.09, 0.12, 0.11), win.z);
      if (vW.z > 0.5 && vW.z < 1.5) tint = vec3(0.10, 0.17, 0.22);
      if (vW.z < -0.5) diffuseColor.rgb = vec3(0.45, 0.44, 0.42) * texture2D(map, vMapUv).rgb;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8, 0.82, 0.84), win.y * 0.85);
      diffuseColor.rgb = mix(diffuseColor.rgb, tint, glassK);`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, 0.04, glassK);
      roughnessFactor = mix(roughnessFactor, 0.35, win.y);`)
    .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
      metalnessFactor = glassK * 0.9 + win.y * 0.6;`)
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      normal = normalize(mix(normal, normalize(vNormal), max(glassK, win.y)));`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance += glassK * step(0.84, win.z) * vec3(1.0, 0.72, 0.42) * 0.5;`);
};

const PASTEL = [0xf4c7d4, 0xa9e4dd, 0xfbe8cf, 0xf2efe8, 0xd6cbef, 0xffd6b0, 0xbfe0f7, 0xf3b6c3, 0xe9e2d0, 0xc9d8c5];
const TOWER_TINT = [0xc8d4dc, 0xb7c3cc, 0xd9dfe3, 0xa9b6bf];
const towers = [];
const neon = { pink: [], cyan: [], lime: [], white: [] };
const roofBits = [];

// A building box: plaster UVs every 4 m, window coordinates in metres along each face.
const towerBox = (x, z, w, d, h, color, y0 = 0, style = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv');
  const n = uv.count;
  const wuv = new Float32Array(n * 3);
  const faces = [d, d, w, w, w, w];
  for (let f = 0; f < 6; f++)
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      const roof = f === 2 || f === 3;
      const along = uv.getX(i) * faces[f], up = uv.getY(i) * (roof ? d : h);
      wuv[i * 3] = along;
      wuv[i * 3 + 1] = roof ? 0 : up + y0;
      wuv[i * 3 + 2] = roof ? -1 : style;
      uv.setXY(i, along / 4, up / 4);
    }
  g.setAttribute('wuv', new THREE.BufferAttribute(wuv, 3));
  g.translate(x, y0 + h / 2, z);
  const c = new THREE.Color(color);
  const col = new Float32Array(n * 3);
  for (let i = 0; i < col.length; i += 3) c.toArray(col, i);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  towers.push(g);
  solids.push({ minx: x - w / 2, maxx: x + w / 2, minz: z - d / 2, maxz: z + d / 2, h: y0 + h });
};

const strip = (list, x, y, z, w, h, d) => {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  list.push(g);
};

// Roofs: a parapet, air-conditioning units, a water tank or an antenna.
const roofStuff = (x, z, w, d, h) => {
  for (const [px, pz, pw, pd] of [[x, z + d / 2 - 0.2, w, 0.4], [x, z - d / 2 + 0.2, w, 0.4], [x + w / 2 - 0.2, z, 0.4, d], [x - w / 2 + 0.2, z, 0.4, d]]) {
    const g = new THREE.BoxGeometry(pw, 1, pd);
    g.translate(px, h + 0.5, pz);
    roofBits.push(g.toNonIndexed());
  }
  const n = Math.floor(rnd(1, 4));
  for (let k = 0; k < n; k++) {
    const g = new THREE.BoxGeometry(rnd(1.5, 3), rnd(1, 2), rnd(1.5, 3));
    g.translate(x + rnd(-w / 3, w / 3), h + 0.8, z + rnd(-d / 3, d / 3));
    roofBits.push(g.toNonIndexed());
  }
  if (h > 40 && Math.random() < 0.5) {
    const g = new THREE.CylinderGeometry(0.15, 0.25, rnd(8, 16), 6);
    g.translate(x + rnd(-w / 4, w / 4), h + 5, z + rnd(-d / 4, d / 4));
    roofBits.push(g.toNonIndexed());
  } else if (Math.random() < 0.35) {
    const g = new THREE.CylinderGeometry(1.6, 1.6, 3, 12);
    g.translate(x + rnd(-w / 4, w / 4), h + 3.5, z + rnd(-d / 4, d / 4));
    roofBits.push(g.toNonIndexed());
  }
};

// Hotel names along the beach.
const HOTELS = ['HOTEL STARSHIP', 'THE CYBER INN', 'DOGE MOTEL', 'MARS BAR', 'HOTEL FALCON', 'ROCKET LOUNGE', 'OCCUPY MARS', 'GIGA SUITES', 'HYPERLOOP HOTEL', 'NEURALINK INN', 'THE RAPTOR', 'X MARKS THE SPOT'];
let hotelN = 0;

// Ordinary blocks: two to four buildings. Glass towers downtown, deco hotels near the beach, apartments between.
const cityBlock = (i, j) => {
  const cx = blockC(i), cz = blockC(j);
  const downtown = 1 - clamp(Math.hypot(cx, cz) / (HALF * 1.05), 0, 1);
  const edge = i === 0 || j === 0 || i === N - 1 || j === N - 1;
  const split = Math.random() < 0.5;
  const lots = split
    ? [[-14, -14, 26, 26], [14, -14, 26, 26], [-14, 14, 26, 26], [14, 14, 26, 26]]
    : [[0, -13, 52, 24], [0, 14, 52, 22]];
  for (const [ox, oz, w, d] of lots) {
    if (Math.random() < 0.1) continue;
    const ww = w - rnd(0, 4), dd = d - rnd(0, 4);
    const x = cx + ox, z = cz + oz;
    const style = downtown > 0.55 && Math.random() < 0.75 ? 1 : edge && Math.random() < 0.7 ? 2 : 0;
    let h = style === 1 ? rnd(45, 70) + downtown * rnd(20, 80) : style === 2 ? rnd(14, 30) : rnd(12, 26) + downtown * rnd(5, 30);
    h = Math.round((h - 4.2) / 3.4) * 3.4 + 4.2 + 0.6;
    const color = style === 1 ? pick(TOWER_TINT) : pick(PASTEL);
    towerBox(x, z, ww, dd, h, color, 0, style);
    roofStuff(x, z, ww, dd, h);
    if (style === 2) {
      const list = neon[pick(['pink', 'cyan', 'pink', 'white'])];
      strip(list, x, h + 0.2, z + dd / 2 + 0.1, ww + 0.4, 0.3, 0.2);
      strip(list, x, h + 0.2, z - dd / 2 - 0.1, ww + 0.4, 0.3, 0.2);
      if (hotelN < HOTELS.length && Math.random() < 0.7) {
        const side = oz > 0 ? 1 : -1;
        sign(HOTELS[hotelN++], x, h + 2.4, z + side * (dd / 2 + 0.3), side > 0 ? 0 : Math.PI, Math.min(ww * 0.9, 20), pick(['#ff4fa3', '#3fe3f0', '#ffffff']));
      }
    }
    // Glass towers step back near the top.
    if (style === 1 && h > 70 && Math.random() < 0.7) {
      const h2 = Math.round(rnd(10, 24) / 3.4) * 3.4;
      towerBox(x, z, ww * 0.7, dd * 0.7, h2, color, h, 1);
      roofStuff(x, z, ww * 0.7, dd * 0.7, h + h2);
    }
  }
};

// A sidewalk slab and lot ground for every block.
const slabs = [];
const lawns = [];
for (let i = 0; i < N; i++)
  for (let j = 0; j < N; j++) {
    const g = new THREE.BoxGeometry(BLOCK, 0.18, BLOCK);
    g.translate(blockC(i), 0.09, blockC(j));
    slabs.push(g);
  }

/* ---------------- signs ---------------- */
const sign = (text, x, y, z, yaw, w, color = '#ff2d55', bg = null) => {
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
  scene.add(m);
  return m;
};

/* ---------------- landmarks ---------------- */
const plain = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...extra });
const add = (geo, mat, x, y, z, solid = true) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
  if (solid && geo.parameters?.width) {
    const p = geo.parameters;
    solids.push({ minx: x - p.width / 2, maxx: x + p.width / 2, minz: z - p.depth / 2, maxz: z + p.depth / 2, h: y + p.height / 2 });
  }
  return m;
};

const giga = (i, j) => {
  const c = at(i, j);
  add(new THREE.BoxGeometry(56, 18, 36), plain(0xf3f5f7), c.x, 9, c.z - 8);
  add(new THREE.BoxGeometry(56.2, 2.2, 36.2), plain(0x20232a), c.x, 14, c.z - 8, false);
  sign('GIGAFACTORY', c.x, 21.5, c.z + 10.3, 0, 40, '#ff2d2d');
  // Superchargers along the front.
  const red = plain(0xd8262c, { metalness: 0.3 });
  for (let k = 0; k < 6; k++) {
    const x = c.x - 20 + k * 8;
    add(new THREE.BoxGeometry(0.7, 2, 0.5), red, x, 1, c.z + 22, false);
    posts.push({ x, z: c.z + 22, r: 0.6 });
  }
  places.giga = new V3(c.x, 0, c.z + 27);
  places.chargers = new V3(c.x, 0, c.z + 22);
};

const boring = (i, j) => {
  const c = at(i, j);
  add(new THREE.BoxGeometry(40, 12, 24), plain(0x8b8f99), c.x, 6, c.z - 12);
  sign('THE BORING COMPANY', c.x, 14.5, c.z + 0.2, 0, 34, '#f5f5f5');
  places.boring = new V3(c.x - 14, 0, c.z + 18);
  portal(c.x + 14, c.z + 22, 0, 'A');
};

// Tunnel portals: a concrete mouth with a dark hole; driving or walking in takes you to the other.
const portalMat = plain(0x9da3ad);
const holeMat = new THREE.MeshBasicMaterial({ color: 0x050507 });
const portal = (x, z, yaw, name) => {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = yaw;
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
  // A ring of light inside, like the Loop.
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.12, 8, 40), new THREE.MeshBasicMaterial({ color: 0x8fd8ff, toneMapped: false }));
  ring.position.set(0, 3, -1.2);
  g.add(ring);
  scene.add(g);
  const fwd = new V3(Math.sin(yaw), 0, Math.cos(yaw));
  places['portal' + name] = { at: new V3(x, 0, z).addScaledVector(fwd, 1), out: new V3(x, 0, z).addScaledVector(fwd, 9), yaw };
  solids.push({ minx: x - 5.2, maxx: x - 4, minz: z - 4, maxz: z + 4, h: 6 }, { minx: x + 4, maxx: x + 5.2, minz: z - 4, maxz: z + 4, h: 6 });
};

const starlinkHQ = (i, j) => {
  const c = at(i, j);
  add(new THREE.BoxGeometry(44, 26, 40), plain(0x15171c, { metalness: 0.4, roughness: 0.3 }), c.x, 13, c.z - 4);
  // The big dish on the roof.
  const dish = new THREE.Mesh(new THREE.SphereGeometry(12, 32, 12, 0, Math.PI * 2, 0, 0.9), plain(0xf2f4f8, { side: THREE.DoubleSide, metalness: 0.2 }));
  dish.rotation.x = Math.PI + 0.5;
  dish.position.set(c.x, 36, c.z - 4);
  dish.castShadow = true;
  scene.add(dish);
  add(new THREE.CylinderGeometry(1, 1.4, 8, 12), plain(0xcfd3da), c.x, 30, c.z - 4, false);
  sign('STARLINK', c.x, 20, c.z + 16.2, 0, 30, '#ffffff');
  places.starlink = new V3(c.x, 0, c.z + 25);
};

const service = (i, j) => {
  const c = at(i, j);
  add(new THREE.BoxGeometry(40, 10, 20), plain(0xf0f0f2), c.x, 5, c.z - 16);
  add(new THREE.BoxGeometry(40, 1, 12), plain(0xf0f0f2), c.x, 9.5, c.z, false);
  add(new THREE.BoxGeometry(1, 9, 12), plain(0xe5e5e8), c.x - 19.5, 4.5, c.z);
  add(new THREE.BoxGeometry(1, 9, 12), plain(0xe5e5e8), c.x + 19.5, 4.5, c.z);
  sign('TESLA SERVICE', c.x, 12, c.z + 6.2, 0, 26, '#e82127', '#ffffff');
  places.service = new V3(c.x, 0, c.z + 1);
};

const police = (i, j) => {
  const c = at(i, j);
  add(new THREE.BoxGeometry(46, 16, 30), plain(0x1d2a4a), c.x, 8, c.z - 10);
  sign('ELON PD', c.x, 13, c.z + 5.2, 0, 22, '#4da3ff');
  for (const [dx, col] of [[-8, 0xff2a3a], [8, 0x2a7bff]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(5, 0.6, 0.6), new THREE.MeshBasicMaterial({ color: col, toneMapped: false }));
    m.position.set(c.x + dx, 16.4, c.z + 5.1);
    scene.add(m);
  }
  places.police = new V3(c.x, 0, c.z + 26);
};

const lot = (i, j) => {
  const c = at(i, j);
  const fence = plain(0x6b6f78, { metalness: 0.6 });
  for (const [x, z, w, d] of [[c.x, c.z - 26, 52, 0.4], [c.x - 26, c.z, 0.4, 52], [c.x + 26, c.z, 0.4, 52]]) add(new THREE.BoxGeometry(w, 2.4, d), fence, x, 1.2, z);
  sign('RIVAL MOTORS', c.x, 4.5, c.z - 25.6, 0, 18, '#ffd23c');
  places.lot = new V3(c.x, 0, c.z);
};

// Palms: one trunk and one crown, instanced.
const palmSpots = [];
const park = (i, j) => {
  const c = at(i, j);
  const grass = new THREE.Mesh(new THREE.BoxGeometry(BLOCK - 6, 0.25, BLOCK - 6), pbr('grass', 10, { roughness: 1, color: 0x9cc77e }));
  grass.position.set(c.x, 0.13, c.z);
  grass.receiveShadow = true;
  scene.add(grass);
  for (let k = 0; k < 14; k++) palmSpots.push([c.x + rnd(-26, 26), c.z + rnd(-26, 26)]);
  const fountain = add(new THREE.CylinderGeometry(6, 6.5, 1.2, 32), plain(0xeee7dc), c.x, 0.6, c.z, false);
  posts.push({ x: c.x, z: c.z, r: 6.5 });
  const water = new THREE.Mesh(new THREE.CylinderGeometry(5.4, 5.4, 0.2, 32), new THREE.MeshStandardMaterial({ color: 0x38c6e6, roughness: 0.05, metalness: 0.3 }));
  water.position.set(c.x, 1.15, c.z);
  scene.add(water);
  if (!places.park) places.park = new V3(c.x, 0, c.z + 10);
};

/* ---------------- Starbase ---------------- */
export const starbase = {};
{
  const px = HALF + 160, pz = 0;
  places.starbase = new V3(HALF + 120, 0, 0);
  places.pad = new V3(px, 0, pz);
  // A concrete pad, the launch mount and the tower with its chopsticks.
  add(new THREE.CylinderGeometry(34, 34, 0.4, 48), plain(0xbfc3c9, { roughness: 0.9 }), px, 0.2, pz, false);
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
  const H = 120, s = 5;
  const cs = [[-s, -s], [s, -s], [s, s], [-s, s]];
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
  solids.push({ minx: tx - s - 0.6, maxx: tx + s + 0.6, minz: pz - s - 0.6, maxz: pz + s + 0.6, h: H });
  // The chopsticks: two arms that can swing and slide.
  const sticks = new THREE.Group();
  sticks.position.set(tx + s, 70, pz);
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(22, 2.4, 1.6), steel);
    arm.position.set(11, 0, side * 6);
    arm.castShadow = true;
    sticks.add(arm);
  }
  scene.add(sticks);
  starbase.sticks = sticks;
  starbase.tower = { x: tx, z: pz };
  sign('STARBASE', HALF + 60, 7, -14, Math.PI / 2, 22, '#ffffff');
  add(new THREE.BoxGeometry(1, 8, 1), plain(0x222222), HALF + 60, 4, -9.5, false);
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

/* ---------------- lay out the city ---------------- */
for (let i = 0; i < N; i++)
  for (let j = 0; j < N; j++) {
    const kind = SPECIAL[`${i},${j}`];
    if (!kind) cityBlock(i, j);
    else if (kind === 'giga') giga(i, j);
    else if (kind === 'boring') boring(i, j);
    else if (kind === 'starlink') starlinkHQ(i, j);
    else if (kind === 'park' || kind === 'park2') park(i, j);
    else if (kind === 'service') service(i, j);
    else if (kind === 'police') police(i, j);
    else if (kind === 'lot') lot(i, j);
  }
// The second tunnel portal, at the Gigafactory end of town.
portal(blockC(2) + 18, blockC(6) - 24, Math.PI, 'B');

{
  const city = new THREE.Mesh(mergeGeometries(towers), wallMat);
  city.castShadow = city.receiveShadow = true;
  scene.add(city);
  const walkMat = pbr('sidewalk', 16, { roughness: 1, color: 0xe6dfd5 });
  const walk = new THREE.Mesh(mergeGeometries(slabs), walkMat);
  const roofs = new THREE.Mesh(mergeGeometries(roofBits.map(g => (g.deleteAttribute('uv'), g))), new THREE.MeshStandardMaterial({ color: 0x9a9690, roughness: 0.8, metalness: 0.2 }));
  roofs.castShadow = roofs.receiveShadow = true;
  scene.add(roofs);
  walk.receiveShadow = true;
  scene.add(walk);
  const NEON = { pink: 0xff3fa4, cyan: 0x3ff2ff, lime: 0x9dff3f, white: 0xffffff };
  for (const [k, list] of Object.entries(neon)) {
    if (!list.length) continue;
    scene.add(new THREE.Mesh(mergeGeometries(list), new THREE.MeshBasicMaterial({ color: new THREE.Color(NEON[k]).multiplyScalar(1.6), toneMapped: false })));
  }
}

// Palms on the beaches, in the parks and along some sidewalks.
{
  for (let k = 0; k < 70; k++) {
    const side = k % 4;
    const t = rnd(-HALF - 20, HALF + 20);
    if (side === 0) palmSpots.push([t, LAND.maxz - rnd(8, 30)]);
    else if (side === 1) palmSpots.push([t, LAND.minz + rnd(8, 30)]);
    else if (side === 2) palmSpots.push([LAND.minx + rnd(8, 30), t]);
    else palmSpots.push([rnd(HALF + 20, LAND.maxx - 10), t * 0.6 + (Math.abs(t) < 30 ? 60 : 0)]);
  }
  for (let i = 0; i <= N; i++)
    for (let j = 0; j < N; j++) if (Math.random() < 0.5) palmSpots.push([road(i) + (Math.random() < 0.5 ? -1 : 1) * (ROAD / 2 + 2), blockC(j) + rnd(-20, 20)]);
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.38, 9, 7);
  trunkGeo.translate(0, 4.5, 0);
  const fronds = [];
  for (let k = 0; k < 8; k++) {
    const f = new THREE.ConeGeometry(0.9, 5, 4);
    f.scale(1, 1, 0.18);
    f.translate(0, 2.5, 0);
    f.rotateZ(-1.15 - rnd(0, 0.3));
    f.rotateY((k / 8) * Math.PI * 2);
    f.translate(0, 9, 0);
    fronds.push(f);
  }
  const crownGeo = mergeGeometries(fronds);
  const trunks = new THREE.InstancedMesh(trunkGeo, plain(0x8a6a4a, { roughness: 1 }), palmSpots.length);
  const crowns = new THREE.InstancedMesh(crownGeo, plain(0x3f9a4c, { roughness: 0.8, side: THREE.DoubleSide }), palmSpots.length);
  trunks.castShadow = crowns.castShadow = true;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  palmSpots.forEach(([x, z], k) => {
    const s = rnd(0.85, 1.25);
    q.setFromEuler(e.set(rnd(-0.08, 0.08), rnd(0, 6.28), rnd(-0.08, 0.08)));
    m.compose(new V3(x, 0, z), q, new V3(s, s, s));
    trunks.setMatrixAt(k, m);
    crowns.setMatrixAt(k, m);
    posts.push({ x, z, r: 0.5 });
  });
  scene.add(trunks, crowns);
}

// Street lamps on the corners.
{
  const pole = new THREE.CylinderGeometry(0.12, 0.16, 7, 6);
  pole.translate(0, 3.5, 0);
  const head = new THREE.SphereGeometry(0.45, 10, 6);
  head.translate(0, 7.1, 0);
  const spots = [];
  for (let i = 0; i <= N; i++)
    for (let j = 0; j <= N; j++) spots.push([road(i) + ROAD / 2 + 1.2, road(j) + ROAD / 2 + 1.2]);
  const poles = new THREE.InstancedMesh(pole, plain(0x3a3a44, { metalness: 0.6 }), spots.length);
  const heads = new THREE.InstancedMesh(head, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd9a0).multiplyScalar(2), toneMapped: false }), spots.length);
  const m = new THREE.Matrix4();
  spots.forEach(([x, z], k) => {
    m.makeTranslation(x, 0, z);
    poles.setMatrixAt(k, m);
    heads.setMatrixAt(k, m);
    posts.push({ x, z, r: 0.3 });
  });
  scene.add(poles, heads);
}

// Starlink ground terminals for the uplink mission: four corners of town.
places.terminals = [
  new V3(road(1) + 12, 0, road(1) + 12),
  new V3(road(7) - 12, 0, road(2) + 12),
  new V3(road(7) - 12, 0, road(7) - 12),
  new V3(road(1) + 12, 0, road(6) - 12),
];
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
        pos[i] = Math.cos(a) * 1900 + camera.position.x;
        pos[i + 1] = Math.sin(a) * 1100 * Math.cos(tilt) + 500;
        pos[i + 2] = Math.sin(a) * 1600 * Math.sin(tilt) - 300 + tr * 400 + camera.position.z;
      }
    geo.attributes.position.needsUpdate = true;
    sky.position.copy(camera.position);
  }, 90);
}

// Road graph for traffic: intersections and which neighbours they connect to.
export const nodes = [];
for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) nodes.push({ i, j, x: road(i), z: road(j) });
export const nodeAt = (i, j) => (i < 0 || j < 0 || i > N || j > N ? null : nodes[i * (N + 1) + j]);
export const nearestNode = (x, z) => nodeAt(clamp(Math.round((x + HALF) / PITCH), 0, N), clamp(Math.round((z + HALF) / PITCH), 0, N));

// Sidewalk loops for pedestrians: a rectangle around each block.
export const walkLoop = (i, j) => {
  const cx = blockC(i), cz = blockC(j), r = BLOCK / 2 - 1.6;
  return [new V3(cx - r, 0, cz - r), new V3(cx + r, 0, cz - r), new V3(cx + r, 0, cz + r), new V3(cx - r, 0, cz + r)];
};

// Spawn point for the player: in front of the Gigafactory.
places.spawn = places.giga.clone().add(new V3(0, 0, 7));
