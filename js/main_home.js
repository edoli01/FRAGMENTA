import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

const REDUCED = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
const COARSE  = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;

const container  = document.getElementById("bg");
const cursorDot  = document.getElementById("cursorDot");
const toggleBtn  = document.getElementById("themeToggle");
const nextBtn    = document.getElementById("nextBtn");
const archiveBtn = document.getElementById("archiveBtn");
const backBtn    = document.getElementById("backBtn");

/* ── Navigazione ── */
let currentPage = 1;
let transitioning = false;

function goTo(page) {
  if (transitioning || currentPage === page) return;
  transitioning = true;
  currentPage = page;
  document.body.dataset.page = page;
  setTimeout(() => { transitioning = false; }, 750);
}

nextBtn.addEventListener("click",    () => goTo(2));
backBtn.addEventListener("click",    () => goTo(1));
archiveBtn.addEventListener("click", () => { window.location.href = "network.html"; });

let touchStartY = 0;
window.addEventListener("wheel", (e) => {
  if (e.deltaY > 30)  goTo(2);
  if (e.deltaY < -30) goTo(1);
}, { passive: true });
window.addEventListener("touchstart", (e) => { touchStartY = e.touches[0].clientY; }, { passive: true });
window.addEventListener("touchend",   (e) => {
  const dy = touchStartY - e.changedTouches[0].clientY;
  if (dy >  40) goTo(2);
  if (dy < -40) goTo(1);
}, { passive: true });

/* ── Temi ── */
const themes = {
  day:   { bg: new THREE.Color(0xF7F7F7), crack: new THREE.Color(0xC3C3C3) },
  night: { bg: new THREE.Color(0x1A1A1A), crack: new THREE.Color(0x949494) }
};
let isDark = true;
const currentBg    = themes.night.bg.clone();
const currentCrack = themes.night.crack.clone();

/* ── Renderer ── */
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setSize(innerWidth, innerHeight, false);
container.appendChild(renderer.domElement);

const camera  = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const quadGeo = new THREE.PlaneGeometry(2, 2);

/* ── Trail shader ── */
const trailVS = `
varying vec2 vUv;
void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }`;

const trailFS = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uPrev;
uniform vec2  uMouse, uPx;
uniform float uVel, uFade, uRadius;
float blob(vec2 p, vec2 c, float r){
  return smoothstep(r*(1.+0.6*clamp(uVel,0.,1.)), 0., distance(p,c));
}
float max9(sampler2D t, vec2 uv, vec2 px){
  float m=texture2D(t,uv).r;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++)
    m=max(m, texture2D(t, uv+vec2(float(i),float(j))*px).r);
  return m;
}
void main(){
  float base=max9(uPrev,vUv,uPx)*uFade;
  float add=blob(vUv,uMouse,uRadius)*(0.15+0.85*clamp(uVel,0.,1.));
  gl_FragColor=vec4(clamp(base+add,0.,1.),0.,0.,1.);
}`;

/* ── Main shader ── */
const mainVS = `
varying vec2 vUv;
void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }`;

const mainFS = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTrail;
uniform vec2  uResolution, uMouse;
uniform float uTime;
uniform vec3  uBgColor, uCrackColor;
uniform float uCrackDensity, uThicknessMin, uThicknessMax, uBevel, uGrainScale;
uniform float uImagesActive;

uniform sampler2D uTex0, uTex1, uTex2, uTex3, uTex4, uTex5;
uniform int   uNumSlots;
uniform float uCellId[6];
uniform float uSlotActive[6];

float hash(vec2 p){
  p=fract(p*vec2(123.34,345.45)); p+=dot(p,p+34.345);
  return fract(p.x*p.y);
}
float noise(vec2 p){
  vec2 i=floor(p), f=fract(p);
  float a=hash(i), b=hash(i+vec2(1,0)), c=hash(i+vec2(0,1)), d=hash(i+vec2(1,1));
  vec2 u=f*f*(3.-2.*f);
  return mix(a,b,u.x)+(c-a)*u.y*(1.-u.x)+(d-b)*u.x*u.y;
}
float fbm(vec2 p){
  float v=0., a=0.5;
  for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.02; a*=0.5; }
  return v;
}
struct VoronoiResult { float d1, d2, id; vec2 site; };
VoronoiResult voronoi(vec2 x){
  vec2 n=floor(x), f=fract(x);
  float md=1e9, sd=1e9, sid=0.; vec2 spos=vec2(0.);
  for(int j=-2;j<=2;j++) for(int i=-2;i<=2;i++){
    vec2 g=vec2(float(i),float(j));
    vec2 o=vec2(hash(n+g), hash(n+g+13.37));
    vec2 r=g+o-f; float d=dot(r,r);
    float id=(n.x+float(i)+50.)*100.+(n.y+float(j)+50.);
    if(d<md){ sd=md; md=d; sid=id; spos=n+g+o; } else if(d<sd){ sd=d; }
  }
  VoronoiResult res;
  res.d1=sqrt(md); res.d2=sqrt(sd); res.id=sid; res.site=spos;
  return res;
}
float tnoise(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453)-0.5; }
vec4 sampleTex(int s, vec2 uv){
  vec4 c=texture2D(uTex0,uv);
  if(s==1)      c=texture2D(uTex1,uv);
  else if(s==2) c=texture2D(uTex2,uv);
  else if(s==3) c=texture2D(uTex3,uv);
  else if(s==4) c=texture2D(uTex4,uv);
  else if(s==5) c=texture2D(uTex5,uv);
  return c;
}
void main(){
  vec2 uv=vUv;
  float aspect=uResolution.x/uResolution.y;
  vec2 p=(uv-0.5)*vec2(aspect,1.);
  float t0=texture2D(uTrail,uv).r;
  float reveal=smoothstep(0.14,0.62,t0);
  vec2 parallax=(uMouse-0.5)*0.006;
  vec2 warp=vec2(fbm(p*2.4+uTime*0.03),fbm(p*2.4-uTime*0.03))-0.5;
  vec2 pp=p+warp*0.10+parallax;
  VoronoiResult v=voronoi(pp*uCrackDensity);
  float edge=v.d2-v.d1;
  float w=fwidth(edge);
  float targetThickness=max(mix(uThicknessMin,uThicknessMax,reveal),w*1.1);
  float sharpness=mix(w*0.8,w*1.5,reveal);
  float ridge=1.-smoothstep(targetThickness-sharpness,targetThickness+sharpness,edge);
  ridge*=(0.7+0.4*fbm(pp*1.5));
  float ink=smoothstep(0.35,0.90,ridge);
  float dynamicBevel=mix(0.,uBevel,reveal);
  vec2 grad=vec2(dFdx(edge),dFdy(edge));
  vec3 N=normalize(vec3(-grad*dynamicBevel,1.8));
  vec3 L=normalize(vec3(0.6,0.8,1.0));
  float lit=clamp(dot(N,L)*0.5+0.5,0.,1.);
  float gnAmp=(0.006+0.012*reveal)*uGrainScale;
  float gn=tnoise(uv*uResolution+uTime*60.)*gnAmp;
  vec3 base=uBgColor+vec3(gn);
  vec3 crack=mix(uBgColor,uCrackColor*mix(0.90,1.10,lit),clamp(ink,0.,1.));
  vec3 color=mix(base,crack,clamp(ink*1.1,0.,1.));
  if(uImagesActive > 0.001){
    for(int s=0;s<6;s++){
      if(s>=uNumSlots) break;
      if(uSlotActive[s]<0.5) continue;
      if(abs(v.id-uCellId[s])<0.5){
        vec2 sitePP=v.site/uCrackDensity;
        vec2 off=pp-sitePP;
        off.x/=aspect;
        float cellRadius=0.6/uCrackDensity;
        vec2 imgUv=off/(cellRadius*2.0)+0.5;
        imgUv=clamp(imgUv,0.,1.);
        vec4 imgSample=sampleTex(s,imgUv);
        float crackMask=1.-clamp(ink*2.0,0.,1.);
        vec3 imgColor=imgSample.rgb*mix(0.75,1.0,crackMask);
        color=mix(color,imgColor,uImagesActive);
        break;
      }
    }
  }
  gl_FragColor=vec4(color,1.);
}`;

/* ── Sorgenti immagini (ordine fisso, posizioni calcolate al resize) ── */
const IMAGE_SRCS = [
  "img_site/ico_000305.jpg",
  "img_site/ico_000606.jpg",
  "img_site/ico_000611.jpg",
  "img_site/ico_000613.jpg",
  "img_site/ico_000614.jpg",
  "img_site/ico_002264.jpg",
];
const N_SLOTS = 6;

/*
 * Posizioni target in coordinate UV normalizzate (0=sinistra/alto, 1=destra/basso).
 * Evitano la zona centrale dove sta il testo (~0.28..0.72 x, ~0.20..0.80 y).
 * Al resize vengono convertite in (gi, gj) di griglia Voronoi in base
 * all'aspect ratio e alla densità correnti, così le immagini restano
 * sempre negli angoli/bordi indipendentemente dalla finestra.
 */
const IMAGE_UV_POSITIONS = [
  { uvX: 0.1, uvY: 0.2 },   // alto sinistra
  { uvX: 0.45, uvY: 0.2 },   // alto centro-destra
  { uvX: 0.7, uvY: 0.4 },   // alto destra
  { uvX: 0.2, uvY: 0.6 },   // basso sinistra
  { uvX: 0.9, uvY: 0.72 },   // basso destra
  { uvX: 0.6, uvY: 0.80 },   // basso centro
];

function makePlaceholderTex(rgba = [1,1,1,1]) {
  const d = new Uint8Array(rgba.map(v => Math.round(v * 255)));
  const t = new THREE.DataTexture(d, 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
}
const slotTextures = Array.from({ length: N_SLOTS }, () => makePlaceholderTex());
const slotActive   = new Float32Array(N_SLOTS);
const cellIds      = new Float32Array(N_SLOTS);

/* ── Scenes ── */
const trailScene = new THREE.Scene();
const mainScene  = new THREE.Scene();

const trailUniforms = {
  uPrev:   { value: null },
  uMouse:  { value: new THREE.Vector2(0.5, 0.5) },
  uVel:    { value: 0.0 },
  uFade:   { value: 0.93 },
  uRadius: { value: 0.060 },
  uPx:     { value: new THREE.Vector2(1, 1) }
};
const mainUniforms = {
  uTrail:        { value: null },
  uResolution:   { value: new THREE.Vector2(1, 1) },
  uMouse:        { value: new THREE.Vector2(0.5, 0.5) },
  uTime:         { value: 0.0 },
  uBgColor:      { value: currentBg },
  uCrackColor:   { value: currentCrack },
  uCrackDensity: { value: 5.2 },
  uThicknessMin: { value: 0.015 },
  uThicknessMax: { value: 0.055 },
  uBevel:        { value: 3.5 },
  uGrainScale:   { value: 0.5 },
  uImagesActive: { value: 0.0 },
  uNumSlots:     { value: N_SLOTS },
  uTex0: { value: slotTextures[0] }, uTex1: { value: slotTextures[1] },
  uTex2: { value: slotTextures[2] }, uTex3: { value: slotTextures[3] },
  uTex4: { value: slotTextures[4] }, uTex5: { value: slotTextures[5] },
  uCellId:     { value: cellIds },
  uSlotActive: { value: slotActive },
};

trailScene.add(new THREE.Mesh(quadGeo, new THREE.ShaderMaterial({
  uniforms: trailUniforms, vertexShader: trailVS, fragmentShader: trailFS
})));
mainScene.add(new THREE.Mesh(quadGeo, new THREE.ShaderMaterial({
  uniforms: mainUniforms, vertexShader: mainVS, fragmentShader: mainFS,
  extensions: { derivatives: true }
})));

/* ── Caricamento immagini ── */
const loader = new THREE.TextureLoader();
const texNames = ['uTex0','uTex1','uTex2','uTex3','uTex4','uTex5'];
const fallbackColors = [
  [0.78,0.72,0.60,1],[0.54,0.65,0.74,1],[0.63,0.70,0.56,1],
  [0.74,0.58,0.52,1],[0.58,0.54,0.72,1],[0.70,0.68,0.60,1]
];
// Su mobile (touch) non carichiamo le immagini — solo voronoi
if (!COARSE) {
  IMAGE_SRCS.forEach((src, i) => {
    if (i >= N_SLOTS || !src) return;
    loader.load(src, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      mainUniforms[texNames[i]].value = tex;
      slotActive[i] = 1.0;
      mainUniforms.uSlotActive.value = new Float32Array(slotActive);
    }, undefined, () => {
      mainUniforms[texNames[i]].value = makePlaceholderTex(fallbackColors[i]);
      slotActive[i] = 1.0;
      mainUniforms.uSlotActive.value = new Float32Array(slotActive);
    });
  });
}

/* ── Resize + celle responsive ── */
let rtA, rtB, trailW, trailH;
const rtParams = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat };

function updateCellIds() {
  /*
   * Il Voronoi usa: pp = (uv - 0.5) * vec2(aspect, 1) poi campiona voronoi(pp * density).
   * Il cellId è: (floor(pp*density).x + 50) * 100 + (floor(pp*density).y + 50)
   *
   * Da una posizione UV schermo (uvX, uvY con 0=alto):
   *   gi = floor( (uvX - 0.5) * aspect * density )
   *   gj = floor( (0.5 - uvY) * density )    ← Y invertita: top=positivo
   *
   * La densità si adatta all'aspect ratio per mantenere celle di dimensione
   * visivamente costante su qualsiasi risoluzione:
   *   aspect 1.33 (4:3)  → ~4.3
   *   aspect 1.78 (16:9) → ~5.2
   *   aspect 2.33 (21:9) → ~5.2 (capped)
   */
  const aspect  = innerWidth / innerHeight;
  const density = Math.min(5.2, Math.max(3.5, 3.0 + aspect * 1.2));
  mainUniforms.uCrackDensity.value = density;

  for (let i = 0; i < N_SLOTS; i++) {
    const { uvX, uvY } = IMAGE_UV_POSITIONS[i];
    const gi = Math.floor((uvX - 0.5) * aspect * density);
    const gj = Math.floor((0.5 - uvY) * density);
    cellIds[i] = (gi + 50) * 100 + (gj + 50);
  }
  mainUniforms.uCellId.value = new Float32Array(cellIds);
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  const dpr = Math.min(renderer.getPixelRatio(), 2.0);
  mainUniforms.uResolution.value.set(w * dpr, h * dpr);
  trailW = Math.floor(w * dpr * 0.5);
  trailH = Math.floor(h * dpr * 0.5);
  rtA?.dispose(); rtB?.dispose();
  rtA = new THREE.WebGLRenderTarget(trailW, trailH, rtParams);
  rtB = new THREE.WebGLRenderTarget(trailW, trailH, rtParams);
  trailUniforms.uPx.value.set(1 / trailW, 1 / trailH);
  updateCellIds();
}
addEventListener("resize", resize);
resize();

/* ── Input ── */
let mx = 0.5, my = 0.5, lx = 0.5, ly = 0.5;
addEventListener("pointermove", (e) => {
  mx = e.clientX / innerWidth;
  my = 1.0 - e.clientY / innerHeight;
  if (!COARSE) cursorDot.style.transform = `translate(calc(${e.clientX}px - 50%), calc(${e.clientY}px - 50%))`;
});

document.querySelectorAll("button, a, [role='button']").forEach(el => {
  el.addEventListener("pointerenter", () => cursorDot.classList.add("hover"));
  el.addEventListener("pointerleave", () => cursorDot.classList.remove("hover"));
});

toggleBtn.addEventListener("click", () => {
  isDark = !isDark;
  document.body.classList.toggle("light-mode", !isDark);
});

/* ── Loop ── */
const t0 = performance.now();
function loop(now) {
  const time = (now - t0) * 0.001;
  mainUniforms.uTime.value = time;
  mainUniforms.uMouse.value.set(mx, my);
  trailUniforms.uMouse.value.set(mx, my);
  const dx = mx - lx, dy = my - ly; lx = mx; ly = my;
  trailUniforms.uVel.value = REDUCED ? 0.0 : Math.min(1.0, Math.hypot(dx, dy) * 22.0);
  currentBg.lerp(isDark ? themes.night.bg : themes.day.bg, 0.05);
  currentCrack.lerp(isDark ? themes.night.crack : themes.day.crack, 0.05);
  const imgTarget = currentPage === 2 ? 1.0 : 0.0;
  mainUniforms.uImagesActive.value += (imgTarget - mainUniforms.uImagesActive.value) * 0.04;
  trailUniforms.uPrev.value = rtA.texture;
  renderer.setRenderTarget(rtB);
  renderer.render(trailScene, camera);
  renderer.setRenderTarget(null);
  mainUniforms.uTrail.value = rtB.texture;
  renderer.render(mainScene, camera);
  [rtA, rtB] = [rtB, rtA];
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
