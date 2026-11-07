/* game.js - Lanternwings game layer. Needs wingengine.js loaded first. */
(function () {
'use strict';
const E = window.WingEngine, P = E.profile;
const HOUR = 36e5, DAY = 24 * HOUR, EGG = 18 * HOUR, LARVA = 48 * HOUR, PUPA = 24 * HOUR, ADULT = 7 * DAY;
const TEST = location.hash === '#test';
const $ = id => document.getElementById(id);
const DPR = Math.min(2, window.devicePixelRatio || 1);

/* ---------- clock (test mode can shift and speed it) ---------- */
let clk = { vA: null, rA: 0, speed: 1 };
if (TEST) try { const s = JSON.parse(localStorage.getItem('lantern_clock') || 'null'); if (s) clk = s; } catch (e) {}
const now = () => clk.vA === null ? Date.now() : clk.vA + (Date.now() - clk.rA) * clk.speed;
function setClock(v, speed) { clk = { vA: v, rA: Date.now(), speed: speed == null ? clk.speed : speed }; try { localStorage.setItem('lantern_clock', JSON.stringify(clk)); } catch (e) {} }
const isNight = t => { const h = new Date(t).getHours(); return h >= 21 || h < 5; };
function nightKey(t) { const d = new Date(t); if (d.getHours() < 5) d.setDate(d.getDate() - 1); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
function morningAfter(t) { const d = new Date(t); if (d.getHours() >= 5) d.setDate(d.getDate() + 1); d.setHours(5, 0, 0, 0); return d.getTime(); }
const dayIdx = t => Math.floor(t / DAY);
const fmtDate = t => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
function inWords(ms) { const h = ms / HOUR; if (h < 1) return 'within the hour'; if (h < 20) return 'in about ' + Math.round(h) + ' hours'; return 'in about ' + Math.round(h / 24) + (Math.round(h / 24) === 1 ? ' day' : ' days'); }

/* ---------- saving (IndexedDB on this phone, same site as the garden) ---------- */
let db = null, M = null; const moths = new Map();
const META0 = () => ({ k: 'meta', visitorsFor: null, released: [], scales: [], atlas: {}, cabinet: [], news: false });
function openDB() { return new Promise((res, rej) => { const q = indexedDB.open('lantern_db', 1); q.onupgradeneeded = () => { const d = q.result; d.createObjectStore('moths', { keyPath: 'id' }); d.createObjectStore('meta', { keyPath: 'k' }); }; q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
function tx(store, mode, fn) { return new Promise((res, rej) => { const t = db.transaction(store, mode), r = fn(t.objectStore(store)); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); }); }
function save(rec) { moths.set(rec.id, rec); if (db) tx('moths', 'readwrite', s => s.put(rec)).catch(() => {}); }
function drop(id) { moths.delete(id); spr.delete(id); if (db) tx('moths', 'readwrite', s => s.delete(id)).catch(() => {}); }
function saveMeta() { if (db) tx('meta', 'readwrite', s => s.put(M)).catch(() => {}); }
async function load() {
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
  try { db = await openDB(); const all = await tx('moths', 'readonly', s => s.getAll()); for (const r of all || []) moths.set(r.id, r); M = (await tx('meta', 'readonly', s => s.get('meta'))) || META0(); }
  catch (e) { db = null; M = META0(); toast('This browser won’t keep moths after closing.'); }
}
const uid = p => p + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);

/* ---------- wing fields (computed once, kept with the moth) ---------- */
const spr = new Map(), queued = new Set(), queue = [];
let pumping = false;
function needField(rec) { if (rec.fR || queued.has(rec.id)) return; queued.add(rec.id); queue.push(rec); pump(); }
function pump() { if (pumping || !queue.length) return; pumping = true;
  setTimeout(() => { const rec = queue.shift(); try { const ph = E.phenotype(rec.g), G = new E.Grower(ph), f = G.finish(); rec.n = f.n; rec.fR = E.pack(f.R); rec.fL = f.L ? E.pack(f.L) : null; G.free(); if (moths.has(rec.id)) save(rec); } catch (e) { console.error(e); }
    queued.delete(rec.id); spr.delete(rec.id); pumping = false; pump(); }, 20); }
function field(rec) { return { R: E.unpack(rec.fR), L: rec.fL ? E.unpack(rec.fL) : null, n: rec.n }; }
function sprite(rec, w) {
  w = w || 320; const key = rec.id + '@' + w; let s = spr.get(key); if (s) return s;
  if (!rec.fR) { needField(rec); return null; }
  const ph = E.phenotype(rec.g), fld = field(rec), eyes = E.eyePeaks(fld.R, fld.n, ph.eyes);
  const mk = glow => { const c = document.createElement('canvas'); c.width = w; c.height = Math.round(w * .625); E.renderMoth(c.getContext('2d'), ph, fld, { eyes, glow, legs: true }); return c; };
  s = { img: mk(0), glow: ph.lumen ? mk(1) : null, ph, fld, eyes }; spr.set(key, s); return s;
}

/* ---------- the wild, the night, and time passing ---------- */
const atLamp = () => [...moths.values()].filter(r => r.stage === 'adult' || r.stage === 'visitor');
let chosen = [];
function lampList() { const key = nightKey(now()), mine = [...moths.values()].filter(r => r.stage === 'adult').sort((a, b) => E.hash(a.id + key) - E.hash(b.id + key)), show = new Set(mine.slice(0, 6));
  if (wedding) { show.add(wedding.a); show.add(wedding.b); } return [...moths.values()].filter(r => r.stage === 'visitor' || show.has(r)); }
const canChoose = r => isNight(now()) && (r.stage === 'adult' || r.stage === 'visitor') && r.wed !== nightKey(now()) && !wedding;
function ensureVisitors(t, force) {
  if (!isNight(t)) return; if (!force && M.visitorsFor === nightKey(t)) return;
  const key = nightKey(t) + (force ? ':' + force : ''); if (!force) M.visitorsFor = key; const r = E.rng('night:' + key), count = E.weighted(r, [2, 5, 3]), gone = morningAfter(t);
  for (let i = 0; i < count; i++) {
    let g = E.wildGenome(r, dayIdx(t) + i);
    if (i === 0 && M.released.length && r() < .25) g = E.breed(M.released[Math.floor(r() * M.released.length)], g, 'kin:' + key);
    const rec = { id: 'v' + key + '-' + i, g, stage: 'visitor', wild: true, parents: null, t: { came: t, gone }, wed: null };
    save(rec); needField(rec);
  }
  saveMeta();
}
function tick() {
  const t = now(); ensureVisitors(t);
  for (const r of [...moths.values()]) {
    if (r.stage === 'visitor' && t >= r.t.gone) drop(r.id);
    else if (r.stage === 'egg' && t >= r.t.hatch) { r.stage = 'larva'; save(r); needField(r); }
    else if (r.stage === 'larva' && t >= r.t.pupa) { r.stage = 'pupa'; save(r); }
    else if (r.stage === 'pupa' && t >= r.t.eclose) { r.stage = 'ready'; save(r); }
    else if (r.stage === 'adult' && t >= r.t.dies) { M.scales.push({ at: t, regime: r.regime || '' }); drop(r.id); saveMeta(); }
  }
  if (!modalOpen()) { const ready = [...moths.values()].find(r => r.stage === 'ready'); if (ready) eclose(ready); }
  if (TEST) $('tclock').textContent = new Date(t).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) + (isNight(t) ? ', night' : ', day') + (clk.speed > 1 ? ', ×' + clk.speed : '');
}
function wed(a, b) {
  const t = now(), key = nightKey(t), r = E.rng(a.id + b.id + key), n = 1 + E.weighted(r, [15, 35, 35, 15]);
  for (const m of [a, b]) { m.wed = key; if (m.stage === 'visitor') { m.stage = 'adult'; m.t = { born: t, dies: t + (3 + r() * 4) * DAY }; } save(m); }
  for (let i = 0; i < n; i++) { const hatch = t + EGG * (.9 + r() * .2), pupa = hatch + LARVA * (.9 + r() * .2);
    save({ id: uid('m'), g: E.breed(a.g, b.g, a.id + b.id + key + i), stage: 'egg', wild: false, parents: [a.id, b.id], pnames: [label(a), label(b)], t: { laid: t, hatch, pupa, eclose: pupa + PUPA * (.9 + r() * .2) }, wed: null }); }
  toast(n + ' eggs, left on the bark.');
}
const label = r => r.name || r.regime || (r.wild ? 'a stranger' : 'a moth');

/* ---------- scene ---------- */
const cv = $('scene'), ctx = cv.getContext('2d');
let W = 0, H = 0, sel = null, wedding = null, hits = [], LAY = null;
function resize() { W = innerWidth; H = innerHeight; cv.width = W * DPR; cv.height = H * DPR; cv.style.width = W + 'px'; cv.style.height = H + 'px'; LAY = null; BARK = null; TWIG = null; }
addEventListener('resize', resize);
const lamp = () => ({ x: W / 2, y: Math.min(H * .34, 300), s: Math.min(W, H) * .1 });
const h01 = (s, k) => (E.hash(s + ':' + k) % 10000) / 10000;
const off = (w, h) => { const c = document.createElement('canvas'); c.width = Math.round(w * DPR); c.height = Math.round(h * DPR); const x = c.getContext('2d'); x.scale(DPR, DPR); return [c, x]; };

/* value noise for organic shapes */
function noise1(seed) { const r = E.rng(seed), T = new Float32Array(1024); for (let i = 0; i < 1024; i++) T[i] = r(); return x => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return T[i & 1023] * (1 - u) + T[(i + 1) & 1023] * u; }; }
function noise2(seed) { const r = E.rng(seed), T = new Float32Array(256 * 256); for (let i = 0; i < T.length; i++) T[i] = r();
  return (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), a = T[(yi & 255) * 256 + (xi & 255)], b = T[(yi & 255) * 256 + ((xi + 1) & 255)], c = T[((yi + 1) & 255) * 256 + (xi & 255)], d = T[((yi + 1) & 255) * 256 + ((xi + 1) & 255)];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; }; }
const fbm = (n, x, o) => { let s = 0, a = .5, f = 1; for (let i = 0; i < o; i++) { s += n(x * f) * a; f *= 2.03; a *= .5; } return s; };
const fbm2 = (n, x, y, o) => { let s = 0, a = .5, f = 1; for (let i = 0; i < o; i++) { s += n(x * f, y * f) * a; f *= 2.03; a *= .5; } return s; };
let GRAINC = null;
function grainTile() { if (GRAINC) return GRAINC; GRAINC = document.createElement('canvas'); GRAINC.width = GRAINC.height = 160; const x = GRAINC.getContext('2d'), im = x.createImageData(160, 160), r = E.rng('film');
  for (let i = 0; i < im.data.length; i += 4) { const v = 128 + (r() - .5) * 90; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; } x.putImageData(im, 0, 0); return GRAINC; }
function drawGrain(a) { const g = grainTile(), ox = Math.floor(Math.random() * 160), oy = Math.floor(Math.random() * 160); ctx.save(); ctx.globalAlpha = a; ctx.globalCompositeOperation = 'overlay';
  for (let y = -oy; y < H; y += 160) for (let x = -ox; x < W; x += 160) ctx.drawImage(g, x, y); ctx.restore(); }

/* night: sky, three noise-built treelines with haze between, mist, framing foliage */
function makeLayers() {
  const L = lamp(), r = E.rng('night-layers'), hz = H * .64;
  const [bg, b] = off(W, H);
  const sky = b.createLinearGradient(0, 0, 0, hz); sky.addColorStop(0, '#05070c'); sky.addColorStop(.6, '#0b0f19'); sky.addColorStop(1, '#161b28'); b.fillStyle = sky; b.fillRect(0, 0, W, hz + 2);
  const moon = b.createRadialGradient(W * .82, H * .06, 2, W * .82, H * .06, W * .7); moon.addColorStop(0, 'rgba(150,160,190,.09)'); moon.addColorStop(1, 'rgba(150,160,190,0)'); b.fillStyle = moon; b.fillRect(0, 0, W, hz);
  for (let i = 0; i < 220; i++) { const a = r(), y = r() * hz * .9; b.fillStyle = 'rgba(225,222,210,' + ((.03 + a * a * a * .6) * (1 - y / hz)) + ')'; b.beginPath(); b.arc(r() * W, y, .3 + a * .7, 0, 7); b.fill(); }
  const ridge = (base, amp, sc, col, seed, crown, haze) => { const n = noise1(seed), q = E.rng(seed + 'c'), pts = [];
    for (let x = -4; x <= W + 4; x += 2) { const v = fbm(n, x / sc, 5), spike = Math.pow(Math.max(0, fbm(n, x / (sc * .18) + 50, 3) - .45), 1.6) * amp * 3.2; pts.push([x, base - v * amp - spike]); }
    b.fillStyle = col; b.beginPath(); b.moveTo(-4, H); for (const [x, y] of pts) b.lineTo(x, y); b.lineTo(W + 4, H); b.closePath(); b.fill();
    for (const [x, y] of pts) if (q() < .7) for (let k = 0; k < crown; k++) { b.beginPath(); b.arc(x + (q() - .5) * 6, y + q() * 5 - 2, .6 + q() * 2.2, 0, 7); b.fill(); }
    if (haze) { const hzg = b.createLinearGradient(0, base - amp * 1.5, 0, base + amp); hzg.addColorStop(0, 'rgba(120,130,155,0)'); hzg.addColorStop(.6, 'rgba(120,130,155,' + haze + ')'); hzg.addColorStop(1, 'rgba(120,130,155,0)'); b.fillStyle = hzg; b.fillRect(0, base - amp * 1.5, W, amp * 2.5); } };
  ridge(hz, H * .06, W * .35, '#141925', 'r1', 2, .05);
  ridge(hz + H * .05, H * .09, W * .28, '#0b0e15', 'r2', 3, .035);
  ridge(hz + H * .14, H * .07, W * .2, '#050609', 'r3', 3, 0);
  b.fillStyle = '#030304'; b.fillRect(0, hz + H * .2, W, H);
  const mh = H * .2, [mist, m] = off(W * 2, mh);
  for (let i = 0; i < 34; i++) { const x = r() * W * 2, y = mh * (.3 + r() * .4), rw = W * (.12 + r() * .3), g = m.createRadialGradient(x, y, 1, x, y, rw); g.addColorStop(0, 'rgba(160,168,186,.07)'); g.addColorStop(1, 'rgba(160,168,186,0)'); m.save(); m.translate(0, y); m.scale(1, .3); m.translate(0, -y); m.fillStyle = g; m.fillRect(x - rw, y - rw, rw * 2, rw * 2); m.restore(); }
  m.globalCompositeOperation = 'destination-in'; const fade = m.createLinearGradient(0, 0, 0, mh); fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(.5, 'rgba(0,0,0,1)'); fade.addColorStop(1, 'rgba(0,0,0,0)'); m.fillStyle = fade; m.fillRect(0, 0, W * 2, mh);
  const [fg, f] = off(W, H), by = L.y - L.s * 3.0;
  /* branch: tapered, with bark ridges catching the lamp */
  const bp = t => { const x = -20 + t * (W + 40), y = by - L.s * .9 + (t * (1 - t)) * L.s * 1.6 - t * L.s * .6; return [x, y]; };
  for (let i = 0; i <= 60; i++) { const t = i / 60, [x, y] = bp(t), w = L.s * (.38 - t * .14); f.fillStyle = '#050406'; f.beginPath(); f.arc(x, y, w / 2, 0, 7); f.fill(); }
  f.strokeStyle = 'rgba(255,175,95,.16)'; f.lineWidth = 1; f.beginPath(); for (let i = 0; i <= 60; i++) { const t = i / 60, [x, y] = bp(t), w = L.s * (.38 - t * .14); i ? f.lineTo(x, y + w * .45) : f.moveTo(x, y + w * .45); } f.stroke();
  f.strokeStyle = 'rgba(255,175,95,.06)'; for (let i = 0; i < 40; i++) { const t = r(), [x, y] = bp(t); f.beginPath(); f.moveTo(x, y + 2); f.lineTo(x + 6 + r() * 10, y + 1 + r() * 3); f.stroke(); }
  const leafAt = (x, y, len, ang, wid) => { f.save(); f.translate(x, y); f.rotate(ang); const g = f.createLinearGradient(0, -len * wid, 0, len * wid); g.addColorStop(0, '#0a0908'); g.addColorStop(1, '#030304'); f.fillStyle = g;
    f.beginPath(); f.moveTo(0, 0); f.bezierCurveTo(len * .3, -len * wid * 1.2, len * .75, -len * wid, len, 0); f.bezierCurveTo(len * .75, len * wid, len * .3, len * wid * 1.1, 0, 0); f.fill();
    f.strokeStyle = 'rgba(255,175,95,.10)'; f.lineWidth = .8; f.stroke(); f.strokeStyle = 'rgba(255,175,95,.07)'; f.beginPath(); f.moveTo(0, 0); f.quadraticCurveTo(len * .5, -len * wid * .1, len * .95, 0); f.stroke(); f.restore(); };
  for (let i = 0; i < 22; i++) { const t = (i + r() * .7) / 22, [x, y] = bp(t); if (Math.abs(x - L.x) < L.s * 1.1) continue; const stem = r() < .5 ? -1 : 1; leafAt(x, y + stem * L.s * .1, L.s * (.9 + r() * 1.1), stem > 0 ? .6 + r() * 1.2 : -.6 - r() * 1.2 + Math.PI * (r() < .3), .22 + r() * .08); }
  /* foreground grasses and leaves, edge-lit faintly */
  const blade = (x, hgt, bend, wb) => { f.beginPath(); f.moveTo(x - wb, H + 4); f.quadraticCurveTo(x + bend * .35, H - hgt * .55, x + bend, H - hgt); f.quadraticCurveTo(x + bend * .35 + wb * .4, H - hgt * .55, x + wb, H + 4); f.closePath(); f.fill(); };
  f.fillStyle = '#020203'; for (let i = 0; i < 90; i++) { const side = i % 2, x = side ? W - r() * W * .45 : r() * W * .45; blade(x, H * (.05 + r() * r() * .26), (side ? -1 : 1) * (8 + r() * 50), 1.2 + r() * 3); }
  for (const [cx, dir] of [[0, 1], [W, -1]]) for (let i = 0; i < 6; i++) leafAt(cx + dir * r() * W * .1, H - r() * H * .1, L.s * (1.5 + r() * 1.5), dir > 0 ? -.5 - r() * .8 : Math.PI + .5 + r() * .8, .22 + r() * .08);
  const [vg, v] = off(W, H); const g = v.createRadialGradient(W / 2, H * .38, Math.min(W, H) * .25, W / 2, H * .5, Math.max(W, H) * .78); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.72)'); v.fillStyle = g; v.fillRect(0, 0, W, H);
  LAY = { bg, mist, fg, vg, by, hz, mh };
}
const MOTES = Array.from({ length: 70 }, (_, i) => ({ x: h01('mx', i), y: h01('my', i), p: h01('mp', i) * 6.28, sp: .004 + h01('ms', i) * .01 }));

function drawLantern(x, y, s, lit, flick, t) {
  const iron = '#17120d', by = LAY ? LAY.by : y - s * 3.2;
  ctx.strokeStyle = iron; ctx.lineWidth = Math.max(1.5, s * .05);
  for (let yy = by + s * .1; yy < y - s * 1.72; yy += s * .16) { ctx.beginPath(); ctx.ellipse(x, yy, s * .035, s * .07, 0, 0, 7); ctx.stroke(); }
  ctx.beginPath(); ctx.arc(x, y - s * 1.78, s * .1, 0, 7); ctx.stroke();
  const dome = ctx.createLinearGradient(x - s * .7, 0, x + s * .7, 0);
  dome.addColorStop(0, '#0d0a07'); dome.addColorStop(.5, lit ? '#3a2a18' : '#1d1610'); dome.addColorStop(1, '#0d0a07');
  ctx.fillStyle = dome; ctx.beginPath(); ctx.moveTo(x - s * .72, y - s * .98); ctx.quadraticCurveTo(x - s * .55, y - s * 1.5, x, y - s * 1.66); ctx.quadraticCurveTo(x + s * .55, y - s * 1.5, x + s * .72, y - s * .98); ctx.closePath(); ctx.fill();
  ctx.fillStyle = iron; ctx.fillRect(x - s * .78, y - s * 1.02, s * 1.56, s * .1);
  for (const dx of [-.3, 0, .3]) { ctx.fillStyle = lit ? 'rgba(255,190,100,.55)' : '#0a0806'; ctx.fillRect(x + dx * s - s * .04, y - s * 1.32, s * .08, s * .12); }
  const gy0 = y - s * .92, gy1 = y + s * .74;
  const pane = (x0, x1, xt0, xt1, bright) => { ctx.beginPath(); ctx.moveTo(x0, gy0); ctx.lineTo(x1, gy0); ctx.lineTo(xt1, gy1); ctx.lineTo(xt0, gy1); ctx.closePath();
    if (lit) { const g = ctx.createRadialGradient(x, y + s * .1, s * .05, x, y + s * .1, s * 1.1); g.addColorStop(0, 'rgba(255,244,205,' + bright + ')'); g.addColorStop(.4, 'rgba(255,196,108,' + bright * .9 + ')'); g.addColorStop(1, 'rgba(150,80,30,' + bright * .75 + ')'); ctx.fillStyle = g; }
    else ctx.fillStyle = 'rgba(40,34,26,' + (.6 + bright * .3) + ')';
    ctx.fill(); };
  pane(x - s * .62, x - s * .4, x - s * .58, x - s * .4, .55 * flick); pane(x + s * .4, x + s * .62, x + s * .4, x + s * .58, .55 * flick); pane(x - s * .4, x + s * .4, x - s * .4, x + s * .4, .95 * flick);
  if (lit) { const fx = x + Math.sin(t * 9.3) * s * .02 + Math.sin(t * 23) * s * .008, fh = s * (.5 + .08 * Math.sin(t * 13) + .05 * Math.sin(t * 5.1)) * flick, fb = y + s * .42;
    const fg = ctx.createRadialGradient(x, fb - fh * .3, 1, x, fb - fh * .3, fh * .9); fg.addColorStop(0, 'rgba(255,255,240,1)'); fg.addColorStop(.3, 'rgba(255,224,140,.95)'); fg.addColorStop(.7, 'rgba(255,140,40,.5)'); fg.addColorStop(1, 'rgba(255,100,20,0)');
    ctx.fillStyle = fg; ctx.beginPath(); ctx.moveTo(x - s * .09, fb); ctx.quadraticCurveTo(x - s * .12, fb - fh * .55, fx, fb - fh); ctx.quadraticCurveTo(x + s * .12, fb - fh * .55, x + s * .09, fb); ctx.quadraticCurveTo(x, fb + s * .05, x - s * .09, fb); ctx.fill();
    ctx.fillStyle = '#2a1d10'; ctx.fillRect(x - s * .012, fb - s * .02, s * .024, s * .07);
    ctx.fillStyle = 'rgba(255,255,255,.10)'; ctx.fillRect(x - s * .3, gy0 + s * .1, s * .05, s * 1.3); }
  ctx.strokeStyle = iron; ctx.lineWidth = Math.max(2, s * .07);
  for (const [a, b2] of [[-.62, -.58], [-.4, -.4], [.4, .4], [.62, .58]]) { ctx.beginPath(); ctx.moveTo(x + a * s, gy0); ctx.lineTo(x + b2 * s, gy1); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(x - s * .62, y - s * .05); ctx.lineTo(x + s * .62, y - s * .05); ctx.lineWidth = Math.max(1, s * .03); ctx.stroke();
  if (lit) { ctx.strokeStyle = 'rgba(255,200,120,.35)'; ctx.lineWidth = 1; for (const a of [-.37, .43]) { ctx.beginPath(); ctx.moveTo(x + a * s, gy0); ctx.lineTo(x + a * s, gy1); ctx.stroke(); } }
  const base = ctx.createLinearGradient(0, gy1, 0, gy1 + s * .28); base.addColorStop(0, lit ? '#3a2a18' : '#1d1610'); base.addColorStop(1, '#0b0805');
  ctx.fillStyle = base; ctx.beginPath(); ctx.moveTo(x - s * .66, gy1); ctx.lineTo(x + s * .66, gy1); ctx.lineTo(x + s * .5, gy1 + s * .24); ctx.lineTo(x - s * .5, gy1 + s * .24); ctx.closePath(); ctx.fill();
  ctx.fillStyle = iron; ctx.beginPath(); ctx.moveTo(x - s * .12, gy1 + s * .24); ctx.lineTo(x + s * .12, gy1 + s * .24); ctx.lineTo(x, gy1 + s * .42); ctx.closePath(); ctx.fill();
}
function drawLight(L, flick, pass) {
  const big = Math.max(W, H) * .85 * flick;
  if (pass === 0) { const g = ctx.createRadialGradient(L.x, L.y, L.s * .3, L.x, L.y, big); g.addColorStop(0, 'rgba(255,190,105,.42)'); g.addColorStop(.12, 'rgba(220,140,60,.22)'); g.addColorStop(.35, 'rgba(110,60,25,.10)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
  else { ctx.globalCompositeOperation = 'lighter'; const g = ctx.createRadialGradient(L.x, L.y, L.s * .2, L.x, L.y, L.s * 2.6 * flick); g.addColorStop(0, 'rgba(255,215,150,.35)'); g.addColorStop(1, 'rgba(255,150,60,0)'); ctx.fillStyle = g; ctx.fillRect(L.x - L.s * 3, L.y - L.s * 3, L.s * 6, L.s * 6); ctx.globalCompositeOperation = 'source-over'; }
}
function drawNight(t, flick) {
  if (!LAY) makeLayers(); const L = lamp();
  ctx.drawImage(LAY.bg, 0, 0, W, H);
  const mo = (t * 5) % (W * 2), my = LAY.hz - LAY.mh * .55; ctx.drawImage(LAY.mist, -mo, my, W * 2, LAY.mh); ctx.drawImage(LAY.mist, W * 2 - mo, my, W * 2, LAY.mh);
  drawLight(L, flick, 0);
}

/* ---------- flight ---------- */
const fly = new Map();
function flyer(r) {
  let f = fly.get(r.id); if (f) return f; const L = lamp(), k = r.id;
  f = { x: L.x + (h01(k, 1) - .5) * W * .9, y: L.y + (h01(k, 2) - .1) * H * .5, z: .7 + h01(k, 5) * .6, vz: 0, th: h01(k, 9) * 6.28, om: 0, v: 0, ang: 0, sy: 1, roll: 0,
    ph: h01(k, 3) * 6.28, rate: 10 + h01(k, 4) * 4, mode: 'fly', tm: 2 + h01(k, 6) * 4, a: h01(k, 7) * 6.28, dir: h01(k, 8) > .5 ? 1 : -1, sit: false, bump: 0, ztt: 1 };
  fly.set(r.id, f); return f;
}
const adiff = (a, b) => { let d = (a - b) % 6.2832; if (d > 3.1416) d -= 6.2832; if (d < -3.1416) d += 6.2832; return d; };
function stepFlyer(f, dt, t, L, U, held) {
  const s = L.s, gx0 = L.x - .66 * s, gx1 = L.x + .66 * s, gy0 = L.y - 1.0 * s, gy1 = L.y + .95 * s, q = f.ph;
  f.tm -= dt;
  if (held) { f.mode = 'hold'; f.sit = false; } else if (f.mode === 'hold') { f.mode = 'fly'; f.tm = 2; }
  if (f.tm <= 0 && f.mode !== 'hold') {
    if (f.mode === 'fly') { const u = h01(f.a.toFixed(2), Math.floor(t));
      if (u < .3) { f.mode = 'rest'; f.tx = L.x + (h01(q, t | 0) - .5) * .7 * s; f.ty = L.y + (h01(q, (t | 0) + 1) - .45) * 1.3 * s; f.restAng = (h01(q, (t | 0) + 2) - .5) * .9; f.tm = 4 + u * 20; f.ztt = 1; }
      else if (u < .58) { f.mode = 'out'; const a = h01(q, (t | 0) + 3) * 6.28; f.tx = L.x + Math.cos(a) * W * .5; f.ty = Math.max(H * .12, Math.min(H * .8, L.y + Math.sin(a) * H * .45 + H * .12)); f.ztt = u < .44 ? .55 + u * .3 : 1.3 + u * .4; f.tm = 3 + u * 6; }
      else { f.tm = 2 + u * 4; if (u > .8) f.dir *= -1; } }
    else { f.mode = 'fly'; f.sit = false; f.tm = 3 + h01(q, t | 0) * 4; } }
  let tx, ty, zt, vt = (240 + 80 * Math.sin(t * .9 + q)) * U;
  if (f.mode === 'hold') { tx = L.x + (held === 1 ? -1 : 1) * s * 1.9 + Math.sin(t * .9 + q) * s * .5; ty = L.y + s * 1.7 + Math.sin(t * 1.3 + q) * s * .35; vt = 70 * U; zt = 1.1; }
  else if (f.mode === 'fly') { f.a += dt * f.dir * (1.1 + .4 * Math.sin(t * .7 + q)); const rr = s * (2.4 + 1.3 * Math.sin(t * .31 + q * 2)); tx = L.x + Math.cos(f.a) * rr * 1.35; ty = L.y + s * .3 + Math.sin(f.a) * rr * .9; zt = 1 + .45 * Math.sin(t * .55 + q * 3); }
  else { tx = f.tx; ty = f.ty; zt = f.ztt; }
  const dx = tx - f.x, dy = ty - f.y, d = Math.hypot(dx, dy);
  if (f.mode === 'rest') { vt *= Math.max(.25, Math.min(1, d / (2.5 * s))); if (!f.sit && d < 7 * U && Math.abs(f.z - 1) < .12) f.sit = true; }
  if (f.sit) { f.x += dx * Math.min(1, dt * 5); f.y += dy * Math.min(1, dt * 5); f.v = 0; f.vz = 0; f.z = 1; f.om = 0; f.ang += adiff(f.restAng, f.ang) * Math.min(1, dt * 3); f.roll *= .9; f.sy += (1 - f.sy) * Math.min(1, dt * 4); f.ph += dt * 1.1; return; }
  const want = Math.atan2(dy, dx) + (f.mode === 'hold' ? .8 * Math.sin(t * 1.1 + q) : .55 * Math.sin(t * 1.3 + q) + .3 * Math.sin(t * 2.7 + q * 2));
  f.om += (adiff(want, f.th) * 3.2 - f.om) * Math.min(1, dt * 3.5); f.om = Math.max(-4.5, Math.min(4.5, f.om)); f.th += f.om * dt;
  f.v += (vt - f.v) * Math.min(1, dt * 2); f.x += Math.cos(f.th) * f.v * dt; f.y += Math.sin(f.th) * f.v * dt;
  f.vz += ((zt - f.z) * 1.4 - f.vz) * Math.min(1, dt * 1.6); f.z = Math.max(.5, Math.min(1.75, f.z + f.vz * dt));
  if (f.mode !== 'rest' && f.mode !== 'hold' && Math.abs(f.z - 1) < .2 && f.x > gx0 && f.x < gx1 && f.y > gy0 && f.y < gy1) { f.x = f.x - gx0 < gx1 - f.x ? gx0 : gx1; f.th = Math.PI - f.th; f.om *= -.5; f.v *= .7; f.bump = .35; }
  if (f.x < -40 || f.x > W + 40) f.th = Math.PI - f.th; if (f.y < 20 || f.y > H - 70) f.th = -f.th;
  f.x = Math.max(-40, Math.min(W + 40, f.x)); f.y = Math.max(20, Math.min(H - 70, f.y));
  f.ang += adiff(f.th + Math.PI / 2, f.ang) * Math.min(1, dt * 8);
  const rollT = Math.max(-.62, Math.min(.62, .55 * Math.sin(t * .27 + q * 5) + f.om * .12));
  f.roll += (rollT - f.roll) * Math.min(1, dt * 2.5);
  const pitchT = Math.min(.7, Math.abs(f.vz) * 1.6 + .35 * Math.max(0, Math.sin(t * .37 + q * 7)));
  f.sy += ((1 - pitchT) - f.sy) * Math.min(1, dt * 2.5);
  f.ph += dt * f.rate * 6.283 * (f.bump > 0 ? 1.5 : 1); if (f.bump > 0) f.bump -= dt;
}
function flySprite(r) {
  const key = r.id + '@fly'; let s = spr.get(key); if (s) return s; const b = sprite(r, 256); if (!b) return null;
  const mk = o => { const c = document.createElement('canvas'); c.width = 256; c.height = 160; E.renderMoth(c.getContext('2d'), b.ph, b.fld, Object.assign({ eyes: b.eyes, noBody: true }, o)); return c; };
  const lit = mk({}), dark = document.createElement('canvas'); dark.width = 256; dark.height = 160; const dx = dark.getContext('2d');
  dx.drawImage(lit, 0, 0); dx.globalCompositeOperation = 'source-atop'; dx.fillStyle = 'rgba(6,8,16,.86)'; dx.fillRect(0, 0, 256, 160);
  s = { lit, dark, gl: b.ph.lumen ? mk({ glow: 1, glowOnly: true }) : null, ph: b.ph }; spr.set(key, s); return s;
}
const drawBody = (w, h, light, sit) => E.drawBody(ctx, w, h, light, sit);
function drawFlyer(s, f, size, light, gf) {
  const w = size, h = size * .625, iw = 256, ih = 160, bank = f.roll, n = f.sit ? 1 : 7;
  ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.ang); ctx.scale(1, f.sy);
  const halves = (src, alpha) => { for (let j = 0; j < n; j++) { const p = f.ph - j * .3, sc = f.sit ? .9 + .1 * Math.sin(p) : .22 + .78 * (.5 + .5 * Math.cos(p)), sL = Math.max(.32, Math.min(1.05, sc * (1 + bank))), sR = Math.max(.32, Math.min(1.05, sc * (1 - bank)));
      ctx.globalAlpha = alpha * (n > 1 ? (j === 0 ? .55 : .2) : 1);
      ctx.save(); ctx.scale(sL, 1); ctx.drawImage(src, 0, 0, iw / 2, ih, -w / 2, -h / 2, w / 2, h); ctx.restore();
      ctx.save(); ctx.scale(sR, 1); ctx.drawImage(src, iw / 2, 0, iw / 2, ih, 0, -h / 2, w / 2, h); ctx.restore(); } ctx.globalAlpha = 1; };
  halves(s.dark, 1); if (light > .02) halves(s.lit, light);
  if (gf > .01 && s.gl) { ctx.globalCompositeOperation = 'lighter'; halves(s.gl, gf); ctx.globalCompositeOperation = 'source-over'; }
  drawBody(w, h, light, f.sit); ctx.restore();
}
function drawFlyers(t, dt, layer) {
  const L = lamp(), U = Math.min(W, H) / 700, R = Math.max(W, H) * .6, list = lampList();
  if (layer === 0) {
    for (const r of list) { const f = flyer(r);
      if (wedding && (r === wedding.a || r === wedding.b)) { const u = Math.min(1, (t - wedding.t0) / 3.4), ang = u * 10 + (r === wedding.a ? 0 : Math.PI), rr = (1 - u * .85) * L.s * 1.6;
        f.x += (L.x + Math.cos(ang) * rr * 1.2 - f.x) * Math.min(1, dt * 4); f.y += (L.y + L.s * 1.3 + Math.sin(ang) * rr * .5 - f.y) * Math.min(1, dt * 4); f.z += (1.05 + Math.sin(ang) * .15 - f.z) * Math.min(1, dt * 3);
        f.ph += dt * 40; f.sit = false; f.mode = 'fly'; f.tm = 3; f.ang += dt * 4; f.th = f.ang - Math.PI / 2; f.sy = 1; }
      else stepFlyer(f, dt, t, L, U, sel === r ? 1 : 0); }
    if (wedding && t - wedding.t0 > 3.4) { const w = wedding; wedding = null; sel = null; for (const m of [w.a, w.b]) { const f = flyer(m); f.mode = 'fly'; f.tm = 2; } wed(w.a, w.b); }
    return;
  }
  const items = list.map(r => [r, flyer(r)]).filter(([, f]) => layer === 1 ? (!f.sit && f.z < 1) : (f.sit || f.z >= 1)).sort((a, b) => (a[1].sit ? 1.01 : a[1].z) - (b[1].sit ? 1.01 : b[1].z));
  for (const [r, f] of items) {
    const s = flySprite(r), d = Math.hypot(f.x - L.x, f.y - L.y), light = f.sit ? .22 : Math.max(.06, Math.min(1, 1.2 - d / R)) * (.65 + .35 * Math.min(1, f.z)), size = Math.min(W, H) * .13 * f.z;
    hits.push({ x: f.x, y: f.y, r: Math.max(34, size * .6), rec: r });
    if (!s) { ctx.fillStyle = 'rgba(220,200,160,' + (.2 + light * .4) + ')'; ctx.beginPath(); ctx.arc(f.x, f.y, 3, 0, 7); ctx.fill(); continue; }
    const gf = s.gl && !f.sit ? Math.max(0, Math.min(1, (d - 2.4 * L.s) / (2.2 * L.s))) * (.72 + .28 * Math.sin(t * 1.047)) : 0;
    if (gf > .02) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; const hg = ctx.createRadialGradient(f.x, f.y, 1, f.x, f.y, size * .75); hg.addColorStop(0, 'rgba(255,205,120,' + (gf * .35) + ')'); hg.addColorStop(1, 'rgba(255,170,80,0)'); ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(f.x, f.y, size * .75, 0, 7); ctx.fill(); ctx.restore(); }
    drawFlyer(s, f, size, light, gf);
    if (sel === r) { ctx.strokeStyle = 'rgba(255,240,210,.85)'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 5]); ctx.beginPath(); ctx.arc(f.x, f.y, size * .5, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
  }
}
function drawMotes(t, dt) {
  const L = lamp(), R = Math.max(W, H) * .45; ctx.globalCompositeOperation = 'lighter';
  for (const m of MOTES) { m.y -= m.sp * dt * .6; m.x += Math.sin(t * .5 + m.p) * .0004; if (m.y < 0) m.y += 1;
    const x = m.x * W, y = m.y * H, d = Math.hypot(x - L.x, y - L.y), a = Math.max(0, 1 - d / R); if (a <= 0) continue;
    ctx.fillStyle = 'rgba(255,210,150,' + (a * a * .55 * (.6 + .4 * Math.sin(t * 2 + m.p))) + ')'; ctx.beginPath(); ctx.arc(x, y, .7 + a, 0, 7); ctx.fill(); }
  ctx.globalCompositeOperation = 'source-over';
}

/* ---------- day: real bark, moths resting, the twig ---------- */
let BARK = null, TWIG = null;
function makeBark() {
  const sc = 2, w = Math.ceil(W / sc), h = Math.ceil(H / sc), c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'), im = x.createImageData(w, h), d = im.data, n = noise2('bark'), l = noise2('lichen'), m = noise2('moss');
  for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) {
    const ridge = fbm2(n, xx * .07, y * .012, 5), fine = n(xx * .5, y * .08);
    const fiss = Math.pow(Math.min(1, Math.abs(ridge - .5) * 3.2), .7), sh = fbm2(n, (xx + 1) * .07, y * .012, 3) - fbm2(n, (xx - 1) * .07, y * .012, 3);
    let br = .18 + fiss * .42 + fine * .1 + sh * 1.4, R = 92 * br + 18, G = 74 * br + 14, B = 56 * br + 10;
    const lc = fbm2(l, xx * .03, y * .03, 4); if (lc > .58) { const a = Math.min(1, (lc - .58) * 9) * (.55 + .45 * fine); R += (150 - R) * a; G += (158 - G) * a; B += (130 - B) * a; if (fine > .7) { R *= .85; G *= .9; B *= .85; } }
    const mc = fbm2(m, xx * .02, y * .02, 3) * (1 - y / h * .3); if (mc > .62 && fiss < .6) { const a = Math.min(1, (mc - .62) * 7); R += (58 - R) * a; G += (78 - G) * a; B += (34 - B) * a; }
    const o = (y * w + xx) * 4; d[o] = R; d[o + 1] = G; d[o + 2] = B; d[o + 3] = 255; }
  x.putImageData(im, 0, 0);
  const sh = x.createLinearGradient(0, 0, w, 0); sh.addColorStop(0, 'rgba(0,0,0,.45)'); sh.addColorStop(.35, 'rgba(0,0,0,0)'); sh.addColorStop(.7, 'rgba(255,240,210,.05)'); sh.addColorStop(1, 'rgba(0,0,0,.5)'); x.fillStyle = sh; x.fillRect(0, 0, w, h);
  return c;
}
function drawDay() {
  if (!BARK || BARK.width !== Math.ceil(W / 2)) BARK = makeBark();
  ctx.imageSmoothingEnabled = true; ctx.drawImage(BARK, 0, 0, W, H);
  if (!LAY) makeLayers(); const L = lamp(); drawLantern(L.x, L.y, L.s, false, 1, 0);
}
function dayMoths() {
  const S = Math.min(W, H) * .16;
  for (const r of atLamp().slice(0, 10)) { if (r.stage === 'visitor') continue; const s = sprite(r), k = r.id, x = W * (.14 + h01(k, 1) * .72), y = H * (.5 + h01(k, 2) * .22), a = (h01(k, 3) - .5) * .5;
    hits.push({ x, y, r: S * .45, rec: r }); if (!s) continue;
    ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3; ctx.drawImage(s.img, -S / 2, -S * .3125, S, S * .625); ctx.restore(); }
}
/* the twig along the bottom, where eggs, caterpillars and cocoons live */
const twigY = x => H - 150 + Math.sin(x / W * 3.1 + .4) * 14 - x / W * 10;
function makeTwig() {
  const [c, t] = off(W, H), r = E.rng('twig');
  for (let x = -10; x <= W + 10; x += 2) { const y = twigY(x), th = 9 - x / W * 3; const g = t.createLinearGradient(0, y - th, 0, y + th); g.addColorStop(0, '#8a7458'); g.addColorStop(.35, '#5e4a37'); g.addColorStop(1, '#231a12'); t.fillStyle = g; t.fillRect(x, y - th, 2.5, th * 2); }
  t.strokeStyle = 'rgba(25,18,12,.6)'; t.lineWidth = 1; for (let i = 0; i < 120; i++) { const x = r() * W, y = twigY(x) + (r() - .5) * 12, l = 4 + r() * 14; t.beginPath(); t.moveTo(x, y); t.lineTo(x + l, twigY(x + l) + (y - twigY(x))); t.stroke(); }
  for (const kx of [W * .23, W * .61, W * .86]) { const ky = twigY(kx); t.fillStyle = '#3a2b1e'; t.beginPath(); t.ellipse(kx, ky, 5, 3.5, 0, 0, 7); t.fill(); t.strokeStyle = 'rgba(140,115,85,.5)'; t.beginPath(); t.ellipse(kx, ky, 3, 2, 0, 0, 7); t.stroke(); }
  const sx = W * .44, sy = twigY(sx); t.strokeStyle = '#4a3a2a'; t.lineWidth = 4; t.lineCap = 'round'; t.beginPath(); t.moveTo(sx, sy); t.quadraticCurveTo(sx + 30, sy - 40, sx + 70, sy - 60); t.stroke();
  const leaf = (x, y, len, ang, col) => { t.save(); t.translate(x, y); t.rotate(ang); const g = t.createLinearGradient(0, -len * .3, 0, len * .3); g.addColorStop(0, col[0]); g.addColorStop(1, col[1]); t.fillStyle = g;
    t.beginPath(); t.moveTo(0, 0); t.bezierCurveTo(len * .3, -len * .34, len * .75, -len * .26, len, 0); t.bezierCurveTo(len * .75, len * .26, len * .3, len * .32, 0, 0); t.fill();
    t.strokeStyle = 'rgba(30,40,18,.6)'; t.lineWidth = 1; t.beginPath(); t.moveTo(0, 0); t.lineTo(len * .96, 0); t.stroke();
    for (let i = 1; i < 6; i++) { const u = i / 6; t.beginPath(); t.moveTo(len * u * .9, 0); t.lineTo(len * (u * .9 + .12), -len * .16 * Math.sin(u * 3)); t.moveTo(len * u * .9, 0); t.lineTo(len * (u * .9 + .12), len * .16 * Math.sin(u * 3)); t.stroke(); } t.restore(); };
  leaf(sx + 70, sy - 60, 70, -.5, ['#7b8a4c', '#3f4a24']); leaf(sx + 40, sy - 38, 54, -1.9, ['#6d7a42', '#34401e']); leaf(W * .08, twigY(W * .08), 60, .5, ['#86884a', '#4a4a24']); leaf(W * .92, twigY(W * .92), 58, -2.6, ['#7a7040', '#3e3818']);
  return c;
}
function nursery(t) {
  const items = [...moths.values()].filter(r => r.stage === 'egg' || r.stage === 'larva' || r.stage === 'pupa' || r.stage === 'ready').sort((a, b) => a.t.laid - b.t.laid);
  if (!items.length) return;
  if (!TWIG || TWIG.width !== Math.round(W * DPR)) TWIG = makeTwig();
  ctx.drawImage(TWIG, 0, 0, W, H);
  let x = 26, prev = null;
  for (const r of items) {
    const clutch = prev && prev.t.laid === r.t.laid; x += prev ? (clutch && r.stage === 'egg' && prev.stage === 'egg' ? 11 : 46) : 0; prev = r;
    if (x > W - 20) break; const y = twigY(x);
    if (r.stage === 'egg') { const ey = y - 12 + (h01(r.id, 1) - .5) * 3, g = ctx.createRadialGradient(x - 1.5, ey - 1.5, .5, x, ey, 5); g.addColorStop(0, '#fbf6e8'); g.addColorStop(.7, '#d8cfb4'); g.addColorStop(1, '#a39878');
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(x + 1, ey + 3, 4.5, 2, 0, 0, 7); ctx.fill(); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, ey, 4.6, 0, 7); ctx.fill();
      ctx.strokeStyle = 'rgba(120,105,80,.5)'; ctx.lineWidth = .6; ctx.beginPath(); ctx.arc(x, ey, 2.2, 0, 7); ctx.stroke(); hits.push({ x, y: ey, r: 16, rec: r }); }
    else if (r.stage === 'larva') { drawCaterpillar(ctx, x + 14, y - 10, 11, r, t); hits.push({ x: x + 14, y: y - 10, r: 26, rec: r }); x += 20; }
    else { drawCocoon(ctx, x, y + 34, 13, t, y + 6); hits.push({ x, y: y + 34, r: 24, rec: r }); }
  }
}
function drawCaterpillar(c, x, y, s, rec, t) {
  const segs = 9, sp = sprite(rec, 160), pts = [];
  for (let i = 0; i < segs; i++) { const u = i / (segs - 1), hump = Math.max(0, Math.sin(t * 2.2 - u * 5)) * s * .35; pts.push([x - s * 2 + u * s * 4 - Math.max(0, Math.sin(t * 2.2 - u * 5)) * s * .12, y - hump]); }
  c.fillStyle = 'rgba(0,0,0,.3)'; c.beginPath(); c.ellipse(x, y + s * .55, s * 2.2, s * .25, 0, 0, 7); c.fill();
  for (let i = 0; i < segs; i++) { const [px, py] = pts[i], rr = s * (i === segs - 1 ? .5 : .46 - Math.abs(i - 4) * .012);
    c.fillStyle = '#4c5a2a'; for (const dx of [-.2, .2]) { c.beginPath(); c.ellipse(px + dx * s, py + rr * .9, s * .09, s * .16, 0, 0, 7); c.fill(); }
    const g = c.createRadialGradient(px - rr * .3, py - rr * .4, rr * .1, px, py, rr); g.addColorStop(0, '#b6c07a'); g.addColorStop(.6, '#7d8a45'); g.addColorStop(1, '#3f4a20'); c.fillStyle = g; c.beginPath(); c.arc(px, py, rr, 0, 7); c.fill(); }
  if (sp) { c.save(); c.beginPath(); for (let i = 0; i < segs - 1; i++) c.arc(pts[i][0], pts[i][1] - s * .12, s * .3, 0, 7); c.clip(); c.globalAlpha = .28; c.globalCompositeOperation = 'multiply'; c.drawImage(sp.img, x - s * 2.4, y - s * 1.0, s * 4.8, s * 1.5); c.restore(); }
  c.strokeStyle = 'rgba(230,225,190,.45)'; c.lineWidth = .7; for (let i = 0; i < segs - 1; i++) { const [px, py] = pts[i]; for (const a of [-2.2, -1.6, -.9]) { c.beginPath(); c.moveTo(px + Math.cos(a) * s * .42, py + Math.sin(a) * s * .42); c.lineTo(px + Math.cos(a) * s * .7, py + Math.sin(a) * s * .7); c.stroke(); } }
  const [hx, hy] = pts[segs - 1]; c.fillStyle = '#2c2416'; c.beginPath(); c.arc(hx + s * .18, hy + s * .05, s * .34, 0, 7); c.fill(); c.fillStyle = 'rgba(255,255,255,.5)'; c.beginPath(); c.arc(hx + s * .26, hy - s * .05, s * .06, 0, 7); c.fill();
}
function drawCocoon(c, x, y, s, t, ty) {
  const sw = Math.sin((t || 0) * .8) * .05; c.save(); c.translate(x, (ty == null ? y - s * 1.6 : ty)); c.rotate(sw);
  const len = (ty == null ? s * 1.6 : y - ty);
  c.strokeStyle = 'rgba(235,228,205,.55)'; c.lineWidth = .8; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, len - s); c.stroke();
  c.translate(0, len);
  const g = c.createLinearGradient(-s * .5, 0, s * .5, 0); g.addColorStop(0, '#8d8268'); g.addColorStop(.45, '#e4dcc4'); g.addColorStop(1, '#7a6f56');
  c.fillStyle = g; c.beginPath(); c.moveTo(0, -s * 1.05); c.bezierCurveTo(s * .62, -s * .7, s * .55, s * .7, 0, s * 1.1); c.bezierCurveTo(-s * .55, s * .7, -s * .62, -s * .7, 0, -s * 1.05); c.fill();
  c.strokeStyle = 'rgba(255,250,235,.28)'; c.lineWidth = .6; for (let k = 0; k < 14; k++) { const a = -s + k * s * .15; c.beginPath(); c.moveTo(-s * .45, a); c.quadraticCurveTo(0, a + s * .22, s * .45, a - s * .05); c.stroke(); }
  c.strokeStyle = 'rgba(60,50,35,.25)'; for (let k = 0; k < 8; k++) { const a = -s * .8 + k * s * .22; c.beginPath(); c.moveTo(-s * .4, a + s * .1); c.quadraticCurveTo(0, a - s * .1, s * .4, a + s * .12); c.stroke(); }
  c.restore();
}

/* ---------- frame ---------- */
let lastT = performance.now() / 1000;
function frame() {
  const tr = performance.now() / 1000, dt = Math.min(.05, tr - lastT), t = now(), night = isNight(t); lastT = tr;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); hits = [];
  if (night) {
    const flick = .93 + .04 * Math.sin(tr * 7.1) * Math.sin(tr * 2.3) + .03 * Math.sin(tr * 17.3), L = lamp();
    drawNight(tr, flick); drawFlyers(tr, dt, 0); drawFlyers(tr, dt, 1);
    drawLantern(L.x, L.y, L.s, true, flick, tr); drawLight(L, flick, 1);
    drawFlyers(tr, dt, 2); drawMotes(tr, dt);
    ctx.save(); ctx.translate(W / 2, H); ctx.rotate(Math.sin(tr * .4) * .004); ctx.drawImage(LAY.fg, -W / 2, -H, W, H); ctx.restore();
    ctx.drawImage(LAY.vg, 0, 0, W, H);
  } else { drawDay(); dayMoths(); }
  nursery(tr); drawGrain(night ? .09 : .06);
  const n = atLamp().length;
  $('hint').textContent = wedding ? '' : night ? (n ? (chosen.length ? 'One is chosen. Choose another in the Roost.' : 'Bring two to the lamp. Choose them in the Roost.') : 'The lantern is lit. Nothing has come yet.') :
    (n ? 'They rest on the bark until nine.' : 'The lantern is lit at nine.');
  requestAnimationFrame(frame);
}

cv.addEventListener('click', e => {
  if (modalOpen()) return;
  let best = null, bd = 1e9; for (const h of hits) { const d = Math.hypot(h.x - e.clientX, h.y - e.clientY); if (d < h.r && d < bd) { bd = d; best = h; } }
  if (best) openView(best.rec, 'lamp');
});

/* ---------- modals ---------- */
const modalOpen = () => document.querySelector('.sheet.open, .panel.open') !== null;
function closeAll() { document.querySelectorAll('.open').forEach(x => x.classList.remove('open')); viewRec = null; }
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeAll));
let viewRec = null, finger = null; const vcache = new Map();
const vc = $('vc'), vctx = vc.getContext('2d');
let viewFrom = null;
function openView(r, from) {
  closeAll(); viewRec = r; viewFrom = from || null; $('view').classList.add('open');
  const t = now(), b = $('vb'); b.innerHTML = '';
  const btn = (txt, fn, cls) => { const x = document.createElement('button'); x.type = 'button'; x.textContent = txt; x.onclick = fn; if (cls) x.className = cls; b.appendChild(x); };
  let title = '', info = '';
  if (r.stage === 'egg') { title = 'An egg'; info = 'Laid ' + fmtDate(r.t.laid) + '. It hatches ' + inWords(r.t.hatch - t) + '.'; }
  else if (r.stage === 'larva') { title = 'A caterpillar'; info = 'It eats. Something shows faintly on its back.'; }
  else if (r.stage === 'pupa' || r.stage === 'ready') { title = 'A cocoon'; info = 'Something is drying inside.'; }
  else if (r.stage === 'visitor') { title = 'A stranger'; info = 'It came to the light tonight. By morning it will be gone.'; }
  else { title = r.name ? r.name + ', ' + (r.regime || '') : (r.regime || 'A moth');
    info = r.stage === 'pinned' ? 'Pinned ' + fmtDate(r.pinned) + '.' : (r.wild ? 'Once a stranger. ' : '') + 'Its days at the lamp end ' + inWords(r.t.dies - t) + '.';
    if (r.stage === 'adult') { const inp = document.createElement('input'); inp.placeholder = 'A name for its label (optional)'; inp.maxLength = 28; inp.className = 'name'; b.appendChild(inp); btn('Pin it', () => pin(r, inp.value), 'primary'); btn('Release it', () => release(r)); } }
  if (canChoose(r)) { if (chosen.includes(r)) btn('Chosen. Unchoose', () => { chosen = chosen.filter(x => x !== r); openRoost(); }); else btn('Choose for the lamp', () => choose(r), 'primary'); }
  else if ((r.stage === 'adult' || r.stage === 'visitor') && isNight(now()) && r.wed === nightKey(now())) info += ' It has been to the lamp tonight.';
  if (r.parents) r.parents.forEach((pid, i) => { const p = moths.get(pid); if (p) btn('Parent: ' + label(p), () => openView(p, viewFrom)); });
  btn(viewFrom === 'roost' ? 'Back to the Roost' : 'Close', viewFrom === 'roost' ? openRoost : closeAll);
  $('vt').textContent = title; $('vi').textContent = info;
}
function choose(r) {
  chosen = chosen.filter(x => moths.has(x.id) && canChoose(x)); if (!chosen.includes(r)) chosen.push(r);
  if (chosen.length >= 2) openPair(); else { openRoost(); toast('Chosen. Now choose another.'); }
}
function cardImage(r, w, glow) { const s = sprite(r, 240); if (!s) return null; const c = document.createElement('canvas'); c.width = 240; c.height = 150; const x = c.getContext('2d'); x.drawImage(s.img, 0, 0);
  if (glow && s.glow) { x.globalAlpha = .85; x.drawImage(s.glow, 0, 0); c.classList.add('glow'); } return c; }
function openPair() {
  closeAll(); $('pair').classList.add('open'); const box = $('pairs'); box.innerHTML = '';
  for (const r of chosen) { const d = document.createElement('div'); d.className = 'card big'; const c = cardImage(r, 240, false); if (c) d.appendChild(c); const p = document.createElement('p'); p.textContent = r.stage === 'visitor' ? 'A stranger' : label(r); d.appendChild(p); box.appendChild(d); }
}
$('pyes').onclick = () => { const [a, b] = chosen; chosen = []; closeAll(); if (!a || !b || !moths.has(a.id) || !moths.has(b.id)) return;
  const fa = flyer(a), fb = flyer(b); fa.x = -60; fb.x = W + 60; fa.y = fb.y = H * .5; fa.z = fb.z = 1; fa.sit = fb.sit = false; wedding = { a, b, t0: performance.now() / 1000 }; };
$('pno').onclick = () => { chosen = []; openRoost(); };
function openRoost() {
  closeAll(); $('roost').classList.add('open'); const t = now(), night = isNight(t);
  chosen = chosen.filter(x => moths.has(x.id) && canChoose(x));
  const card = (r, grid) => { const d = document.createElement('div'); d.className = 'card' + (chosen.includes(r) ? ' chosen' : ''); const c = cardImage(r, 240, night); if (c) d.appendChild(c); else { const ph = document.createElement('div'); ph.className = 'wait'; ph.textContent = 'still drying'; d.appendChild(ph); }
    const p = document.createElement('p'), left = r.stage === 'adult' ? r.t.dies - t : 0;
    p.innerHTML = (r.stage === 'visitor' ? 'A stranger' : label(r)) + '<br><span>' + (r.stage === 'visitor' ? 'gone by morning' : left < DAY ? 'its last night' : Math.round(left / DAY) + ' nights left') + (night && r.wed === nightKey(t) ? ', wed tonight' : '') + '</span>';
    d.appendChild(p); d.onclick = () => openView(r, 'roost'); grid.appendChild(d); };
  const vis = [...moths.values()].filter(r => r.stage === 'visitor'), mine = [...moths.values()].filter(r => r.stage === 'adult').sort((a, b) => a.t.dies - b.t.dies);
  $('strangers').innerHTML = ''; $('sh').hidden = !vis.length; vis.forEach(r => card(r, $('strangers')));
  $('roostgrid').innerHTML = ''; mine.forEach(r => card(r, $('roostgrid')));
  $('rnote').textContent = mine.length || vis.length ? (night ? (chosen.length ? 'One is chosen. Choose another.' : 'Choose two for the lamp.') : 'They rest until the lantern is lit at nine.') : 'No one rests here yet.';
}
function drawView() {
  if (!viewRec) return; const r = viewRec, t = performance.now() / 1000, w = vc.width, h = vc.height;
  vctx.clearRect(0, 0, w, h);
  if (r.stage === 'egg') { vctx.fillStyle = '#e9e1cc'; vctx.beginPath(); vctx.ellipse(w / 2, h / 2, 30, 40, 0, 0, 7); vctx.fill(); }
  else if (r.stage === 'larva') drawCaterpillar(vctx, w / 2, h / 2, 90, r, t);
  else if (r.stage === 'pupa' || r.stage === 'ready') drawCocoon(vctx, w / 2, h / 2, 90);
  else { const s = sprite(r); if (s) { const glow = isNight(now()) ? (s.ph.lumen ? .8 + .2 * Math.sin(t * 1.05) : 0) : 0;
      if (s.ph.mut === 'watcher') { if (!vcache.has(r.id)) vcache.set(r.id, {}); E.renderMoth(vctx, s.ph, s.fld, { cache: vcache.get(r.id), eyes: s.eyes, finger, glow, legs: true }); }
      else { vctx.drawImage(s.img, 0, 0, w, h); if (glow && s.glow) { vctx.globalAlpha = glow; vctx.drawImage(s.glow, 0, 0, w, h); vctx.globalAlpha = 1; } } } }
}
vc.addEventListener('pointermove', e => { const b = vc.getBoundingClientRect(); finger = [(e.clientX - b.left) / b.width * vc.width, (e.clientY - b.top) / b.height * vc.height]; });
vc.addEventListener('pointerdown', e => { const b = vc.getBoundingClientRect(); finger = [(e.clientX - b.left) / b.width * vc.width, (e.clientY - b.top) / b.height * vc.height]; });
(function viewLoop() { drawView(); requestAnimationFrame(viewLoop); })();
function pin(r, nm) {
  nm = nm || '';
  r.stage = 'pinned'; r.pinned = now(); if (nm.trim()) r.name = nm.trim().slice(0, 28);
  let i = M.cabinet.indexOf(null); if (i < 0) { i = M.cabinet.length; M.cabinet.push(null); } M.cabinet[i] = r.id;
  save(r); saveMeta(); closeAll(); toast('Pinned in the Cabinet.');
}
function release(r) { M.released.push(r.g); if (M.released.length > 30) M.released.shift(); saveMeta(); drop(r.id); closeAll(); toast('Released into the dark.'); }

/* ---------- eclosion: the cocoon splits, the moth climbs out, crumpled wings
   expand and dry while the pattern grows live ---------- */
const ec = $('ec'), ectx = ec.getContext('2d');
const MO = document.createElement('canvas'), WC = document.createElement('canvas'); MO.width = WC.width = 640; MO.height = WC.height = 400;
const mctx = MO.getContext('2d'), wctx = WC.getContext('2d');
function drawHusk(c, x, y, s, split, shake, t) {
  c.save(); c.translate(x + Math.sin(t * 38) * shake, y); c.rotate(Math.sin(t * 23) * shake * .02);
  c.strokeStyle = 'rgba(235,228,205,.5)'; c.lineWidth = 1; c.beginPath(); c.moveTo(0, -y - 10); c.lineTo(0, -s * 1.05); c.stroke();
  const g = c.createLinearGradient(-s * .5, 0, s * .5, 0); g.addColorStop(0, '#7f755c'); g.addColorStop(.45, '#ddd4bb'); g.addColorStop(1, '#6f644c');
  c.fillStyle = g; c.beginPath(); c.moveTo(0, -s * 1.05); c.bezierCurveTo(s * .62, -s * .7, s * .55, s * .7, s * .18 + split * s * .35, s * 1.05); c.lineTo(-s * .18 - split * s * .35, s * 1.05); c.bezierCurveTo(-s * .55, s * .7, -s * .62, -s * .7, 0, -s * 1.05); c.fill();
  c.strokeStyle = 'rgba(255,250,235,.25)'; c.lineWidth = .7; for (let k = 0; k < 12; k++) { const a = -s + k * s * .17; c.beginPath(); c.moveTo(-s * .45, a); c.quadraticCurveTo(0, a + s * .2, s * .45, a - s * .05); c.stroke(); }
  if (split > 0) { c.fillStyle = 'rgba(12,8,5,.9)'; c.beginPath(); c.ellipse(0, s * 1.0, s * (.12 + split * .3), s * .12 * split + 1, 0, 0, 7); c.fill();
    c.strokeStyle = 'rgba(30,20,12,.8)'; c.lineWidth = 1.2; c.beginPath(); c.moveTo(0, s * (1 - split * .9)); c.lineTo(s * .04, s * .7); c.lineTo(-s * .03, s * .45); c.stroke(); }
  c.restore();
}
function eclose(r) {
  closeAll(); $('ecl').classList.add('open'); $('et').textContent = 'The cocoon stirs.'; $('eok').hidden = true;
  $('ecl').querySelector('.btns').querySelectorAll('.x').forEach(q => q.remove());
  const ph = E.phenotype(r.g), G = new E.Grower(ph), cache = {}, per = Math.max(10, Math.round(ph.stop / 170)), t0 = performance.now() / 1000;
  let skip = false, eyes = null, frameN = 0, finished = 0, f = null; ec.onclick = () => { skip = true; };
  const K = .85, rootMO = 132, ease = p => 1 - Math.pow(1 - p, 3);
  (function grow() {
    if (!$('ecl').classList.contains('open') && finished) return;
    const t = performance.now() / 1000 - t0, w = ec.width, h = ec.height; frameN++;
    let done = G.steps >= G.stop;
    const growing = skip || t > 2.6;
    if (growing && !done) { done = G.step(skip ? 1e6 : G.gpu ? per : Math.min(per, 15)); }
    if (!finished && growing && (frameN % 3 === 0 || done || !f)) f = G.read();
    const p = growing ? ease(Math.min(1, G.steps / G.stop)) : 0;
    if (f && p > .55 && (frameN % 20 === 0 || done)) eyes = E.eyePeaks(f.R, f.n, ph.eyes);
    ectx.clearRect(0, 0, w, h);
    const bg = ectx.createRadialGradient(w / 2, h * .35, 10, w / 2, h * .4, w * .7); bg.addColorStop(0, 'rgba(70,52,32,.55)'); bg.addColorStop(1, 'rgba(0,0,0,0)'); ectx.fillStyle = bg; ectx.fillRect(0, 0, w, h);
    const shake = skip ? 0 : t < 1.4 ? Math.min(1, t / 1.4) * 2.2 : 0, split = skip ? 1 : Math.max(0, Math.min(1, (t - 1.0) / .5));
    const emerge = skip ? 1 : Math.max(0, Math.min(1, (t - 1.4) / 1.2)), thY = 56 + (150 - 56) * ease(emerge);
    if (emerge > 0) {
      const crumple = 1 - p, sx = .16 + .84 * p, sy = .3 + .7 * p;
      if (f) { E.renderMoth(mctx, ph, f, { cache, noBody: true, eyes, reveal: Math.max(0, Math.min(1, (G.steps - 120) / 450)) });
        wctx.clearRect(0, 0, 640, 400); const N = 44, hs = 400 / N;
        for (let i = 0; i < N; i++) { const k = .5 + .5 * Math.sin(i * .72 + 1), sxi = 1 - crumple * .38 * k, y0 = i * hs; wctx.drawImage(MO, 0, y0, 640, hs + 1, 320 - 320 * sxi, y0 + crumple * Math.sin(i * .5) * 4, 640 * sxi, hs + 1.5); }
        if (crumple > .02) { wctx.globalCompositeOperation = 'source-atop'; for (let i = 0; i < 44; i++) { const k = .5 + .5 * Math.sin(i * .72 + 1); wctx.fillStyle = k > .5 ? 'rgba(20,12,6,' + (crumple * .4 * (k - .5) * 2) + ')' : 'rgba(255,245,225,' + (crumple * .18 * (.5 - k) * 2) + ')'; wctx.fillRect(0, i * 400 / 44, 640, 400 / 44 + 1); } wctx.globalCompositeOperation = 'source-over'; }
        const flut = finished ? Math.max(0, 1 - (t - finished) / 1.4) : 0, fl = 1 - flut * .25 * (.5 + .5 * Math.sin((t - finished) * 22));
        ectx.save(); ectx.translate(w / 2, thY); ectx.scale(K * sx * fl, K * sy); ectx.translate(-320, -rootMO); ectx.globalAlpha = Math.min(1, emerge * 1.5); ectx.drawImage(WC, 0, 0); ectx.restore(); }
      ectx.save(); ectx.translate(w / 2, thY + .17 * 400 * K); ectx.scale(K, K); ectx.globalAlpha = Math.min(1, emerge * 2); E.drawBody(ectx, 640, 400, 1, emerge > .6); ectx.restore();
    }
    drawHusk(ectx, w / 2, 36, 28, split, shake, t);
    if (t > 1.0 && t < 2.6 && !skip) $('et').textContent = 'The cocoon splits.';
    else if (growing && !done) $('et').textContent = 'Its wings unfold and dry. Tap to hurry them.';
    if (done && !finished) {
      f = G.read(); f = { R: f.R.slice(), L: f.L ? f.L.slice() : null, n: f.n }; finished = t;
      r.n = f.n; r.fR = E.pack(f.R); r.fL = f.L ? E.pack(f.L) : null; G.free();
      r.regime = E.classify(f.R, f.n, ph.F); r.stage = 'adult'; const tn = now(); r.t.born = tn; r.t.dies = tn + ADULT;
      spr.forEach((_, k) => { if (k.startsWith(r.id + '@')) spr.delete(k); });
      eyes = E.eyePeaks(f.R, f.n, ph.eyes);
      const cell = Math.round(ph.fi) + ',' + Math.round(ph.ki); if (!M.atlas[cell]) { M.atlas[cell] = { regime: r.regime, id: r.id, fR: r.fR, n: r.n, g: r.g }; M.news = true; $('natl').classList.add('dot'); }
      save(r); saveMeta();
      $('et').textContent = r.regime; $('eok').hidden = false;
      const bx = $('ecl').querySelector('.btns');
      const inp = document.createElement('input'); inp.className = 'name x'; inp.placeholder = 'A name for its label (optional)'; inp.maxLength = 28; bx.prepend(inp);
      for (const [tx3, fn] of [['Pin it', () => pin(r, inp.value)], ['Release it', () => release(r)]]) { const q = document.createElement('button'); q.className = tx3 === 'Pin it' ? 'x primary' : 'x'; q.type = 'button'; q.textContent = tx3; q.onclick = fn; bx.appendChild(q); }
    }
    if (!finished || t - finished < 1.6) requestAnimationFrame(grow);
  })();
}
$('eok').addEventListener('click', closeAll);

/* ---------- Cabinet: wooden drawers under glass, specimens pinned on cream board ---------- */
let held = null, BOARD = null;
const ROMAN = n => { const m = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]; let s = ''; for (const [v, r] of m) while (n >= v) { s += r; n -= v; } return s; };
function boardTile() { if (BOARD) return BOARD; BOARD = document.createElement('canvas'); BOARD.width = 240; BOARD.height = 170; const x = BOARD.getContext('2d'), im = x.createImageData(240, 170), n = noise2('board');
  for (let y = 0; y < 170; y++) for (let xx = 0; xx < 240; xx++) { const v = .9 + fbm2(n, xx * .08, y * .08, 3) * .12 - .06, o = (y * 240 + xx) * 4; im.data[o] = 232 * v; im.data[o + 1] = 223 * v; im.data[o + 2] = 202 * v; im.data[o + 3] = 255; }
  x.putImageData(im, 0, 0); const g = x.createRadialGradient(120, 85, 40, 120, 85, 150); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(60,40,20,.25)'); x.fillStyle = g; x.fillRect(0, 0, 240, 170); return BOARD; }
function specimen(rec, night) {
  const s = sprite(rec, 240), c = document.createElement('canvas'); c.width = 240; c.height = 170; const x = c.getContext('2d');
  x.drawImage(boardTile(), 0, 0);
  if (s) { x.save(); x.shadowColor = 'rgba(40,25,10,.45)'; x.shadowBlur = 7; x.shadowOffsetX = 3; x.shadowOffsetY = 5; x.drawImage(s.img, 0, 10, 240, 150); x.restore();
    if (night && s.glow) { x.globalAlpha = .5; x.drawImage(s.glow, 0, 10, 240, 150); x.globalAlpha = 1; c.classList.add('glow'); }
    const px = 120, py = 10 + 150 * .33; x.strokeStyle = 'rgba(30,20,10,.35)'; x.lineWidth = 1; x.beginPath(); x.moveTo(px + 1, py + 1); x.lineTo(px + 7, py + 9); x.stroke();
    const g = x.createRadialGradient(px - 1, py - 1.2, .3, px, py, 3.2); g.addColorStop(0, '#9a9a9a'); g.addColorStop(.45, '#1a1a1a'); g.addColorStop(1, '#000'); x.fillStyle = g; x.beginPath(); x.arc(px, py, 3.1, 0, 7); x.fill(); }
  return c;
}
function openCabinet() {
  closeAll(); $('cab').classList.add('open'); held = null;
  while (M.cabinet.length && M.cabinet[M.cabinet.length - 1] === null) M.cabinet.pop();
  const box = $('drawers'); box.innerHTML = ''; const night = isNight(now()), total = Math.max(6, Math.ceil((M.cabinet.length + 1) / 6) * 6);
  for (let d = 0; d < total / 6; d++) {
    const dr = document.createElement('div'); dr.className = 'drawer'; const pl = document.createElement('div'); pl.className = 'plaque'; pl.textContent = 'No. ' + ROMAN(d + 1); dr.appendChild(pl);
    const tray = document.createElement('div'); tray.className = 'tray'; dr.appendChild(tray); let letters = '';
    for (let k = 0; k < 6; k++) {
      const i = d * 6 + k, id = M.cabinet[i], rec = id && moths.get(id), slot = document.createElement('div'); slot.className = 'slot' + (rec ? '' : ' empty');
      if (rec) { slot.appendChild(specimen(rec, night));
        const lb = document.createElement('p'); lb.className = 'slip'; lb.innerHTML = (rec.name ? '<b>' + rec.name.replace(/[<&]/g, '') + '</b><br>' : '') + (rec.regime || '') + '<br><i>' + fmtDate(rec.pinned) + '</i>'; slot.appendChild(lb);
        letters += rec.g.letter || '·'; } else letters += '·';
      let timer = null;
      slot.addEventListener('pointerdown', () => { timer = setTimeout(() => { timer = null; if (rec) { held = i; slot.classList.add('held'); toast('Now tap the place to move it to.'); } }, 500); });
      slot.addEventListener('pointerup', () => { if (timer) { clearTimeout(timer); timer = null;
          if (held !== null && held !== i) { const a = M.cabinet[held]; while (M.cabinet.length <= i) M.cabinet.push(null); M.cabinet[held] = M.cabinet[i] || null; M.cabinet[i] = a; saveMeta(); openCabinet(); }
          else if (held === null && rec) openView(rec); } });
      slot.addEventListener('contextmenu', e => e.preventDefault());
      tray.appendChild(slot);
    }
    const word = P.scriptWords.find(w => letters.includes(w));
    if (word) { const wd = document.createElement('div'); wd.className = 'word'; wd.textContent = word; dr.appendChild(wd); }
    box.appendChild(dr);
  }
  if (M.scales.length) { const sc = document.createElement('p'); sc.className = 'scales'; sc.textContent = M.scales.length === 1 ? 'In the corner of the last drawer, a singed scale.' : 'In the corner of the last drawer, ' + M.scales.length + ' singed scales.'; box.appendChild(sc); }
}

/* ---------- Atlas: an aged chart; regions ink in as she discovers them ---------- */
const ac = $('ac'), actx = ac.getContext('2d'); let apins = [], PAPER = null;
function paper(S) { if (PAPER && PAPER.width === S) return PAPER; PAPER = document.createElement('canvas'); PAPER.width = PAPER.height = S; const x = PAPER.getContext('2d'), sc = 2, w = S / sc, im = x.createImageData(w, w), n = noise2('paper'), f = noise2('fox');
  for (let y = 0; y < w; y++) for (let xx = 0; xx < w; xx++) { const v = fbm2(n, xx * .03, y * .03, 5), e = Math.min(xx, y, w - xx, w - y) / w, edge = Math.max(0, .12 - e) * 4, fox = Math.max(0, fbm2(f, xx * .09, y * .09, 3) - .66) * 3;
    const k = .93 + (v - .5) * .14 - edge * .5 - fox * .35, o = (y * w + xx) * 4; im.data[o] = 236 * k; im.data[o + 1] = 222 * k - edge * 10; im.data[o + 2] = 190 * k - edge * 25; im.data[o + 3] = 255; }
  const t = document.createElement('canvas'); t.width = t.height = w; t.getContext('2d').putImageData(im, 0, 0); x.imageSmoothingEnabled = true; x.drawImage(t, 0, 0, S, S);
  x.strokeStyle = 'rgba(90,65,35,.18)'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(S / 2, 0); x.lineTo(S / 2, S); x.moveTo(0, S / 2); x.lineTo(S, S / 2); x.stroke();
  x.strokeStyle = 'rgba(255,250,235,.25)'; x.lineWidth = 1; x.beginPath(); x.moveTo(S / 2 + 1.5, 0); x.lineTo(S / 2 + 1.5, S); x.moveTo(0, S / 2 + 1.5); x.lineTo(S, S / 2 + 1.5); x.stroke();
  x.strokeStyle = 'rgba(60,40,20,.75)'; x.lineWidth = 2; x.strokeRect(14, 14, S - 28, S - 28); x.lineWidth = .8; x.strokeRect(20, 20, S - 40, S - 40);
  x.strokeStyle = 'rgba(60,40,20,.13)'; x.lineWidth = .6; for (let i = 1; i < 10; i++) { const p = 20 + (S - 40) * i / 10; x.beginPath(); x.moveTo(p, 20); x.lineTo(p, S - 20); x.moveTo(20, p); x.lineTo(S - 20, p); x.stroke(); }
  const cx = S - 62, cy = S - 62; x.fillStyle = 'rgba(60,40,20,.55)'; x.strokeStyle = 'rgba(60,40,20,.55)'; x.lineWidth = .8;
  for (let a = 0; a < 4; a++) { const an = a * Math.PI / 2; x.beginPath(); x.moveTo(cx + Math.cos(an) * 30, cy + Math.sin(an) * 30); x.lineTo(cx + Math.cos(an + .3) * 7, cy + Math.sin(an + .3) * 7); x.lineTo(cx + Math.cos(an - .3) * 7, cy + Math.sin(an - .3) * 7); x.closePath(); a % 2 ? x.stroke() : x.fill(); }
  x.beginPath(); x.arc(cx, cy, 12, 0, 7); x.stroke();
  return PAPER; }
function openAtlas() {
  closeAll(); $('atl').classList.add('open'); M.news = false; $('natl').classList.remove('dot'); saveMeta();
  const S = ac.width, m0 = 24, span = S - 48, N = 20, cs = span / N, cx = ki => m0 + (ki + .5) * cs, cy = fi => m0 + span - (fi + .5) * cs;
  actx.drawImage(paper(S), 0, 0);
  const groups = {}, placed = [];
  for (const key in M.atlas) { const c = M.atlas[key], [fi, ki] = key.split(',').map(Number); (groups[c.regime] = groups[c.regime] || { cells: [], c }).cells.push([cx(ki), cy(fi)]); }
  for (const name in groups) {
    const gr = groups[name], ph = E.phenotype(gr.c.g), B = E.unpack(gr.c.fR), n = gr.c.n;
    const tile = document.createElement('canvas'); tile.width = tile.height = 48; const tx2 = tile.getContext('2d'), im = tx2.createImageData(48, 48);
    for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) { const b = B[Math.floor((y / 48 * .5 + .2) * n) * n + Math.floor((x / 48 * .5 + .35) * n)]; let t = Math.max(0, Math.min(1, (b - .07) / .22)); const o = (y * 48 + x) * 4; im.data[o] = 70; im.data[o + 1] = 45; im.data[o + 2] = 22; im.data[o + 3] = 40 + t * 190; }
    tx2.putImageData(im, 0, 0);
    const lo = document.createElement('canvas'), q = 8; lo.width = lo.height = Math.ceil(S / q); const lx = lo.getContext('2d'), jr = E.rng(name);
    lx.fillStyle = '#000'; for (const [x, y] of gr.cells) for (let j = 0; j < 4; j++) { lx.beginPath(); lx.arc((x + (jr() - .5) * cs * .6) / q, (y + (jr() - .5) * cs * .6) / q, cs * (.55 + jr() * .3) / q, 0, 7); lx.fill(); }
    const mask = document.createElement('canvas'); mask.width = mask.height = S; const mx = mask.getContext('2d'); mx.imageSmoothingEnabled = true; mx.imageSmoothingQuality = 'high'; mx.drawImage(lo, 0, 0, S, S);
    mx.globalCompositeOperation = 'source-in'; mx.fillStyle = mx.createPattern(tile, 'repeat'); mx.fillRect(0, 0, S, S);
    mx.globalCompositeOperation = 'destination-over'; mx.globalAlpha = .35; mx.drawImage(lo, 0, 0, S, S); mx.globalAlpha = 1;
    actx.save(); actx.globalCompositeOperation = 'multiply'; actx.drawImage(mask, 0, 0); actx.restore();
    const pts = gr.cells, mx2 = pts.reduce((a, p) => a + p[0], 0) / pts.length, my2 = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    actx.font = 'italic ' + Math.round(S / 24) + 'px "IM Fell English", Georgia, serif'; actx.textAlign = 'center'; actx.textBaseline = 'middle';
    const tw = actx.measureText(name).width, th = S / 24; let ly = my2 - cs * 1.2;
    for (let k = 0; k < 6 && placed.some(p => Math.abs(p[0] - mx2) < (p[2] + tw) / 2 + 4 && Math.abs(p[1] - ly) < th); k++) ly += th * 1.05;
    placed.push([mx2, ly, tw]);
    actx.lineWidth = 4; actx.strokeStyle = 'rgba(236,224,194,.9)'; actx.strokeText(name, mx2, ly); actx.fillStyle = '#3a2614'; actx.fillText(name, mx2, ly);
  }
  if (!Object.keys(groups).length) { actx.font = 'italic ' + Math.round(S / 26) + 'px "IM Fell English", Georgia, serif'; actx.textAlign = 'center'; actx.fillStyle = 'rgba(58,38,20,.55)'; actx.fillText('Terra incognita', S / 2, S / 2); }
  apins = [];
  for (const m of moths.values()) { if (!m.parents || m.stage === 'egg' || m.stage === 'larva' || m.stage === 'pupa' || m.stage === 'ready') continue; const ph = E.phenotype(m.g), x = cx(ph.ki), y = cy(ph.fi);
    actx.strokeStyle = 'rgba(30,20,10,.35)'; actx.lineWidth = 1; actx.beginPath(); actx.moveTo(x + 1, y + 1); actx.lineTo(x + 5, y + 6); actx.stroke();
    const g = actx.createRadialGradient(x - 1, y - 1, .3, x, y, 4); g.addColorStop(0, '#e46a52'); g.addColorStop(.6, '#8a1f12'); g.addColorStop(1, '#3a0a04'); actx.fillStyle = g; actx.beginPath(); actx.arc(x, y, 3.6, 0, 7); actx.fill(); apins.push({ x, y, m }); }
}
ac.addEventListener('click', e => { const b = ac.getBoundingClientRect(), x = (e.clientX - b.left) / b.width * ac.width, y = (e.clientY - b.top) / b.height * ac.height;
  let best = null, bd = ac.width / 28; for (const p of apins) { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = p; } } if (best) { openView(best.m); return; }
  const span = ac.width - 48, cs = span / 20, ki = Math.floor((x - 24) / cs), fi = Math.floor((24 + span - y) / cs);
  let hit = null; for (let dfi = -1; dfi <= 1 && !hit; dfi++) for (let dki = -1; dki <= 1 && !hit; dki++) hit = M.atlas[(fi + dfi) + ',' + (ki + dki)] || null; if (!hit) return;
  const pool = [...moths.values()].filter(m => m.regime === hit.regime && (m.stage === 'pinned' || m.stage === 'adult')); pool.sort((a, b) => (b.stage === 'pinned') - (a.stage === 'pinned'));
  if (pool.length) openView(pool[0]); else toast('None of these left.'); });

/* ---------- nav, toast, test panel ---------- */
if (/\/lanternwings\/?(index\.html)?$/.test(location.pathname)) { $('ngarden').hidden = false; $('ngarden').onclick = () => { location.href = '../'; }; }
$('nlamp').onclick = closeAll; $('nroost').onclick = openRoost; $('ncab').onclick = openCabinet; $('natl').onclick = openAtlas;
let tt = null; function toast(s) { const t = $('toast'); t.textContent = s; t.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), 3200); }
if (TEST) {
  $('test').hidden = false;
  const at = h => { const d = new Date(now()); d.setHours(h, 0, 0, 0); setClock(d.getTime()); tick(); };
  $('tnight').onclick = () => at(22); $('tday').onclick = () => at(12);
  $('t1').onclick = () => setClock(now(), 1); $('t60').onclick = () => setClock(now(), 60); $('t600').onclick = () => setClock(now(), 600);
  $('th').onclick = () => { setClock(now() + HOUR); tick(); }; $('td').onclick = () => { setClock(now() + 12 * HOUR); tick(); };
  $('tvis').onclick = () => { if (!isNight(now())) { toast('Visitors come only at night.'); return; } ensureVisitors(now(), Date.now().toString(36)); tick(); };
  $('thatch').onclick = () => { const t = now(); for (const r of moths.values()) if (r.t && ['egg', 'larva', 'pupa'].includes(r.stage)) { r.t.hatch = Math.min(r.t.hatch, t); r.t.pupa = Math.min(r.t.pupa, t); r.t.eclose = Math.min(r.t.eclose, t); save(r); } tick(); tick(); tick(); };
  let armed = false; $('treset').onclick = async () => { if (!armed) { armed = true; $('treset').textContent = 'Tap again: erase all'; setTimeout(() => { armed = false; $('treset').textContent = 'Reset'; }, 3000); return; } if (db) { await tx('moths', 'readwrite', s => s.clear()); await tx('meta', 'readwrite', s => s.clear()); } localStorage.removeItem('lantern_clock'); location.reload(); };
}

/* ---------- start ---------- */
(async function start() {
  resize(); await load(); tick(); setInterval(tick, 1000);
  for (const r of moths.values()) if (r.stage !== 'egg' && !r.fR) needField(r);
  if (M.news) $('natl').classList.add('dot');
  requestAnimationFrame(frame);
  setTimeout(() => $('title').classList.add('fade'), 6000);
})();
})();
