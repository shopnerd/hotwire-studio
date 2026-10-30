/* Hotwire Studio — profile geometry.
   Profile space: x runs leading edge (left) -> trailing edge (right), y up, mm.
   A "ring" is a closed loop stored without the repeated last point,
   counter-clockwise, starting at the trailing edge (max x). */
(function (root) {
'use strict';
const G = {};

G.dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

G.bbox = function (pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
};

G.signedArea = function (ring) {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i], q = ring[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
};

G.length = function (pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += G.dist(pts[i - 1], pts[i]);
  return L;
};

/* ── sources ─────────────────────────────────────────────── */

// NACA 4-digit, closed trailing edge, chord 1, Selig order (TE upper -> LE -> TE lower).
G.naca4 = function (code, n) {
  n = n || 100;
  const s = String(code).trim();
  if (!/^\d{4}$/.test(s)) throw new Error('NACA code must be 4 digits, e.g. 2412');
  const m = +s[0] / 100, p = +s[1] / 10, t = +s.slice(2) / 100;
  if (t <= 0) throw new Error('NACA thickness (last two digits) must be above 00');
  const upper = [], lower = [];
  for (let i = 0; i <= n; i++) {
    const x = (1 - Math.cos(Math.PI * i / n)) / 2;
    const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.1260 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    let yc = 0, dyc = 0;
    if (m > 0 && p > 0) {
      if (x < p) { yc = m / (p * p) * (2 * p * x - x * x); dyc = 2 * m / (p * p) * (p - x); }
      else { yc = m / ((1 - p) ** 2) * ((1 - 2 * p) + 2 * p * x - x * x); dyc = 2 * m / ((1 - p) ** 2) * (p - x); }
    }
    const th = Math.atan(dyc);
    upper.push([x - yt * Math.sin(th), yc + yt * Math.cos(th)]);
    lower.push([x + yt * Math.sin(th), yc - yt * Math.cos(th)]);
  }
  return { name: 'NACA ' + s, pts: upper.reverse().concat(lower.slice(1)) };
};

// Airfoil .dat, Selig (one loop) or Lednicer (counts line, upper then lower, both LE -> TE).
G.parseDat = function (text, fallbackName) {
  let name = fallbackName || 'Airfoil';
  const nums = [];
  for (const ln of String(text).split(/\r?\n/)) {
    const parts = ln.trim().split(/[\s,]+/).filter(Boolean);
    if (parts.length >= 2 && parts.slice(0, 2).every(v => v !== '' && isFinite(+v))) nums.push([+parts[0], +parts[1]]);
    else if (!nums.length && ln.trim()) name = ln.trim();
  }
  if (nums.length < 4) throw new Error('No coordinate list found in the .dat file');
  let pts = nums;
  if (nums[0][0] > 1.5 && nums[0][1] > 1.5) {
    const nu = Math.round(nums[0][0]), nl = Math.round(nums[0][1]);
    const up = nums.slice(1, 1 + nu), lo = nums.slice(1 + nu, 1 + nu + nl);
    if (lo.length && up.length && G.dist(lo[0], up[0]) < 1e-9) lo.shift();
    pts = up.slice().reverse().concat(lo);
  }
  return { name, pts };
};

/* ── loops ───────────────────────────────────────────────── */

/* Any point list -> clean CCW ring.
   start: 'te'    = trailing edge (max x, upper corner on a blunt TE) — airfoils
          'first' = the source's own first point (DXF drawing order, what DevFoam does)
          'topleft' = point nearest the bounding box top-left corner */
G.normalizeLoop = function (pts, start) {
  if (!pts || pts.length < 3) throw new Error('Profile needs at least 3 points');
  const bb = G.bbox(pts);
  const tol = Math.max(bb.w, bb.h) * 1e-7;
  let ring = [];
  for (const p of pts) {
    if (!ring.length || G.dist(ring[ring.length - 1], p) > tol) ring.push([p[0], p[1]]);
  }
  while (ring.length > 1 && G.dist(ring[0], ring[ring.length - 1]) <= tol) ring.pop();
  if (ring.length < 3) throw new Error('Profile collapsed to fewer than 3 points');
  if (G.signedArea(ring) < 0) ring = [ring[0]].concat(ring.slice(1).reverse()); // keep first point first
  let k = 0;
  if (start === 'topleft') {
    let best = Infinity;
    ring.forEach((p, i) => { const d = Math.hypot(p[0] - bb.minX, p[1] - bb.maxY); if (d < best - 1e-9) { best = d; k = i; } });
  } else if (start !== 'first') {
    const xTol = bb.w * 1e-4;
    for (let i = 1; i < ring.length; i++) {
      const p = ring[i], s = ring[k];
      if (p[0] > s[0] + xTol || (Math.abs(p[0] - s[0]) <= xTol && p[1] > s[1])) k = i;
    }
  }
  return ring.slice(k).concat(ring.slice(0, k));
};

G.argMinX = function (ring) {
  let k = 0;
  for (let i = 1; i < ring.length; i++) if (ring[i][0] < ring[k][0]) k = i;
  return k;
};

// Sharp vertices (turn > deg), excluding the given indices.
G.corners = function (ring, deg, exclude) {
  const lim = deg * Math.PI / 180, out = [], n = ring.length;
  for (let i = 0; i < n; i++) {
    if (exclude.includes(i)) continue;
    const a = ring[(i - 1 + n) % n], b = ring[i], c = ring[(i + 1) % n];
    const t1 = Math.atan2(b[1] - a[1], b[0] - a[0]), t2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
    let d = Math.abs(t2 - t1); if (d > Math.PI) d = 2 * Math.PI - d;
    if (d > lim) out.push(i);
  }
  return out;
};

// Uniform-by-arc-length points along an open polyline: c intervals, returns c points (last endpoint excluded).
G.resample = function (poly, c) {
  const cum = [0];
  for (let i = 1; i < poly.length; i++) cum.push(cum[i - 1] + G.dist(poly[i - 1], poly[i]));
  const L = cum[cum.length - 1], out = [];
  let j = 1;
  for (let k = 0; k < c; k++) {
    const target = L * k / c;
    while (j < poly.length - 1 && cum[j] < target) j++;
    const seg = cum[j] - cum[j - 1], t = seg > 0 ? (target - cum[j - 1]) / seg : 0;
    const a = poly[j - 1], b = poly[j];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
};

function segment(ring, i, j) { // i..j inclusive, j may equal ring.length (= wrap to start)
  const s = ring.slice(i, Math.min(j, ring.length - 1) + 1);
  if (j >= ring.length) s.push(ring[0]);
  return s;
}

/* Make two rings point-for-point compatible for a tapered cut.
   Sync points: the start point, LE (min x), plus corners (turn > cornerDeg) when both faces
   have the same count on each side. Points are spaced about `spacing` mm along the longer face.
   Returns closed polylines (first point repeated at the end) of equal length. */
G.syncPair = function (ra, rb, spacing, cornerDeg) {
  spacing = spacing > 0 ? spacing : 1;
  const anchorsFor = (ring) => {
    let le = 1; // leftmost point other than the start
    for (let i = 2; i < ring.length; i++) if (ring[i][0] < ring[le][0]) le = i;
    const cs = G.corners(ring, cornerDeg || 10, [0, le]);
    return { le, up: cs.filter(i => i < le), lo: cs.filter(i => i > le) };
  };
  const A = anchorsFor(ra), B = anchorsFor(rb);
  const useUp = A.up.length === B.up.length, useLo = A.lo.length === B.lo.length;
  const list = (X, ring) => [0].concat(useUp ? X.up : [], [X.le], useLo ? X.lo : [], [ring.length]);
  const la = list(A, ra), lb = list(B, rb);
  const segA = [], segB = [];
  for (let k = 0; k < la.length - 1; k++) {
    segA.push(segment(ra, la[k], la[k + 1]));
    segB.push(segment(rb, lb[k], lb[k + 1]));
  }
  const lenA = segA.map(G.length), lenB = segB.map(G.length);
  const a = [], b = [];
  for (let k = 0; k < segA.length; k++) {
    const c = Math.max(1, Math.ceil(Math.max(lenA[k], lenB[k]) / spacing - 1e-9));
    a.push(...G.resample(segA[k], c));
    b.push(...G.resample(segB[k], c));
  }
  a.push(a[0].slice()); b.push(b[0].slice());
  return { a, b, cornersMatched: useUp && useLo, cornerCounts: [A.up.length + A.lo.length, B.up.length + B.lo.length] };
};

/* Kerf compensation for a synced pair of closed CCW polylines (first == last).
   Offsets face A by ra and face B by rb, outward. Convex corners get round joins
   (wire swings around the corner, like DevFoam); concave corners get a miter.
   Both faces get the same number of points so they stay paired. */
G.offsetPair = function (pa, pb, ra, rb, arcStepDeg) {
  const step = (arcStepDeg || 10) * Math.PI / 180;
  const A = pa.slice(0, -1), B = pb.slice(0, -1), n = A.length;
  const nrm = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy); return L ? [dy / L, -dx / L] : null; };
  const info = (ring, i) => {
    const a = ring[(i - 1 + n) % n], b = ring[i], c = ring[(i + 1) % n];
    const n1 = nrm(a, b) || nrm(a, c) || [0, 1], n2 = nrm(b, c) || n1;
    const t1 = Math.atan2(n1[1], n1[0]);
    let dt = Math.atan2(n2[1], n2[0]) - t1;
    while (dt <= -Math.PI) dt += 2 * Math.PI; while (dt > Math.PI) dt -= 2 * Math.PI;
    return { b, n1, n2, t1, dt };
  };
  const pointsAt = (I, r, count) => {
    if (!r) return Array.from({ length: count }, () => [I.b[0], I.b[1]]);
    if (I.dt > 1e-6 && count > 1) { // convex: arc from n1 to n2
      const out = [];
      for (let k = 0; k < count; k++) { const t = I.t1 + I.dt * k / (count - 1); out.push([I.b[0] + r * Math.cos(t), I.b[1] + r * Math.sin(t)]); }
      return out;
    }
    let mx = I.n1[0] + I.n2[0], my = I.n1[1] + I.n2[1];
    const mL = Math.hypot(mx, my);
    if (mL < 1e-9) { mx = I.n2[0]; my = I.n2[1]; } else { mx /= mL; my /= mL; }
    const cosHalf = Math.max(1 / 3, mx * I.n2[0] + my * I.n2[1]);
    const p = [I.b[0] + mx * r / cosHalf, I.b[1] + my * r / cosHalf];
    return Array.from({ length: count }, () => p.slice());
  };
  const oa = [], ob = [];
  for (let i = 0; i < n; i++) {
    const IA = info(A, i), IB = info(B, i);
    const arcA = ra && IA.dt > step / 4 ? IA.dt : 0, arcB = rb && IB.dt > step / 4 ? IB.dt : 0;
    const count = Math.max(arcA, arcB) > 0 ? Math.max(2, Math.ceil(Math.max(arcA, arcB) / step) + 1) : 1;
    oa.push(...pointsAt(IA, ra, count));
    ob.push(...pointsAt(IB, rb, count));
  }
  G.trimLoops(oa); G.trimLoops(ob);
  // drop pairs that repeat on both faces
  const fa = [oa[0]], fb = [ob[0]];
  for (let i = 1; i < oa.length; i++) {
    if (G.dist(oa[i], fa[fa.length - 1]) < 1e-6 && G.dist(ob[i], fb[fb.length - 1]) < 1e-6) continue;
    fa.push(oa[i]); fb.push(ob[i]);
  }
  fa.push(fa[0].slice()); fb.push(fb[0].slice());
  return { a: fa, b: fb };
};

/* Remove small self-intersection loops from an offset path, in place, without changing its length:
   the points inside a loop all collapse onto the crossing point (so a paired face stays paired). */
G.segX = function (p1, p2, p3, p4) {
  const d1x = p2[0] - p1[0], d1y = p2[1] - p1[1], d2x = p4[0] - p3[0], d2y = p4[1] - p3[1];
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / den;
  const u = ((p3[0] - p1[0]) * d1y - (p3[1] - p1[1]) * d1x) / den;
  if (t <= 1e-9 || t >= 1 - 1e-9 || u <= 1e-9 || u >= 1 - 1e-9) return null;
  return [p1[0] + d1x * t, p1[1] + d1y * t];
};
G.trimLoops = function (pts, window) {
  const K = window || 60, n = pts.length;
  for (let i = 0; i < n - 3; i++) {
    for (let j = Math.min(n - 2, i + K); j >= i + 2; j--) {
      const x = G.segX(pts[i], pts[i + 1], pts[j], pts[j + 1]);
      if (x) { for (let k = i + 1; k <= j; k++) pts[k] = x.slice(); i = j - 1; break; }
    }
  }
  return pts;
};

G.transform = function (pts, f) { return pts.map(f); };

G.rotateAbout = function (pts, cx, cy, deg) {
  const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
  return pts.map(p => { const x = p[0] - cx, y = p[1] - cy; return [cx + x * c - y * s, cy + x * s + y * c]; });
};

if (typeof module !== 'undefined') module.exports = G; else root.HWGeom = G;
})(this);
