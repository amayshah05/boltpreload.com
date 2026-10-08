// UI: DOM wiring only. Parsing lives in parser.js, math in calculator.js.

import { parseTitle, selectGrade, productLabel } from './parser.js';
import { UNIT, tensileStressArea, resolveSp, coversProduct, calculate, compareLubricants, warnings } from './calculator.js';

const $ = (id) => document.getElementById(id);

// Real titles from tests/titles.txt.
const EXAMPLES = [
  ['M14 × 2 alloy steel', 'Black-Oxide Alloy Steel Socket Head Screw\nM14 x 2 mm Thread Size, 20 mm Long'],
  ['1/4"-20 zinc-plated alloy', 'Zinc-Plated Alloy Steel Socket Head Screw\nUS Origin, 1/4"-20 Thread Size, 1" Long'],
  ['M5 × 0.8 18-8 stainless', 'Black-Oxide 18-8 Stainless Steel Socket Head Screws\nM5 x 0.8 mm Thread Size, 20 mm Long'],
  ['10-32 316 sealing', 'Sealing Socket Head Screw\n316 Stainless Steel with Buna-N O-Ring, 10-32 Thread, 5/8" Long'],
  ['1/4"-20 Grade 5 hex head', 'Medium-Strength Grade 5 Steel Hex Head Screw\nZinc-Plated, 1/4"-20 Thread Size, 3-1/2" Long, Partially Threaded'],
  ['Pan head (out of scope)', 'Zinc-Plated Steel Pan Head Phillips Screw\n8-32 Thread, 1-1/8" Long'],
];

let data = null;
const idx = { grades: new Map(), lubes: new Map(), engagement: new Map(), sizes: [] };

const state = {
  parse: null,
  parseKey: '',
  product: 'shcs',     // head type: 'shcs' | 'hex' (SPEC §1); socket head unless a hex title says otherwise
  thread: null,        // { id, system, size, series, d, pitch, tpi, At, atUser, custom, pitchSource, pitchShigley }
  gradeId: '',
  gradeInferred: false,
  gradeConfirmed: false,
  gradeMsg: null,
  spUser: null,        // user-entered Sp in native units (MPa or kpsi)
  lubeId: '',
  customK: null,
  customGamma: null,
  joint: 'reusable',
  customF: null,
  engagementId: 'nut_steel',
  runningNmm: null,
  reused: false,
  gammaOverride: null,
  units: 'metric',
};

// ------------------------------------------------------------ DOM helpers

function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : String(c));
  }
  return node;
}

// Source label. Anything not from Shigley says so.
function src(text, sourceId) {
  if (sourceId === 'user') return h('span', { class: 'src user' }, text);
  if (sourceId === 'shigley') return h('span', { class: 'src' }, text);
  return h('span', { class: 'src ext' }, `${text} · not from Shigley`);
}

function num(v) {
  const x = typeof v === 'string' ? v.trim() : v;
  if (x === '' || x == null) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

// n significant figures, keeping trailing zeros ("84.0"), with thousands separators.
function sig(x, n = 3) {
  if (x == null || !Number.isFinite(x)) return '—';
  if (x === 0) return '0';
  let s = x.toPrecision(n);
  if (s.includes('e')) s = String(Number(s));
  const [int, frac] = s.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${grouped}.${frac}` : grouped;
}

// Short K source for tables: "Shigley T8-15", "Shigley p. 430", "NASA NTRS 20150004064".
function shortKSource(l) {
  const s = l.K.source;
  if (s.startsWith('Shigley Table 8-15')) return 'Shigley T8-15';
  if (s.startsWith('Shigley p. 430')) return 'Shigley p. 430';
  return s.replace(/,.*$/, '').replace(' (not Shigley)', '');
}

// Echo of an input value: up to 6 significant figures, no padding zeros.
function plain(x) {
  return x == null || !Number.isFinite(x) ? '—' : String(Number(x.toPrecision(6)));
}

function pct(x) {
  return `${plain(Math.round(x * 1000) / 10)}%`;
}

function inputValue(x, n = 4) {
  return x == null || !Number.isFinite(x) ? '' : String(Number(x.toPrecision(n)));
}

// ------------------------------------------------------------ units

const NATIVE = {
  metric: { len: 'mm', area: 'mm²', stress: 'MPa' },
  inch: { len: 'in', area: 'in²', stress: 'kpsi' },
};

function fmtForce(N) {
  if (state.units === 'metric') {
    return Math.abs(N) < 1000 ? { main: `${sig(N)} N` } : { main: `${sig(N / 1000)} kN` };
  }
  const lbf = N / UNIT.N_PER_LBF;
  return { main: `${sig(lbf)} lbf`, alt: Math.abs(lbf) >= 1000 ? `${sig(lbf / 1000)} kip` : null };
}

function fmtTorque(Nmm) {
  if (state.units === 'metric') return { main: `${sig(Nmm / 1000)} N·m` };
  return { main: `${sig(Nmm / UNIT.NMM_PER_LBFIN)} in·lbf`, alt: `${sig(Nmm / UNIT.NMM_PER_LBFFT)} ft·lbf` };
}

function torqueInputFactor() {
  return state.units === 'metric' ? 1000 : UNIT.NMM_PER_LBFIN;   // display unit -> N·mm
}

// Thread and strength values in SI for the calculator.
function toSI(t, spNative) {
  const inch = t.system === 'inch';
  return {
    d: inch ? t.d * UNIT.MM_PER_IN : t.d,
    At: inch ? t.At * UNIT.MM2_PER_IN2 : t.At,
    Sp: inch ? spNative * UNIT.MPA_PER_KPSI : spNative,
  };
}

// ------------------------------------------------------------ thread state

function threadsForSize(system, size) {
  return data.threads.filter((t) => t.system === system && t.size === size);
}

function sizeLabel(t) {
  return t.system === 'metric' || t.number != null ? t.size : `${t.size}"`;
}

function setThread(t) {
  state.thread = {
    id: t.id, system: t.system, size: t.size, series: t.series, d: t.d,
    pitch: t.system === 'metric' ? t.pitch : null, tpi: t.tpi, At: t.At, atUser: false, custom: false,
    designation: t.designation, pitchSource: t.pitch_source, pitchShigley: t.pitch_source_id === 'shigley',
  };
}

// d and pitch/TPI typed by the user: use the dataset thread if one matches.
function setThreadFromValues(system, d, p) {
  const match = data.threads.find((t) => t.system === system && Math.abs(t.d - d) < 1e-6 &&
    (system === 'metric' ? Math.abs(t.pitch - p) < 1e-6 : t.tpi === p));
  if (match) return setThread(match);
  const sameSize = data.threads.filter((t) => t.system === system && Math.abs(t.d - d) < 1e-6);
  const coarse = sameSize.find((t) => t.series === 'coarse');
  state.thread = {
    id: null, system, size: 'custom', d,
    series: system === 'metric' && coarse && p != null && Math.abs(coarse.pitch - p) > 1e-6 ? 'fine' : 'custom',
    pitch: system === 'metric' ? p : null, tpi: system === 'inch' ? p : null,
    At: tensileStressArea(system, d, p), atUser: false, custom: true,
    designation: system === 'metric' ? `M${d} × ${p ?? '?'}` : `${d}"-${p ?? '?'}`,
    pitchSource: 'user input', pitchShigley: false,
  };
}

function defaultThreadForSize(system, size) {
  const ts = threadsForSize(system, size);
  return ts.find((t) => t.series === 'coarse' || t.series === 'UNC') || ts[0];
}

// ------------------------------------------------------------ grade / Sp

function gradesFor(system, product) {
  return data.grades.filter((g) => g.system === system && coversProduct(g, product));
}

function gradeLabel(g) {
  return g.label_by_product?.[state.product] ?? g.label;
}

function currentGrade() {
  return idx.grades.get(state.gradeId) || null;
}

function applyGradeSelection(sel) {
  state.gradeId = sel.gradeId || '';
  state.gradeInferred = sel.inferred;
  state.gradeConfirmed = false;
  state.gradeMsg = sel.message;
  state.spUser = null;
}

function currentSp() {
  const t = state.thread;
  const g = currentGrade();
  const resolved = t && g ? resolveSp(g, { system: t.system, d: t.d, series: t.series }, data.fine_pitch_note, state.product) : null;
  if (state.spUser != null) return { value: state.spUser, user: true, resolved };
  if (resolved && resolved.value != null) return { value: resolved.value, user: false, resolved };
  return { value: null, user: false, resolved };
}

function isStainless() {
  const g = currentGrade();
  if (g) return /stainless/i.test(g.material);
  return /^ss_/.test(state.parse?.material?.key || '');
}

// ------------------------------------------------------------ f, K, Gamma

function currentF() {
  if (state.joint === 'custom') return state.customF;
  return data.preload_fraction.options.find((o) => o.id === state.joint).f;
}

function currentLube() {
  return idx.lubes.get(state.lubeId) || null;
}

function currentK(lube) {
  if (!lube) return null;
  return lube.id === 'custom' ? state.customK : lube.K.value;
}

function currentGamma(lube) {
  if (state.gammaOverride != null) return { value: state.gammaOverride, user: true };
  if (!lube) return { value: null, user: false };
  if (lube.id === 'custom') return { value: state.customGamma, user: true };
  return { value: lube.gamma.value, user: false };
}

// ------------------------------------------------------------ parsing

let parseTimer = null;

function onTitleInput() {
  clearTimeout(parseTimer);
  parseTimer = setTimeout(() => applyParse($('title').value), 150);
}

function applyParse(text) {
  const p = parseTitle(text, data);
  state.parse = p.status === 'empty' ? null : p;
  if (!state.parse) {
    render();
    return;
  }
  if (p.thread) setThread(p.thread);
  else state.thread = null;

  state.product = p.product ?? 'shcs';
  const sel = selectGrade(p, data, state.product);
  applyGradeSelection(sel);

  // A different screw means a fresh lubrication choice (SPEC §4: never pre-selected).
  const key = [p.product, p.thread?.id, p.material?.key, p.finish?.key, sel.gradeId].join('|');
  if (key !== state.parseKey) {
    state.parseKey = key;
    state.lubeId = '';
    state.runningNmm = null;   // a measured running torque belongs to one screw
    if (p.thread) setUnits(p.thread.system);
  }
  render();
}

function setUnits(u) {
  state.units = u;
  for (const r of document.querySelectorAll('input[name="units"]')) r.checked = r.value === u;
}

// ------------------------------------------------------------ builders (once)

function buildExamples() {
  const box = $('examples');
  for (const [label, title] of EXAMPLES) {
    box.append(h('button', { type: 'button', class: 'chip', title: title.replace('\n', ' '),
      onclick: () => { $('title').value = title; applyParse(title); } }, label));
  }
}

function buildSizeSelect() {
  const seen = new Set();
  const groups = { metric: h('optgroup', { label: 'Metric (ISO)' }), inch: h('optgroup', { label: 'Inch (Unified)' }) };
  for (const t of data.threads) {
    const key = `${t.system}|${t.size}`;
    if (seen.has(key)) continue;
    seen.add(key);
    groups[t.system].append(h('option', { value: key }, sizeLabel(t)));
  }
  $('size').append(
    h('option', { value: '' }, 'Choose a size…'),
    groups.metric, groups.inch,
    h('optgroup', { label: 'Other' },
      h('option', { value: 'metric|custom' }, 'Custom metric thread'),
      h('option', { value: 'inch|custom' }, 'Custom inch thread')),
  );
}

function buildHeadSelect() {
  $('head').append(...data.products.options.map((o) => h('option', { value: o.id }, o.label)));
}

function buildLubeSelect() {
  $('lube').append(h('option', { value: '' }, 'Choose lubrication…'),
    ...data.lubricants.map((l) => h('option', { value: l.id }, l.label)));
}

function buildEngagementSelect() {
  $('engagement').append(...data.engagement.map((e) => h('option', { value: e.id }, e.label)));
}

function buildInfo() {
  const F = data.formulas;
  const sc = data.shigley_scatter;
  const gp = data.gamma_policy;
  const lubed = data.lubricants.filter((l) => l.K.value != null && l.K.source_id === 'shigley');
  $('info').append(
    h('h3', {}, 'How it\'s calculated'),
    h('ol', {},
      h('li', {}, `Tensile stress area: metric ${F.At_metric.expression}, unified ${F.At_unified.expression} `,
        src('Shigley Table 8-1 / 8-2 footnotes, pp. 404-405', 'shigley'),
        ' Numbered sizes: ', F.numbered_diameter.expression, ' ', src('ASME B1.1', 'asme_b1_1')),
      h('li', {}, 'Proof strength Sp from the grade tables ', src('Shigley Tables 8-9 to 8-11', 'shigley'),
        ', otherwise from the governing standard (labeled). Where a standard gives only yield strength, ',
        F.approx_proof_strength.expression, ' ', src(F.approx_proof_strength.source, 'shigley')),
      h('li', {}, `Proof load ${F.proof_load.expression} `, src(F.proof_load.source, 'shigley')),
      h('li', {}, `Preload ${F.preload.expression}, f = 0.75 for reusable joints, 0.90 for permanent `, src(F.preload.source, 'shigley')),
      h('li', {}, `Seating torque ${F.torque.expression} `, src(F.torque.source, 'shigley'),
        ' with K from ', src('Shigley Table 8-15, p. 431', 'shigley'), ' (K = 0.20 when unknown ',
        src('Shigley p. 430', 'shigley'), '). ', data.products.bearing_face_note, ' ',
        src(data.products.source, data.products.source_id)),
      h('li', {}, `Preload range ${F.preload_range.expression} `, src('NASA-STD-5020B Sec. 4.3.1, Eqs. 3-4', 'nasa')),
      h('li', {}, 'Screw-locking inserts: T_inst = T_seat + measured running torque (SPEC §5). Running torque adds no preload.'),
    ),
    h('h3', {}, 'Preload scatter at the same torque'),
    h('p', {}, `${sc.unlubricated.n} unlubricated bolts: σ = ${sc.unlubricated.std_kN} kN on a mean of ${sc.unlubricated.mean_kN} kN (${Math.round(sc.unlubricated.cov * 1000) / 10}%) `,
      src(sc.unlubricated.table, 'shigley'), `. ${sc.lubricated.n} lubricated bolts: σ = ${sc.lubricated.std_kN} kN on ${sc.lubricated.mean_kN} kN (${Math.round(sc.lubricated.cov * 1000) / 10}%) `,
      src(sc.lubricated.table, 'shigley'), '.'),
    h('p', {}, `The range shown uses Γ = ${gp.lubricated} lubricated / ${gp.non_lubricated_or_as_received} non-lubricated or as-received `,
      src(gp.clause, 'nasa'), `. ${gp.applicability} ${gp.lubricated_definition}`),
    h('p', {}, data.lubrication_notes.always, ' Torque coefficients: ',
      lubed.map((l) => `${l.label} ${l.K.value.toFixed(2)}`).join(', '), '.'),
    h('h3', {}, 'Data notes'),
    h('ul', {},
      h('li', {}, data.lookup_rule),
      h('li', {}, 'Class 8.8 at M16: Shigley Table 8-11 gives 600 MPa, ISO 898-1 gives 580 MPa (d ≤ 16 mm). Shigley is used.'),
      h('li', {}, 'Shigley Table 8-2 prints At = 0.00880 in² for #5-44 UNF; its own formula and ASTM A574/F837 give 0.00830. The formula value is used.'),
      h('li', {}, 'Hex heads: ASTM A574 and F837 are socket head specifications and are not offered. ASTM F593 covers hex cap screws from 1/4 in; stainless hex heads below 1/4 in have no verified Sp.'),
      h('li', {}, data.reused_insert.note),
    ),
    h('h3', {}, 'Sources'),
    h('ul', { class: 'src-list' }, Object.entries(data.sources).map(([id, s]) =>
      h('li', {}, s.citation, ' ', s.is_shigley ? src('primary source', 'shigley') : src('secondary', id),
        s.verification ? h('div', { class: 'muted small' }, s.verification) : null,
        (s.urls || []).map((u) => h('div', { class: 'small' }, h('a', { href: u, rel: 'noopener', target: '_blank' }, u)))))),
  );
}

// ------------------------------------------------------------ render

function render() {
  renderParseStatus();
  renderHead();
  renderThread();
  renderGrade();
  renderFacts();
  renderConditions();
  const ctx = compute();
  renderResults(ctx);
  renderWarnings(ctx);
  renderCompare(ctx);
}

function banner(level, ...paras) {
  return h('div', { class: `banner ${level}` }, paras.filter(Boolean).map((p) => h('p', {}, p)));
}

function renderParseStatus() {
  const box = $('parse-status');
  box.replaceChildren();
  const p = state.parse;
  $('detected-title').textContent = p && p.thread ? 'Detected values' : 'Manual entry';
  if (!p) return;
  if (p.ok) {
    const bits = [p.thread.designation, p.material?.text, p.finish?.text, p.statedGrade?.text].filter(Boolean);
    box.append(banner('ok', `Read: ${bits.join(' · ')}. Every value below is editable.`, ...p.notes));
    return;
  }
  const level = p.status === 'out_of_scope' && p.thread ? 'warn' : 'danger';
  const tail = p.thread ? 'Values below were read from the title; check them before use.'
    : 'Choose the size, thread and grade manually below.';
  box.append(banner(level, ...p.errors, ...p.notes, tail));
}

function renderHead() {
  $('head').value = state.product;
  const note = $('head-note');
  note.replaceChildren();
  if (state.product === 'hex') {
    note.append(data.products.bearing_face_note, ' ', src(data.products.source, data.products.source_id));
  }
}

function renderThread() {
  const t = state.thread;
  const sizeSel = $('size');
  sizeSel.value = t ? `${t.system}|${t.size}` : '';

  const seriesSel = $('series');
  seriesSel.replaceChildren();
  const pitchList = $('pitch-list');
  pitchList.replaceChildren();
  const system = t?.system ?? 'metric';
  const n = NATIVE[system];
  for (const s of document.querySelectorAll('[data-unit="len"]')) s.textContent = `(${n.len})`;
  for (const s of document.querySelectorAll('[data-unit="area"]')) s.textContent = `(${n.area})`;
  for (const s of document.querySelectorAll('[data-unit="stress"]')) s.textContent = `(${n.stress})`;
  $('pitch-label').textContent = system === 'metric' ? 'Pitch P (mm)' : 'Threads per inch n';

  for (const id of ['series', 'd', 'pitch', 'at']) $(id).disabled = !t;
  if (!t) {
    for (const id of ['d', 'pitch', 'at']) $(id).value = '';
    $('at-src').replaceChildren();
    return;
  }
  if (t.custom) {
    seriesSel.append(h('option', { value: t.series }, t.series === 'fine' ? 'Fine (non-standard pitch)' : 'Custom'));
  } else {
    const ts = threadsForSize(t.system, t.size);
    for (const s of [...new Set(ts.map((x) => x.series))]) {
      seriesSel.append(h('option', { value: s }, s === 'coarse' ? 'Coarse' : s === 'fine' ? 'Fine' : s));
    }
    for (const x of ts) pitchList.append(h('option', { value: t.system === 'metric' ? x.pitch : x.tpi }));
  }
  seriesSel.value = t.series;

  if (document.activeElement !== $('d')) $('d').value = inputValue(t.d, 6);
  if (document.activeElement !== $('pitch')) $('pitch').value = inputValue(t.system === 'metric' ? t.pitch : t.tpi, 6);
  if (document.activeElement !== $('at')) $('at').value = inputValue(t.At, 5);
  $('at').classList.toggle('is-user', t.atUser);

  const atSrc = $('at-src');
  atSrc.replaceChildren();
  if (t.atUser) {
    atSrc.append(src('user input', 'user'));
  } else {
    atSrc.append(src(t.system === 'metric' ? 'Shigley Table 8-1 footnote formula' : 'Shigley Table 8-2 footnote formula', 'shigley'));
    atSrc.append(t.custom ? src('pitch: user input', 'user')
      : src(`pitch: ${t.pitchSource}`, t.pitchShigley ? 'shigley' : 'iso'));
  }
}

function renderGrade() {
  const sel = $('grade');
  sel.replaceChildren();
  const t = state.thread;
  sel.disabled = !t;
  sel.append(h('option', { value: '' }, 'Choose a grade…'));
  if (t) {
    for (const g of gradesFor(t.system, state.product)) sel.append(h('option', { value: g.id }, gradeLabel(g)));
  }
  sel.append(h('option', { value: 'custom' }, 'Other: enter Sp'));
  const g0 = currentGrade();
  if (state.gradeId && state.gradeId !== 'custom' && !(t && g0?.system === t.system && coversProduct(g0, state.product))) {
    state.gradeId = '';
  }
  sel.value = state.gradeId;

  const msg = $('grade-msg');
  msg.replaceChildren();
  if (state.gradeInferred && state.gradeId) {
    const box = h('div', { class: `banner ${state.gradeConfirmed ? 'ok' : 'warn'} flag` },
      h('input', { type: 'checkbox', id: 'grade-confirm', checked: state.gradeConfirmed,
        onchange: (e) => { state.gradeConfirmed = e.target.checked; render(); } }),
      h('label', { for: 'grade-confirm' }, state.gradeConfirmed
        ? 'Grade checked against the product page.'
        : `${data.inferred_grade_flag} Tick when checked.`));
    msg.append(box);
  } else if (state.gradeMsg && !state.gradeId) {
    msg.append(banner('warn', state.gradeMsg));
  }

  const sp = currentSp();
  const spIn = $('sp');
  spIn.disabled = !t;
  if (document.activeElement !== spIn) spIn.value = sp.value == null ? '' : inputValue(sp.value, 6);
  spIn.placeholder = t ? 'enter Sp' : '';
  spIn.classList.toggle('is-user', sp.user);
  $('sp-reset').hidden = !(sp.user && sp.resolved && sp.resolved.value != null);

  const line = $('sp-src');
  line.replaceChildren();
  if (!t) return;
  if (sp.user) {
    line.append(src('user input', 'user'));
  } else if (sp.resolved && sp.resolved.value != null) {
    const r = sp.resolved;
    line.append(src(r.source, r.sourceId));
    if (r.method !== 'direct proof strength') {
      line.append(src(`0.85 × Sy (Sy = ${plain(r.Sy)} ${r.unit})`, 'shigley'));
    }
    if (r.scopeNote) line.append(h('div', { class: 'banner warn' }, r.scopeNote));
    const disagree = r.crossChecks.filter((c) => !c.agrees);
    if (disagree.length) {
      line.append(h('div', {}, disagree.map((c) => `Cross-check: ${c.source} gives ${plain(c.value)} ${c.unit}. `)));
    }
  } else if (sp.resolved?.reason) {
    line.append(h('div', {}, sp.resolved.reason));
  }
}

function renderFacts() {
  const dl = $('facts');
  dl.replaceChildren();
  const p = state.parse;
  if (!p) return;
  const add = (k, v) => v && dl.append(h('dt', {}, k), h('dd', {}, v));
  add('Head', p.headType ? (p.inScope ? productLabel(data, p.product).toLowerCase() : p.headType) : 'not found');
  add('Material', p.material?.text || 'not found');
  add('Stated grade', p.statedGrade?.text);
  add('Finish', p.finish?.text);
  add('Thread text', p.threadText);
}

function renderConditions() {
  const lube = currentLube();
  $('lube').value = state.lubeId;
  $('custom-k-field').hidden = lube?.id !== 'custom';
  $('custom-gamma-field').hidden = lube?.id !== 'custom';

  const info = $('lube-info');
  info.replaceChildren();
  const finish = state.parse?.finish;
  if (finish) {
    const hints = data.lubrication_notes.finish_hints;
    info.append(banner('info', `Title finish: ${finish.text}. ${hints[finish.key] || hints.other}`));
  }
  if (lube && lube.id !== 'custom') {
    const k = lube.K;
    info.append(h('div', { class: 'src-line' },
      k.value != null ? [`K = ${k.value.toFixed(2)} `, src(k.source.replace(' (not Shigley)', ''), k.source_id)]
        : [h('b', {}, 'K: none. '), k.note, ' Preload only.'],
      h('br'), `Γ = ${lube.gamma.value} (${lube.gamma.basis}) `, src('NASA-STD-5020B Sec. 4.3.3, Table 3', 'nasa')));
    for (const n of lube.notes) info.append(h('p', { class: 'hint' }, n));
  }
  info.append(h('p', { class: 'hint' }, h('b', {}, data.lubrication_notes.always)));
  if (!lube) info.append(h('p', { class: 'hint' }, data.lubrication_notes.no_preselect));

  const f = currentF();
  $('custom-f').hidden = state.joint !== 'custom';
  const fLine = $('f-src');
  fLine.replaceChildren(state.joint === 'custom' ? src('f: user input', 'user') : src(data.preload_fraction.source, 'shigley'));
  if (state.joint === 'custom' && f == null) fLine.append(' Enter f.');

  const eng = idx.engagement.get(state.engagementId);
  $('engagement').value = state.engagementId;
  const eInfo = $('engagement-info');
  eInfo.replaceChildren(...eng.notes.map((n) => h('p', { class: 'hint' }, n)));
  $('running-field').hidden = !eng.requires_running_torque;
  $('running-prompt').textContent = eng.running_torque_prompt || '';
  const runIn = $('running');
  if (document.activeElement !== runIn) {
    runIn.value = state.runningNmm == null ? '' : inputValue(state.runningNmm / torqueInputFactor(), 4);
  }
  for (const s of document.querySelectorAll('[data-unit="torqueIn"]')) {
    s.textContent = state.units === 'metric' ? '(N·m)' : '(in·lbf)';
  }
  $('reused-field').hidden = !eng.insert;
  $('reused').checked = state.reused;
  $('reused-note').hidden = !(eng.insert && state.reused);
  $('reused-note').textContent = data.reused_insert.note;

  const gIn = $('gamma');
  gIn.placeholder = lube && lube.id !== 'custom' ? `default ${lube.gamma.value}` : 'e.g. 0.20';
  gIn.classList.toggle('is-user', state.gammaOverride != null);
}

// ------------------------------------------------------------ compute

function compute() {
  const t = state.thread;
  const sp = currentSp();
  const f = currentF();
  const lube = currentLube();
  const eng = idx.engagement.get(state.engagementId);
  const ctx = { t, sp, f, lube, eng, K: null, gamma: currentGamma(lube), result: null, si: null, missing: [] };
  if (!t) ctx.missing.push('thread');
  else if (!(t.d > 0) || !(t.At > 0)) ctx.missing.push('area');
  if (t && !(sp.value > 0)) ctx.missing.push('sp');
  if (!(f > 0)) ctx.missing.push('f');
  if (lube) {
    ctx.K = currentK(lube);
    if (lube.id === 'custom' && !(ctx.K > 0)) ctx.missing.push('customK');
  }
  const gamma = ctx.gamma.value != null && ctx.gamma.value >= 0 && ctx.gamma.value < 1 ? ctx.gamma.value : null;
  if (ctx.missing.length) return ctx;
  ctx.si = toSI(t, sp.value);
  ctx.result = calculate({
    At: ctx.si.At, Sp: ctx.si.Sp, d: ctx.si.d, f,
    K: lube ? ctx.K : null,
    gamma,
    lockingInsert: Boolean(eng.requires_running_torque),
    runningTorque: state.runningNmm,
  });
  return ctx;
}

// ------------------------------------------------------------ results

const PENDING = {
  thread: 'Paste a title or choose a size and thread.',
  area: 'Enter a positive diameter, pitch and tensile stress area.',
  sp: 'Enter the proof strength Sp (no verified value for this grade and size).',
  f: 'Enter the preload fraction f.',
  customK: 'Enter a custom K.',
};

function metric(label, value, { cls = '', alt = null, sub = [], tags = [] } = {}) {
  return h('div', { class: `metric ${cls}` },
    h('div', { class: 'label' }, label),
    h('div', { class: 'value' }, value, alt ? h('span', { class: 'alt' }, ` (${alt})`) : null),
    sub.map((s) => h('div', { class: 'sub' }, s)),
    tags.length ? h('div', {}, tags) : null);
}

function renderResults(ctx) {
  const box = $('results');
  box.replaceChildren();
  if (ctx.missing.length) {
    box.append(h('ul', { class: 'pending' }, ctx.missing.map((m) => h('li', {}, PENDING[m]))));
    return;
  }
  const r = ctx.result;
  const { lube, eng } = ctx;
  const Fi = fmtForce(r.Fi);
  const Fp = fmtForce(r.Fp);
  const gammaUser = ctx.gamma.user;
  const w1 = r.FiMax != null && r.FiMax > r.Fp;

  const fiSub = [];
  const fiTags = [src('Shigley Eq. 8-31', 'shigley')];
  if (r.FiMin != null) {
    const lo = fmtForce(r.FiMin);
    const hi = fmtForce(r.FiMax);
    const g = r.FiMax / r.Fi - 1;
    fiSub.push(`Range ${lo.main} – ${hi.main} (Γ = ±${pct(g)}); Fi,max = ${Math.round(r.FiMaxOverFp * 100)}% of Fp`);
    fiTags.push(gammaUser ? src('Γ: user input', 'user') : src('Γ: NASA-STD-5020B Sec. 4.3.3', 'nasa'));
  } else {
    fiSub.push('Choose lubrication for the preload range.');
  }

  let torqueCard;
  if (!lube) {
    torqueCard = metric('Tightening torque', '—', { sub: ['Choose lubrication. K moves torque by up to 2.5×.'] });
  } else if (ctx.K == null) {
    torqueCard = metric('Tightening torque', '—', { sub: [`No K for ${lube.label}: ${lube.K.note} Preload only.`] });
  } else {
    const kTag = lube.id === 'custom' ? src(`K = ${ctx.K}: user input`, 'user')
      : src(`K = ${ctx.K.toFixed(2)}: ${lube.K.source.replace(' (not Shigley)', '')}`, lube.K.source_id);
    const seat = fmtTorque(r.Tseat);
    if (eng.requires_running_torque && r.Tinst != null) {
      const inst = fmtTorque(r.Tinst);
      torqueCard = metric('Installation torque T_inst', inst.main, { cls: 'primary', alt: inst.alt,
        sub: [`= T_seat ${seat.main} + T_prevailing ${fmtTorque(r.Tprev).main}`],
        tags: [src('Shigley Eq. 8-27', 'shigley'), kTag, src('T_prevailing: measured', 'user')] });
    } else if (eng.requires_running_torque) {
      torqueCard = metric('Seating torque T_seat', seat.main, { cls: 'primary', alt: seat.alt,
        sub: [h('span', { class: 'tag-excl' }, 'EXCLUDES running torque'), ` ${eng.running_torque_prompt}`],
        tags: [src('Shigley Eq. 8-27', 'shigley'), kTag] });
    } else {
      torqueCard = metric('Tightening torque', seat.main, { cls: 'primary', alt: seat.alt,
        sub: [`T = K·Fi·d`], tags: [src('Shigley Eq. 8-27', 'shigley'), kTag] });
    }
  }

  box.append(h('div', { class: 'headline' },
    metric('Target preload Fi', Fi.main, { cls: `primary ${w1 ? 'danger' : ''}`, alt: Fi.alt, sub: fiSub, tags: fiTags }),
    torqueCard,
    metric('Proof load Fp', Fp.main, { alt: Fp.alt, sub: ['Fp = At·Sp'], tags: [src('Shigley Eq. 8-32', 'shigley')] }),
    metric('Preload fraction f', String(ctx.f), { sub: [state.joint === 'permanent' ? 'Permanent joint' : state.joint === 'reusable' ? 'Reusable / nonpermanent' : 'Custom'],
      tags: [state.joint === 'custom' ? src('user input', 'user') : src('Shigley Eq. 8-31', 'shigley')] }),
  ));
  box.append(renderInputsUsed(ctx));
}

function renderInputsUsed(ctx) {
  const { t, sp } = ctx;
  const n = NATIVE[t.system];
  const items = [];
  items.push(h('li', {}, 'Thread ', h('b', {}, t.designation), `, d = ${plain(t.d)} ${n.len} `,
    t.custom ? src('user input', 'user') : src(state.parse?.thread?.id === t.id ? 'from title' : 'selected', 'user')));
  items.push(h('li', {}, 'At = ', h('b', {}, `${sig(t.At, 4)} ${n.area}`), ' ',
    t.atUser ? src('user input', 'user') : src(t.system === 'metric' ? 'Shigley Table 8-1 footnote formula' : 'Shigley Table 8-2 footnote formula', 'shigley'),
    !t.atUser && !t.custom && !t.pitchShigley ? src(`pitch: ${t.pitchSource}`, 'iso') : null));
  const r = sp.resolved;
  items.push(h('li', {}, 'Sp = ', h('b', {}, `${plain(sp.value)} ${n.stress}`), ' ',
    sp.user ? src('user input', 'user') : [src(r.source, r.sourceId),
      r.method !== 'direct proof strength' ? src(`0.85 × Sy`, 'shigley') : null,
      r.scopeNote ? src('outside the standard\'s fine-pitch scope', 'user') : null],
    ctx.t && currentGrade() ? h('span', { class: 'muted' }, ` (${gradeLabel(currentGrade())})`) : null));
  if (ctx.lube && ctx.K != null) {
    items.push(h('li', {}, 'K = ', h('b', {}, ctx.lube.id === 'custom' ? String(ctx.K) : ctx.K.toFixed(2)), ` (${ctx.lube.label}) `,
      ctx.lube.id === 'custom' ? src('user input', 'user') : src(ctx.lube.K.source.replace(' (not Shigley)', ''), ctx.lube.K.source_id)));
  }
  if (ctx.result.FiMin != null) {
    items.push(h('li', {}, 'Γ = ', h('b', {}, `±${pct(ctx.result.FiMax / ctx.result.Fi - 1)}`), ' ',
      ctx.gamma.user ? src('user input', 'user') : src(`NASA-STD-5020B Sec. 4.3.3, Table 3 (${ctx.lube.gamma.basis})`, 'nasa')));
  }
  return h('ul', { class: 'inputs-used' }, items);
}

function renderWarnings(ctx) {
  const list = $('warnings');
  list.replaceChildren();
  const spMissing = ctx.missing.includes('sp');
  const ws = warnings({
    result: ctx.result,
    spMissing,
    stainless: isStainless(),
    lubricant: ctx.lube,
    f: ctx.f,
    engagement: ctx.eng,
    torqueShown: Boolean(ctx.result && ctx.result.Tseat != null),
  });
  for (const w of ws) list.append(h('li', { class: w.level }, h('span', { class: 'wid' }, w.id), w.text));
}

function renderCompare(ctx) {
  const table = $('compare');
  table.replaceChildren();
  const cap = $('compare-caption');
  cap.replaceChildren();
  if (!ctx.result) {
    cap.append('Complete the thread, grade and preload inputs to compare lubrication options.');
    return;
  }
  const r = ctx.result;
  const selected = ctx.lube && ctx.K != null ? r.Tseat : null;
  const rows = compareLubricants(data.lubricants, { Fi: r.Fi, Fp: r.Fp, d: ctx.si.d, selectedTorque: selected,
    customK: state.customK, customGamma: state.customGamma });
  cap.append(`Torque to reach Fi = ${fmtForce(r.Fi).main} under each condition `, src('Shigley Eq. 8-27', 'shigley'),
    ', and the preload range at that torque ', src('Γ: NASA-STD-5020B', 'nasa'), '.',
    selected != null ? ` The last column is the preload you would get by applying your selected torque (${fmtTorque(selected).main}) under each condition instead: this is why the lubrication must match.` : ' Choose lubrication to see the effect of a mismatch.');
  table.append(h('thead', {}, h('tr', {},
    h('th', {}, 'Lubrication'), h('th', {}, 'K'), h('th', { class: 'num' }, 'Γ'),
    h('th', { class: 'num' }, 'Torque for Fi'), h('th', { class: 'num' }, 'Preload range'),
    h('th', { class: 'num' }, 'Preload at your torque'))));
  const body = h('tbody');
  for (const row of rows) {
    const l = idx.lubes.get(row.id);
    if (row.id === 'custom' && row.K == null) continue;
    body.append(h('tr', { class: row.id === state.lubeId ? 'selected' : '' },
      h('td', { class: 'label-cell' }, l.label),
      h('td', {}, row.K == null ? h('span', { class: 'muted' }, '— preload only')
        : [`${row.id === 'custom' ? row.K : row.K.toFixed(2)} `,
          row.id === 'custom' ? src('user input', 'user') : src(shortKSource(l), l.K.source_id)]),
      h('td', { class: 'num' }, row.gamma == null ? '—' : `±${Math.round(row.gamma * 100)}%`),
      h('td', { class: 'num' }, row.T == null ? '—' : fmtTorque(row.T).main),
      h('td', { class: 'num' }, row.FiMin == null ? '—' : `${fmtForce(row.FiMin).main} – ${fmtForce(row.FiMax).main}`),
      h('td', { class: `num ${row.overProof ? 'over' : ''}` }, row.FiAtSelected == null ? '—'
        : `${fmtForce(row.FiAtSelected).main} (${Math.round(row.ratio * 100)}%)${row.overProof ? ' > Fp' : ''}`)));
  }
  table.append(body);
}

// ------------------------------------------------------------ events

function bindEvents() {
  $('title').addEventListener('input', onTitleInput);

  // SPEC §3: a head-type change re-runs the inference unless the grade came
  // from the title or the user; a grade that no longer applies is cleared.
  $('head').addEventListener('change', (e) => {
    state.product = e.target.value;
    const g = currentGrade();
    if (state.parse && (state.gradeInferred || !state.gradeId)) {
      applyGradeSelection(selectGrade(state.parse, data, state.product));
    } else if (g && !coversProduct(g, state.product)) {
      applyGradeSelection({ gradeId: null, inferred: false,
        message: `${gradeLabel(g)} does not cover ${productLabel(data, state.product).toLowerCase()}s. Choose a grade.` });
    }
    render();
  });

  $('size').addEventListener('change', (e) => {
    const [system, size] = e.target.value.split('|');
    if (!system) { state.thread = null; render(); return; }
    const prevSystem = state.thread?.system;
    if (size === 'custom') {
      state.thread = { id: null, system, size: 'custom', series: 'custom', d: null, pitch: null, tpi: null, At: null,
        atUser: false, custom: true, designation: `custom ${system} thread`, pitchSource: 'user input', pitchShigley: false };
    } else {
      setThread(defaultThreadForSize(system, size));
    }
    if (system !== prevSystem) { state.gradeId = ''; state.gradeInferred = false; state.spUser = null; setUnits(system); }
    render();
  });

  $('series').addEventListener('change', (e) => {
    const t = state.thread;
    if (!t || t.custom) return;
    const next = threadsForSize(t.system, t.size).find((x) => x.series === e.target.value);
    if (next) setThread(next);
    render();
  });

  const onDims = () => {
    const t = state.thread;
    if (!t) return;
    const d = num($('d').value);
    const p = num($('pitch').value);
    if (d == null || d <= 0) return;
    setThreadFromValues(t.system, d, p);
    render();
  };
  $('d').addEventListener('change', onDims);
  $('pitch').addEventListener('change', onDims);

  $('at').addEventListener('input', (e) => {
    if (!state.thread) return;
    const v = num(e.target.value);
    if (v == null) {
      state.thread.atUser = false;
      state.thread.At = tensileStressArea(state.thread.system, state.thread.d, state.thread.system === 'metric' ? state.thread.pitch : state.thread.tpi);
    } else {
      state.thread.At = v;
      state.thread.atUser = true;
    }
    render();
  });

  $('grade').addEventListener('change', (e) => {
    state.gradeId = e.target.value;
    state.gradeInferred = false;
    state.gradeMsg = null;
    state.spUser = null;
    render();
  });

  $('sp').addEventListener('input', (e) => { state.spUser = num(e.target.value); render(); });
  $('sp-reset').addEventListener('click', () => { state.spUser = null; render(); });

  $('lube').addEventListener('change', (e) => { state.lubeId = e.target.value; render(); });
  $('custom-k').addEventListener('input', (e) => { state.customK = num(e.target.value); render(); });
  $('custom-gamma').addEventListener('input', (e) => { state.customGamma = num(e.target.value); render(); });

  for (const r of document.querySelectorAll('input[name="joint"]')) {
    r.addEventListener('change', (e) => { state.joint = e.target.value; render(); });
  }
  $('custom-f').addEventListener('input', (e) => { state.customF = num(e.target.value); render(); });

  $('engagement').addEventListener('change', (e) => { state.engagementId = e.target.value; render(); });
  $('running').addEventListener('input', (e) => {
    const v = num(e.target.value);
    state.runningNmm = v == null ? null : v * torqueInputFactor();
    render();
  });
  $('reused').addEventListener('change', (e) => { state.reused = e.target.checked; render(); });
  $('gamma').addEventListener('input', (e) => { state.gammaOverride = num(e.target.value); render(); });

  for (const r of document.querySelectorAll('input[name="units"]')) {
    r.addEventListener('change', (e) => { state.units = e.target.value; render(); });
  }
}

// ------------------------------------------------------------ init

async function init() {
  try {
    const res = await fetch('data/fastener_standards.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    const b = $('load-error');
    b.hidden = false;
    b.textContent = `Could not load data/fastener_standards.json (${err.message}). Serve this folder over HTTP, e.g. python3 -m http.server.`;
    return;
  }
  for (const g of data.grades) idx.grades.set(g.id, g);
  for (const l of data.lubricants) idx.lubes.set(l.id, l);
  for (const e of data.engagement) idx.engagement.set(e.id, e);
  buildExamples();
  buildHeadSelect();
  buildSizeSelect();
  buildLubeSelect();
  buildEngagementSelect();
  buildInfo();
  bindEvents();
  if ($('title').value.trim()) applyParse($('title').value);
  else render();
}

init();
