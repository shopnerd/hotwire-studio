/* Hotwire Studio — UI wiring. */
(function () {
'use strict';
const G = window.HWGeom, D = window.HWDxf, M = window.HWMachine, X = window.HWExamples || {};
const $ = (s, el) => (el || document).querySelector(s), $$ = (s, el) => [...(el || document).querySelectorAll(s)];
const KEY = 'hotwire-studio-v1';

const clone = o => JSON.parse(JSON.stringify(o));
function merge(base, over) {
  const out = clone(base);
  for (const k in over || {}) {
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) out[k] = merge(out[k], over[k]);
    else out[k] = over[k];
  }
  return out;
}
const get = (o, p) => p.split('.').reduce((a, k) => a == null ? a : a[k], o);
const set = (o, p, v) => { const ks = p.split('.'), last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };

let saved = null;
try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { /* storage blocked */ }
// First visit opens on the DevFoam sample so there's a real cut on screen.
let st = saved ? merge(M.DEFAULTS, saved) : (X.floor ? exampleState('floor') : clone(M.DEFAULTS));

let result = null, buildErr = null, loaded = null, showing = 'generated';
let prog = null; // { moves, lines, minutes, kind }
let simT = 0, playing = false, lastFrame = 0, curLine = -1;

const side = new HWViews.SideView($('#cvSide'));
const v3d = new HWViews.View3D($('#cv3d'));

/* ── settings form ─────────────────────────────────────── */
function fillForm() {
  $('#designName').value = st.name || '';
  for (const el of $$('[data-k]')) {
    const v = get(st, el.dataset.k);
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v == null ? '' : v;
  }
  $('#fnameLeft').textContent = st.left.src ? st.left.src.name : 'none';
  $('#fnameRight').textContent = st.right.src ? st.right.src.name : 'none';
  updateShow();
}
function updateShow() {
  for (const el of $$('[data-show]')) {
    const [k, v] = el.dataset.show.split('=');
    const cur = String(get(st, k));
    if (cur === v) el.removeAttribute('data-hidden'); else el.setAttribute('data-hidden', '');
  }
}
for (const el of $$('[data-k]')) {
  const handler = () => {
    const k = el.dataset.k;
    let v;
    if (el.type === 'checkbox') v = el.checked;
    else if (el.type === 'number') v = el.value === '' ? ((k === 'startX' || k === 'startY') ? null : 0) : +el.value;
    else v = el.value;
    set(st, k, v);
    updateShow(); schedule();
  };
  el.addEventListener('input', handler); el.addEventListener('change', handler);
}
$('#designName').addEventListener('input', e => { st.name = e.target.value; save(); });

// Face files: DXF (real size) or airfoil .dat (unit chord)
for (const inp of $$('input[data-file]')) {
  inp.addEventListener('change', async () => {
    const f = inp.files[0]; if (!f) return;
    const face = inp.dataset.file;
    try {
      const text = await f.text();
      let src;
      if (/\.dxf$/i.test(f.name)) {
        const p = D.readProfile(text, f.name);
        src = { name: f.name, pts: p.pts, syncPts: p.syncPts, isAirfoil: false, notes: p.notes };
        st[face].chord = +G.bbox(p.pts).w.toFixed(4); // DXF is already full size
      } else {
        const p = G.parseDat(text, f.name);
        src = { name: f.name + ' (' + p.name + ')', pts: p.pts, isAirfoil: true, notes: [] };
      }
      st[face].src = src; st[face].kind = 'file';
      fillForm(); rebuild(true);
    } catch (e) { flash('Could not read ' + f.name + ': ' + e.message); }
    inp.value = '';
  });
}

/* ── build ─────────────────────────────────────────────── */
function srcFor(face) {
  const F = st[face];
  if (face === 'right' && F.kind === 'same') return srcFor('left');
  if (F.kind === 'naca') return { ...G.naca4(F.naca || '0012', 100), isAirfoil: true };
  if (!F.src) throw new Error(`Load a DXF or .dat file for the ${face} face.`);
  return F.src;
}
let pending = 0;
function schedule() { cancelAnimationFrame(pending); pending = requestAnimationFrame(() => rebuild(false)); }
function rebuild(refit) {
  save();
  try {
    buildErr = null;
    result = M.build(st, srcFor('left'), srcFor('right'));
  } catch (e) { result = null; buildErr = e.message; }
  setProgram(refit);
}
function spanNow() {
  const W = +st.machine.span, w = +st.width;
  const sL = st.center ? (W - w) / 2 : +st.leftPos;
  return { W, sL, sR: sL + w };
}

function setProgram(refit) {
  if (showing === 'loaded' && loaded) {
    const { W, sL, sR } = spanNow();
    const mv = loaded.parsed.moves;
    prog = { kind: 'loaded', moves: mv, lines: loaded.parsed.lines, minutes: loaded.parsed.minutes };
    const towersL = mv.map(m => m.L), towersR = mv.map(m => m.R);
    scene = { W, sL, sR, towersL, towersR,
      faceL: mv.map(m => M.atSpan(m.L, m.R, sL, W)), faceR: mv.map(m => M.atSpan(m.L, m.R, sR, W)),
      partL: null, partR: null, block: result ? result.block : null };
  } else if (result) {
    const r = result;
    prog = { kind: 'generated', moves: r.moves, lines: r.gcode.trimEnd().split('\n'), minutes: r.minutes };
    scene = { W: r.W, sL: r.sL, sR: r.sR, towersL: r.towers.L, towersR: r.towers.R, faceL: r.faceL, faceR: r.faceR,
      partL: r.part.L, partR: r.part.R, block: r.block, syncMarks: r.syncMarks, pickPending: pick && pick.pt };
  } else { prog = null; scene = null; }
  simT = Math.min(simT, prog ? prog.minutes : 0);
  renderSync();
  renderOut();
  renderCode();
  updateSim(refit);
}
let scene = null;

/* ── output panel ──────────────────────────────────────── */
const fmtTime = m => { const s = Math.round(m * 60); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
function renderOut() {
  const bar = $('#srcBar');
  bar.innerHTML = '';
  const tag = document.createElement('span');
  tag.className = 'tag' + (showing === 'loaded' ? ' loaded' : '');
  tag.textContent = showing === 'loaded' ? 'Previewing file' : 'Generated';
  bar.append(tag);
  const nm = document.createElement('span'); nm.className = 'mono';
  nm.textContent = showing === 'loaded' ? loaded.name : (st.name || 'Untitled') + '.nc';
  bar.append(nm);
  if (loaded) {
    const b = document.createElement('button'); b.className = 'small';
    b.textContent = showing === 'loaded' ? 'Back to generated' : 'Show ' + loaded.name;
    b.onclick = () => { showing = showing === 'loaded' ? 'generated' : 'loaded'; simT = 0; setProgram(true); };
    bar.append(b);
  }

  const stats = $('#stats'); stats.innerHTML = '';
  const add = (k, v) => { const a = document.createElement('span'); a.textContent = k; const b = document.createElement('b'); b.textContent = v; stats.append(a, b); };
  if (prog && scene) {
    const tb = G.bbox(scene.towersL.concat(scene.towersR));
    add('Cut time', fmtTime(prog.minutes) + ' min');
    add('Lines', String(prog.lines.length));
    add('Tower X / A range', `${tb.minX.toFixed(1)} – ${tb.maxX.toFixed(1)}`);
    add('Tower Y / Z range', `${tb.minY.toFixed(1)} – ${tb.maxY.toFixed(1)}`);
    add('Faces from left tower', `${scene.sL.toFixed(1)} / ${scene.sR.toFixed(1)}`);
    if (prog.kind === 'generated') add('Speed', st.speed + ' mm/min (G93)');
  }

  const box = $('#msgs'); box.innerHTML = '';
  const msg = (cls, t) => { const d = document.createElement('div'); d.className = 'msg ' + cls; d.textContent = t; box.append(d); };
  if (buildErr) msg('bad', buildErr);
  if (showing === 'loaded' && loaded) {
    msg('info', 'Faces shown are where this program\'s wire crosses the part width and position set on the left.');
    loaded.parsed.notes.forEach(n => msg('info', n));
  }
  if (result && showing === 'generated') {
    result.warn.forEach(t => msg('warn', t));
    result.info.forEach(t => msg('info', t));
    for (const f of ['left', 'right']) if (st[f].kind === 'file' && st[f].src && st[f].src.notes) st[f].src.notes.forEach(n => msg('info', `${f === 'left' ? 'Left' : 'Right'} file: ${n}`));
  }
}

function renderCode() {
  const el = $('#code'); el.innerHTML = ''; curLine = -1;
  if (!prog) return;
  const frag = document.createDocumentFragment();
  prog.lines.forEach((t, i) => {
    const d = document.createElement('div');
    const n = document.createElement('i'); n.textContent = i + 1;
    d.append(n, document.createTextNode(t));
    if (/^G0/.test(t)) d.className = 'g0'; else if (/^M\d/.test(t)) d.className = 'm';
    d.dataset.i = i;
    d.onclick = () => { const m = prog.moves.find(mv => mv.line === i); if (m) { simT = m.t; updateSim(); } };
    frag.append(d);
  });
  el.append(frag);
}

/* ── simulator ─────────────────────────────────────────── */
function stateAt(t) {
  const mv = prog.moves;
  let lo = 0, hi = mv.length - 1;
  if (t <= mv[0].t) return { k: 0, f: 0 };
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (mv[mid].t < t) lo = mid; else hi = mid; }
  const a = mv[lo], b = mv[hi], dt = b.t - a.t;
  return { k: hi, f: dt > 0 ? Math.min(1, (t - a.t) / dt) : 1 };
}
function updateSim(refit) {
  const slider = $('#simT');
  if (!prog || !scene) { side.set(scene, refit); v3d.set(scene); $('#simRead').textContent = ''; return; }
  const mv = prog.moves, { k, f } = stateAt(simT);
  const a = mv[Math.max(0, k - 1)], b = mv[k];
  const lerp = (p, q) => [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
  const L = k === 0 ? b.L : lerp(a.L, b.L), R = k === 0 ? b.R : lerp(a.R, b.R);
  scene.cur = { L, R, fL: M.atSpan(L, R, scene.sL, scene.W), fR: M.atSpan(L, R, scene.sR, scene.W) };
  side.set(scene, refit); v3d.set(scene);
  slider.value = prog.minutes > 0 ? Math.round(simT / prog.minutes * 1000) : 0;
  $('#simRead').textContent = `${fmtTime(simT)} / ${fmtTime(prog.minutes)}  ·  X${L[0].toFixed(2)} Y${L[1].toFixed(2)}  A${R[0].toFixed(2)} Z${R[1].toFixed(2)}`;
  highlight(b.line);
}
function highlight(i) {
  if (i === curLine) return;
  const el = $('#code');
  const old = el.querySelector('.cur'); if (old) old.classList.remove('cur');
  curLine = i;
  const d = el.querySelector(`[data-i="${i}"]`);
  if (d) {
    d.classList.add('cur');
    const top = d.offsetTop - el.offsetTop, h = el.clientHeight;
    if (top < el.scrollTop || top > el.scrollTop + h - 20) el.scrollTop = top - h / 3;
  }
}
$('#simT').addEventListener('input', e => { if (!prog) return; simT = prog.minutes * e.target.value / 1000; updateSim(); });
$('#btnPlay').addEventListener('click', () => {
  if (!prog) return;
  playing = !playing;
  $('#btnPlay').textContent = playing ? 'Pause' : 'Play';
  if (playing) { if (simT >= prog.minutes) simT = 0; lastFrame = performance.now(); requestAnimationFrame(tick); }
});
function tick(now) {
  if (!playing || !prog) return;
  const dt = (now - lastFrame) / 60000 * +$('#simSpeed').value; lastFrame = now;
  simT = Math.min(prog.minutes, simT + dt);
  updateSim();
  if (simT >= prog.minutes) { playing = false; $('#btnPlay').textContent = 'Play'; return; }
  requestAnimationFrame(tick);
}

/* ── sync points ───────────────────────────────────────── */
let pick = null; // null | { stage: 'l' | 'r', l: fraction, pt: [x, y] }
function setPick(p) {
  pick = p;
  const hint = $('#pickHint'), cv = $('#cvSide');
  if (!pick) { hint.hidden = true; cv.classList.remove('picking'); }
  else {
    hint.hidden = false; cv.classList.add('picking');
    hint.textContent = pick.stage === 'l' ? 'Click the LEFT face (blue outline) · Esc cancels' : 'Now click the matching spot on the RIGHT face (orange)';
  }
  if (scene) { scene.pickPending = pick && pick.pt; side.draw(); }
}
side.onPick = (pt, scale) => {
  if (!pick || !scene || !scene.partL || showing === 'loaded') return;
  const poly = (pick.stage === 'l' ? scene.partL : scene.partR).slice(0, -1);
  const f = G.fractionOf(poly, pt);
  if (f.dist * scale > 30) { flash(`Click closer to the ${pick.stage === 'l' ? 'blue (left)' : 'orange (right)'} outline.`); return; }
  if (pick.stage === 'l') { setPick({ stage: 'r', l: f.t, pt }); return; }
  st.sync = (st.sync || []).concat([{ l: +pick.l.toFixed(5), r: +f.t.toFixed(5) }]);
  setPick(null); rebuild(false);
};
$('#btnSyncAdd').addEventListener('click', () => {
  if (!result) { flash(buildErr || 'Set up both faces first.'); return; }
  if (showing === 'loaded') { showing = 'generated'; setProgram(true); }
  setPick({ stage: 'l' });
});
$('#btnSyncClear').addEventListener('click', () => { st.sync = []; setPick(null); rebuild(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && pick) setPick(null); });
function renderSync() {
  const ol = $('#syncList'); ol.innerHTML = '';
  const marks = result ? result.syncMarks.filter(m => m.user) : [];
  let k = 0;
  for (const m of marks) {
    k++;
    const li = document.createElement('li'); if (m.from === 'dxf') li.className = 'dxf';
    const b = document.createElement('b'); b.textContent = k;
    const s = document.createElement('span'); s.textContent = m.from === 'dxf' ? 'from the DXFs' : 'added here';
    li.append(b, s);
    if (m.from === 'app') {
      const appPairs = (st.sync || []).slice().sort((x, y) => x.l - y.l);
      const idx = marks.filter(x => x.from === 'app').indexOf(m), pair = appPairs[idx];
      const del = document.createElement('button'); del.className = 'small ghost'; del.textContent = '×'; del.title = 'Remove this pair';
      del.onclick = () => { st.sync = (st.sync || []).filter(p => p !== pair); rebuild(false); };
      li.append(del);
    }
    ol.append(li);
  }
}

/* ── top bar ───────────────────────────────────────────── */
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/plain' }));
  a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const safeName = () => (st.name || 'cut').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'cut';
$('#btnDownload').addEventListener('click', () => {
  if (!result) { flash(buildErr || 'Nothing to download yet.'); return; }
  download(safeName() + '.nc', result.gcode);
});
$('#btnSave').addEventListener('click', () => download(safeName() + '.hotwire.json', JSON.stringify(st, null, 1), 'application/json'));
$('#fileOpen').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try { st = merge(M.DEFAULTS, JSON.parse(await f.text())); fillForm(); rebuild(true); }
  catch (err) { flash('Could not open ' + f.name + ': ' + err.message); }
  e.target.value = '';
});
$('#fileNc').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const parsed = M.parseGcode(await f.text());
    if (parsed.moves.length < 2) throw new Error('no X/Y/A/Z moves found');
    loaded = { name: f.name, parsed }; showing = 'loaded'; simT = 0; setProgram(true);
  } catch (err) { flash('Could not read ' + f.name + ': ' + err.message); }
  e.target.value = '';
});
function exampleState(key) {
  const ex = X[key], s = merge(M.DEFAULTS, ex.settings);
  if (ex.src) {
    const w = +G.bbox(ex.src.pts).w.toFixed(4);
    s.left = merge(M.DEFAULTS.left, { kind: 'file', src: clone(ex.src), chord: w });
    s.right = merge(M.DEFAULTS.right, { kind: 'same', chord: w });
  }
  return s;
}
const exSel = $('#exampleSel');
for (const k in X) { const o = document.createElement('option'); o.value = k; o.textContent = X[k].label; exSel.append(o); }
exSel.addEventListener('change', () => {
  if (!exSel.value) return;
  st = exampleState(exSel.value); exSel.value = '';
  showing = 'generated'; simT = 0; fillForm(); rebuild(true);
});
for (const b of $$('#view3d button')) b.addEventListener('click', () => { $$('#view3d button').forEach(x => x.classList.toggle('on', x === b)); v3d.preset(b.dataset.v); });
$('[data-fit="side"]').addEventListener('click', () => side.fit());

function flash(t) { const box = $('#msgs'); const d = document.createElement('div'); d.className = 'msg bad'; d.textContent = t; box.prepend(d); }
function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* ignore */ } }

new ResizeObserver(() => { side.draw(); v3d.draw(); }).observe($('.views'));
window.HWApp = { side, get scene() { return scene; }, get state() { return st; } }; // for debugging in the console
fillForm(); rebuild(true);
})();
