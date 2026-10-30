/* Hotwire Studio — minimal DXF reader for profile outlines (OnShape R11/12 export, mm).
   Reads LINE, ARC, CIRCLE, LWPOLYLINE, POLYLINE/VERTEX (with bulges) and SPLINE,
   then chains them end-to-end into closed loops. Returns the largest loop. */
(function (root) {
'use strict';
const D = {};

function pairs(text) {
  const lines = String(text).split(/\r?\n/), out = [];
  for (let i = 0; i + 1 < lines.length; i += 2) out.push([parseInt(lines[i].trim(), 10), lines[i + 1].trim()]);
  return out;
}

function arcPts(cx, cy, r, a0, a1) { // degrees, CCW from a0 to a1
  while (a1 <= a0) a1 += 360;
  const n = Math.max(4, Math.ceil((a1 - a0) / 3));
  const out = [];
  for (let k = 0; k <= n; k++) {
    const t = (a0 + (a1 - a0) * k / n) * Math.PI / 180;
    out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return out;
}

function bulgePts(p, q, b) { // arc from p to q with DXF bulge b (excluding p)
  if (!b) return [q];
  const th = 4 * Math.atan(b), dx = q[0] - p[0], dy = q[1] - p[1], c = Math.hypot(dx, dy);
  const r = c / (2 * Math.sin(th / 2));
  const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
  const h = r * Math.cos(th / 2); // centre distance from chord midpoint (signed)
  const cx = mx - h * dy / c, cy = my + h * dx / c;
  const a0 = Math.atan2(p[1] - cy, p[0] - cx);
  const n = Math.max(2, Math.ceil(Math.abs(th) / (3 * Math.PI / 180)));
  const out = [];
  for (let k = 1; k <= n; k++) {
    const t = a0 + th * k / n;
    out.push([cx + Math.abs(r) * Math.cos(t), cy + Math.abs(r) * Math.sin(t)]);
  }
  out[out.length - 1] = [q[0], q[1]];
  return out;
}

function polyFromVerts(verts, closed) {
  if (!verts.length) return null;
  const out = [[verts[0].x, verts[0].y]];
  const n = verts.length, last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p = verts[i], q = verts[(i + 1) % n];
    out.push(...bulgePts([p.x, p.y], [q.x, q.y], p.b || 0));
  }
  return out;
}

function deBoor(ctrl, knots, deg, samples) {
  const n = ctrl.length;
  const lo = knots[deg], hi = knots[n];
  const out = [];
  for (let s = 0; s <= samples; s++) {
    const u = lo + (hi - lo) * s / samples;
    let k = deg;
    while (k < n - 1 && u >= knots[k + 1]) k++;
    const d = [];
    for (let j = 0; j <= deg; j++) d.push(ctrl[k - deg + j].slice());
    for (let r = 1; r <= deg; r++) {
      for (let j = deg; j >= r; j--) {
        const i = k - deg + j;
        const den = knots[i + deg - r + 1] - knots[i];
        const a = den ? (u - knots[i]) / den : 0;
        d[j] = [(1 - a) * d[j - 1][0] + a * d[j][0], (1 - a) * d[j - 1][1] + a * d[j][1]];
      }
    }
    out.push(d[deg]);
  }
  return out;
}

D.parse = function (text) {
  const P = pairs(text);
  let i = 0;
  while (i < P.length && !(P[i][0] === 2 && P[i][1] === 'ENTITIES')) i++;
  if (i >= P.length) throw new Error('DXF has no ENTITIES section');
  const polys = [];
  const skipped = {};
  let cur = null, poly = null;

  const flush = () => {
    if (!cur) return;
    const e = cur; cur = null;
    const g = (c) => e.codes.filter(x => x[0] === c).map(x => parseFloat(x[1]));
    const g1 = (c, d) => { const v = g(c); return v.length ? v[0] : d; };
    switch (e.type) {
      case 'LINE': polys.push([[g1(10), g1(20)], [g1(11), g1(21)]]); break;
      case 'ARC': polys.push(arcPts(g1(10), g1(20), g1(40), g1(50), g1(51))); break;
      case 'CIRCLE': polys.push(arcPts(g1(10), g1(20), g1(40), 0, 360)); break;
      case 'LWPOLYLINE': {
        const verts = []; let v = null;
        for (const [c, s] of e.codes) {
          if (c === 10) { v = { x: parseFloat(s), y: 0, b: 0 }; verts.push(v); }
          else if (c === 20 && v) v.y = parseFloat(s);
          else if (c === 42 && v) v.b = parseFloat(s);
        }
        const p = polyFromVerts(verts, (g1(70, 0) & 1) === 1);
        if (p) polys.push(p);
        break;
      }
      case 'SPLINE': {
        const deg = g1(71, 3), knots = g(40);
        const cx = g(10), cy = g(20), fx = g(11), fy = g(21);
        const ctrl = cx.map((x, k) => [x, cy[k]]);
        if (ctrl.length > deg && knots.length === ctrl.length + deg + 1) polys.push(deBoor(ctrl, knots, deg, Math.max(40, ctrl.length * 8)));
        else if (fx.length > 1) polys.push(fx.map((x, k) => [x, fy[k]]));
        else if (ctrl.length > 1) polys.push(ctrl);
        break;
      }
      default: skipped[e.type] = (skipped[e.type] || 0) + 1;
    }
  };

  for (i++; i < P.length; i++) {
    const [c, s] = P[i];
    if (c === 0) {
      if (cur && cur.type === 'VERTEX') { // commit the previous vertex first
        const vx = cur.codes; cur = null;
        const get = (k) => { const f = vx.find(x => x[0] === k); return f ? parseFloat(f[1]) : 0; };
        poly.verts.push({ x: get(10), y: get(20), b: get(42) });
      }
      if (cur && cur.type === 'POLYHEAD') cur = null;
      if (poly && s === 'VERTEX') { cur = { type: 'VERTEX', codes: [] }; continue; }
      if (poly && s === 'SEQEND') { const p = polyFromVerts(poly.verts, poly.closed); if (p) polys.push(p); poly = null; continue; }
      flush();
      if (s === 'ENDSEC' || s === 'EOF') break;
      if (s === 'POLYLINE') { poly = { verts: [], closed: false, head: true }; cur = { type: 'POLYHEAD', codes: [] }; continue; }
      cur = { type: s, codes: [] };
    } else if (cur) {
      if (cur.type === 'POLYHEAD' && c === 70) poly.closed = (parseInt(s, 10) & 1) === 1;
      cur.codes.push([c, s]);
    }
  }
  flush();
  if (cur && cur.type === 'POLYHEAD') cur = null;
  delete skipped.POLYHEAD; delete skipped.VERTEX;
  if (!polys.length) throw new Error('No lines, arcs, polylines or splines found in the DXF');
  return { polys, skipped };
};

// Chain open pieces into loops by matching endpoints.
D.chain = function (polys, tol) {
  const pool = polys.map(p => p.slice());
  const loops = [], open = [];
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  while (pool.length) {
    let cur = pool.shift();
    let grew = true;
    while (grew && d(cur[0], cur[cur.length - 1]) > tol) {
      grew = false;
      const end = cur[cur.length - 1];
      for (let k = 0; k < pool.length; k++) {
        const p = pool[k];
        if (d(p[0], end) <= tol) { cur = cur.concat(p.slice(1)); pool.splice(k, 1); grew = true; break; }
        if (d(p[p.length - 1], end) <= tol) { cur = cur.concat(p.slice().reverse().slice(1)); pool.splice(k, 1); grew = true; break; }
      }
    }
    if (cur.length < 3) { if (cur.length === 2) open.push(cur); continue; }
    (d(cur[0], cur[cur.length - 1]) <= tol ? loops : open).push(cur);
  }
  return { loops, open };
};

D.readProfile = function (text, name) {
  const { polys, skipped } = D.parse(text);
  let all = polys.flat();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of all) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  const tol = Math.max(0.01, Math.max(maxX - minX, maxY - minY) * 1e-5);
  const { loops, open } = D.chain(polys, tol);
  const notes = [];
  const area = (r) => { let a = 0; for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return Math.abs(a / 2); };
  let pick;
  if (loops.length) {
    loops.sort((a, b) => area(b) - area(a));
    pick = loops[0];
    if (loops.length > 1) notes.push(`DXF has ${loops.length} closed outlines; using the largest. Export one face per file.`);
  } else {
    open.sort((a, b) => b.length - a.length);
    pick = open[0];
    notes.push('DXF outline is not closed; the gap is closed with a straight line.');
  }
  if (open.length && loops.length) notes.push(`${open.length} loose piece(s) ignored.`);
  const sk = Object.keys(skipped).filter(k => !['TEXT', 'MTEXT', 'DIMENSION', 'POINT', 'INSERT', 'HATCH'].includes(k) || true);
  if (sk.length) notes.push('Ignored entity types: ' + sk.map(k => `${k}×${skipped[k]}`).join(', '));
  return { name: name || 'DXF', pts: pick, notes };
};

if (typeof module !== 'undefined') module.exports = D; else root.HWDxf = D;
})(this);
