// The valley: night sky, hills, a lake with the Golden Temple in the middle, trees and a scattered village.
import * as THREE from 'three';
import { makeDiya, glowSprite } from './fx.js';

// Where each story happens (x, z). The lake is at the centre.
export const SPOTS = { rama: [-46, 6], krishna: [-31, -36], lakshmi: [4, -47], bandi: [38, -30], mahavira: [47, 12], days: [0, 23] };
export const WATER_Y = -0.45, LAKE_R = 15;

const sm = (u) => { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); };
export function heightAt(x, z) {
  const r = Math.hypot(x, z);
  let h = Math.sin(x * 0.05) * 2.2 + Math.cos(z * 0.045) * 2 + Math.sin((x + z) * 0.09) * 1.1 + Math.sin(x * 0.17 + z * 0.11) * 0.5 + 2.2;
  h += Math.max(0, r - 66) * 0.42 + Math.max(0, r - 66) ** 1.5 * 0.02;
  let f = 1;
  for (const [sx, sz] of Object.values(SPOTS)) f = Math.min(f, sm((Math.hypot(x - sx, z - sz) - 17) / 12));
  h *= f;
  const lk = sm((r - LAKE_R) / 6);
  return h * lk + -1.6 * (1 - lk);
}

export function buildWorld(scene) {
  // Sky dome with a deep blue-violet gradient and stars.
  const sky = new THREE.Mesh(new THREE.SphereGeometry(480, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color('#02020c') }, mid: { value: new THREE.Color('#0d0a26') }, low: { value: new THREE.Color('#2a1638') } },
    vertexShader: 'varying vec3 vp; void main(){ vp = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 low; varying vec3 vp; void main(){ float h = vp.y; vec3 c = h > 0.12 ? mix(mid, top, smoothstep(0.12, 0.7, h)) : mix(low, mid, smoothstep(-0.05, 0.12, h)); gl_FragColor = vec4(c, 1.0); }',
  }));
  scene.add(sky);
  const sp = []; const sc = [];
  for (let i = 0; i < 2200; i++) {
    const v = new THREE.Vector3().randomDirection(); if (v.y < 0.04) v.y = Math.abs(v.y) + 0.04; v.normalize().multiplyScalar(440);
    sp.push(v.x, v.y, v.z); const b = 0.4 + Math.random() * 0.9; sc.push(b, b, b * (0.9 + Math.random() * 0.2));
  }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)); sg.setAttribute('color', new THREE.Float32BufferAttribute(sc, 3));
  scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, fog: false, transparent: true, depthWrite: false })));

  // Terrain
  const geo = new THREE.PlaneGeometry(320, 320, 160, 160).rotateX(-Math.PI / 2);
  const p = geo.attributes.position, cols = [];
  const grass = new THREE.Color('#1d2a1c'), dirt = new THREE.Color('#2e2620'), sand = new THREE.Color('#5a4a38'), rock = new THREE.Color('#2a2633');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), h = heightAt(x, z); p.setY(i, h);
    const r = Math.hypot(x, z), c = grass.clone().lerp(dirt, 0.5 + 0.5 * Math.sin(x * 0.3) * Math.cos(z * 0.27));
    if (r < LAKE_R + 4) c.lerp(sand, 1 - sm((r - LAKE_R) / 4));
    if (h > 6) c.lerp(rock, sm((h - 6) / 8));
    cols.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  scene.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true })));

  // Lake
  const water = new THREE.Mesh(new THREE.CircleGeometry(LAKE_R + 3, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#0a1a36', roughness: 0.12, metalness: 0.4, transparent: true, opacity: 0.86 }));
  water.position.y = WATER_Y; scene.add(water);

  // Trees
  const nT = 520, tree = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 3.4, 7).translate(0, 1.7, 0), new THREE.MeshLambertMaterial({ color: '#13301f' }), nT);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
  let k = 0;
  for (let tries = 0; k < nT && tries < 6000; tries++) {
    const a = Math.random() * Math.PI * 2, r = 20 + Math.random() * 100, x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Object.values(SPOTS).some(([sx, sz]) => Math.hypot(x - sx, z - sz) < 20)) continue;
    const s = 0.7 + Math.random() * 1.1;
    m.compose(new THREE.Vector3(x, heightAt(x, z) - 0.1, z), q, new THREE.Vector3(s, s * (0.8 + Math.random() * 0.6), s));
    tree.setMatrixAt(k, m); tree.setColorAt(k, col.setHSL(0.36 + Math.random() * 0.06, 0.4, 0.1 + Math.random() * 0.07)); k++;
  }
  tree.count = k; scene.add(tree);

  // A scattered village whose windows all glow in the finale
  const winMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#1a120c') });
  const wallMat = new THREE.MeshLambertMaterial({ color: '#3a2c3c' }), roofMat = new THREE.MeshLambertMaterial({ color: '#4a2622' });
  const box = new THREE.BoxGeometry(1, 1, 1), roof = new THREE.ConeGeometry(0.8, 0.7, 4).rotateY(Math.PI / 4), win = new THREE.PlaneGeometry(0.35, 0.45);
  const village = [];
  for (let i = 0, tries = 0; i < 44 && tries < 2000; tries++) {
    const a = Math.random() * Math.PI * 2, r = 24 + Math.random() * 40, x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Object.values(SPOTS).some(([sx, sz]) => Math.hypot(x - sx, z - sz) < 19) || village.some((v) => v.distanceTo(new THREE.Vector3(x, 0, z)) < 6)) continue;
    const h = heightAt(x, z), g = new THREE.Group(); g.position.set(x, h, z); g.rotation.y = Math.atan2(-x, -z); g.scale.setScalar(1.6 + Math.random() * 0.8);
    const b = new THREE.Mesh(box, wallMat); b.scale.set(1.6, 1.2, 1.4); b.position.y = 0.6; g.add(b);
    const rf = new THREE.Mesh(roof, roofMat); rf.scale.set(1.45, 1, 1.25); rf.position.y = 1.55; g.add(rf);
    [-0.4, 0.4].forEach((wx) => { const w = new THREE.Mesh(win, winMat); w.position.set(wx, 0.65, 0.71); g.add(w); });
    makeDiya(g, new THREE.Vector3(0, 0, 1.05), 0.55, { pool: 3 });
    scene.add(g); village.push(g.position.clone()); i++;
  }
  const villageDiyas = [];
  scene.traverse((o) => {});

  return { water, winMat, village, villageDiyas, temple: buildTemple(scene) };
}

// Harmandir Sahib (the Golden Temple) in the middle of the lake, with a causeway and lamps all round the water.
function buildTemple(scene) {
  const g = new THREE.Group(); g.position.y = WATER_Y; scene.add(g);
  const marble = new THREE.MeshStandardMaterial({ color: '#d9d0c2', roughness: 0.6, emissive: '#fff0d0', emissiveIntensity: 0 });
  const gold = new THREE.MeshStandardMaterial({ color: '#c9962f', metalness: 0.75, roughness: 0.35, emissive: '#ffae3a', emissiveIntensity: 0 });
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };
  add(new THREE.BoxGeometry(7.5, 0.7, 7.5), marble, 0, 0.35, 0);
  add(new THREE.BoxGeometry(5.2, 2.8, 5.2), gold, 0, 2.1, 0);
  add(new THREE.BoxGeometry(3.6, 1.3, 3.6), gold, 0, 4.15, 0);
  const dome = add(new THREE.SphereGeometry(1.55, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), gold, 0, 4.8, 0); dome.scale.y = 1.25;
  add(new THREE.ConeGeometry(0.22, 1.2, 10), gold, 0, 7.2, 0);
  [[-2.3, -2.3], [2.3, -2.3], [-2.3, 2.3], [2.3, 2.3]].forEach(([x, z]) => { add(new THREE.CylinderGeometry(0.35, 0.35, 0.9, 10), gold, x, 3.95, z); add(new THREE.SphereGeometry(0.42, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), gold, x, 4.4, z); });
  const arch = new THREE.MeshBasicMaterial({ color: new THREE.Color('#2a1a08') });
  for (let i = -2; i <= 2; i++) for (const [rx, rz, ry] of [[0, 2.61, 0], [0, -2.61, Math.PI], [2.61, 0, Math.PI / 2], [-2.61, 0, -Math.PI / 2]]) {
    const a = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 1.1), arch); a.position.set(rx + (rz ? i * 0.95 : 0), 1.7, rz + (rx ? i * 0.95 : 0)); a.rotation.y = ry; g.add(a);
  }
  // causeway to the south shore
  const cw = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 11), marble); cw.position.set(0, 0.25, 9.2); g.add(cw);
  // mirror image in the water
  const refl = g.clone(true);
  refl.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.3; o.material.side = THREE.DoubleSide; o.material.depthWrite = false; } });
  refl.scale.y = -1; refl.position.y = WATER_Y - 0.02; scene.add(refl);
  const halo = glowSprite(new THREE.Color(1.6, 1.0, 0.35), 26); halo.position.set(0, 4, 0); halo.material.opacity = 0; scene.add(halo);
  // lamps round the lake
  const rim = [];
  for (let i = 0; i < 56; i++) {
    const a = (i / 56) * Math.PI * 2, x = Math.cos(a) * (LAKE_R + 1.2), z = Math.sin(a) * (LAKE_R + 1.2);
    if (Math.abs(x) < 1.6 && z > 0) continue; // the causeway
    rim.push(makeDiya(scene, new THREE.Vector3(x, heightAt(x, z) + 0.02, z), 0.8, { reflect: new THREE.Vector3(Math.cos(a) * (LAKE_R - 0.2), WATER_Y, Math.sin(a) * (LAKE_R - 0.2)), pool: 4 }));
  }
  const reflMats = []; refl.traverse((o) => { if (o.isMesh) reflMats.push(o.material); });
  let lit = 0;
  return {
    group: g, rim,
    get lit() { return lit; },
    setLit(v) {
      lit = v;
      gold.emissiveIntensity = 0.9 * v; marble.emissiveIntensity = 0.25 * v; halo.material.opacity = 0.35 * v;
      reflMats.forEach((m) => { if (m.emissive) m.emissiveIntensity = (m.metalness > 0.5 ? 0.9 : 0.25) * v; });
    },
  };
}
