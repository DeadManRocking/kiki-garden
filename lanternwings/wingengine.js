/* wingengine.js - Lanternwings wing engine (reusable for Flutterby Papillarium).
   Genome, inheritance, slips, mutations, reaction-diffusion growth (WebGL with
   plain-JS fallback), regime classification, wing rendering. No game logic. */
(function (root) {
'use strict';

/* ---------- randomness ---------- */
function hash(s) { s = String(s); let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let a = (typeof seed === 'number' ? seed : hash(seed)) >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function weighted(r, w) { let s = 0; for (const x of w) s += x; let x = r() * s; for (let i = 0; i < w.length; i++) { x -= w[i]; if (x < 0) return i; } return w.length - 1; }
function interp(x, xs, ys) { if (x <= xs[0]) return ys[0]; for (let k = 1; k < xs.length; k++) if (x <= xs[k]) { const t = (x - xs[k - 1]) / (xs[k] - xs[k - 1]); return ys[k - 1] + t * (ys[k] - ys[k - 1]); } return ys[ys.length - 1]; }
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

/* ---------- species profile: moth ---------- */
const VMAX = 1.32; /* sim square covers wing u 0..1, v 0..VMAX (room for tails) */
const MOTH = {
  feed: { min: 0.014, max: 0.058, steps: 20 },
  warp: { f: [.0120, .0169, .0218, .0267, .0316, .0365, .0415, .0464, .0513, .0562, .0611],
          c: [.0450, .0495, .0541, .0579, .0623, .0639, .0631, .0622, .0612, .0592, .0557],
          w: [.0080, .0136, .0130, .0108, .0141, .0130, .0093, .0054, .0040, .0040, .0040] },
  scales: [['Dust', 192], ['Fine', 160], ['Medium', 128], ['Bold', 96], ['Great', 72]],
  scaleWild: [1, 3, 6, 6, 1],
  seeds: ['Dot', 'Bar', 'Ring', 'Scatter', 'Vein'],
  tips: ['Falcate', 'Pointed', 'Rounded'],
  tails: ['None', 'Nub', 'Short', 'Swallow', 'Ribbon'],
  grains: ['Still', 'Faint', 'Drawn', 'Swept', 'Combed'],
  grounds: [['Bone', [232, 223, 200]], ['Ash', [169, 164, 155]], ['Rust', [138, 74, 43]], ['Moss', [93, 106, 60]], ['Dusk', [58, 51, 70]]],
  inks: [['Soot', [26, 23, 20]], ['Oxblood', [90, 20, 20]], ['Verdigris', [63, 143, 127]], ['Ochre', [192, 138, 46]], ['Indigo', [36, 58, 110]], ['Pearl', [236, 232, 222]]],
  mutations: ['script', 'watcher', 'glasswing', 'singed', 'pale'],
  scriptWords: ['LUX', 'NOX', 'MANE', 'VIGIL', 'KIKI', 'KHIARA'],
  slip: 0.03, mutate: 0.05,
  fore: {
    Falcate: [[.02, .30], [.28, .10, .70, -.02, 1.0, .03], [.93, .09, .90, .14, .95, .22], [.97, .33, .86, .44, .70, .52], [.45, .56, .18, .50, .02, .46]],
    Pointed: [[.02, .30], [.28, .12, .68, .02, .99, .06], [1.0, .16, .90, .38, .70, .52], [.45, .56, .18, .50, .02, .46]],
    Rounded: [[.02, .30], [.28, .12, .64, .05, .88, .11], [1.0, .20, .92, .40, .70, .53], [.45, .56, .18, .50, .02, .46]] },
  hind: [[.02, .46], [.30, .44, .52, .47, .62, .55], [.72, .67, .57, .83, .40, .83], [.20, .83, .06, .71, .02, .58]],
  tailLen: [0, .035, .07, .12, .2],
  veins: [[[.03, .37], [.50, .20], [.96, .08]], [[.03, .37], [.50, .27], [.95, .20]], [[.03, .38], [.55, .36], [.88, .36]], [[.03, .40], [.45, .45], [.74, .50]],
          [[.03, .50], [.35, .50], [.60, .56]], [[.03, .52], [.35, .60], [.58, .72]], [[.03, .54], [.28, .70], [.42, .82]], [[.03, .56], [.14, .70], [.22, .80]]],
  base: [.02, .40]
};
/* gene table: type avg = copies averaged, add = copies summed, dom = lowest index wins,
   codom = both expressed, rec = shows only with two copies of allele 1 */
const GENES = { feed: { n: 20, t: 'avg' }, kill: { n: 20, t: 'avg' }, scale: { n: 5, t: 'avg' }, grain: { n: 3, t: 'add' },
  seed: { n: 5, t: 'codom' }, tip: { n: 3, t: 'dom' }, tail: { n: 3, t: 'add' }, ground: { n: 5, t: 'dom' },
  ink: { n: 6, t: 'codom' }, lumen: { n: 2, t: 'rec' }, eyes: { n: 3, t: 'add' }, sym: { n: 2, t: 'rec' } };

const P = MOTH;
function feedAt(fi) { return P.feed.min + fi * (P.feed.max - P.feed.min) / (P.feed.steps - 1); }
function killAt(fi, ki) { const f = feedAt(fi), c = interp(f, P.warp.f, P.warp.c), w = interp(f, P.warp.f, P.warp.w); return c - w + ki * 2 * w / 19; }
function stopFor(F) { const lo = 0.0215, a = 0.0235, b = 0.0285, hi = 0.031; if (F <= lo || F >= hi) return 2000; if (F >= a && F <= b) return 6000; return Math.round(F < a ? 2000 + 4000 * (F - lo) / (a - lo) : 6000 - 4000 * (F - b) / (hi - b)); }
function letters() { return P.scriptWords.join('').split(''); }

/* ---------- genomes ---------- */
function slipCopy(spec, v, r) {
  if (r() >= P.slip) return v;
  if (spec.t === 'avg' || spec.t === 'add') return clamp(v + (r() < .5 ? -1 : 1), 0, spec.n - 1);
  const w = Math.floor(r() * (spec.n - 1)); return w >= v ? w + 1 : w;
}
function breed(a, b, seed) {
  const r = rng(seed), g = {};
  for (const k in GENES) g[k] = [slipCopy(GENES[k], a[k][r() < .5 ? 0 : 1], r), slipCopy(GENES[k], b[k][r() < .5 ? 0 : 1], r)];
  g.mut = null;
  if (r() < P.mutate) { g.mut = P.mutations[Math.floor(r() * P.mutations.length)]; if (g.mut === 'script') { const L = letters(); g.letter = L[Math.floor(r() * L.length)]; } }
  g.sid = Math.floor(r() * 4294967295);
  return g;
}
/* wild moth from the drifting wild pool; day = whole days since epoch */
function wildGenome(r, day) {
  const d = day || 0, drift = (k) => Math.sin(d / 11 + k * 1.7) * .5 + .5, g = {};
  const fc = 5 + drift(1) * 9; g.feed = [0, 1].map(() => clamp(Math.round(fc + (r() - .5) * 10), 0, 19));
  /* 7 in 10 look Pall or Plain, but each hides one copy from the pattern zone */
  const kind = r(), pz = () => 5 + Math.floor(r() * 10);
  if (kind < .35) g.kill = [Math.floor(r() * 2), 7 + Math.floor(r() * 3)];
  else if (kind < .70) g.kill = [18 + Math.floor(r() * 2), 10 + Math.floor(r() * 3)];
  else g.kill = [pz(), pz()];
  if (r() < .5) g.kill.reverse();
  g.scale = [weighted(r, P.scaleWild), weighted(r, P.scaleWild)];
  g.grain = [weighted(r, [6, 3, 1]), weighted(r, [6, 3, 1])];
  g.seed = [Math.floor(r() * 5), Math.floor(r() * 5)];
  g.tip = [weighted(r, [2, 3, 3]), weighted(r, [2, 3, 3])];
  g.tail = [weighted(r, [7, 2, 1]), weighted(r, [7, 2, 1])];
  const gw = P.grounds.map((_, i) => 1 + .8 * Math.sin(d / 13 + i)), iw = P.inks.map((_, i) => 1 + .8 * Math.sin(d / 17 + i * 2));
  g.ground = [weighted(r, gw), weighted(r, gw)];
  g.ink = [weighted(r, iw), weighted(r, iw)];
  g.lumen = r() < 1 / 8 ? [1, 0] : [0, 0];
  g.eyes = [weighted(r, [6, 3, 1]), weighted(r, [6, 3, 1])];
  g.sym = r() < .1 ? [0, 1] : [0, 0];
  g.mut = null; g.sid = Math.floor(r() * 4294967295);
  return g;
}
function phenotype(g) {
  const fi = (g.feed[0] + g.feed[1]) / 2, ki = (g.kill[0] + g.kill[1]) / 2, F = feedAt(fi), K = killAt(fi, ki);
  const si = Math.round((g.scale[0] + g.scale[1]) / 2), gi = Math.min(g.ground[0], g.ground[1]);
  return { fi, ki, F, K, scale: si, scaleName: P.scales[si][0], n: P.scales[si][1],
    grain: g.grain[0] + g.grain[1], seeds: Array.from(new Set(g.seed)).map(i => P.seeds[i]),
    tip: P.tips[Math.min(g.tip[0], g.tip[1])], tail: g.tail[0] + g.tail[1],
    ground: P.grounds[gi][1], groundName: P.grounds[gi][0],
    ink0: P.inks[g.ink[0]][1], ink1: P.inks[g.ink[1]][1], inkNames: Array.from(new Set(g.ink)).map(i => P.inks[i][0]),
    lumen: !!(g.lumen[0] && g.lumen[1]), eyes: Math.max(g.eyes[0] + g.eyes[1], g.mut === 'watcher' ? 1 : 0),
    sinister: !!(g.sym[0] && g.sym[1]), mut: g.mut || null, letter: g.letter || null, sid: g.sid, stop: stopFor(F) };
}

/* ---------- seeds (image coords, row 0 = top) ---------- */
function quad(v, t) { const [a, b, c] = v, m = 1 - t; return [m * m * a[0] + 2 * m * t * b[0] + t * t * c[0], m * m * a[1] + 2 * m * t * b[1] + t * t * c[1]]; }
function seedMarks(ph, n, r) {
  const m = [], S = (u, v) => [Math.round(u * n), Math.round(v / VMAX * n)];
  const th = Math.max(2, Math.round(n * .02)), rd = Math.max(4, Math.round(n * .045)), sq = Math.max(5, Math.round(n * .045));
  const disk = (u, v, rr) => { const [cx, cy] = S(u, v); for (let y = -rr; y <= rr; y++) for (let x = -rr; x <= rr; x++) if (x * x + y * y <= rr * rr) m.push([cx + x, cy + y]); };
  const curve = (cv) => { for (let t = 0; t <= 1; t += 1 / (n * 1.5)) { const [u, v] = quad(cv, t); disk(u, v, th); } };
  const ring = (u, v, R) => { for (let a = 0; a < 360; a += 3) { const t = a * Math.PI / 180; disk(u + Math.cos(t) * R, v + Math.sin(t) * R * VMAX, Math.max(1, th - 1)); } };
  for (const s of ph.seeds) {
    if (s === 'Dot') { disk(.45, .27, rd); disk(.36, .68, rd); }
    else if (s === 'Ring') { ring(.45, .27, .09); ring(.36, .68, .08); }
    else if (s === 'Bar') curve([[.56, .05], [.40, .50], [.50, .93]]);
    else if (s === 'Scatter') for (let k = 0; k < 16; k++) { const [cx, cy] = S(.06 + r() * .88, (.04 + r() * .92) * VMAX); for (let y = 0; y < sq; y++) for (let x = 0; x < sq; x++) m.push([cx + x, cy + y]); }
    else if (s === 'Vein') P.veins.forEach(curve);
  }
  if (ph.letter && typeof document !== 'undefined') { /* Script: pattern grows from a hidden glyph */
    const c = document.createElement('canvas'); c.width = c.height = n; const x = c.getContext('2d');
    x.font = 'bold ' + Math.round(n * .32) + 'px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(ph.letter, n * .5, n * .30 / VMAX);
    const d = x.getImageData(0, 0, n, n).data; for (let i = 0; i < n * n; i++) if (d[i * 4 + 3] > 128) m.push([i % n, (i / n) | 0]);
  }
  return m;
}
function initState(ph, n, noiseKey) {
  const A = new Float32Array(n * n).fill(1), B = new Float32Array(n * n), lay = rng(ph.sid + ':layout'), noise = rng(ph.sid + noiseKey);
  for (const [x, y] of seedMarks(ph, n, lay)) { if (x < 0 || y < 0 || x >= n || y >= n) continue; const i = (n - 1 - y) * n + x; A[i] = .5; B[i] = .25 + (noise() - .5) * .06; }
  return { A, B };
}

/* ---------- WebGL backend ---------- */
let GLX = null;
const FS = `precision highp float;
uniform sampler2D uS;uniform float uN;uniform float uF;uniform float uK;uniform float uG;uniform vec2 uB;
vec2 dec(vec4 c){c=floor(c*255.0+0.5);return vec2(c.r*256.0+c.g,c.b*256.0+c.a)/65535.0;}
vec4 enc(vec2 v){v=clamp(v,0.0,1.0);vec2 n=floor(v*65535.0+0.5);vec2 hi=floor(n/256.0);vec2 lo=n-hi*256.0;return vec4(hi.x,lo.x,hi.y,lo.y)/255.0;}
vec2 at(vec2 p){p=mod(p,uN);return dec(texture2D(uS,(p+0.5)/uN));}
void main(){vec2 p=floor(gl_FragCoord.xy);vec2 c=at(p);
vec2 li=-c+0.2*(at(p+vec2(1.0,0.0))+at(p-vec2(1.0,0.0))+at(p+vec2(0.0,1.0))+at(p-vec2(0.0,1.0)))+0.05*(at(p+vec2(1.0,1.0))+at(p+vec2(-1.0,1.0))+at(p+vec2(1.0,-1.0))+at(p+vec2(-1.0,-1.0)));
vec2 lap=li;
if(uG>0.0){vec2 d=p-uB;float L=max(length(d),0.001);vec2 o=floor(d/L*1.4142+0.5);float s=(abs(o.x)+abs(o.y)>1.5)?0.5:1.0;lap=mix(li,(at(p+o)+at(p-o)-2.0*c)*s*0.4,uG);}
float r=c.x*c.y*c.y;
gl_FragColor=enc(c+vec2(lap.x-r+uF*(1.0-c.x),0.5*lap.y+r-(uK+uF)*c.y));}`;
function glInit() {
  if (GLX !== null) return GLX;
  GLX = false;
  try {
    if (typeof document === 'undefined') return GLX;
    const cv = document.createElement('canvas'), gl = cv.getContext('webgl', { antialias: false, premultipliedAlpha: false });
    if (!gl) return GLX;
    const hp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT); if (!hp || hp.precision < 16) return GLX;
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
    const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, 'attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}')); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link');
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.disable(gl.DITHER); gl.disable(gl.BLEND);
    const u = {}; for (const k of ['uS', 'uN', 'uF', 'uK', 'uG', 'uB']) u[k] = gl.getUniformLocation(p, k);
    GLX = { gl, p, u };
  } catch (e) { GLX = false; }
  return GLX;
}
function enc8(A, B) { const n = A.length, d = new Uint8Array(n * 4); for (let i = 0; i < n; i++) { const a = Math.round(A[i] * 65535), b = Math.round(B[i] * 65535); d[i * 4] = a >> 8; d[i * 4 + 1] = a & 255; d[i * 4 + 2] = b >> 8; d[i * 4 + 3] = b & 255; } return d; }
function GpuSide(n, st, prm) {
  const { gl } = GLX, mk = (data) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, n, n, 0, gl.RGBA, gl.UNSIGNED_BYTE, data); return t; };
  const t = [mk(enc8(st.A, st.B)), mk(null)], f = t.map(x => { const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, x, 0); return fb; });
  let cur = 0; const buf = new Uint8Array(n * n * 4);
  return {
    step(k) { const u = GLX.u; gl.useProgram(GLX.p); gl.viewport(0, 0, n, n); gl.uniform1f(u.uN, n); gl.uniform1f(u.uF, prm.F); gl.uniform1f(u.uK, prm.K); gl.uniform1f(u.uG, prm.g); gl.uniform2f(u.uB, prm.bx, prm.by); gl.uniform1i(u.uS, 0); gl.activeTexture(gl.TEXTURE0);
      for (let i = 0; i < k; i++) { gl.bindFramebuffer(gl.FRAMEBUFFER, f[1 - cur]); gl.bindTexture(gl.TEXTURE_2D, t[cur]); gl.drawArrays(gl.TRIANGLES, 0, 3); cur = 1 - cur; } },
    read(out) { gl.bindFramebuffer(gl.FRAMEBUFFER, f[cur]); gl.readPixels(0, 0, n, n, gl.RGBA, gl.UNSIGNED_BYTE, buf); for (let y = 0; y < n; y++) { const s = (n - 1 - y) * n; for (let x = 0; x < n; x++) { const i = (s + x) * 4; out[y * n + x] = (buf[i + 2] * 256 + buf[i + 3]) / 65535; } } },
    free() { t.forEach(x => gl.deleteTexture(x)); f.forEach(x => gl.deleteFramebuffer(x)); }
  };
}
function CpuSide(n, st, prm) {
  let A = st.A, B = st.B, A2 = new Float32Array(n * n), B2 = new Float32Array(n * n);
  const OX = new Int8Array(n * n), OY = new Int8Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const dx = x - prm.bx, dy = y - prm.by, L = Math.max(Math.hypot(dx, dy), .001); OX[y * n + x] = Math.floor(dx / L * 1.4142 + .5); OY[y * n + x] = Math.floor(dy / L * 1.4142 + .5); }
  const g = prm.g, F = prm.F, K = prm.K;
  return {
    step(k) {
      for (let it = 0; it < k; it++) {
        for (let y = 0; y < n; y++) { const ym = ((y - 1 + n) % n) * n, y0 = y * n, yp = ((y + 1) % n) * n;
          for (let x = 0; x < n; x++) { const xm = (x - 1 + n) % n, xp = (x + 1) % n, i = y0 + x, a = A[i], b = B[i];
            let la = -a + .2 * (A[ym + x] + A[yp + x] + A[y0 + xm] + A[y0 + xp]) + .05 * (A[ym + xm] + A[ym + xp] + A[yp + xm] + A[yp + xp]);
            let lb = -b + .2 * (B[ym + x] + B[yp + x] + B[y0 + xm] + B[y0 + xp]) + .05 * (B[ym + xm] + B[ym + xp] + B[yp + xm] + B[yp + xp]);
            if (g > 0) { const ox = OX[i], oy = OY[i], s = (ox && oy) ? .5 : 1, j1 = ((y + oy + n) % n) * n + (x + ox + n) % n, j2 = ((y - oy + n) % n) * n + (x - ox + n) % n;
              la = la * (1 - g) + g * (A[j1] + A[j2] - 2 * a) * s * .4; lb = lb * (1 - g) + g * (B[j1] + B[j2] - 2 * b) * s * .4; }
            const r = a * b * b; let na = a + la - r + F * (1 - a), nb = b + .5 * lb + r - (K + F) * b;
            na = na < 0 ? 0 : na > 1 ? 1 : na; nb = nb < 0 ? 0 : nb > 1 ? 1 : nb;
            A2[i] = Math.round(na * 65535) / 65535; B2[i] = Math.round(nb * 65535) / 65535; } }
        let t = A; A = A2; A2 = t; t = B; B = B2; B2 = t;
      } },
    read(out) { for (let y = 0; y < n; y++) { const s = (n - 1 - y) * n; for (let x = 0; x < n; x++) out[y * n + x] = B[s + x]; } },
    free() {}
  };
}
/* Grower: grows one moth's wings; same genome -> same wing */
function Grower(ph, opts) {
  opts = opts || {};
  const n = ph.n, gpu = !opts.cpu && glInit();
  const prm = { F: ph.F, K: ph.K, g: ph.grain * .15, bx: P.base[0] * n, by: (1 - P.base[1] / VMAX) * n };
  const Side = gpu ? GpuSide : CpuSide;
  this.n = n; this.ph = ph; this.steps = 0; this.stop = ph.stop; this.gpu = !!gpu;
  this.R = Side(n, initState(ph, n, ':R'), prm);
  this.L = ph.sinister ? Side(n, initState(ph, n, ':L'), prm) : null;
  this.fR = new Float32Array(n * n); this.fL = ph.sinister ? new Float32Array(n * n) : null; this.prev = null;
}
Grower.prototype.step = function (k) {
  k = Math.min(k, this.stop - this.steps); if (k <= 0) return true;
  const snap = this.stop - 200;
  if (this.steps < snap && this.steps + k >= snap) { const a = snap - this.steps; this.R.step(a); this.prev = new Float32Array(this.n * this.n); this.R.read(this.prev); this.R.step(k - a); }
  else this.R.step(k);
  if (this.L) this.L.step(k);
  this.steps += k; return this.steps >= this.stop;
};
Grower.prototype.read = function () { this.R.read(this.fR); if (this.L) this.L.read(this.fL); return { R: this.fR, L: this.fL, n: this.n }; };
Grower.prototype.finish = function () { while (!this.step(500)); return this.read(); };
Grower.prototype.free = function () { this.R.free(); if (this.L) this.L.free(); };

/* ---------- regime classification (in-game names) ---------- */
function components(mask, n) {
  const lab = new Int32Array(n * n).fill(-1), sizes = [], st = [];
  for (let i = 0; i < n * n; i++) { if (!mask[i] || lab[i] >= 0) continue; const id = sizes.length; let sz = 0; st.push(i); lab[i] = id;
    while (st.length) { const j = st.pop(); sz++; const x = j % n, y = (j / n) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue; const k = yy * n + xx; if (mask[k] && lab[k] < 0) { lab[k] = id; st.push(k); } } }
    sizes.push(sz); }
  return sizes;
}
function classify(B, n, F) {
  let mx = 0, c = 0; const ink = new Uint8Array(n * n), bg = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) { if (B[i] > mx) mx = B[i]; ink[i] = B[i] > .18 ? 1 : 0; bg[i] = 1 - ink[i]; c += ink[i]; } c /= n * n;
  if (mx < .1 || c < .02) return 'Plain';
  if (c > .92) return 'Pall';
  const si = components(ink, n).filter(z => z > 3), sb = components(bg, n).filter(z => z > 3);
  const big = si.length ? Math.max.apply(null, si) / (n * n) : 0, spots = si.length >= 8 && big < .04;
  if (F < .024) return spots ? 'Ember' : c > .45 ? 'Storm' : 'Tide';
  if (spots) return c < .2 ? 'Freckle' : 'Bloom';
  if (sb.length >= 12 && c > .5) return 'Lace';
  if (big > .3) return c > .45 ? 'Maze' : 'Coral';
  return 'Worm';
}

/* ---------- eyespot positions: strongest pattern peaks inside the wings ---------- */
function eyePeaks(B, n, k) {
  if (!k) return [];
  const S = new Float32Array(n * n), r = 3;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { let s = 0, c = 0; for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < n && yy < n) { s += B[yy * n + xx]; c++; } } S[y * n + x] = s / c; }
  const inWing = (u, v) => (u > .14 && u < .82 && v > .14 && v < .44) || (u > .12 && u < .50 && v > .56 && v < .78);
  const cand = [];
  for (let y = 2; y < n - 2; y++) for (let x = 2; x < n - 2; x++) { const u = x / n, v = y / n * VMAX; if (!inWing(u, v)) continue; const s = S[y * n + x]; let top = true;
    for (let dy = -2; dy <= 2 && top; dy++) for (let dx = -2; dx <= 2; dx++) if (S[(y + dy) * n + x + dx] > s) { top = false; break; }
    if (top && s > .1) cand.push([s, u, v]); }
  cand.sort((a, b) => b[0] - a[0]);
  const out = []; for (const c of cand) { if (out.every(o => Math.hypot(o[0] - c[1], (o[1] - c[2]) / VMAX) > .18)) out.push([c[1], c[2]]); if (out.length >= k) break; }
  return out;
}

/* ---------- rendering ---------- */
function wingPath(ph, X, Y) {
  const p = new Path2D(), F = P.fore[ph.tip], h = P.hind, bz = c => p.bezierCurveTo(X(c[0]), Y(c[1]), X(c[2]), Y(c[3]), X(c[4]), Y(c[5]));
  p.moveTo(X(F[0][0]), Y(F[0][1])); for (let i = 1; i < F.length; i++) bz(F[i]); p.closePath();
  p.moveTo(X(h[0][0]), Y(h[0][1])); bz(h[1]);
  const L = P.tailLen[ph.tail];
  if (!L) { bz(h[2]); bz(h[3]); }
  else { const w = ph.tail === 4 ? .022 : ph.tail === 3 ? .04 : .055, bx = .5, by = .79;
    bz([.70, .64, .63, .73, bx + w + .03, by - .01]);
    bz([bx + w * .8, by + L * .4, bx + w * .35, by + L * .85, bx + .005, by + L]);
    bz([bx - w * .35, by + L * .8, bx - w * .7, by + L * .35, bx - w - .03, by + .015]);
    bz([.30, .84, .08, .74, .02, .58]); }
  p.closePath(); return p;
}
function paint(B, n, ph, cache, key, reveal, eyes, pup) {
  const rv = reveal == null ? 1 : reveal;
  const c = cache[key] || (cache[key] = document.createElement('canvas')); if (c.width !== n) { c.width = c.height = n; }
  const x = c.getContext('2d'), im = x.createImageData(n, n), d = im.data, G = ph.ground, I0 = ph.ink0, I1 = ph.ink1, pale = ph.mut === 'pale', glass = ph.mut === 'glasswing';
  for (let i = 0; i < n * n; i++) { let t = (B[i] - .07) / .22; t = t < 0 ? 0 : t > 1 ? 1 : t; t = t * t * (3 - 2 * t) * rv;
    let r = G[0] + ((I0[0] + (I1[0] - I0[0]) * t) - G[0]) * t, g = G[1] + ((I0[1] + (I1[1] - I0[1]) * t) - G[1]) * t, b = G[2] + ((I0[2] + (I1[2] - I0[2]) * t) - G[2]) * t;
    if (pale) { const l = (r * .3 + g * .59 + b * .11) * .8 + 45; r = r * .12 + l * .88; g = g * .12 + l * .88; b = b * .12 + l * .88; }
    const o = i * 4; d[o] = r; d[o + 1] = g; d[o + 2] = b; d[o + 3] = glass && t < .15 ? 46 : 255; }
  x.putImageData(im, 0, 0);
  if (eyes && eyes.length) { const ink = ph.ink0, pale = ph.ground.map(v => Math.min(255, v + 35)), rgba = (c, a) => 'rgba(' + c.map(Math.round).join(',') + ',' + a + ')', R0 = n * .075, px = pup ? pup[0] * R0 : 0, py = pup ? pup[1] * R0 : 0;
    for (const [u, v] of eyes) { const cx = u * n, cy = v / VMAX * n;
      let g = x.createRadialGradient(cx, cy, 0, cx, cy, R0); g.addColorStop(0, rgba(pale, .95)); g.addColorStop(.55, rgba(pale, .9)); g.addColorStop(.68, rgba(ink, .95)); g.addColorStop(.86, rgba(ink, .8)); g.addColorStop(1, rgba(ink, 0));
      x.fillStyle = g; x.beginPath(); x.arc(cx, cy, R0, 0, 7); x.fill();
      g = x.createRadialGradient(cx + px, cy + py, 0, cx + px, cy + py, R0 * .42); g.addColorStop(0, 'rgba(14,9,6,1)'); g.addColorStop(.75, 'rgba(14,9,6,.95)'); g.addColorStop(1, 'rgba(14,9,6,0)');
      x.fillStyle = g; x.beginPath(); x.arc(cx + px, cy + py, R0 * .42, 0, 7); x.fill();
      g = x.createRadialGradient(cx + px - R0 * .13, cy + py - R0 * .13, 0, cx + px - R0 * .13, cy + py - R0 * .13, R0 * .13); g.addColorStop(0, 'rgba(255,250,235,.8)'); g.addColorStop(1, 'rgba(255,250,235,0)');
      x.fillStyle = g; x.beginPath(); x.arc(cx + px - R0 * .13, cy + py - R0 * .13, R0 * .13, 0, 7); x.fill(); } }
  return c;
}
function paintGlow(B, n, cache, key) {
  const m = n >> 1, c = cache[key] || (cache[key] = document.createElement('canvas')); if (c.width !== m) { c.width = c.height = m; }
  const x = c.getContext('2d'), im = x.createImageData(m, m), d = im.data;
  for (let y = 0; y < m; y++) for (let xx = 0; xx < m; xx++) { const b = B[(y * 2) * n + xx * 2]; let t = (b - .07) / .22; t = t < 0 ? 0 : t > 1 ? 1 : t; const o = (y * m + xx) * 4; d[o] = 255; d[o + 1] = 214; d[o + 2] = 130; d[o + 3] = t * 255; }
  x.putImageData(im, 0, 0); return c;
}
let GRAIN = null;
function grainCanvas() { if (GRAIN) return GRAIN; GRAIN = document.createElement('canvas'); GRAIN.width = GRAIN.height = 96; const x = GRAIN.getContext('2d'), im = x.createImageData(96, 96), r = rng(7); for (let i = 0; i < im.data.length; i += 4) { const v = 196 + r() * 59; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; } x.putImageData(im, 0, 0); return GRAIN; }
/* renderMoth(ctx, ph, field{R,L,n}, opt{cache, glow 0..1, eyes:[[u,v]], finger:[x,y], noBody}) */
function renderMoth(ctx, ph, fld, opt) {
  opt = opt || {}; const cache = opt.cache || (opt.cache = {}), W = ctx.canvas.width, H = ctx.canvas.height, n = fld.n;
  ctx.clearRect(0, 0, W, H);
  const x0 = W / 2 + 4, x1 = W - 6, y0 = H * .03, hw = H * .72, X = u => x0 + u * (x1 - x0), Y = v => y0 + v * hw, path = wingPath(ph, X, Y);
  let pupR = null, pupL = null;
  if (ph.mut === 'watcher' && opt.finger && opt.eyes && opt.eyes.length) { const [u, v] = opt.eyes[0], ex = X(u), ey = Y(v), f = opt.finger;
    for (const sd of [0, 1]) { const fx = sd ? W - f[0] : f[0], dx = fx - ex, dy = f[1] - ey, L = Math.hypot(dx, dy) || 1, o = [dx / L * .3, dy / L * .3]; if (sd) pupL = o; else pupR = o; } }
  const watch = ph.mut === 'watcher' && opt.finger, pR = paint(fld.R, n, ph, cache, 'pR', opt.reveal, opt.eyes, pupR), pL = fld.L || watch ? paint(fld.L || fld.R, n, ph, cache, 'pL', opt.reveal, opt.eyes, pupL) : pR;
  const gR = opt.glow > 0 ? paintGlow(fld.R, n, cache, 'gR') : null, gL = opt.glow > 0 && fld.L ? paintGlow(fld.L, n, cache, 'gL') : gR;
  if (!cache.grain) cache.grain = ctx.createPattern(grainCanvas(), 'repeat');
  const ink = 'rgba(' + ph.ink0.join(',') + ',1)';
  for (let side = 0; side < 2; side++) {
    ctx.save(); if (side) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    if (!opt.glowOnly) { ctx.save(); ctx.clip(path); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(side ? pL : pR, x0, y0, x1 - x0, hw * VMAX);
    ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(18,12,6,.36)'; ctx.lineWidth = Math.max(1, W / 460);
    for (const v of P.veins) { ctx.beginPath(); ctx.moveTo(X(v[0][0]), Y(v[0][1])); ctx.quadraticCurveTo(X(v[1][0]), Y(v[1][1]), X(v[2][0]), Y(v[2][1])); ctx.stroke(); }
    ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = cache.grain; ctx.fillRect(x0, y0, x1 - x0, H); ctx.globalCompositeOperation = 'source-over';
    if (ph.mut === 'singed') { ctx.strokeStyle = 'rgba(42,16,4,.6)'; ctx.lineWidth = W * .045; ctx.stroke(path); ctx.setLineDash([3, 7, 1, 5]); ctx.strokeStyle = 'rgba(0,0,0,.85)'; ctx.lineWidth = W * .02; ctx.stroke(path); ctx.setLineDash([]); }
    ctx.strokeStyle = 'rgba(8,5,2,.30)'; ctx.lineWidth = W * .028; ctx.stroke(path);
    ctx.strokeStyle = 'rgba(8,5,2,.70)'; ctx.lineWidth = Math.max(1.5, W / 210); ctx.stroke(path);
    ctx.restore(); }
    if (opt.glow > 0) { ctx.save(); ctx.clip(path); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = opt.glow * .85; ctx.drawImage(side ? gL : gR, x0, y0, x1 - x0, hw * VMAX); ctx.restore();
      ctx.save(); ctx.clip(path); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = opt.glow * .35; ctx.filter = 'blur(' + Math.round(W / 60) + 'px)'; ctx.drawImage(side ? gL : gR, x0, y0, x1 - x0, hw * VMAX); ctx.filter = 'none'; ctx.restore(); }
    ctx.restore();
  }
  if (!opt.noBody && !opt.glowOnly) { ctx.save(); ctx.translate(W / 2, H / 2); drawBody(ctx, W, H, opt.light == null ? 1 : opt.light, opt.legs); ctx.restore(); }
}
/* body: furry thorax, ringed abdomen, eyes, feathered antennae, legs when at rest.
   Drawn around the moth's centre; w,h = full moth width/height. */
function drawBody(ctx, w, h, light, legs) {
  const k = .25 + .75 * light, c = (r, g2, b, a) => 'rgba(' + Math.round(r * k) + ',' + Math.round(g2 * k) + ',' + Math.round(b * k) + ',' + (a == null ? 1 : a) + ')';
  const boost = Math.max(0, Math.min(1, (170 - w) / 110)), sx = .92 + .63 * boost, sy = .95 + .3 * boost;
  ctx.save(); ctx.translate(0, h * -.17); ctx.scale(sx, sy); ctx.translate(0, h * .17); ctx.lineCap = 'round';
  if (legs) for (const [col, lw] of [[c(30, 22, 15), Math.max(1.6, w / 150)], [c(175, 150, 115), Math.max(.8, w / 300)]]) { ctx.strokeStyle = col; ctx.lineWidth = lw; for (const sd of [-1, 1]) for (const [y0, kx, ky, ex, ey] of [[-.21, .06, -.26, .085, -.31], [-.17, .075, -.15, .1, -.07], [-.13, .06, -.06, .085, .06]]) { ctx.beginPath(); ctx.moveTo(sd * w * .02, h * y0); ctx.lineTo(sd * w * kx, h * ky); ctx.lineTo(sd * w * ex, h * ey); ctx.stroke(); } }
  ctx.shadowColor = c(160, 130, 95, .35); ctx.shadowBlur = Math.max(2, w * .02);
  const ab = ctx.createLinearGradient(-w * .04, 0, w * .04, 0); ab.addColorStop(0, c(50, 38, 28)); ab.addColorStop(.5, c(160, 132, 100)); ab.addColorStop(1, c(50, 38, 28));
  ctx.fillStyle = ab; ctx.beginPath(); ctx.moveTo(0, h * -.12); ctx.bezierCurveTo(w * .045, h * -.08, w * .04, h * .2, 0, h * .3); ctx.bezierCurveTo(-w * .04, h * .2, -w * .045, h * -.08, 0, h * -.12); ctx.fill();
  ctx.shadowBlur = 0; ctx.strokeStyle = c(25, 18, 12, .55); ctx.lineWidth = Math.max(.8, w / 160);
  for (let i = 1; i < 6; i++) { const y = h * (-.06 + i * .055), hw = w * .038 * (1 - i * .12); ctx.beginPath(); ctx.moveTo(-hw, y); ctx.quadraticCurveTo(0, y + h * .02, hw, y); ctx.stroke(); }
  ctx.shadowBlur = Math.max(3, w * .025); ctx.shadowColor = c(200, 175, 140, .55);
  const th = ctx.createRadialGradient(-w * .01, h * -.2, 1, 0, h * -.17, w * .06); th.addColorStop(0, c(205, 180, 145)); th.addColorStop(1, c(80, 62, 46));
  ctx.fillStyle = th; ctx.beginPath(); ctx.ellipse(0, h * -.17, w * .05, h * .095, 0, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
  ctx.fillStyle = c(110, 88, 66); ctx.beginPath(); ctx.ellipse(0, h * -.285, w * .032, h * .042, 0, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(10,6,4,1)'; for (const sd of [-1, 1]) { ctx.beginPath(); ctx.arc(sd * w * .022, h * -.295, w * .012, 0, 7); ctx.fill(); }
  ctx.strokeStyle = c(175, 150, 112); ctx.lineWidth = Math.max(1, w / 120);
  for (const sd of [-1, 1]) { ctx.beginPath(); ctx.moveTo(sd * w * .012, h * -.32); ctx.quadraticCurveTo(sd * w * .06, h * -.4, sd * w * .16, h * -.42); ctx.stroke();
    ctx.lineWidth = Math.max(.7, w / 200); for (let i = 1; i < 8; i++) { const u = i / 8, ax = sd * w * (.012 + .145 * u), ay = h * (-.32 - .14 * u + .05 * u * u), l = w * .026 * Math.sin(u * Math.PI); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + sd * l * .35, ay - l); ctx.moveTo(ax, ay); ctx.lineTo(ax + sd * l, ay - l * .15); ctx.stroke(); } ctx.lineWidth = Math.max(1, w / 120); }
  ctx.restore();
}

/* field packing for storage (Uint8, B scaled by 2) */
function pack(f) { const o = new Uint8Array(f.length); for (let i = 0; i < f.length; i++) o[i] = Math.min(255, Math.round(f[i] * 510)); return o; }
function unpack(u) { const o = new Float32Array(u.length); for (let i = 0; i < u.length; i++) o[i] = u[i] / 510; return o; }

root.WingEngine = { profile: MOTH, GENES, VMAX, hash, rng, weighted, breed, wildGenome, phenotype, feedAt, killAt, stopFor,
  Grower, classify, eyePeaks, renderMoth, drawBody, wingPath, pack, unpack, hasWebGL: () => !!glInit() };
})(typeof window !== 'undefined' ? window : globalThis);
