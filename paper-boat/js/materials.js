// Custom shaders for the forest stream. Everything shares one lighting model: a warm sun broken into
// dapples by the canopy, a green-grey sky/bounce ambient, soft mist with distance, ACES tonemap.
import * as THREE from '../vendor/three/three.module.js';
import { STREAM_GLSL } from './stream.js';

export const shared = {
  uTime: { value: 0 },
  uSun: { value: new THREE.Vector3(-0.35, 0.82, 0.45).normalize() },
  uFogCol: { value: new THREE.Color(0.16, 0.22, 0.16) },
  uFogD: { value: 0.03 },
  uWind: { value: new THREE.Vector2(0.8, 0.35) },
  uDensity: { value: 1 },
  uBoat: { value: new THREE.Vector4(0, 0, 0, 1) },
};

const NOISE = `
float hash12(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
vec2 hash22(vec2 p){vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));p3+=dot(p3,p3.yzx+33.33);return fract((p3.xx+p3.yz)*p3.zy);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash12(i),hash12(i+vec2(1,0)),u.x),mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),u.x),u.y);}
float fbm(vec2 p){float s=0.,a=.5;for(int i=0;i<4;i++){s+=a*vnoise(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return s;}
float fbm3(vec2 p){float s=0.,a=.5;for(int i=0;i<3;i++){s+=a*vnoise(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return s;}
`;

const COMMON = `
uniform float uTime; uniform vec3 uSun; uniform vec3 uFogCol; uniform float uFogD; uniform vec2 uWind;
${NOISE}
${STREAM_GLSL}
// sunlight through the canopy: bright flecks that drift slowly as the leaves move
float dapple(vec3 p){
  vec2 q=p.xz+uSun.xz/uSun.y*(9.-p.y);
  float n=fbm3(q*.32+vec2(uTime*.05,uTime*.03))+.18*vnoise(q*2.5+uTime*.4);
  return smoothstep(.5,.66,n);
}
const vec3 SUNC=vec3(1.0,.86,.62)*3.4;
vec3 ambient(vec3 N){ return mix(vec3(.05,.07,.035),vec3(.22,.31,.24),.5+.5*N.y); }
vec3 lit(vec3 alb,vec3 N,vec3 P,float ao,float trans){
  float d=dapple(P);
  float ndl=max(dot(N,uSun),0.);
  vec3 c=alb*ambient(N)*ao;
  c+=alb*SUNC*ndl*d*mix(.6,1.,ao);
  c+=alb*SUNC*trans*d*max(dot(-N,uSun),0.)*.6;
  return c;
}
vec3 fogit(vec3 c,vec3 P){
  float d=length(P-cameraPosition);
  float f=1.-exp(-d*uFogD);
  float mist=exp(-max(P.y-levelF(P.z),0.)*1.4)*.12*(1.-exp(-d*.06));
  return mix(c,uFogCol,clamp(f+mist,0.,1.));
}
vec3 tone(vec3 c){c=(c*(2.51*c+.03))/(c*(2.43*c+.59)+.14);return pow(clamp(c,0.,1.),vec3(1./2.2));}
`;

function mat(vs, fs, opts = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared, ...(opts.uniforms || {}) },
    vertexShader: vs,
    fragmentShader: COMMON + fs,
    side: opts.side ?? THREE.FrontSide,
    transparent: !!opts.transparent,
    depthWrite: opts.depthWrite ?? true,
    blending: opts.blending ?? THREE.NormalBlending,
    vertexColors: !!opts.vertexColors,
  });
}

// ---------- foliage: grass blades, ferns, flowers, ivy, canopy leaves ----------
// Instanced. Each instance gets its own tint (instanceColor) and sways in a gusty wind; a hash of its
// position thins it out when the quality tier drops (uDensity) without rebuilding anything.
const FOLIAGE_VS = `
uniform float uTime; uniform vec2 uWind; uniform float uDensity; uniform float uBend; uniform float uGeoH; uniform vec4 uBoat;
${NOISE}
varying vec3 vCol; varying vec3 vP; varying vec3 vN; varying float vH; varying vec2 vUv;
void main(){
  vec3 base=(modelMatrix*instanceMatrix*vec4(0.,0.,0.,1.)).xyz;
  float hid=hash12(base.xz*7.31+base.y);
  if(hid>uDensity){ gl_Position=vec4(2.,2.,2.,1.); return; }
  vec4 wp=modelMatrix*instanceMatrix*vec4(position,1.);
  float h=clamp(position.y/uGeoH,0.,1.);
  float lift=max(wp.y-base.y,0.);
  float g=sin(uTime*1.6+base.x*.5+base.z*.35)*.5+sin(uTime*2.9+base.x*1.7+base.z*1.1)*.22+(vnoise(base.xz*.25+vec2(uTime*.35,uTime*.2))-.45)*1.3;
  vec2 wd=normalize(uWind);
  float bend=uBend*lift*lift*(g+.35);
  wp.xz+=wd*bend+vec2(-wd.y,wd.x)*uBend*lift*lift*.25*sin(uTime*4.3+hid*30.);
  wp.y-=abs(bend)*.25*lift;
  vP=wp.xyz; vH=h; vUv=uv;
  vN=normalize(mat3(modelMatrix)*mat3(instanceMatrix)*normal);
  vec3 col=vec3(1.);
  #ifdef USE_COLOR
  col*=color;
  #endif
  #ifdef USE_INSTANCING_COLOR
  col*=instanceColor;
  #endif
  vCol=col;
  gl_Position=projectionMatrix*viewMatrix*wp;
}`;
const FOLIAGE_FS = `
uniform float uAoBase; uniform float uTrans; uniform float uUp; uniform float uLeaf;
varying vec3 vCol; varying vec3 vP; varying vec3 vN; varying float vH; varying vec2 vUv;
void main(){
  vec3 N=normalize(vN); if(!gl_FrontFacing) N=-N;
  N=normalize(mix(N,vec3(0.,1.,0.),uUp));
  vec3 alb=vCol;
  if(uLeaf>.5){
    float s=abs(vUv.x-.5)*2.;
    float mid=smoothstep(.09,.0,s);
    float vein=smoothstep(.08,.0,abs(fract(vUv.y*6.-s*1.6)-.5))*(1.-s)*.6;
    alb*=1.+mid*.45+vein*.25;
    alb*=mix(.75,1.,smoothstep(1.,.7,s));
  }
  float ao=mix(uAoBase,1.,smoothstep(0.,.85,vH));
  vec3 c=lit(alb,N,vP,ao,uTrans);
  // wet sheen near the stream
  c=fogit(c,vP);
  gl_FragColor=vec4(tone(c),1.);
}`;
export function foliageMat({ bend = 0.6, geoH = 1, aoBase = 0.25, trans = 0.5, up = 0.35, leaf = false, side = THREE.DoubleSide } = {}) {
  return mat(FOLIAGE_VS, FOLIAGE_FS, {
    side, vertexColors: true,
    uniforms: { uBend: { value: bend }, uGeoH: { value: geoH }, uAoBase: { value: aoBase }, uTrans: { value: trans }, uUp: { value: up }, uLeaf: { value: leaf ? 1 : 0 } },
  });
}

// ---------- rocks: wet granite with moss on top, darker at the waterline, caustics under water ----------
const ROCK_VS = `
varying vec3 vP; varying vec3 vN; varying vec3 vL; varying vec3 vCol;
void main(){
  vec4 wp=modelMatrix*instanceMatrix*vec4(position,1.);
  vP=wp.xyz; vL=position; vN=normalize(mat3(modelMatrix)*mat3(instanceMatrix)*normal);
  vCol=vec3(1.);
  #ifdef USE_INSTANCING_COLOR
  vCol=instanceColor;
  #endif
  gl_Position=projectionMatrix*viewMatrix*wp;
}`;
const CAUSTIC = `
// sunlight focused by the moving surface: bright wavy lines where two scrolling noise fields cross 0.5
float caustic(vec2 p,float t){
  float a=1.-abs(vnoise(p*4.2+vec2(t*.55,t*.35))-.5)*2.;
  float b=1.-abs(vnoise(p*5.6-vec2(t*.4,-t*.45)+7.)-.5)*2.;
  return pow(a,9.)*.6+pow(b,9.)*.6+pow(a*b,5.)*.8;
}`;
const ROCK_FS = `
${CAUSTIC}
varying vec3 vP; varying vec3 vN; varying vec3 vL; varying vec3 vCol;
void main(){
  vec3 N=normalize(vN);
  N=normalize(N+(vec3(vnoise(vL.xz*9.),vnoise(vL.yz*9.+3.),vnoise(vL.xy*9.+7.))-.5)*.35);
  float L=levelF(vP.z);
  float n=fbm(vP.xz*4.+vP.y*3.);
  vec3 alb=mix(vec3(.16,.155,.14),vec3(.30,.29,.26),n)*vCol;
  alb*=.8+.4*vnoise(vL.xy*30.);
  // lichen flecks
  alb=mix(alb,vec3(.42,.43,.33),smoothstep(.72,.8,vnoise(vL.xz*22.+vL.y*9.))*.5);
  // moss on the upward faces, thick and green above the splash zone
  float up=N.y;
  float moss=smoothstep(.25,.7,up+(fbm(vP.xz*5.+vL.y*2.)-.5)*1.1)*smoothstep(L+.04,L+.14,vP.y);
  vec3 mossC=mix(vec3(.05,.11,.018),vec3(.15,.25,.045),fbm(vP.xz*14.+vP.y*5.));
  mossC*=.75+.5*vnoise(vP.xz*60.+vP.y*30.);
  alb=mix(alb,mossC,moss);
  // wet: darker and shinier near and under the water
  float wet=smoothstep(L+.16,L+.0,vP.y);
  alb*=mix(1.,.55,wet);
  float under=step(vP.y,L);
  vec3 c=lit(alb,N,vP,.75+.25*up,moss*.25);
  if(under>.5){
    float dep=L-vP.y;
    c*=exp(-dep*vec3(2.6,1.4,1.5));
    c+=alb*SUNC*caustic(vP.xz,uTime)*dapple(vP)*exp(-dep*2.)*1.3;
  }
  vec3 V=normalize(cameraPosition-vP), R=reflect(-V,N);
  float spec=pow(max(dot(R,uSun),0.),40.)*wet*(1.-under)*dapple(vP);
  c+=SUNC*spec*.5;
  c=fogit(c,vP);
  gl_FragColor=vec4(tone(c),1.);
}`;
export function rockMat() { return mat(ROCK_VS, ROCK_FS); }

// ---------- ground: pebbly stream bed with caustics, wet mud at the edge, moss and leaf litter on the banks ----------
const GROUND_VS = `
varying vec3 vP; varying vec3 vN;
void main(){ vec4 wp=modelMatrix*vec4(position,1.); vP=wp.xyz; vN=normalize(mat3(modelMatrix)*normal); gl_Position=projectionMatrix*viewMatrix*wp; }`;
const GROUND_FS = `
${CAUSTIC}
varying vec3 vP; varying vec3 vN;
// one layer of rounded stones: jittered cells, each stone an ellipse of its own size, tilt and colour
vec4 stoneLayer(vec2 p,float sc,float seed,out vec2 slope){
  vec2 q=p*sc; vec2 g=floor(q), f=fract(q); float best=9.; vec2 bc=vec2(0.), bd=vec2(0.);
  for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){ vec2 o=vec2(x,y); vec2 h=hash22(g+o+seed); vec2 d=o+.12+.76*h-f;
    float a=hash12(g+o+seed+5.)*6.28; mat2 R=mat2(cos(a),-sin(a),sin(a),cos(a)); vec2 e=R*d; e.x*=1.+hash12(g+o+seed+9.)*.8;
    float s=.25+.3*hash12(g+o+seed+2.); float k=length(e)/s; if(k<best){best=k; bc=g+o; bd=d/s;} }
  float inside=smoothstep(1.,.86,best);
  slope=bd*inside*1.4;
  float h=hash12(bc+seed);
  vec3 c=mix(vec3(.26,.24,.21),vec3(.52,.48,.41),h);
  c=mix(c,vec3(.38,.25,.16),step(.78,hash12(bc+seed+3.))*.7);
  c=mix(c,vec3(.58,.57,.53),step(.9,hash12(bc+seed+7.))*.7);
  c=mix(c,vec3(.17,.17,.18),step(.84,hash12(bc+seed+11.))*.8);
  c*=.75+.35*vnoise(p*70.+seed)+.15*(1.-best);
  return vec4(c,inside);
}
vec3 pebbles(vec2 p,out vec3 n){
  vec2 s1,s2,s3;
  vec4 a=stoneLayer(p,4.,0.,s1), b=stoneLayer(p,10.,17.,s2), c=stoneLayer(p,24.,41.,s3);
  vec3 sand=mix(vec3(.24,.21,.16),vec3(.36,.32,.24),vnoise(p*40.))*(.8+.3*vnoise(p*180.));
  vec3 col=sand; vec2 sl=vec2(0.);
  col=mix(col,c.rgb,c.a); sl=mix(sl,s3,c.a);
  col=mix(col,b.rgb,b.a); sl=mix(sl,s2,b.a);
  col=mix(col,a.rgb,a.a); sl=mix(sl,s1,a.a);
  // dark gaps between stones
  col*=.65+.35*max(max(a.a,b.a),c.a);
  n=normalize(vec3(sl,1.));
  return col;
}void main(){
  vec3 N=normalize(vN);
  float L=levelF(vP.z);
  float dx=abs(vP.x-cxF(vP.z))-halfWF(vP.z);
  vec3 alb; float ao=1.;
  if(vP.y<L+.015){
    vec3 pn; alb=pebbles(vP.xz,pn);
    N=normalize(N+vec3(pn.x,0.,pn.y)*.9);
    alb=mix(alb,vec3(.16,.19,.06),smoothstep(.55,.75,fbm(vP.xz*1.5))*.5);
  } else {
    float e=max(dx,0.);
    vec3 mud=vec3(.14,.10,.065)*(.8+.4*vnoise(vP.xz*20.));
    vec3 mossC=mix(vec3(.05,.10,.02),vec3(.12,.19,.04),fbm(vP.xz*7.))*(.7+.5*vnoise(vP.xz*45.));
    vec3 litter=mix(vec3(.19,.12,.06),vec3(.32,.22,.10),fbm(vP.xz*9.));
    litter=mix(litter,vec3(.36,.26,.08),smoothstep(.7,.8,vnoise(vP.xz*26.)));
    alb=mix(mud,mossC,smoothstep(.02,.35,e));
    alb=mix(alb,litter*.75,smoothstep(.35,.7,fbm(vP.xz*.9+4.))*smoothstep(.4,2.,e));
    alb*=mix(.6,1.,smoothstep(0.,.2,vP.y-L));
    ao=.75;
  }
  vec3 c=lit(alb,N,vP,ao,0.);
  if(vP.y<L){
    float dep=L-vP.y;
    c*=exp(-dep*vec3(2.6,1.3,1.4));
    c+=alb*SUNC*caustic(vP.xz,uTime)*dapple(vP)*exp(-dep*1.8)*1.4;
  }
  c=fogit(c,vP);
  gl_FragColor=vec4(tone(c),1.);
}`;
export function groundMat() { return mat(GROUND_VS, GROUND_FS); }

// ---------- bark ----------
const BARK_VS = `
varying vec3 vP; varying vec3 vN; varying vec2 vUv; varying vec3 vCol;
void main(){
  vec4 wp=modelMatrix*instanceMatrix*vec4(position,1.); vP=wp.xyz; vUv=uv;
  vN=normalize(mat3(modelMatrix)*mat3(instanceMatrix)*normal);
  vCol=vec3(1.);
  #ifdef USE_INSTANCING_COLOR
  vCol=instanceColor;
  #endif
  gl_Position=projectionMatrix*viewMatrix*wp;
}`;
const BARK_FS = `
varying vec3 vP; varying vec3 vN; varying vec2 vUv; varying vec3 vCol;
void main(){
  vec3 N=normalize(vN);
  vec2 b=vec2(vUv.x*14.,vP.y*2.2);
  float ridge=fbm(vec2(b.x*1.2,b.y*.35));
  float cr=smoothstep(.45,.5,abs(fract(b.x+ridge*1.8)-.5));
  vec3 alb=mix(vec3(.06,.05,.04),vec3(.17,.14,.11),ridge)*vCol;
  alb*=1.-cr*.55;
  N=normalize(N+vec3(cos(vUv.x*6.28),0.,sin(vUv.x*6.28))*(ridge-.5)*.5);
  float moss=smoothstep(.2,.8,dot(N,normalize(vec3(.3,.2,-1.)))+fbm(vP.xz*3.+vP.y)*.6-.3)*smoothstep(2.6,.2,vP.y-levelF(vP.z));
  alb=mix(alb,mix(vec3(.10,.19,.03),vec3(.20,.30,.05),fbm(vP.xy*9.)),moss*.85);
  float ao=smoothstep(-.2,1.2,vP.y-levelF(vP.z))*.6+.4;
  vec3 c=lit(alb,N,vP,ao,0.);
  c=fogit(c,vP);
  gl_FragColor=vec4(tone(c),1.);
}`;
export function barkMat() { return mat(BARK_VS, BARK_FS); }

// ---------- water: clear mountain water over the bed, foam in the rapids and round rocks, canopy reflections ----------
const WATER_VS = `
uniform float uTime; uniform vec4 uRocks[24];
${STREAM_GLSL}
varying vec3 vP;
float wave(vec3 p){
  float R=rapidF(p.z);
  float h=R*.018*sin(p.x*9.+p.z*4.)*sin(p.z*7.3-uTime*.6);
  h+=.004*sin(p.x*3.1+p.z*2.3+uTime*1.7)+.003*sin(p.x*-2.3+p.z*4.1-uTime*2.3);
  for(int i=0;i<24;i++){ vec4 k=uRocks[i]; if(k.z<=0.) continue; float dx=p.x-k.x, dz=p.z-k.y; float r2=k.z*k.z;
    h+=.03*exp(-((dz+k.z*.9)*(dz+k.z*.9)+dx*dx)/r2)-.02*exp(-((dz-k.z*1.8)*(dz-k.z*1.8)+dx*dx*1.5)/(r2*1.5)); }
  return h;
}
void main(){
  vec4 wp=modelMatrix*vec4(position,1.);
  wp.y=levelF(wp.z)+wave(wp.xyz);
  vP=wp.xyz;
  gl_Position=projectionMatrix*viewMatrix*wp;
}`;
const WATER_FS = `
uniform vec4 uRocks[24]; uniform vec4 uBoat;
varying vec3 vP;
float hgt(vec2 p,float t,vec2 flow){
  // two-phase flow-mapped ripple height so the surface streams downhill without smearing
  float ph=fract(t*.6), ph2=fract(t*.6+.5);
  vec2 a=p-flow*ph*1.6, b=p-flow*ph2*1.6+.37;
  float w=abs(ph-.5)*2.;
  float h1=vnoise(a*vec2(6.,3.))*.6+vnoise(a*vec2(15.,8.))*.3+vnoise(a*vec2(34.,18.))*.12;
  float h2=vnoise(b*vec2(6.,3.))*.6+vnoise(b*vec2(15.,8.))*.3+vnoise(b*vec2(34.,18.))*.12;
  return mix(h1,h2,w);
}
void main(){
  vec3 P=vP; float t=uTime;
  // the inside of the boat's hull stays dry
  { vec2 d=P.xz-uBoat.xy; vec2 fw=vec2(sin(uBoat.z),cos(uBoat.z)); float lz=dot(d,fw), lx=dot(d,vec2(fw.y,-fw.x));
    float a=abs(lz)/(.078*uBoat.w); if(a<1. && abs(lx)<.016*uBoat.w*(1.-a*a)) discard; }
  float z=P.z, L=levelF(z), R=rapidF(z);
  float w=halfWF(z), dx=P.x-cxF(z), u=clamp(dx/w,-1.,1.);
  vec2 dir=normalize(vec2(dcxF(z),1.));
  float sp=(.42+.95*R)*(1.-.6*u*u);
  vec2 flow=dir*sp;
  float e=.02;
  float amp=.035+.11*R;
  float h0=hgt(P.xz,t,flow), hx=hgt(P.xz+vec2(e,0.),t,flow), hz=hgt(P.xz+vec2(0.,e),t,flow);
  vec3 N=normalize(vec3(-(hx-h0)/e*amp,1.,-(hz-h0)/e*amp));
  // foam: white water in the rapids, cushions upstream of rocks and trails in their lee
  float foam=0.;
  float rk=0.;
  for(int i=0;i<24;i++){ vec4 k=uRocks[i]; if(k.z<=0.) continue; vec2 d=P.xz-k.xy; float r=length(d);
    float a=dot(d,dir), b=dot(d,vec2(dir.y,-dir.x));
    foam+=smoothstep(k.z*1.45,k.z*.95,r)*.9;
    foam+=smoothstep(k.z*1.2,0.,abs(b))*smoothstep(0.,k.z*.6,a)*exp(-a/(k.z*5.))*.8;
    rk=max(rk,smoothstep(k.z*1.1,k.z*.9,r)); }
    // foam streaks stretched along the flow, with fine bubbles
  vec2 fq=vec2(dot(P.xz,vec2(dir.y,-dir.x)),dot(P.xz,dir));
  vec2 fsp=vec2(0.,sp*t);
  float fn=vnoise((fq-fsp)*vec2(26.,5.))*.55+vnoise((fq-fsp*1.15)*vec2(70.,16.))*.3+vnoise((fq-fsp*1.3)*vec2(160.,90.))*.25;
  float lip=smoothstep(STEP-1.0,STEP-.55,mod(z,STEP))*(1.-smoothstep(STEP-.05,STEP,mod(z,STEP)));
  float churn=smoothstep(0.,1.8,mod(z,STEP))*(1.-smoothstep(1.8,3.6,mod(z,STEP)));
  foam=clamp(foam+(R*R*.35+lip*.6+(1.-smoothstep(0.,.6,mod(z,STEP)))*.55+churn*.25)*smoothstep(.0,.6,1.-abs(u)),0.,1.6);
  float foamM=smoothstep(.5,.85,foam*fn*1.15+foam*.06);
  // depth of clear water to the bed
  float depth=max(.0,.34-.16*R)*pow(max(0.,1.-u*u),.6)+.01;
  depth*=1.-rk;
  vec3 V=normalize(cameraPosition-P);
  float F=.02+.98*pow(1.-max(dot(N,V),0.),5.);
  vec3 Rv=reflect(-V,N);
  // reflection: dark canopy with bright gaps of sky
  float gap=smoothstep(.68,.85,fbm(Rv.xz/(Rv.y+.3)*1.6+3.));
  vec3 refl=mix(vec3(.035,.06,.035),vec3(.55,.66,.64),gap*smoothstep(0.,.5,Rv.y));
  refl=mix(refl,vec3(.12,.16,.10),exp(-max(Rv.y,0.)*5.)*.6);
  refl*=1.-lip*.6;
  float d=dapple(P);
  float glint=pow(max(dot(Rv,uSun),0.),300.)*d*7.;
  vec3 tint=vec3(.018,.04,.03);
  float alpha=1.-exp(-depth*2.4);
  alpha=mix(alpha,1.,F);
  vec3 c=mix(tint*(.6+.8*d),refl,F/max(alpha,.05));
  c+=SUNC*glint;
  vec3 foamC=vec3(.86,.9,.88)*(ambient(vec3(0.,1.,0.))*1.6+SUNC*d*.7);
  c=mix(c,foamC,foamM*.95);
  alpha=max(alpha,foamM*.95);
  alpha=max(alpha,.12);
  // a thin bright line where the water meets the banks
  c=fogit(c,P);
  gl_FragColor=vec4(tone(c),clamp(alpha,0.,1.));
}`;
export function waterMat() {
  return mat(WATER_VS, WATER_FS, { transparent: true, depthWrite: false, uniforms: { uRocks: { value: Array.from({ length: 24 }, () => new THREE.Vector4(0, 0, 0, 0)) } } });
}

// ---------- the paper boat: notebook paper, crease lines, soaking at the waterline ----------
const PAPER_VS = `
attribute vec3 bar;
varying vec3 vP; varying vec3 vN; varying vec3 vL; varying vec3 vNL; varying vec2 vUv; varying vec3 vB;
void main(){ vec4 wp=modelMatrix*vec4(position,1.); vP=wp.xyz; vN=normalize(mat3(modelMatrix)*normal); vNL=normal; vL=position; vUv=uv; vB=bar; gl_Position=projectionMatrix*viewMatrix*wp; }`;
const PAPER_FS = `
uniform float uSoak; uniform float uWaterY;
varying vec3 vP; varying vec3 vN; varying vec3 vL; varying vec3 vNL; varying vec2 vUv; varying vec3 vB;
void main(){
  vec3 N=normalize(vN); vec3 nl=normalize(vNL);
  if(!gl_FrontFacing){ N=-N; nl=-nl; }
  vec2 uv=vUv;
  float fib=vnoise(uv*900.)*.5+vnoise(uv*2400.)*.5;
  vec3 alb=vec3(.72,.71,.66)*(.95+.07*fib);
  float d=abs(fract(uv.y/.0072)-.5)*.0072;
  alb=mix(alb,vec3(.22,.36,.66),(1.-smoothstep(.00012,.00045,d))*.42);
  alb=mix(alb,vec3(.62,.12,.10),(1.-smoothstep(.0002,.0006,abs(uv.x-.041)))*.45);
  float outside=step(0.,dot(nl.xz,vL.xz))*step(.0035,abs(vL.x));
  float wl=uWaterY+.006+.014*uSoak+(vnoise(vL.xz*95.+vL.y*40.)-.5)*.007;
  float s=smoothstep(wl+.004,wl-.003,vP.y)*outside;
  alb=mix(alb,alb*vec3(.55,.6,.62),s*.85);
  vec3 bw=fwidth(vB); vec3 e3=smoothstep(vec3(0.),bw*1.6,vB);
  alb*=1.-(1.-min(e3.x,min(e3.y,e3.z)))*.3;
  N=normalize(N+(vec3(vnoise(vL.xz*260.),vnoise(vL.zy*260.+3.),vnoise(vL.xy*260.+7.))-.5)*.05);
  float ao=mix(.62+.38*smoothstep(-.012,.045,vL.y),1.,outside);
  vec3 c=lit(alb,N,vP,ao,.45+s*.3);
  c+=alb*vec3(.25,.3,.28)*.25;
  c=fogit(c,vP);
  gl_FragColor=vec4(tone(c),1.);
}`;
export function paperMat() {
  return mat(PAPER_VS, PAPER_FS, { side: THREE.DoubleSide, uniforms: { uSoak: { value: 0 }, uWaterY: { value: 0 } } });
}

// ---------- butterflies: two wings flapping, orange with black veins and white dots ----------
const FLY_VS = `
uniform float uTime;
varying vec2 vUv; varying vec3 vP; varying vec3 vCol;
void main(){
  vec3 p=position;
  float ph=instanceColor.g*20.;
  float flap=sin(uTime*14.+ph)*.9+.2;
  float side=sign(p.x);
  float ang=flap*side;
  p=vec3(p.x*cos(ang),abs(p.x)*sin(flap),p.z);
  vec4 wp=modelMatrix*instanceMatrix*vec4(p,1.);
  vP=wp.xyz; vUv=uv; vCol=instanceColor;
  gl_Position=projectionMatrix*viewMatrix*wp;
}`;
const FLY_FS = `
varying vec2 vUv; varying vec3 vP; varying vec3 vCol;
void main(){
  vec2 q=vec2(abs(vUv.x-.5)*2.,vUv.y);
  float shape=smoothstep(1.02,.95,length((q-vec2(.45,.6))*vec2(1.,1.3)))+smoothstep(.75,.68,length((q-vec2(.4,.18))*vec2(1.2,1.2)));
  if(shape<.5||q.x<.04) discard;
  vec3 c=vCol.r>.5?vec3(.95,.42,.05):vec3(.25,.45,.95);
  float edge=smoothstep(.75,.95,length((q-vec2(.42,.5))*vec2(1.,1.1)));
  float vein=smoothstep(.04,.0,abs(fract(atan(q.y-.3,q.x)*3.)-.5)*.2);
  c=mix(c,vec3(.02),max(edge,vein*.8));
  c=mix(c,vec3(.95),step(.85,edge)*step(.6,hash12(floor(vUv*18.))));
  vec3 col=lit(c,vec3(0.,1.,0.),vP,1.,.6);
  col=fogit(col,vP);
  gl_FragColor=vec4(tone(col),1.);
}`;
export function flyMat() { return mat(FLY_VS, FLY_FS, { side: THREE.DoubleSide }); }

// ---------- light shafts and mist ----------
const SHAFT_VS = `
varying vec2 vUv; varying vec3 vP;
void main(){ vUv=uv; vec4 wp=modelMatrix*instanceMatrix*vec4(position,1.); vP=wp.xyz; gl_Position=projectionMatrix*viewMatrix*wp; }`;
const SHAFT_FS = `
varying vec2 vUv; varying vec3 vP;
void main(){
  float x=abs(vUv.x-.5)*2.;
  float a=smoothstep(1.,.2,x)*smoothstep(0.,.35,vUv.y)*smoothstep(1.,.6,vUv.y);
  a*=.55+.45*vnoise(vec2(vUv.x*6.,vUv.y*2.-uTime*.05));
  float d=length(vP-cameraPosition);
  a*=smoothstep(1.,4.,d)*(1.-smoothstep(30.,45.,d));
  gl_FragColor=vec4(vec3(1.,.92,.75)*a*.10,0.);
}`;
export function shaftMat() { return mat(SHAFT_VS, SHAFT_FS, { side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }); }

// ---------- sky behind the canopy ----------
export function skyMat() {
  return new THREE.ShaderMaterial({
    uniforms: shared,
    side: THREE.BackSide, depthWrite: false,
    vertexShader: `varying vec3 vD; void main(){ vD=position; vec4 p=projectionMatrix*viewMatrix*vec4(position+cameraPosition,1.); gl_Position=p.xyww; }`,
    fragmentShader: `uniform float uTime; ${NOISE}
      varying vec3 vD;
      void main(){ vec3 d=normalize(vD);
        // the canopy: layered leaves overhead, dark green, with small bright gaps of sky
        vec2 cq=d.xz/(abs(d.y)+.2);
        float leaves=fbm(cq*2.2+3.)*.6+vnoise(cq*14.)*.25+vnoise(cq*38.)*.15;
        float gap=smoothstep(.7,.78,leaves)*smoothstep(.1,.5,d.y);
        float canopy=smoothstep(-.02,.14,d.y);
        vec3 haze=vec3(.20,.27,.20);
        vec3 leafC=mix(vec3(.025,.05,.02),vec3(.10,.17,.06),vnoise(cq*20.))*(.6+.6*smoothstep(.3,.6,leaves));
        vec3 c=mix(haze,leafC,canopy);
        c=mix(c,vec3(.9,.95,.85),gap*canopy);
        c=(c*(2.51*c+.03))/(c*(2.43*c+.59)+.14);
        gl_FragColor=vec4(pow(clamp(c,0.,1.),vec3(1./2.2)),1.); }`,
  });
}

// spray droplets in the rapids
export function sprayMat() {
  return new THREE.ShaderMaterial({
    uniforms: shared, transparent: true, depthWrite: false,
    vertexShader: `uniform float uTime; attribute vec4 seed; varying float vA;
      void main(){ float life=fract(uTime*seed.w+seed.z*7.);
        vec3 p=position+vec3((seed.z-.5)*.4*life,sin(life*3.14159)*(.12+.25*seed.w),(seed.w-.3)*.6*life);
        vec4 mv=viewMatrix*vec4(p,1.); gl_Position=projectionMatrix*mv;
        gl_PointSize=clamp(5./-mv.z,1.,6.)*${'(1.0)'}; vA=(1.-life)*.65; }`,
    fragmentShader: `varying float vA; void main(){ vec2 q=gl_PointCoord-.5; float a=smoothstep(.5,.2,length(q))*vA; gl_FragColor=vec4(vec3(.9,.95,.95)*a,a); }`,
    blending: THREE.NormalBlending,
  });
}

// ---------- grown trees: bark with deep furrows, peeling patches, lichen and moss; twigs sway in the wind ----------
const TREE_VS = `
uniform float uTime; uniform vec2 uWind;
attribute float flex; attribute float btype;
varying vec3 vP; varying vec3 vN; varying vec2 vUv; varying vec3 vCol; varying float vType; varying float vFlex;
float h12(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);return mix(mix(h12(i),h12(i+vec2(1,0)),u.x),mix(h12(i+vec2(0,1)),h12(i+vec2(1,1)),u.x),u.y);}
void main(){
  vec4 wp=modelMatrix*instanceMatrix*vec4(position,1.);
  vec3 base=(modelMatrix*instanceMatrix*vec4(0.,0.,0.,1.)).xyz;
  vec2 wd=normalize(uWind);
  float gust=(vn(wp.xz*.15+vec2(uTime*.35,uTime*.2))-.5)*2.+.4*sin(uTime*1.3+base.x*.3);
  wp.xz+=wd*.06*gust*flex*flex;
  vP=wp.xyz; vUv=uv; vType=btype; vFlex=flex;
  vN=normalize(mat3(modelMatrix)*mat3(instanceMatrix)*normal);
  vCol=vec3(1.);
  #ifdef USE_INSTANCING_COLOR
  vCol=instanceColor;
  #endif
  gl_Position=projectionMatrix*viewMatrix*wp;
}`;
const TREE_FS = `
varying vec3 vP; varying vec3 vN; varying vec2 vUv; varying vec3 vCol; varying float vType; varying float vFlex;
float barkH(vec2 b,float kind){
  if(kind<.5){
    // furrowed: long vertical plates split by deep cracks that wander and branch
    float w=fbm(vec2(b.x*2.6,b.y*.38))*2.6+vnoise(vec2(b.x*9.,b.y*1.2))*.5;
    float plate=abs(fract(b.x*3.3+w)-.5)*2.;
    float cross=smoothstep(.72,1.,vnoise(vec2(b.x*3.3+w,b.y*3.1)));
    return smoothstep(.05,.6,plate)*(1.-cross*.55)*(.75+.25*vnoise(b*vec2(8.,3.)))+vnoise(b*vec2(30.,12.))*.14;
  }
  // smooth with flaking patches and horizontal lenticels
  float p=fbm(b*vec2(2.2,1.4));
  float len=smoothstep(.08,0.,abs(fract(b.y*9.+vnoise(b*3.)*.6)-.5)-.4)*step(.55,vnoise(vec2(b.x*7.,b.y*9.)));
  return .7+.25*p-len*.25;
}
void main(){
  vec3 N=normalize(vN);
  float kind=mod(vType,2.);
  bool root=vType>1.5;
  vec2 b=vec2(vUv.x,vUv.y);
  // bump from the bark height field, around and along the stem
  float e=.012;
  float h0=barkH(b,kind), hu=barkH(b+vec2(e,0.),kind), hv=barkH(b+vec2(0.,e),kind);
  vec3 T=normalize(cross(vec3(0.,1.,0.)+N.zxy*.01,N)); vec3 Bt=normalize(cross(N,T));
  float depth=kind<.5?1.6:.35;
  N=normalize(N-T*(hu-h0)/e*depth*.06-Bt*(hv-h0)/e*depth*.025);
  vec3 alb;
  if(kind<.5){
    alb=mix(vec3(.05,.04,.03),vec3(.22,.19,.15),smoothstep(.0,.85,h0));
    alb*=.8+.4*fbm(b*vec2(1.5,.6));
  } else {
    float flake=smoothstep(.55,.6,fbm(b*vec2(1.6,.8)+3.));
    alb=mix(vec3(.24,.23,.19),vec3(.42,.34,.24),flake);
    alb=mix(alb,vec3(.55,.45,.32),flake*smoothstep(.6,.7,vnoise(b*5.))*.6);
    alb*=.75+.35*h0;
  }
  alb*=vCol;
  // lichen: pale grey-green rosettes
  float lich=smoothstep(.68,.74,fbm(b*vec2(3.,2.)+17.))*(1.-vFlex);
  alb=mix(alb,vec3(.42,.46,.36)*(.8+.3*vnoise(b*40.)),lich*.75);
  // moss: on the shaded north side, on the upper faces of limbs and roots, thick near the ground and water
  float L=levelF(vP.z);
  float shade=dot(N,normalize(vec3(-uSun.x,0.,-uSun.z)))*.5+.5;
  float low=1.-smoothstep(.3,2.2,vP.y-L);
  float moss=smoothstep(.62,.9,shade*.55+max(N.y,0.)*.55+low*.4+(fbm(b*vec2(2.,1.5)+5.)-.5)*1.1)*(root?1.:.8);
  vec3 mossC=mix(vec3(.05,.11,.02),vec3(.14,.24,.04),fbm(b*6.))*(.7+.6*vnoise(b*60.));
  alb=mix(alb,mossC,moss*(1.-vFlex*.8));
  // wet and dark where roots run into the water
  float wet=smoothstep(L+.12,L-.02,vP.y);
  alb*=mix(1.,.45,wet);
  float ao=mix(.45,1.,smoothstep(-.2,1.,vP.y-L))*mix(.8,1.,h0);
  vec3 c=lit(alb,N,vP,ao,0.);
  if(vP.y<L){ float dep=L-vP.y; c*=exp(-dep*vec3(2.6,1.4,1.5)); }
  c=fogit(c,vP);
  gl_FragColor=vec4(tone(c),1.);
}`;
export function treeMat() { return mat(TREE_VS, TREE_FS); }

// ---------- distant forest: painted billboards, trunk and crown silhouettes fading into the mist ----------
const FAR_VS = `
varying vec2 vUv; varying vec3 vP; varying float vSeed;
void main(){
  vec3 o=(modelMatrix*instanceMatrix*vec4(0.,0.,0.,1.)).xyz;
  float w=length(instanceMatrix[0].xyz), h=length(instanceMatrix[1].xyz);
  vec3 toC=cameraPosition-o; toC.y=0.; toC=normalize(toC);
  vec3 right=vec3(toC.z,0.,-toC.x);
  vec3 wp=o+right*position.x*w+vec3(0.,1.,0.)*position.y*h;
  vUv=uv; vP=wp; vSeed=fract(o.x*.137+o.z*.0713);
  gl_Position=projectionMatrix*viewMatrix*vec4(wp,1.);
}`;
const FAR_FS = `
varying vec2 vUv; varying vec3 vP; varying float vSeed;
void main(){
  vec2 u=vUv; float x=u.x-.5;
  float tw=.05+.03*vSeed+.06*smoothstep(.15,0.,u.y);
  float trunk=step(abs(x+sin(u.y*3.+vSeed*9.)*.03),tw)*step(u.y,.75);
  float crownMask=smoothstep(.98,.55,length(vec2(x*1.3,(u.y-.72)*1.6)));
  float leaves=fbm(u*vec2(7.,9.)+vSeed*20.);
  float crown=step(.5,crownMask*(.4+leaves*.75+vnoise(u*vec2(40.,40.)+vSeed*9.)*.25))*step(.35,u.y);
  float limbs=step(abs(abs(x)-(u.y-.4)*.6),.012)*step(.4,u.y)*step(u.y,.8);
  float a=max(max(trunk,crown),limbs);
  if(a<.5) discard;
  // dissolve into the mist: dithered, thinning with distance and at the crown's ragged edge
  float dist=length(vP-cameraPosition);
  float keep=(1.-smoothstep(16.,48.,dist))*.85*mix(1.,smoothstep(.5,.62,crownMask*(.4+leaves*.75)),crown*(1.-trunk));
  if(hash12(floor(gl_FragCoord.xy))>keep) discard;
  vec3 col=trunk>.5&&crown<.5?vec3(.035,.03,.025):mix(vec3(.02,.04,.018),vec3(.05,.09,.035),leaves);
  vec3 c=col*ambient(vec3(0.,.5,.8))*1.2;
  c=fogit(c,vP);
  gl_FragColor=vec4(tone(c),1.);
}`;
export function farMat() { return mat(FAR_VS, FAR_FS, { side: THREE.DoubleSide }); }