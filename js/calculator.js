// Calculator: pure functions, no DOM. SPEC §1 pipeline.
//
// Internal units are SI: d in mm, At in mm², Sp in MPa, forces in N,
// torques in N·mm. Inch inputs are converted with the exact factors below.

export const UNIT = Object.freeze({
  MM_PER_IN: 25.4,                          // exact
  MM2_PER_IN2: 645.16,                      // 25.4²
  N_PER_LBF: 4.4482216152605,               // exact (NIST SP 811)
  MPA_PER_KPSI: 4448.2216152605 / 645.16,   // 1000 lbf/in² in N/mm² = 6.894757...
  NMM_PER_LBFIN: 4.4482216152605 * 25.4,    // 112.98... N·mm
  NMM_PER_LBFFT: 4.4482216152605 * 304.8,   // 1355.8... N·mm
});

const EPS = 1e-9;

// Tensile stress area, SPEC §2 (Shigley Tables 8-1 and 8-2 footnotes).
// Metric: d and P in mm -> mm². Unified: D in in, n in TPI -> in².
export function tensileStressArea(system, d, pitchOrTpi) {
  if (!(d > 0) || !(pitchOrTpi > 0)) return null;
  const root = system === 'metric' ? d - 0.9382 * pitchOrTpi : d - 0.9743 / pitchOrTpi;
  return root > 0 ? (Math.PI / 4) * root * root : null;
}

export function numberedDiameter(n) {
  return Math.round((0.060 + 0.013 * n) * 1e4) / 1e4;
}

// ---------------------------------------------------------------- Sp lookup

export function inRange(d, row) {
  const lo = row.d_min_exclusive ? d > row.d_min + EPS : d >= row.d_min - EPS;
  const hi = row.d_max_exclusive ? d < row.d_max - EPS : d <= row.d_max + EPS;
  return lo && hi;
}

export function outOfFineScope(row, thread) {
  const fp = row.fine_pitch_d_min;
  return thread.series === 'fine' && fp != null && thread.d < fp - EPS;
}

const PRODUCT_NAMES = { shcs: 'socket head cap screws', hex: 'hex head cap screws' };

export function coversProduct(item, product) {
  return !item.products || item.products.includes(product);
}

// Proof strength for a grade and thread, using the JSON lookup rule: only
// rows covering the head type (product: 'shcs' | 'hex') count, the lowest
// priority number wins (1 = Shigley, 2 = governing standard), rows whose
// scope covers the thread are preferred, and other matching rows are
// returned as cross-checks. thread = { system, d (native units), series }.
export function resolveSp(grade, thread, finePitchNote = '', product = 'shcs') {
  if (!grade || !thread || !(thread.d > 0)) return null;
  if (grade.system !== thread.system) {
    return { value: null, reason: `${grade.label} is ${grade.system === 'inch' ? 'an inch' : 'a metric'} grade; the thread is ${thread.system}.` };
  }
  if (!coversProduct(grade, product)) {
    return { value: null, reason: `${grade.label} does not cover ${PRODUCT_NAMES[product] ?? product}.` };
  }
  const matches = grade.rows.filter((r) => inRange(thread.d, r) && coversProduct(r, product));
  if (!matches.length) {
    return { value: null, reason: `${grade.label} has no tabulated proof strength for this size.` };
  }
  matches.sort((a, b) => a.priority - b.priority || outOfFineScope(a, thread) - outOfFineScope(b, thread));
  const row = matches[0];
  if (row.value == null) return { value: null, reason: row.note, row };
  const oos = outOfFineScope(row, thread);
  return {
    value: row.value,
    unit: row.unit,
    Sy: row.Sy,
    method: row.method,
    source: row.source,
    sourceId: row.source_id,
    fromShigley: row.source_id === 'shigley',
    verified: row.verified,
    note: row.note,
    scopeNote: oos ? finePitchNote.replace('{source}', row.source) : null,
    crossChecks: matches.slice(1)
      .filter((r) => r.value != null)
      .map((r) => ({ value: r.value, unit: r.unit, source: r.source, agrees: Math.abs(r.value - row.value) < EPS })),
    row,
  };
}

// ---------------------------------------------------------------- core math

// T = K·Fi·d, Shigley Eq. 8-27 (any consistent units).
export function torque(K, Fi, d) {
  return K * Fi * d;
}

// Preload produced by torque T with coefficient K (Eq. 8-27 inverted).
export function preloadAtTorque(T, K, d) {
  return T / (K * d);
}

// SPEC §1. Inputs in SI (At mm², Sp MPa, d mm, runningTorque N·mm).
// K = null gives preload only. gamma = null gives no range.
export function calculate({ At, Sp, d, f, K = null, gamma = null, lockingInsert = false, runningTorque = null }) {
  const Fp = At * Sp;                                           // Shigley Eq. 8-32
  const Fi = f * Fp;                                            // Shigley Eq. 8-31
  const FiMin = gamma == null ? null : (1 - gamma) * Fi;        // NASA-STD-5020B Eq. 4
  const FiMax = gamma == null ? null : (1 + gamma) * Fi;        // NASA-STD-5020B Eq. 3
  const Tseat = K == null ? null : torque(K, Fi, d);            // Shigley Eq. 8-27
  const Tprev = lockingInsert && runningTorque != null ? runningTorque : null;
  const Tinst = Tseat != null && Tprev != null ? Tseat + Tprev : null;
  return {
    Fp, Fi, FiMin, FiMax, Tseat, Tprev, Tinst,
    FiMaxOverFp: FiMax == null ? null : FiMax / Fp,
    runningTorqueMissing: lockingInsert && Tprev == null,
  };
}

// Torque for the target preload and resulting scatter for every lubricant,
// plus the preload each one would give at the selected seating torque.
export function compareLubricants(lubricants, { Fi, Fp, d, selectedTorque = null, customK = null, customGamma = null }) {
  return lubricants.map((l) => {
    const custom = l.id === 'custom';
    const K = custom ? customK : l.K.value;
    const gamma = custom ? customGamma : l.gamma.value;
    const row = { id: l.id, label: l.label, K, gamma, T: null, FiMin: null, FiMax: null, FiAtSelected: null, ratio: null, overProof: false };
    if (gamma != null) {
      row.FiMin = (1 - gamma) * Fi;
      row.FiMax = (1 + gamma) * Fi;
    }
    if (K != null && K > 0) {
      row.T = torque(K, Fi, d);
      if (selectedTorque != null) {
        row.FiAtSelected = preloadAtTorque(selectedTorque, K, d);
        row.ratio = row.FiAtSelected / Fi;
        row.overProof = row.FiAtSelected > Fp;
      }
    }
    return row;
  });
}

// ---------------------------------------------------------------- warnings

const STAINLESS_LUBES_AT_RISK = new Set(['dry', 'unknown']);

// SPEC §7. Returns [{ id, level: 'danger' | 'warn' | 'info', text }].
export function warnings({ result = null, spMissing = false, stainless = false, lubricant = null,
                           f = null, engagement = null, torqueShown = false }) {
  const out = [];
  if (spMissing) {
    out.push({ id: 'W2', level: 'danger', text: 'Proof strength not verified. Enter Sp to calculate.' });
  }
  if (result && result.FiMax != null && result.FiMax > result.Fp) {
    const pct = Math.round(result.FiMaxOverFp * 100);
    out.push({ id: 'W1', level: 'danger',
      text: `Worst-case preload exceeds proof load (Fi,max = ${pct}% of Fp). Lubricate, lower f, or use a better tightening method.` });
  }
  if (stainless && lubricant && STAINLESS_LUBES_AT_RISK.has(lubricant.id)) {
    out.push({ id: 'W3', level: 'warn', text: 'Stainless threads can gall when tightened dry. Anti-seize is recommended.' });
  }
  if (f != null && f > 0.90 + EPS) {
    out.push({ id: 'W4', level: 'warn', text: `f = ${f} exceeds Shigley's highest recommendation (0.90, Eq. 8-31).` });
  }
  if (engagement && engagement.warnings && engagement.warnings.includes('W5')) {
    out.push({ id: 'W5', level: 'warn',
      text: 'Tapped soft material: risk of thread stripping and under-head bearing crush. Use a helical insert, or verify engagement length and bearing pressure (outside Shigley; e.g., VDI 2230).' });
  }
  if (torqueShown && lubricant && engagement) {
    out.push({ id: 'W6', level: 'info',
      text: `Torque valid ONLY for: ${lubricant.label} on threads and under head, ${engagement.label.toLowerCase()}.` });
  }
  out.push({ id: 'W7', level: 'info',
    text: 'Torque is a poor indicator of preload; measure bolt elongation where reliability matters (after Shigley p. 433).' });
  return out;
}
