// GLSL for the courtyard: shared noise/sky/brick code, objects, sky, water, ripple simulation and rain.
// Everything is lit by a soft overcast monsoon sky: no hard sun, lots of grey sky reflected in wet surfaces.

export const HALF = 1.4;      // half width of the flooded courtyard (aangan)
export const FIN = 16.0;      // finish thread
export const END = 17.6;      // far wall with the drain

const COMMON = `
precision highp float;
uniform float uTime;
uniform vec3 uCam;
uniform vec3 uFog;
uniform float uExposure;
const float HALF = ${HALF.toFixed(3)};
const float FIN = ${FIN.toFixed(3)};
const float END = ${END.toFixed(3)};
float hash12(vec2 p){vec3 p3=fract(vec3(p.xyx)*.1031);p3+=dot(p3,p3.yzx+33.33);return fract((p3.x+p3.y)*p3.z);}
vec2 hash22(vec2 p){vec3 p3=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973));p3+=dot(p3,p3.yzx+33.33);return fract((p3.xx+p3.yz)*p3.zy);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash12(i),hash12(i+vec2(1,0)),u.x),mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),u.x),u.y);}
float fbm(vec2 p){float s=0.,a=.5;for(int i=0;i<4;i++){s+=a*vnoise(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return s;}
float fbm2(vec2 p){return .66*vnoise(p)+.34*vnoise(p*2.1+5.3);}

vec3 sky(vec3 d){
  float y=max(d.y,0.);
  vec2 uv=d.xz/(y+.12)*.55+vec2(uTime*.012,uTime*.02);
  float c=fbm(uv*1.1);
  float c2=fbm2(uv*3.3+7.);
  vec3 hi=vec3(.62,.66,.69), lo=vec3(.40,.43,.45);
  vec3 col=mix(lo,hi,smoothstep(0.,.55,y));
  col=mix(col,vec3(.22,.245,.26),smoothstep(.42,.78,c)*.8);
  col*=.92+.16*c2;
  col=mix(col,vec3(.46,.49,.50),exp(-y*7.)*.7);
  return col;
}
// cheaper sky for reflections in the water: the ripples blur it anyway
vec3 skyR(vec3 d){
  float y=max(d.y,0.);
  vec2 uv=d.xz/(y+.12)*.55+vec2(uTime*.012,uTime*.02);
  float c=fbm2(uv*1.1);
  vec3 col=mix(vec3(.40,.43,.45),vec3(.62,.66,.69),smoothstep(0.,.55,y));
  col=mix(col,vec3(.22,.245,.26),smoothstep(.45,.8,c)*.8);
  return mix(col,vec3(.46,.49,.50),exp(-y*7.)*.7);
}
vec3 fogit(vec3 c,float dist){float f=1.-exp(-dist*.021);return mix(c,uFog,f);}
vec3 tonemap(vec3 c){c*=uExposure;c=(c*(2.51*c+.03))/(c*(2.43*c+.59)+.14);c=pow(clamp(c,0.,1.),vec3(1./2.2));float l=dot(c,vec3(.299,.587,.114));c=mix(vec3(l),c,1.12);c=(c-.5)*1.1+.5;return clamp(c,0.,1.);}

// Flat-laid courtyard bricks (23 x 11 cm) in stretcher bond.
vec3 brick(vec2 p,out float mortar){
  vec2 s=vec2(.23,.115);
  vec2 q=p/s; float row=floor(q.y); q.x+=mod(row,2.)*.5;
  vec2 cell=floor(q), f=fract(q);
  vec2 m=min(f,1.-f)*s; float e=min(m.x,m.y);
  mortar=1.-smoothstep(.003,.008,e);
  float h=hash12(cell+row*7.13);
  vec3 c=mix(vec3(.24,.075,.035),vec3(.36,.14,.07),h);
  c=mix(c,vec3(.17,.10,.06),hash12(cell*1.7+2.)*.5);
  c*=.8+.4*vnoise(p*38.);
  c=mix(c,vec3(.13,.12,.10),mortar);
  return c;
}

// Rain drop rings, procedural: one drop per cell per cycle, each a few concentric rings that expand and fade.
vec2 rainGrad(vec2 q,float t){
  vec2 g=vec2(0.);
  vec2 o=floor(q-.5);
  for(int j=0;j<2;j++)for(int i=0;i<2;i++){
    vec2 c=o+vec2(float(i),float(j));
    float ph0=hash12(c+3.7);
    float tt=t+ph0;
    float n=floor(tt);
    float ph=tt-n;
    vec2 h=hash22(c+n*13.17);
    vec2 ctr=c+.25+.5*h;
    vec2 d=q-ctr; float r=length(d);
    float R=ph*.55;
    float x=r-R;
    float env=(1.-ph); env*=env*(.35+.65*h.x);
    float w=cos(x*62.)*exp(-x*x*420.)*env*smoothstep(0.,.04,r);
    g+=d/max(r,1e-3)*w;
  }
  return g;
}
`;

// ---------- objects ----------
export const WORLD_VS = `#version 300 es
layout(location=0) in vec3 aP; layout(location=1) in vec3 aN; layout(location=2) in vec2 aUv; layout(location=3) in vec3 aB;
uniform mat4 uVP, uModel;
out vec3 vP; out vec3 vN; out vec3 vL; out vec3 vNL; out vec2 vUv; out vec3 vB;
void main(){ vec4 w=uModel*vec4(aP,1.); vP=w.xyz; vN=normalize(mat3(uModel)*aN); vNL=aN; vL=aP; vUv=aUv; vB=aB; gl_Position=uVP*w; }`;

export const WORLD_FS = `#version 300 es
${COMMON}
uniform int uMat;
uniform int uPart;
uniform vec3 uTint;
uniform float uClip;
uniform float uFlip;
uniform float uTwoSided;
uniform float uSoak;
uniform float uMirror;
in vec3 vP; in vec3 vN; in vec3 vL; in vec3 vNL; in vec2 vUv; in vec3 vB;
out vec4 o;

vec3 plaster(vec3 P,vec3 N,out float wet){
  vec2 w=abs(N.x)>abs(N.z)?P.zy:P.xy;
  if(abs(N.y)>.7) w=P.xz;
  vec3 c=vec3(.64,.60,.51);
  float f=fbm(w*vec2(1.2,.8));
  c*=.82+.3*f;
  // rain streak stains running down from the roof line
  float st=fbm(vec2(w.x*11.,w.y*.35+3.));
  c*=1.-smoothstep(.55,.8,st)*.22*smoothstep(1.2,2.6,P.y);
  // rising damp with a brown tide line
  float hd=.55+.35*fbm(w*1.7+9.);
  float damp=smoothstep(hd,hd-.18,P.y);
  float tide=exp(-pow((P.y-hd+.03)/.03,2.))*.35;
  // ochre-red dado band, the lower wall of an old Indian house
  if(uPart==0 && P.y<.92 && P.y>.1){ c=mix(c,vec3(.26,.11,.05)*(.6+.6*fbm(w*vec2(4.,3.))),.85); }
  c=mix(c,c*vec3(.42,.46,.40),damp*.85);
  c*=1.-tide;
  wet=.08+damp*.35;
  // painted wooden doors on the side walls
  if(abs(N.x)>.7 && abs(P.x)>3.){
    float u=mod(P.z+1.,7.2)-3.6;
    if(abs(u)<.5 && P.y<2.05 && P.y>.1){
      float pane=step(.035,abs(u))*step(.06,.5-abs(u))*step(P.y,1.99);
      vec3 door=vec3(.025,.085,.10)*(.8+.4*fbm(vec2(u*30.,P.y*2.)));
      float panel=smoothstep(.02,.0,abs(fract(P.y*1.6)-.5)-.46)+smoothstep(.012,.0,abs(u-.0));
      door*=1.-panel*.35;
      c=mix(vec3(.16,.11,.07)*(.8+.4*f),door,pane);
      wet=.15;
    }
  }
  // the drain (mori) opening in the far wall, with an iron grille
  if(N.z<-.7 && P.z>END-.05){
    float inD=step(abs(P.x),.32)*step(P.y,.2);
    if(inD>.5){
      float bars=smoothstep(.006,.002,abs(fract(P.x*14.)-.5)*.0714);
      c=mix(vec3(.004,.004,.003),vec3(.09,.05,.03),bars);
      wet=.4;
    }
  }
  return c;
}

void main(){
  if(uClip>.5 && vP.y<-.0005) discard;
  vec3 N=normalize(vN);
  bool front=gl_FrontFacing; if(uFlip>.5) front=!front;
  if(uTwoSided>.5 && !front) N=-N;
  vec3 V=normalize(uCam-vP);
  float dist=length(uCam-vP);
  vec3 alb=vec3(.5); float wet=.1; float trans=0.; float ao=1.; float spec=0.;

  if(uMat==0){ alb=plaster(vP,N,wet); ao=mix(.55,1.,smoothstep(.1,.6,vP.y)); if(uPart==1) ao*=.9; }
  else if(uMat==1){
    if(N.y>.5){
      // red oxide floor of the verandah with a grey Kota stone edge, rain soaked
      float ax=abs(vP.x);
      float f=fbm(vP.xz*3.);
      alb=vec3(.16,.03,.018)*(.7+.6*f);
      float edge=step(ax,HALF+.16);
      float joint=smoothstep(.004,.0,abs(fract(vP.z/.6)-.5)*.6-.297);
      vec3 kota=vec3(.13,.15,.14)*(.8+.4*fbm(vP.xz*6.));
      alb=mix(alb,kota,edge);
      alb*=1.-joint*.5*edge;
      wet=.5; spec=1.;
      ao=mix(.6,1.,smoothstep(3.2,2.7,ax));
    } else {
      float m; alb=brick(vec2(vP.z,vP.y*2.+.05),m)*.75;
      float moss=smoothstep(.05,-.01,vP.y);
      alb=mix(alb,vec3(.04,.065,.02),moss*.8);
      wet=.45; ao=.85;
    }
  }
  else if(uMat==3){
    // notebook paper: faint blue rules and a red margin; soaks darker and greyer at the waterline
    vec2 uv=vUv;
    float fib=vnoise(uv*900.)*.5+vnoise(uv*2400.)*.5;
    alb=vec3(.62,.61,.565)*(.95+.07*fib);
    float d=abs(fract(uv.y/.0072)-.5)*.0072;
    float rule=1.-smoothstep(.00012,.00045,d);
    alb=mix(alb,vec3(.22,.36,.66),rule*.42);
    float dm=abs(uv.x-.041);
    alb=mix(alb,vec3(.62,.12,.10),(1.-smoothstep(.0002,.0006,dm))*.45);
    float wl=.006+.012*uSoak+(vnoise(vL.xz*95.+vL.y*40.)-.5)*.007;
    vec3 nl=normalize(vNL); if(uTwoSided>.5 && !front) nl=-nl;
    float outside=step(0.,dot(nl.xz,vL.xz))*step(.0035,abs(vL.x));
    float s=smoothstep(wl+.004,wl-.003,vP.y)*outside;
    alb=mix(alb,alb*vec3(.52,.56,.60),s*.85);
    wet=.04+s*.4; trans=.55+s*.3;
    // crease lines along every fold and paper edge (quad diagonals are excluded)
    vec3 bw=fwidth(vB); vec3 e3=smoothstep(vec3(0.),bw*1.6,vB);
    float crease=1.-min(e3.x,min(e3.y,e3.z));
    alb*=1.-crease*.3;
    N=normalize(N+(vec3(vnoise(vL.xz*260.),vnoise(vL.zy*260.+3.),vnoise(vL.xy*260.+7.))-.5)*.05);
    ao=mix(.62+.38*smoothstep(-.012,.045,vL.y),1.,outside);
  }
  else if(uMat==4){
    // leaf: midrib, side veins, darker margin, waxy wet sheen
    vec2 uv=vUv; float s=abs(uv.y);
    vec3 base=uTint*(.8+.4*vnoise(uv*vec2(22.,9.)));
    float mid=smoothstep(.05,.0,s)*smoothstep(1.,.85,uv.x);
    float side=abs(fract(uv.x*7.5-s*2.2)-.5);
    float vein=smoothstep(.07,.0,side)*smoothstep(.95,.15,s)*.6;
    alb=mix(base,base*1.7+vec3(.03,.03,.0),mid*.7+vein*.4);
    alb*=mix(.65,1.,smoothstep(1.,.75,s));
    float spot=smoothstep(.62,.8,fbm(uv*vec2(9.,5.)+uTint.xy*30.));
    alb=mix(alb,vec3(.10,.06,.02),spot*.6);
    if(!front) alb*=1.25;
    wet=.55; trans=.35;
  }
  else if(uMat==5){
    // frog: olive-brown with dark blotches, pale throat, gold eyes with a black pupil
    if(uPart==1){
      vec3 ln=normalize(vL-vec3(sign(vL.x)*.0115,.035,.03));
      float pupil=smoothstep(.55,.75,ln.z)*smoothstep(.5,.2,abs(ln.y));
      alb=mix(vec3(.42,.27,.05),vec3(.005),pupil);
      wet=.9;
    } else {
      float b=fbm(vL.xz*90.+vL.y*40.);
      alb=mix(vec3(.11,.12,.035),vec3(.035,.04,.012),smoothstep(.5,.65,b));
      alb=mix(alb,vec3(.40,.37,.22),smoothstep(-.2,-.7,N.y));
      float stripe=smoothstep(.003,.0,abs(vL.x))*step(-.02,vL.z);
      alb=mix(alb,vec3(.30,.30,.12),stripe*.6);
      wet=.65;
    }
  }
  else if(uMat==6){ alb=vec3(.45,.02,.02)*(.8+.4*vnoise(vUv*40.)); wet=.25; }
  else if(uMat==7){ float m; vec3 w=vP; alb=brick(abs(N.x)>.5?w.zy*vec2(1.,2.):w.xy*vec2(1.,2.),m)*.9; wet=.4; }
  else if(uMat==8){
    // terracotta matka, darker where rain has soaked it
    alb=vec3(.34,.12,.05)*(.8+.4*fbm(vL.xz*20.+vL.y*12.));
    alb*=mix(.6,1.,smoothstep(.0,.25,vL.y));
    wet=.3;
  }

  // overcast lighting: hemisphere sky, soft top light, paper and leaves let light through
  float hemi=.5+.5*N.y;
  vec3 amb=mix(vec3(.10,.095,.085),vec3(.92,.95,.98),hemi);
  vec3 Ld=normalize(vec3(-.25,1.,.55));
  float dif=max(dot(N,Ld),0.)*.3;
  vec3 col=alb*(amb*.78+dif)*ao;
  if(trans>0.) col+=alb*trans*(.18+.25*max(dot(-N,Ld),0.))*vec3(1.,.98,.9);
  if(uMat==3){ vec3 Ls=normalize(vec3(.75,.55,-.35)); col=col*.86+alb*max(dot(N,Ls),0.)*.2; }
  vec3 R=reflect(-V,N);
  float F=.04+.96*pow(1.-max(dot(N,V),0.),5.);
  float rough=1.;
  if(spec>.5){
    // standing water film on the floor: ripple rings from the rain and puddles that mirror the sky
    float pud=smoothstep(.55,.7,fbm(vP.xz*1.6+4.));
    vec2 g=rainGrad(vP.xz/.14,uTime*1.2)*.12*pud/(1.+dist*.3);
    N=normalize(N+vec3(-g.x,0.,-g.y)); R=reflect(-V,N);
    F=mix(F,.02+.98*pow(1.-max(dot(N,V),0.),5.),pud);
    col*=1.-pud*.35;
    wet=mix(.25,.9,pud);
  }
  col=mix(col,sky(R)*.9*ao,clamp(F*wet*(spec>.5?1.:1.6),0.,1.));
  col=fogit(col,dist);
  if(uMirror>.5){ o=vec4(sqrt(clamp(col,0.,1.)),1.); return; }
  o=vec4(tonemap(col),1.);
}`;

// ---------- sky ----------
export const SKY_VS = `#version 300 es
out vec2 vNdc;
void main(){ vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2)); vNdc=p*2.-1.; gl_Position=vec4(p*2.-1.,1.,1.); }`;
export const SKY_FS = `#version 300 es
${COMMON}
uniform mat4 uInvVP;
in vec2 vNdc; out vec4 o;
void main(){
  vec4 w=uInvVP*vec4(vNdc,1.,1.); vec3 d=normalize(w.xyz/w.w-uCam);
  vec3 c=sky(d);
  c=mix(c,uFog,exp(-max(d.y,0.)*12.)*.5);
  o=vec4(tonemap(c),1.);
}`;

// ---------- water ----------
export const WATER_VS = `#version 300 es
layout(location=0) in vec3 aP;
uniform mat4 uVP;
out vec3 vP;
void main(){ vP=aP; gl_Position=uVP*vec4(aP,1.); }`;

export const WATER_FS = `#version 300 es
${COMMON}
uniform sampler2D uRefl;
uniform sampler2D uSim;
uniform vec4 uSimRect;   // x0, z0, size, texel(uv)
uniform float uSimOn;
uniform float uSimGain;
uniform vec2 uRes;
uniform vec4 uSh[12];    // soft shadows on the bed: x, z, radius, strength
uniform vec4 uGust;      // x, z, strength, yaw: wind ruffle from your blowing
uniform vec4 uHull;      // boat x, z, yaw, scale: the inside of the hull stays dry
in vec3 vP; out vec4 o;

float bedDepth(vec2 xz){
  float d=.034+(fbm2(xz*.55+3.)-.5)*.06;
  d-=smoothstep(HALF-.35,HALF,abs(xz.x))*.012;
  return max(d,.004);
}
vec3 bedColor(vec2 xz){
  float m; vec3 b=brick(xz,m)*.6;
  b=mix(b,vec3(.10,.075,.045),m*.7);
  float silt=fbm(xz*2.6);
  b=mix(b,vec3(.11,.08,.048)*(.8+.4*vnoise(xz*9.)),smoothstep(.25,.6,silt)*.92);
  b=mix(b,vec3(.03,.05,.018),smoothstep(.62,.82,fbm2(xz*1.3+7.))*.55);
  // pebbles and grit washed in by the rain
  vec2 c=floor(xz*22.); vec2 f=fract(xz*22.)-.5; vec2 h=hash22(c);
  float peb=step(.94,h.x)*smoothstep(.26*h.y+.08,.05*h.y+.03,length(f-(h-.5)*.4));
  b=mix(b,vec3(.10,.095,.085)*(.6+.8*h.y),peb*.8);
  return b;
}
float bedLight(vec2 p){
  float s=1.;
  for(int i=0;i<12;i++){ vec4 c=uSh[i]; if(c.z<=0.) continue; float d=length(p-c.xy)/c.z; s*=1.-c.w*exp(-d*d*1.6); }
  return s;
}

void main(){
  vec3 P=vP; float t=uTime;
  {
    vec2 d=P.xz-uHull.xy; vec2 fw=vec2(sin(uHull.z),cos(uHull.z));
    float lz=dot(d,fw), lx=dot(d,vec2(fw.y,-fw.x));
    float a=abs(lz)/(.078*uHull.w);
    if(a<1. && abs(lx)<.016*uHull.w*(1.-a*a)) discard;
  }
  vec3 V=normalize(uCam-P); float dist=length(uCam-P);
  float far=1./(1.+dist*.35);
  vec2 g=vec2(0.);
  vec2 pf=P.xz-vec2(0.,t*.05);
  // slow swell from the current and gusts
  g+=.012*vec2(.8,.6)*cos(dot(pf,vec2(.8,.6))*9.+t*1.6);
  g+=.009*vec2(-.5,.85)*cos(dot(pf,vec2(-.5,.85))*14.-t*2.1);
  g+=.006*vec2(.25,-.97)*cos(dot(pf,vec2(.25,-.97))*23.+t*2.9);
  g+=(vec2(vnoise(pf*26.+t*vec2(.2,.9)),vnoise(pf*26.+vec2(19.,4.)-t*vec2(.4,.5)))-.5)*.05*far;
  // raindrop rings at two sizes
  g+=rainGrad(P.xz/.15,t*1.35)*.16*far;
  g+=rainGrad(P.xz/.27+11.,t*.95)*.20*far;
  // ripple simulation around the boat: wake, bow wave, plops
  if(uSimOn>.5){
    vec2 su=(P.xz-uSimRect.xy)/uSimRect.z;
    if(su.x>0.&&su.y>0.&&su.x<1.&&su.y<1.){
      float tx=uSimRect.w;
      float hx=texture(uSim,su+vec2(tx,0.)).r-texture(uSim,su-vec2(tx,0.)).r;
      float hz=texture(uSim,su+vec2(0.,tx)).r-texture(uSim,su-vec2(0.,tx)).r;
      vec2 e=min(su,1.-su); float fade=smoothstep(0.,.12,min(e.x,e.y));
      g+=vec2(hx,hz)*uSimGain*fade;
    }
  }
  // cat's paw: blowing ruffles the water just behind the boat
  if(uGust.z>.001){
    vec2 d=P.xz-uGust.xy; float cs=cos(uGust.w), sn=sin(uGust.w);
    vec2 l=vec2(d.x*cs-d.y*sn,d.x*sn+d.y*cs);
    float m=exp(-pow(l.x/.22,2.)-pow((l.y+.28)/.42,2.))*uGust.z;
    vec2 q=P.xz*70.+vec2(0.,-t*9.);
    g+=(vec2(vnoise(q),vnoise(q+31.))-.5)*.22*m;
  }
  // near the drain the water hurries and swirls
  float drain=smoothstep(END-1.6,END,P.z)*smoothstep(.9,.0,abs(P.x));
  g+=(vec2(vnoise(P.xz*18.-vec2(0.,t*1.5)),vnoise(P.xz*18.+9.-vec2(0.,t*1.5)))-.5)*.12*drain;

  vec3 N=normalize(vec3(-g.x,1.,-g.y));
  float ndv=max(dot(N,V),0.);
  float F=.02+.98*pow(1.-ndv,5.);

  vec3 R=reflect(-V,N); R.y=abs(R.y);
  vec3 rc=skyR(R);
  vec2 ruv=gl_FragCoord.xy/uRes+N.xz*vec2(.5,.9)*.12;
  vec4 rt=texture(uRefl,ruv);
  rc=mix(rc,rt.rgb*rt.rgb,rt.a);

  vec3 T=refract(-V,N,.75);
  float dep=bedDepth(P.xz);
  float L=dep/max(-T.y,.08);
  vec2 bp=P.xz+T.xz*L;
  vec3 bed=bedColor(bp)*bedLight(bp)*vec3(.62,.64,.62);
  bed*=mix(.55,1.,smoothstep(0.,.12,HALF-abs(bp.x)));
  vec3 tr=exp(-L*vec3(24.,29.,38.));
  vec3 inscat=vec3(.075,.068,.05);
  vec3 refr=bed*tr+inscat*(1.-tr);

  vec3 col=mix(refr,rc,F);
  vec2 bq=(P.xz-vec2(0.,t*.06))*38.; vec2 bc=floor(bq); vec2 bh=hash22(bc);
  float bub=step(.985,bh.x)*smoothstep(.09,.03,length(fract(bq)-.5-(bh-.5)*.6))*far;
  col=mix(col,vec3(.6,.62,.62),bub*.35);
  col*=mix(.7,1.,smoothstep(0.,.07,HALF-abs(P.x)));
  col=fogit(col,dist);
  o=vec4(tonemap(col),1.);
}`;

// ---------- ripple simulation (wave equation on a 256x256 window that follows the boat) ----------
export const SIM_VS = `#version 300 es
out vec2 vUv;
void main(){ vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2)); vUv=p; gl_Position=vec4(p*2.-1.,0.,1.); }`;
export const SIM_FS = `#version 300 es
precision highp float;
uniform sampler2D uPrev;
uniform vec2 uShift;
uniform float uTx;
uniform vec4 uRect;
uniform vec4 uDrops[8];
uniform int uDropN;
uniform vec4 uBoat;    // x, z, yaw, depth
uniform float uK, uDamp;
in vec2 vUv; out vec4 o;
const float HALF = ${HALF.toFixed(3)};
const float END = ${END.toFixed(3)};
vec2 S(vec2 uv){ uv+=uShift; if(uv.x<0.||uv.y<0.||uv.x>1.||uv.y>1.) return vec2(0.); return texture(uPrev,uv).rg; }
void main(){
  vec2 c=S(vUv);
  float avg=(S(vUv+vec2(uTx,0.)).r+S(vUv-vec2(uTx,0.)).r+S(vUv+vec2(0.,uTx)).r+S(vUv-vec2(0.,uTx)).r)*.25;
  c.g+=(avg-c.r)*uK; c.g*=uDamp; c.r+=c.g; c.r*=.9995;
  vec2 w=uRect.xy+vUv*uRect.z;
  for(int i=0;i<8;i++){ if(i>=uDropN) break; vec4 d=uDrops[i]; float r=length(w-d.xy)/d.z; if(r<1.) c.r+=d.w*(.5+.5*cos(r*3.14159)); }
  vec2 dd=w-uBoat.xy; vec2 fw=vec2(sin(uBoat.z),cos(uBoat.z)); vec2 rt=vec2(fw.y,-fw.x);
  float lz=dot(dd,fw), lx=dot(dd,rt);
  float e=pow(lx/.048,2.)+pow(lz/.126,2.);
  if(e<1.) c.r=mix(c.r,-uBoat.w*(1.-e),.4);
  if(abs(w.x)>HALF||w.y>END) c=vec2(0.);
  o=vec4(c,0.,1.);
}`;

// ---------- rain streaks ----------
export const RAIN_VS = `#version 300 es
uniform mat4 uVP; uniform vec3 uCam; uniform vec3 uFwd; uniform float uTime; uniform vec2 uRes; uniform float uPx;
out float vA; out float vS;
float h1(float n){return fract(sin(n*91.345)*47453.5453);}
void main(){
  float id=float(gl_InstanceID);
  vec3 box=vec3(5.,3.2,8.);
  vec3 org=uCam+uFwd*3.6-box*.5; org.y=-.02;
  float sp=6.+h1(id*1.7)*2.5;
  vec3 seed=vec3(h1(id),h1(id+31.7),h1(id+71.3))*box*7.+vec3(uTime*.4,-uTime*sp,0.);
  vec3 p=org+mod(seed-org,box);
  vec3 q=p+vec3(.4,-sp,0.)*.02;
  vec4 a=uVP*vec4(p,1.), b=uVP*vec4(q,1.);
  int v=gl_VertexID;
  float side=(v==0||v==2||v==3)?-1.:1.;
  float end=(v==2||v==3||v==5)?1.:0.;
  vec2 sa=a.xy/a.w, sb=b.xy/b.w;
  vec2 dir=normalize((sb-sa)*uRes+vec2(1e-5));
  vec2 nrm=vec2(-dir.y,dir.x)/uRes*2.*uPx;
  vec4 c=end<.5?a:b;
  c.xy+=nrm*side*c.w;
  gl_Position=c;
  float d=length(p-uCam);
  vA=.24*smoothstep(.3,.9,d)*(1.-smoothstep(4.5,8.5,d))*step(0.,min(a.w,b.w))*step(0.,q.y)*(.5+.5*h1(id+5.));
  vS=side;
}`;
export const RAIN_FS = `#version 300 es
precision mediump float;
in float vA; in float vS; out vec4 o;
void main(){ float a=vA*(1.-vS*vS*.6); o=vec4(vec3(.86,.89,.92)*a,a); }`;
