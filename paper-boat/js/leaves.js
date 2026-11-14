// Leaves. A 2048 px atlas is painted at load (no image files): four species, each in four states.
//   species: 0 serrated ovate (elm/beech-like), 1 lobed (oak-like), 2 long tapered (mango/willow-like),
//            3 heart with a drip tip (peepal-like)
//   states:  0 healthy, 1 young and light, 2 yellowing, 3 browned edges with insect nibbles
// Every leaf has a petiole, a raised midrib, curving side veins and a fine net of veinlets. Geometry is a
// small curved mesh per leaf: cupped across, folded along the midrib, arched along its length. Leaves sit
// alternately along twigs ("sprays"), facing the light, growing larger toward the middle of the twig.
import * as THREE from '../vendor/three/three.module.js';
import { shared } from './materials.js';
import { STREAM_GLSL } from './stream.js';

const CELL = 512, GRID = 4, SIZE = CELL * GRID;

function rng(seed) { let s = (seed * 9301 + 49297) % 233280 || 5; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

// half-width of the blade at t (0 base .. 1 tip), as a fraction of the cell
function outline(sp, t) {
  if (sp === 0) { const w = 0.36 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.85)), 0.9); return w + w * 0.06 * (1 - Math.abs((t * 26) % 1 * 2 - 1)); }
  if (sp === 1) { const w = 0.34 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.9)), 0.7); const lobes = 0.62 + 0.38 * Math.pow(Math.abs(Math.cos(t * Math.PI * 4.5)), 0.6); return w * (t < 0.08 ? 0.6 : lobes); }
  if (sp === 2) return 0.16 * Math.pow(Math.sin(Math.PI * t), 0.75) * (1 - 0.2 * t);
  const body = 0.42 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.12 + t * 1.15)), 0.75);
  return t > 0.76 ? body * Math.max(0.05, 1 - (t - 0.76) * 3.2) + 0.012 : body;
}

function paintLeaf(ctx, ox, oy, sp, st, r) {
  const S = CELL, base = 0.07, tip = 0.97;
  const X = (u) => ox + S * (0.5 + u), Y = (t) => oy + S * (1 - (base + (tip - base) * t));
  // palette per state (sRGB)
  const pal = [
    ['#2e5a1c', '#3f7426', '#1f4213'],
    ['#5f8f2c', '#79a83a', '#4a7a22'],
    ['#9c9a2e', '#bdb446', '#6f7a22'],
    ['#3b6420', '#507d2c', '#2a4a16'],
  ][st];
  // blade
  ctx.save();
  ctx.beginPath();
  const N = 140;
  for (let i = 0; i <= N; i++) { const t = i / N; ctx.lineTo(X(outline(sp, t)), Y(t)); }
  for (let i = N; i >= 0; i--) { const t = i / N; ctx.lineTo(X(-outline(sp, t)), Y(t)); }
  ctx.closePath();
  const g = ctx.createLinearGradient(X(-0.4), 0, X(0.4), 0);
  g.addColorStop(0, pal[2]); g.addColorStop(0.5, pal[1]); g.addColorStop(1, pal[0]);
  ctx.fillStyle = g; ctx.fill();
  ctx.clip();
  // mottling
  for (let k = 0; k < 160; k++) {
    ctx.fillStyle = `rgba(${r() < 0.5 ? '20,40,10' : '120,150,60'},${0.03 + r() * 0.05})`;
    ctx.beginPath(); ctx.ellipse(X((r() - 0.5) * 0.8), Y(r()), 4 + r() * 22, 3 + r() * 14, r() * 3, 0, 6.28); ctx.fill();
  }
  if (st === 2) { // yellowing: green lingers along the veins
    const yg = ctx.createRadialGradient(X(0), Y(0.4), 10, X(0), Y(0.4), S * 0.5);
    yg.addColorStop(0, 'rgba(60,110,30,0.55)'); yg.addColorStop(1, 'rgba(60,110,30,0)');
    ctx.fillStyle = yg; ctx.fillRect(ox, oy, S, S);
  }
  if (st === 3) { // browned, dried margin
    ctx.lineWidth = 26; ctx.strokeStyle = 'rgba(120,70,25,0.75)';
    ctx.beginPath();
    for (let i = 0; i <= N; i++) { const t = i / N; ctx.lineTo(X(outline(sp, t)), Y(t)); }
    for (let i = N; i >= 0; i--) { const t = i / N; ctx.lineTo(X(-outline(sp, t)), Y(t)); }
    ctx.stroke();
  }
  // side veins: curving from the midrib toward the margin, then a fine net between them
  const nv = sp === 2 ? 22 : sp === 1 ? 9 : 11;
  ctx.lineCap = 'round';
  for (let side = -1; side <= 1; side += 2) {
    for (let v = 0; v < nv; v++) {
      const t0 = 0.06 + v / nv * 0.86 + (side > 0 ? 0.02 : 0);
      const w0 = outline(sp, Math.min(1, t0 + 0.14));
      const t1 = Math.min(0.99, t0 + (sp === 2 ? 0.08 : 0.16));
      ctx.strokeStyle = 'rgba(190,215,120,0.55)'; ctx.lineWidth = sp === 2 ? 2 : 3 * (1 - t0 * 0.5);
      ctx.beginPath(); ctx.moveTo(X(0), Y(t0));
      ctx.quadraticCurveTo(X(side * w0 * 0.45), Y(t0 + 0.05), X(side * w0 * 0.92), Y(t1)); ctx.stroke();
      ctx.strokeStyle = 'rgba(15,35,8,0.25)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X(0) + side * 2, Y(t0) + 2);
      ctx.quadraticCurveTo(X(side * w0 * 0.45) + side * 2, Y(t0 + 0.05) + 2, X(side * w0 * 0.92), Y(t1) + 2); ctx.stroke();
    }
  }
  for (let k = 0; k < 700; k++) { // veinlet net
    const t = r(), u = (r() - 0.5) * 2 * outline(sp, t);
    ctx.strokeStyle = `rgba(170,200,110,${0.08 + r() * 0.1})`; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(X(u), Y(t)); const a = r() * 6.28; ctx.lineTo(X(u) + Math.cos(a) * 9, Y(t) + Math.sin(a) * 9); ctx.stroke();
  }
  // midrib, raised and pale
  ctx.strokeStyle = 'rgba(205,225,140,0.85)'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(X(0), Y(0)); ctx.quadraticCurveTo(X(0.01), Y(0.5), X(0), Y(0.985)); ctx.stroke();
  ctx.strokeStyle = 'rgba(20,40,10,0.35)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(X(0) + 4, Y(0)); ctx.quadraticCurveTo(X(0.01) + 4, Y(0.5), X(0) + 3, Y(0.985)); ctx.stroke();
  // darker rim
  ctx.restore();
  ctx.save();
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(15,30,8,0.6)';
  ctx.beginPath();
  for (let i = 0; i <= N; i++) { const t = i / N; ctx.lineTo(X(outline(sp, t)), Y(t)); }
  for (let i = N; i >= 0; i--) { const t = i / N; ctx.lineTo(X(-outline(sp, t)), Y(t)); }
  ctx.closePath(); ctx.stroke();
  ctx.restore();
  // insect nibbles bite clean through
  if (st === 3) {
    ctx.save(); ctx.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 4; k++) {
      const t = 0.25 + r() * 0.6, s = r() < 0.5 ? -1 : 1;
      ctx.beginPath(); ctx.arc(X(s * outline(sp, t) * 0.95), Y(t), 14 + r() * 22, 0, 6.28); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(X(0.08), Y(0.55), 7, 0, 6.28); ctx.fill();
    ctx.restore();
  }
  // petiole
  ctx.strokeStyle = st === 2 ? '#7a7a2a' : '#4b5a22'; ctx.lineWidth = 7; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(X(0), Y(0.02)); ctx.lineTo(X(0), oy + S * 0.995); ctx.stroke();
}

let atlasTex = null;
export function leafAtlas() {
  if (atlasTex) return atlasTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = SIZE;
  const ctx = cv.getContext('2d');
  const r = rng(11);
  for (let sp = 0; sp < 4; sp++) for (let st = 0; st < 4; st++) paintLeaf(ctx, st * CELL, sp * CELL, sp, st, r);
  atlasTex = new THREE.CanvasTexture(cv);
  atlasTex.colorSpace = THREE.NoColorSpace;
  atlasTex.anisotropy = 4;
  atlasTex.generateMipmaps = true;
  atlasTex.minFilter = THREE.LinearMipmapLinearFilter;
  atlasTex.flipY = false;
  return atlasTex;
}

// ---------- geometry ----------
class B {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.lf = []; this.i = []; }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('lf', new THREE.Float32BufferAttribute(this.lf, 2));
    g.setIndex(this.i);
    g.computeVertexNormals();
    g.computeBoundingSphere();
    g.boundingSphere.radius += 0.5;
    return g;
  }
}
const V = THREE.Vector3;

// one leaf: 5 rows along x 3 columns across (edge, midrib, edge); cup, fold and arch baked in
function addLeaf(b, origin, fwd, up, L, sp, st, shade, phase) {
  const side = new V().crossVectors(fwd, up).normalize();
  const u0 = st / GRID, v0 = sp / GRID, cu = 1 / GRID;
  const base = b.p.length / 3;
  const rows = 5;
  for (let i = 0; i < rows; i++) {
    const t = i / (rows - 1);
    for (let j = -1; j <= 1; j++) {
      // cell space: midrib at x=0.5; blade spans y 0.07..0.97, petiole below
      const cy = 0.0 + t, cx = 0.5 + j * 0.5;
      const along = t * L, across = j * 0.5 * L;
      const lift = Math.abs(j) * 0.16 * L + 0.09 * L * Math.sin(Math.PI * t) - 0.12 * L * t * t;
      const p = new V().copy(origin).addScaledVector(fwd, along).addScaledVector(side, across).addScaledVector(up, lift);
      b.p.push(p.x, p.y, p.z);
      b.uv.push(u0 + cx * cu, v0 + (1 - cy) * cu);
      const s = shade * (j === 0 ? 1 : 0.92);
      b.c.push(s, s, s);
      b.lf.push(t, phase);
    }
  }
  for (let i = 0; i < rows - 1; i++) for (let j = 0; j < 2; j++) {
    const a = base + i * 3 + j, c = a + 3;
    b.i.push(a, a + 1, c + 1, a, c + 1, c);
  }
}

// a thin twig strip (flag lf.x = -1 so the shader paints it as bark)
function addTwig(b, pts, w) {
  const base = b.p.length / 3;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], ww = w * (1 - i / pts.length * 0.7);
    b.p.push(p.x - ww, p.y, p.z, p.x + ww, p.y, p.z, p.x, p.y + ww, p.z);
    for (let k = 0; k < 3; k++) { b.uv.push(0, 0); b.c.push(1, 1, 1); b.lf.push(-1, 0); }
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = base + i * 3, c = a + 3;
    b.i.push(a, a + 2, c + 2, a, c + 2, c, a + 1, c + 1, c + 2, a + 1, c + 2, a + 2);
  }
}

// A spray: a twig ~40 cm long along +z with alternate leaves facing up toward the light.
export function sprayGeo(sp, seed = 1, nLeaves = 11) {
  const r = rng(seed * 31 + sp * 7);
  const b = new B();
  const Ls = 0.42;
  const pts = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push(new V((r() - 0.5) * 0.01, 0.03 * Math.sin(t * 2.5) - 0.05 * t * t, t * Ls)); }
  addTwig(b, pts, 0.0035);
  const sizeBase = sp === 2 ? 0.17 : sp === 3 ? 0.12 : sp === 1 ? 0.11 : 0.095;
  for (let k = 0; k < nLeaves; k++) {
    const t = 0.12 + 0.88 * k / (nLeaves - 1);
    const at = pts[Math.min(8, Math.round(t * 8))].clone();
    const s = k % 2 ? 1 : -1;
    const terminal = k === nLeaves - 1;
    const a = terminal ? 0 : s * (0.75 + r() * 0.35);
    const fwd = new V(Math.sin(a), 0.15 + r() * 0.25, Math.cos(a)).normalize();
    const up = new V(-(r() - 0.5) * 0.4, 1, -fwd.z * 0.25).normalize();
    up.addScaledVector(fwd, -up.dot(fwd)).normalize();
    const size = sizeBase * (0.65 + 0.5 * Math.sin(Math.PI * Math.min(1, t * 1.1))) * (0.85 + r() * 0.3);
    const roll = r();
    const st = roll < 0.68 ? 0 : roll < 0.84 ? 1 : roll < 0.95 ? 2 : 3;
    addLeaf(b, at, fwd, up, size, sp, st, 0.8 + r() * 0.25, r());
  }
  return b.geo();
}

// a single leaf lying flat (for leaves drifting on the water)
export function singleLeafGeo(sp, st) {
  const b = new B();
  addLeaf(b, new V(0, 0, -0.5), new V(0, 0, 1), new V(0, 1, 0), 1, sp, st, 1, 0.3);
  return b.geo();
}

// ---------- material ----------
export function leafMat(opts = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared, uAtlas: { value: leafAtlas() }, uSway: { value: opts.sway ?? 0.06 }, uFlutter: { value: opts.flutter ?? 1 } },
    side: THREE.DoubleSide,
    vertexColors: true,
    vertexShader: `
      uniform float uTime; uniform vec2 uWind; uniform float uDensity; uniform float uSway; uniform float uFlutter;
      attribute vec2 lf;
      varying vec2 vUv; varying vec3 vP; varying vec3 vN; varying vec3 vCol; varying float vTwig;
      float h12(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
      float vn(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);return mix(mix(h12(i),h12(i+vec2(1,0)),u.x),mix(h12(i+vec2(0,1)),h12(i+vec2(1,1)),u.x),u.y);}
      void main(){
        vec3 base=(modelMatrix*instanceMatrix*vec4(0.,0.,0.,1.)).xyz;
        if(h12(base.xz*5.17+base.y)>uDensity){ gl_Position=vec4(2.,2.,2.,1.); return; }
        vec4 wp=modelMatrix*instanceMatrix*vec4(position,1.);
        vec3 n=normalize(mat3(modelMatrix)*mat3(instanceMatrix)*normal);
        vec2 wd=normalize(uWind);
        // the whole spray sways with its branch (same field as the bark), each leaf flutters on its stalk
        float gust=(vn(wp.xz*.15+vec2(uTime*.35,uTime*.2))-.5)*2.+.4*sin(uTime*1.3+base.x*.3);
        wp.xz+=wd*uSway*gust;
        if(lf.x>0.){
          float fl=sin(uTime*(7.+lf.y*5.)+lf.y*40.+base.x*3.)*(.5+.5*gust);
          wp.xyz+=n*fl*.018*lf.x*uFlutter;
        }
        vP=wp.xyz; vN=n; vUv=uv; vTwig=lf.x<0.?1.:0.;
        vec3 col=color;
        #ifdef USE_INSTANCING_COLOR
        col*=instanceColor;
        #endif
        vCol=col;
        gl_Position=projectionMatrix*viewMatrix*wp;
      }`,
    fragmentShader: `
      uniform sampler2D uAtlas; uniform float uTime; uniform vec3 uSun; uniform vec3 uFogCol; uniform float uFogD; uniform vec2 uWind;
      varying vec2 vUv; varying vec3 vP; varying vec3 vN; varying vec3 vCol; varying float vTwig;
      ${'float hash12(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}'}
      float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);return mix(mix(hash12(i),hash12(i+vec2(1,0)),u.x),mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),u.x),u.y);}
      float fbm3(vec2 p){float s=0.,a=.5;for(int i=0;i<3;i++){s+=a*vnoise(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return s;}
      ${STREAM_GLSL}
      float dapple(vec3 p){ vec2 q=p.xz+uSun.xz/uSun.y*(9.-p.y); float n=fbm3(q*.32+vec2(uTime*.05,uTime*.03))+.18*vnoise(q*2.5+uTime*.4); return smoothstep(.5,.66,n); }
      const vec3 SUNC=vec3(1.0,.86,.62)*3.4;
      vec3 tone(vec3 c){c=(c*(2.51*c+.03))/(c*(2.43*c+.59)+.14);return pow(clamp(c,0.,1.),vec3(1./2.2));}
      void main(){
        vec3 alb; float a=1.;
        if(vTwig>.5){ alb=vec3(.09,.07,.045); }
        else {
          vec4 t=texture2D(uAtlas,vUv);
          if(t.a<.5) discard;
          alb=pow(t.rgb,vec3(2.2))*vCol;
        }
        vec3 N=normalize(vN);
        bool front=gl_FrontFacing;
        if(!front) N=-N;
        vec3 V=normalize(cameraPosition-vP);
        float d=dapple(vP);
        float ao=clamp(vCol.g/max(vCol.g,.001),0.,1.);
        // the underside is paler and matte
        if(!front && vTwig<.5) alb=alb*vec3(1.2,1.28,1.05)+vec3(.012,.016,.004);
        vec3 amb=mix(vec3(.05,.07,.035),vec3(.22,.31,.24),.5+.5*N.y);
        float ndl=max(dot(N,uSun),0.);
        vec3 c=alb*amb*1.05+alb*SUNC*ndl*d*.9;
        if(vTwig<.5){
          // light through the leaf: veins show darker against the glow when the sun is behind it
          float back=pow(max(dot(-V,uSun),0.),2.)*.9+max(dot(-N,uSun),0.)*.35;
          c+=alb*vec3(1.05,1.25,.55)*SUNC*back*d*.75;
          // waxy upper surface
          if(front){ vec3 H=normalize(V+uSun); c+=SUNC*pow(max(dot(N,H),0.),60.)*.18*d; float F=pow(1.-max(dot(N,V),0.),5.); c+=vec3(.18,.24,.22)*F*.25; }
          // a few beads of water on leaves low over the stream
          float wet=1.-smoothstep(.3,1.4,vP.y-levelF(vP.z));
          vec2 g=vUv*vec2(260.,260.); float dr=step(.992,hash12(floor(g)))*smoothstep(.5,.15,length(fract(g)-.5));
          c+=vec3(1.)*dr*wet*(.6+2.*d);
        }
        float dist=length(vP-cameraPosition);
        c=mix(c,uFogCol,clamp(1.-exp(-dist*uFogD),0.,1.));
        gl_FragColor=vec4(tone(c),1.);
      }`,
  });
}
