/* node test/run.js — checks Hotwire Studio against a real DevFoam Pro 3 cut. */
const fs = require('fs'), path = require('path');
const G = require('../js/geom.js'), D = require('../js/dxf.js'), M = require('../js/machine.js');
const dir = path.join(__dirname, '..', 'docs', 'samples', 'payload-foam-floor');
let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };

// distance from point to polyline
function dPoly(p, poly) {
  let best = Infinity;
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1], b = poly[i], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
  }
  return best;
}
const hausdorff = (A, B) => Math.max(Math.max(...A.map(p => dPoly(p, B))), Math.max(...B.map(p => dPoly(p, A))));

// 1. NACA sanity
const n = G.naca4('2412', 80);
ok(Math.abs(G.bbox(n.pts).w - 1) < 1e-6, 'NACA 2412 chord = 1');
ok(Math.abs(G.bbox(G.naca4('0012').pts).h - 0.12) < 0.002, 'NACA 0012 thickness ≈ 12%');

// 2. Projection: straight cut stays straight, taper extends linearly
const t = M.project([10, 5], [10, 5], 100, 700, 882.65);
ok(t.L[0] === 10 && t.R[1] === 5, 'Untapered wire: towers = faces');
const t2 = M.project([0, 0], [6, 0], 100, 700, 800);
ok(Math.abs(t2.L[0] + 1) < 1e-9 && Math.abs(t2.R[0] - 7) < 1e-9, 'Taper projection extends to towers');

// 3. DevFoam sample: payload foam floor
const prof = D.readProfile(fs.readFileSync(path.join(dir, 'M2foamfloor.dxf'), 'utf8'), 'M2foamfloor');
const w = G.bbox(prof.pts).w;
ok(Math.abs(w - 315.2) < 0.01, 'DXF read: part length 315.2 mm');
const st = JSON.parse(JSON.stringify(M.DEFAULTS));
Object.assign(st, { start: 'first', kerfL: 1.5, kerfR: 1.5, speed: 200, spacing: 1, frontX: 2, bottomY: 2, startX: 7.9137, startY: 51.5303 });
st.left.chord = w; st.right.chord = w;
const src = { pts: prof.pts, name: 'floor', isAirfoil: false };
const r = M.build(st, src, src);
const ref = M.parseGcode(fs.readFileSync(path.join(dir, 'gcode.nc'), 'utf8'));
const theirs = ref.moves.slice(2, -1).map(m => m.L);   // contour only (skip zero, G0 start, lead-out)
const ours = r.moves.slice(1, -1).map(m => m.L);
const theirsOnOurs = Math.max(...theirs.map(p => dPoly(p, ours)));
const oursOnTheirs = Math.max(...ours.map(p => dPoly(p, theirs)));
console.log(`     DevFoam ${theirs.length} points, ours ${ours.length}`);
ok(theirsOnOurs < 0.05, `Every DevFoam point lies on our path (worst ${theirsOnOurs.toFixed(4)} mm)`);
// DevFoam chamfers inside corners with its 1 mm steps; we follow the exact offset into them.
ok(oursOnTheirs < 0.4, `Our path stays within 0.4 mm of DevFoam's (worst ${oursOnTheirs.toFixed(3)} mm, at inside corners)`);
const refCut = ref.minutes - ref.moves[1].t; // drop DevFoam's opening rapid
ok(Math.abs(r.minutes - refCut) / refCut < 0.01, `Cut time matches (ours ${r.minutes.toFixed(3)} min, DevFoam ${refCut.toFixed(3)} min)`);
const head = r.gcode.split('\n').slice(0, 6).join('|'), refHead = ref.lines.slice(0, 6).join('|');
ok(head === refHead, 'Header and first rapid identical to DevFoam: ' + head);
ok(r.gcode.trim().endsWith('M5'), 'Ends with M5');
ok(r.towers.L.every((p, i) => Math.abs(p[0] - r.towers.R[i][0]) < 1e-9), 'Untapered: X = A on every line');

// 4. Tapered wing: tower points lie on the wire through both faces
const st2 = JSON.parse(JSON.stringify(M.DEFAULTS));
Object.assign(st2, { start: 'te', frontX: 76.2, bottomY: 12.7 });
st2.left.chord = 300; st2.right.chord = 200; st2.right.dx = 40; st2.right.dy = 5;
const naca = { ...G.naca4('2412', 120), isAirfoil: true };
const r2 = M.build(st2, naca, naca);
let worst = 0;
for (let i = 0; i < r2.faceL.length; i++) {
  const a = M.atSpan(r2.towers.L[i], r2.towers.R[i], r2.sL, r2.W), b = M.atSpan(r2.towers.L[i], r2.towers.R[i], r2.sR, r2.W);
  worst = Math.max(worst, G.dist(a, r2.faceL[i]), G.dist(b, r2.faceR[i]));
}
ok(worst < 1e-9, 'Tapered: wire passes through both face paths');
ok(r2.path.L.length === r2.path.R.length, `Tapered: faces paired point-for-point (${r2.path.L.length})`);
const lb = G.bbox(r2.part.L), rb = G.bbox(r2.part.R);
ok(Math.abs(lb.w - 300) < 0.01 && Math.abs(rb.w - 200) < 0.01, 'Tapered: chords 300 / 200');
// G93 timing: faster tower moves at speed
const m = r2.moves[5], p = r2.moves[4];
const fast = Math.max(G.dist(m.L, p.L), G.dist(m.R, p.R)) / (m.t - p.t);
ok(Math.abs(fast - st2.speed) < 1e-6, 'G93 feed: faster tower runs at set speed');

console.log(fails ? `\n${fails} FAILED` : '\nAll passed');
process.exit(fails ? 1 : 0);
