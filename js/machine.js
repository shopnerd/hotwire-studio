/* Hotwire Studio — machine side: placement, tower projection, G-code out and in.
   Machine frame (from the SOP): X = horizontal (front edge of the vacuum table = 0, increasing away
   from the operator), Y = vertical (0 = where the wire was zeroed). Left tower = X/Y, right tower = A/Z.
   Span s runs from the left tower (0) to the right tower (wire span). */
(function (root) {
'use strict';
const G = (typeof module !== 'undefined') ? require('./geom.js') : root.HWGeom;
const M = {};

M.DEFAULTS = {
  name: 'Untitled cut',
  left:  { kind: 'naca', naca: '2412', src: null, chord: 250, rot: 0 },
  right: { kind: 'same', naca: '2412', src: null, chord: 250, rot: 0, dx: 0, dy: 0 },
  start: 'auto',          // auto | te | first | topleft
  ref: 'bbox',            // where the right-face offset is measured: bbox lower-left | le | te
  pivot: 0.25,            // rotation pivot, fraction of chord
  flip: false,            // true = drawing's left side goes to the BACK of the machine
  width: 685.8,           // part width between the two faces (mm)
  center: true, leftPos: 98.425,
  frontX: 2, bottomY: 2,  // part's nearest-front / lowest point (DevFoam sample puts it at 2, 2)
  startX: null, startY: null, // rapid-to point; null = automatic
  kerfL: 1.5, kerfR: 1.5, // per side, mm (DevFoam sample: 1.5)
  speed: 200,             // mm/min along the faster tower
  spacing: 1,             // point spacing, mm (DevFoam sample: ~1)
  cornerDeg: 10,
  sync: [],               // sync pairs added in the app: [{ l, r }] as fractions round each face from its start
  syncFromDxf: true,      // use POINTs / tiny circles drawn on the DXF outlines as sync points
  block: { length: 0, height: 50.8, margin: 25.4 },
  machine: { span: 882.65, maxX: 0, maxY: 0 },
};

function fmt(v) { const s = (Math.abs(v) < 5e-5 ? 0 : v).toFixed(4); return s === '-0.0000' ? '0.0000' : s; }

/* Shape -> face ring in profile space: chord scaled, rotated (+ = nose up), LE at origin.
   `marks` (sync markers from the DXF) get the same transform and come back as fractions round the ring. */
M.prepFace = function (pts, chord, rotDeg, pivotFrac, start, marks) {
  let ring = G.normalizeLoop(pts, start);
  const bb = G.bbox(ring);
  const sc = chord > 0 && bb.w > 0 ? chord / bb.w : 1;
  const le = ring[G.argMinX(ring)];
  const tf = q => q.map(p => [(p[0] - le[0]) * sc, (p[1] - le[1]) * sc]);
  ring = tf(ring);
  let mk = marks && marks.length ? tf(marks) : [];
  if (rotDeg) {
    ring = G.rotateAbout(ring, (pivotFrac || 0) * (bb.w * sc), 0, -rotDeg);
    mk = G.rotateAbout(mk, (pivotFrac || 0) * (bb.w * sc), 0, -rotDeg);
  }
  ring = G.normalizeLoop(ring, start === 'te' ? 'te' : 'first'); // re-pick TE after rotation
  const fr = mk.map(p => G.fractionOf(ring, p));
  ring.marks = fr.filter(f => f.dist <= Math.max(2, G.bbox(ring).w * 0.02)).map(f => f.t).sort((x, y) => x - y);
  ring.marksOff = fr.length - ring.marks.length;
  return ring;
};

/* Pair up sync points: DXF markers (matched in order) + pairs clicked in the app.
   Keeps only pairs that go round both faces in the same order. */
M.syncPairs = function (st, fl, fr, warn) {
  let pairs = [];
  if (st.syncFromDxf !== false && (fl.marks.length || fr.marks.length)) {
    if (fl.marks.length === fr.marks.length) pairs = fl.marks.map((t, i) => ({ l: t, r: fr.marks[i], from: 'dxf' }));
    else warn.push(`The DXFs have different numbers of sync points (left ${fl.marks.length}, right ${fr.marks.length}); they were ignored.`);
  }
  if (fl.marksOff || fr.marksOff) warn.push('Some DXF sync points are not on the outline, so they were ignored. Draw them on the line.');
  for (const p of st.sync || []) if (p && p.l > 0 && p.l < 1 && p.r > 0 && p.r < 1) pairs.push({ l: +p.l, r: +p.r, from: 'app' });
  pairs.sort((a, b) => a.l - b.l);
  const kept = [];
  for (const p of pairs) {
    const last = kept[kept.length - 1];
    if (last && (p.r <= last.r || p.l - last.l < 1e-4)) { warn.push('Two sync pairs cross each other (they go round the faces in a different order), so one was ignored.'); continue; }
    kept.push(p);
  }
  return kept;
};

M.refPoint = function (ring, ref) {
  if (ref === 'le') return ring[G.argMinX(ring)].slice();
  if (ref === 'te') { let k = 0; ring.forEach((p, i) => { if (p[0] > ring[k][0]) k = i; }); return ring[k].slice(); }
  const bb = G.bbox(ring); return [bb.minX, bb.minY];
};

/* Wire through face points pl (at span sL) and pr (at sR) -> tower points at 0 and W. */
M.project = function (pl, pr, sL, sR, W) {
  const w = sR - sL, tL = -sL / w, tR = (W - sL) / w;
  return {
    L: [pl[0] + (pr[0] - pl[0]) * tL, pl[1] + (pr[1] - pl[1]) * tL],
    R: [pl[0] + (pr[0] - pl[0]) * tR, pl[1] + (pr[1] - pl[1]) * tR],
  };
};
// Inverse: where the wire crosses span s, given tower points.
M.atSpan = function (tl, tr, s, W) { const t = s / W; return [tl[0] + (tr[0] - tl[0]) * t, tl[1] + (tr[1] - tl[1]) * t]; };

/* Build everything from settings + resolved source shapes ({pts, name, isAirfoil}). */
M.build = function (st, srcL, srcR) {
  const warn = [], info = [];
  const W = +st.machine.span;
  const width = +st.width;
  const sL = st.center ? (W - width) / 2 : +st.leftPos, sR = sL + width;
  if (!(width > 0)) throw new Error('Part width must be above 0');
  if (sL < 0 || sR > W) warn.push(`Part (${width} mm wide) does not fit between the towers at this position (wire span ${W} mm).`);

  const startMode = st.start === 'auto' ? (srcL.isAirfoil ? 'te' : 'first') : st.start;
  let fl = M.prepFace(srcL.pts, +st.left.chord, +st.left.rot, +st.pivot, startMode, srcL.syncPts);
  let fr = M.prepFace(srcR.pts, +st.right.chord, +st.right.rot, +st.pivot, startMode, srcR.syncPts);
  const pairs = M.syncPairs(st, fl, fr, warn);

  // Right face sits at left ref + (dx, dy)
  const rl = M.refPoint(fl, st.ref), rr = M.refPoint(fr, st.ref);
  fl = fl.map(p => [p[0] - rl[0], p[1] - rl[1]]);
  fr = fr.map(p => [p[0] - rr[0] + (+st.right.dx || 0), p[1] - rr[1] + (+st.right.dy || 0)]);

  const sync = G.syncPair(fl, fr, +st.spacing, +st.cornerDeg, pairs.map(p => p.l), pairs.map(p => p.r));
  if (!sync.user && !sync.cornersMatched) info.push(`The two faces' corners don't line up (left ${sync.cornerCounts[0]}, right ${sync.cornerCounts[1]}), so they're matched at the start and leading edge only. Add sync points to control the match.`);
  if (sync.user) info.push(`${pairs.length} sync point pair${pairs.length > 1 ? 's' : ''} in use (${pairs.filter(p => p.from === 'dxf').length} from the DXFs, ${pairs.filter(p => p.from === 'app').length} added here).`);
  const cut = G.offsetPair(sync.a, sync.b, +st.kerfL || 0, +st.kerfR || 0);

  // Into machine X/Y: optional front/back flip, then shift so the part's front-lowest point is at (frontX, bottomY).
  const fx = st.flip ? -1 : 1;
  const both = sync.a.concat(sync.b).map(p => [fx * p[0], p[1]]);
  const bb = G.bbox(both);
  const ox = +st.frontX - bb.minX, oy = +st.bottomY - bb.minY;
  const place = p => [fx * p[0] + ox, p[1] + oy];
  const part = { L: sync.a.map(place), R: sync.b.map(place) };
  const path = { L: cut.a.map(place), R: cut.b.map(place) };

  // Start (rapid-to) point, same on both faces
  const pbb = G.bbox(path.L.concat(path.R));
  const entryL = path.L[0], entryR = path.R[0];
  let start;
  if (st.startX != null && st.startX !== '' && st.startY != null && st.startY !== '') start = [+st.startX, +st.startY];
  else {
    const ex = (entryL[0] + entryR[0]) / 2, ey = Math.max(entryL[1], entryR[1]);
    const nearFront = ex - pbb.minX < pbb.maxX - ex;
    start = [nearFront ? Math.max(0, pbb.minX - 5) : pbb.maxX + 5, Math.max(ey, pbb.maxY) + 15];
    if (Math.abs(ey - pbb.maxY) < 2) start = [ex + (nearFront ? 6 : -6), ey + 15];
  }

  // Full face-space program: rapid to start, lead in, contour (closed), lead out to start.
  const faceL = [start].concat(path.L, [start]), faceR = [start].concat(path.R, [start]);
  const towers = { L: [], R: [] };
  for (let i = 0; i < faceL.length; i++) {
    const t = M.project(faceL[i], faceR[i], sL, sR, W);
    towers.L.push(t.L); towers.R.push(t.R);
  }

  // Block (display + checks): front at X 0, as the SOP squares it to the table edge.
  const ext = G.bbox(part.L.concat(part.R));
  const blockLen = +st.block.length > 0 ? +st.block.length : Math.ceil(ext.maxX + 76.2);
  const block = { x0: 0, x1: blockLen, y0: 0, y1: +st.block.height, s0: sL - (+st.block.margin), s1: sR + (+st.block.margin) };

  // Checks
  const all = towers.L.concat(towers.R);
  const tb = G.bbox(all);
  if (tb.minX < -0.001) warn.push(`A tower goes to X ${tb.minX.toFixed(2)} mm, in front of zero.`);
  if (tb.minY < -0.001) warn.push(`A tower goes to Y ${tb.minY.toFixed(2)} mm, below zero.`);
  if (+st.machine.maxX > 0 && tb.maxX > +st.machine.maxX) warn.push(`A tower needs X ${tb.maxX.toFixed(1)} mm; travel is ${st.machine.maxX} mm.`);
  if (+st.machine.maxY > 0 && tb.maxY > +st.machine.maxY) warn.push(`A tower needs Y ${tb.maxY.toFixed(1)} mm; travel is ${st.machine.maxY} mm.`);
  if (ext.maxY > block.y1) info.push(`Part top (${ext.maxY.toFixed(1)} mm) is above the block height (${block.y1} mm).`);
  if (start[1] < ext.maxY && (start[0] > ext.minX && start[0] < ext.maxX)) warn.push('Start point is inside the part outline area; the rapid move may hit foam.');

  const prog = M.program(towers, +st.speed);
  const syncMarks = sync.anchors.map((i, k) => ({ L: part.L[i], R: part.R[i], user: !!sync.user, from: sync.user ? (pairs[k] || {}).from : 'auto' }));
  return { st, sL, sR, W, part, path, start, faceL, faceR, towers, block, warn, info, sync, syncMarks, ...prog };
};

/* DevFoam-style program: G93 inverse-time feed, timed so the faster tower moves at `speed` mm/min. */
M.program = function (towers, speed) {
  const L = towers.L, R = towers.R;
  const lines = ['G21', 'G17', 'G90', 'F' + fmt(speed), 'M3'];
  const moves = []; // for the simulator
  const xyaz = (i) => `X${fmt(L[i][0])}Y${fmt(L[i][1])}A${fmt(R[i][0])}Z${fmt(R[i][1])}`;
  lines.push('G0' + xyaz(0));
  moves.push({ i: 0, line: lines.length - 1, L: L[0], R: R[0], t: 0, rapid: true });
  lines.push('G93');
  let time = 0, cutLen = 0;
  for (let i = 1; i < L.length; i++) {
    const dl = G.dist(L[i - 1], L[i]), dr = G.dist(R[i - 1], R[i]);
    const d = Math.max(dl, dr);
    if (d < 1e-6) continue;
    const minutes = d / speed;
    time += minutes; cutLen += d;
    lines.push('G1' + xyaz(i) + 'F' + fmt(1 / minutes));
    moves.push({ i, line: lines.length - 1, L: L[i], R: R[i], t: time });
  }
  lines.push('M5');
  return { gcode: lines.join('\n') + '\n', moves, minutes: time, cutLen };
};

/* Read any 4-axis program (G0/G1, G90/G91, G20/G21, G93/G94) for preview. */
M.parseGcode = function (text) {
  const pos = { X: 0, Y: 0, A: 0, Z: 0 };
  let abs = true, scale = 1, inv = false, F = 0, mode = 0, time = 0;
  const moves = [{ line: -1, L: [0, 0], R: [0, 0], t: 0, rapid: true }];
  const notes = new Set();
  const src = String(text).split(/\r?\n/);
  src.forEach((raw, ln) => {
    const s = raw.replace(/\(.*?\)/g, '').replace(/;.*/, '').toUpperCase();
    const words = [...s.matchAll(/([A-Z])\s*([-+]?\d*\.?\d+)/g)].map(m => [m[1], parseFloat(m[2])]);
    if (!words.length) return;
    let hasAxis = false, newF = null;
    const tgt = { ...pos };
    for (const [k, v] of words) {
      if (k === 'G') {
        if (v === 0 || v === 1) mode = v;
        else if (v === 90) abs = true; else if (v === 91) abs = false;
        else if (v === 20) scale = 25.4; else if (v === 21) scale = 1;
        else if (v === 93) inv = true; else if (v === 94) inv = false;
        else if (v === 2 || v === 3) notes.add('Arcs (G2/G3) are drawn as straight lines.');
      } else if (k === 'F') newF = v;
      else if ('XYAZ'.includes(k)) { hasAxis = true; tgt[k] = abs ? v * scale : pos[k] + v * scale; }
      else if (k === 'B' || k === 'C') notes.add('Extra axis words (' + k + ') are ignored in this preview.');
    }
    if (newF != null) F = newF;
    if (!hasAxis) return;
    const dl = Math.hypot(tgt.X - pos.X, tgt.Y - pos.Y), dr = Math.hypot(tgt.A - pos.A, tgt.Z - pos.Z);
    let dt;
    if (mode === 0) dt = Math.max(dl, dr) / 1000;          // rapids: nominal 1000 mm/min for the timeline
    else if (inv) dt = F > 0 ? 1 / F : 0;
    else dt = F > 0 ? Math.hypot(dl, dr) / (F * scale) : 0; // stock GRBL: F over the 4-axis vector
    time += dt;
    Object.assign(pos, tgt);
    moves.push({ line: ln, L: [pos.X, pos.Y], R: [pos.A, pos.Z], t: time, rapid: mode === 0 });
  });
  return { moves, minutes: time, notes: [...notes], lines: src };
};

if (typeof module !== 'undefined') module.exports = M; else root.HWMachine = M;
})(this);
