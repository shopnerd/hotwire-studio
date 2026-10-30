/* Hotwire Studio — canvas views. Side view (X/Y, looking along the wire) and a simple 3D view. */
(function (root) {
'use strict';

const C = {
  ink: '#1f2328', ink2: '#4a5058', muted: '#9aa0a8', rule: '#e4e0d8', rule2: '#d2cdc2',
  left: '#1f6fb2', right: '#d9480f', wire: '#c92a2a', part: 'rgba(154,153,147,0.22)', partLine: '#8d8c86',
  block: 'rgba(240, 200, 120, 0.16)', blockLine: '#d8c39a', loaded: '#6741d9',
};

function fitCanvas(cv) {
  const dpr = window.devicePixelRatio || 1, r = cv.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: r.width, h: r.height };
}

function poly(ctx, pts, map) {
  if (!pts || !pts.length) return;
  ctx.beginPath();
  pts.forEach((p, i) => { const q = map(p); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); });
}

function bounds(list) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of list) { if (!p) continue; minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  return { minX, minY, maxX, maxY };
}

/* ── Side view ─────────────────────────────────────────── */
function SideView(cv, onChange) {
  this.cv = cv; this.scene = null; this.view = null; this.onChange = onChange;
  let drag = null;
  cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => {
    if (!drag || !this.view) return;
    this.view.ox += e.clientX - drag.x; this.view.oy += e.clientY - drag.y;
    drag = { x: e.clientX, y: e.clientY }; this.draw();
  });
  cv.addEventListener('pointerup', () => { drag = null; });
  cv.addEventListener('wheel', e => {
    e.preventDefault(); if (!this.view) return;
    const r = cv.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const k = Math.exp(-e.deltaY * 0.0015);
    this.view.ox = mx - (mx - this.view.ox) * k; this.view.oy = my - (my - this.view.oy) * k; this.view.s *= k;
    this.draw();
  }, { passive: false });
}
SideView.prototype.set = function (scene, refit) { this.scene = scene; if (refit || !this.view) this.view = null; this.draw(); };
SideView.prototype.fit = function () { this.view = null; this.draw(); };
SideView.prototype.draw = function () {
  const { ctx, w, h } = fitCanvas(this.cv);
  ctx.clearRect(0, 0, w, h);
  const S = this.scene; if (!S) return;
  const pts = [[0, 0]].concat(S.towersL, S.towersR, S.faceL, S.faceR);
  if (S.block) pts.push([S.block.x1, S.block.y1]);
  const b = bounds(pts);
  if (!this.view) {
    const pad = 28, bw = Math.max(1, b.maxX - b.minX), bh = Math.max(1, b.maxY - b.minY);
    const s = Math.min((w - 2 * pad) / bw, (h - 2 * pad) / bh);
    this.view = { s, ox: (w - bw * s) / 2 - b.minX * s, oy: h - (h - bh * s) / 2 + b.minY * s };
  }
  const V = this.view, map = p => [V.ox + p[0] * V.s, V.oy - p[1] * V.s];

  // grid
  const step = V.s > 4 ? 10 : V.s > 0.8 ? 50 : 100;
  const x0 = Math.floor((-V.ox) / V.s / step) * step, x1 = (w - V.ox) / V.s;
  const y0 = Math.floor((V.oy - h) / V.s / step) * step, y1 = V.oy / V.s;
  ctx.lineWidth = 1;
  for (let x = x0; x <= x1; x += step) { const q = map([x, 0]); ctx.strokeStyle = x % (step * 5) === 0 ? C.rule2 : C.rule; ctx.beginPath(); ctx.moveTo(q[0], 0); ctx.lineTo(q[0], h); ctx.stroke(); }
  for (let y = y0; y <= y1; y += step) { const q = map([0, y]); ctx.strokeStyle = y % (step * 5) === 0 ? C.rule2 : C.rule; ctx.beginPath(); ctx.moveTo(0, q[1]); ctx.lineTo(w, q[1]); ctx.stroke(); }
  // table + zero
  const z = map([0, 0]);
  ctx.strokeStyle = C.ink2; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, z[1]); ctx.lineTo(w, z[1]); ctx.stroke();
  ctx.fillStyle = C.ink2; ctx.font = '11px IBM Plex Sans, sans-serif'; ctx.fillText('table', 6, z[1] + 13);
  ctx.beginPath(); ctx.arc(z[0], z[1], 4, 0, 7); ctx.stroke(); ctx.fillText('0', z[0] - 12, z[1] - 6);

  if (S.block) {
    const a = map([S.block.x0, S.block.y0]), c = map([S.block.x1, S.block.y1]);
    ctx.fillStyle = C.block; ctx.fillRect(a[0], c[1], c[0] - a[0], a[1] - c[1]);
    ctx.strokeStyle = C.blockLine; ctx.lineWidth = 1; ctx.strokeRect(a[0], c[1], c[0] - a[0], a[1] - c[1]);
  }
  if (S.partL) {
    for (const P of [S.partL, S.partR]) { poly(ctx, P, map); ctx.closePath(); ctx.fillStyle = C.part; ctx.fill(); ctx.strokeStyle = C.partLine; ctx.lineWidth = 1; ctx.stroke(); }
    // pairing ticks: which point on the left face cuts with which on the right
    ctx.strokeStyle = 'rgba(80,80,80,0.25)'; ctx.lineWidth = 0.75;
    const n = S.partL.length, every = Math.max(1, Math.round(n / 40));
    for (let i = 0; i < n; i += every) { const a = map(S.partL[i]), c = map(S.partR[i]); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.stroke(); }
  }
  // tower paths (dashed), face cuts (solid)
  ctx.setLineDash([5, 4]); ctx.lineWidth = 1.2;
  poly(ctx, S.towersL, map); ctx.strokeStyle = C.left; ctx.stroke();
  poly(ctx, S.towersR, map); ctx.strokeStyle = C.right; ctx.stroke();
  ctx.setLineDash([]); ctx.lineWidth = 1.6;
  poly(ctx, S.faceL, map); ctx.strokeStyle = C.left; ctx.stroke();
  poly(ctx, S.faceR, map); ctx.strokeStyle = C.right; ctx.stroke();
  // start point
  if (S.faceL.length) { const q = map(S.faceL[0]); ctx.fillStyle = C.ink; ctx.beginPath(); ctx.arc(q[0], q[1], 3.5, 0, 7); ctx.fill(); ctx.fillText('start', q[0] + 6, q[1] - 5); }
  // wire now
  if (S.cur) {
    const a = map(S.cur.L), c = map(S.cur.R), fa = map(S.cur.fL), fc = map(S.cur.fR);
    ctx.strokeStyle = C.wire; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.stroke();
    for (const [q, col, r] of [[a, C.left, 4], [c, C.right, 4], [fa, C.wire, 3.5], [fc, C.wire, 3.5]]) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(q[0], q[1], r, 0, 7); ctx.fill(); }
  }
  // scale bar
  const target = 100 / V.s, nice = [1, 2, 5, 10, 20, 50, 100, 200, 500].find(v => v >= target * 0.5) || 500;
  const L = nice * V.s;
  ctx.strokeStyle = C.ink2; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(w - 16 - L, h - 14); ctx.lineTo(w - 16, h - 14); ctx.stroke();
  ctx.fillStyle = C.ink2; ctx.fillText(nice + ' mm', w - 16 - L, h - 19);
};

/* ── 3D view ───────────────────────────────────────────── */
const PRESETS = { iso: [-35, 28], top: [0, 89.9], front: [0, 0], side: [-90, 0] };
function View3D(cv) {
  this.cv = cv; this.scene = null; this.yaw = PRESETS.iso[0]; this.pitch = PRESETS.iso[1]; this.zoom = 1; this.pan = [0, 0];
  let drag = null;
  cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, shift: e.shiftKey || e.button === 1 }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
    if (drag.shift) { this.pan[0] += dx; this.pan[1] += dy; }
    else { this.yaw += dx * 0.4; this.pitch = Math.max(-89.9, Math.min(89.9, this.pitch + dy * 0.4)); }
    this.draw();
  });
  cv.addEventListener('pointerup', () => { drag = null; });
  cv.addEventListener('wheel', e => { e.preventDefault(); this.zoom *= Math.exp(-e.deltaY * 0.0015); this.draw(); }, { passive: false });
}
View3D.prototype.preset = function (k) { [this.yaw, this.pitch] = PRESETS[k]; this.zoom = 1; this.pan = [0, 0]; this.draw(); };
View3D.prototype.set = function (scene) { this.scene = scene; this.draw(); };
View3D.prototype.draw = function () {
  const { ctx, w, h } = fitCanvas(this.cv);
  ctx.clearRect(0, 0, w, h);
  const S = this.scene; if (!S) return;
  const W = S.W, cy = Math.cos(this.yaw * Math.PI / 180), sy = Math.sin(this.yaw * Math.PI / 180);
  const cp = Math.cos(this.pitch * Math.PI / 180), sp = Math.sin(this.pitch * Math.PI / 180);
  // world: s (span, left->right), x (front->back), y (up). Camera looks from the front, operator side.
  const raw = (s, x, y) => { const sx = s - W / 2; const px = sx * cy + x * sy, d = -sx * sy + x * cy; return [px, y * cp + d * sp]; };
  const ext = bounds(S.towersL.concat(S.towersR, [[0, 0]], S.block ? [[S.block.x1, S.block.y1]] : []));
  const xMax = Math.max(ext.maxX, 50), yMax = Math.max(ext.maxY, 50);
  const corners = [];
  for (const s of [0, W]) for (const x of [Math.min(0, ext.minX), xMax]) for (const y of [0, yMax]) corners.push(raw(s, x, y));
  const b = bounds(corners), pad = 24;
  const sc = Math.min((w - 2 * pad) / Math.max(1, b.maxX - b.minX), (h - 2 * pad) / Math.max(1, b.maxY - b.minY)) * this.zoom;
  const cxs = w / 2 - (b.minX + b.maxX) / 2 * sc + this.pan[0], cys = h / 2 + (b.minY + b.maxY) / 2 * sc + this.pan[1];
  const P = (s, x, y) => { const r = raw(s, x, y); return [cxs + r[0] * sc, cys - r[1] * sc]; };
  const line = (pts, col, lw, dash) => { ctx.beginPath(); pts.forEach((p, i) => { const q = P(p[0], p[1], p[2]); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }); ctx.strokeStyle = col; ctx.lineWidth = lw || 1; ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]); };

  // table outline + rails
  const tx0 = Math.min(0, ext.minX);
  line([[0, tx0, 0], [W, tx0, 0], [W, xMax, 0], [0, xMax, 0], [0, tx0, 0]], C.rule2, 1);
  line([[0, tx0, 0], [0, xMax, 0]], C.ink2, 2); line([[W, tx0, 0], [W, xMax, 0]], C.ink2, 2);
  // block
  if (S.block) {
    const B = S.block, v = [];
    for (const s of [B.s0, B.s1]) for (const x of [B.x0, B.x1]) for (const y of [B.y0, B.y1]) v.push([s, x, y]);
    const E = [[0, 1], [0, 2], [1, 3], [2, 3], [4, 5], [4, 6], [5, 7], [6, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    for (const [a, c] of E) line([v[a], v[c]], C.blockLine, 1);
  }
  // part: faces + ruled lines
  if (S.partL) {
    const n = S.partL.length, every = Math.max(1, Math.round(n / 60));
    for (let i = 0; i < n; i += every) line([[S.sL, ...S.partL[i]], [S.sR, ...S.partR[i]]], 'rgba(141,140,134,0.45)', 0.8);
    line(S.partL.map(p => [S.sL, p[0], p[1]]), C.left, 1.4);
    line(S.partR.map(p => [S.sR, p[0], p[1]]), C.right, 1.4);
  } else {
    line(S.faceL.map(p => [S.sL, p[0], p[1]]), C.left, 1.2);
    line(S.faceR.map(p => [S.sR, p[0], p[1]]), C.right, 1.2);
  }
  // tower paths
  line(S.towersL.map(p => [0, p[0], p[1]]), C.left, 1, [4, 3]);
  line(S.towersR.map(p => [W, p[0], p[1]]), C.right, 1, [4, 3]);
  // towers + wire now
  if (S.cur) {
    const top = yMax * 1.08;
    line([[0, S.cur.L[0], 0], [0, S.cur.L[0], top]], C.ink, 3);
    line([[W, S.cur.R[0], 0], [W, S.cur.R[0], top]], C.ink, 3);
    line([[0, S.cur.L[0], S.cur.L[1]], [W, S.cur.R[0], S.cur.R[1]]], C.wire, 1.8);
  }
  ctx.fillStyle = C.ink2; ctx.font = '11px IBM Plex Sans, sans-serif';
  const lq = P(0, tx0, 0), rq = P(W, tx0, 0);
  ctx.fillText('X/Y', lq[0] - 10, lq[1] + 14); ctx.fillText('A/Z', rq[0] - 10, rq[1] + 14);
};

root.HWViews = { SideView, View3D };
})(this);
