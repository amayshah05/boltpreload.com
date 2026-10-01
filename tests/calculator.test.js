// Calculator tests: SPEC §9 cases plus Sp lookup, warnings and units.
// Run: node --test "tests/*.test.js"

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  UNIT, tensileStressArea, resolveSp, calculate, torque, compareLubricants, warnings,
} from '../js/calculator.js';

const data = JSON.parse(fs.readFileSync(new URL('../data/fastener_standards.json', import.meta.url), 'utf8'));
const thread = (id) => data.threads.find((t) => t.id === id);
const grade = (id) => data.grades.find((g) => g.id === id);
const lube = (id) => data.lubricants.find((l) => l.id === id);
const engagement = (id) => data.engagement.find((e) => e.id === id);
const sp = (gradeId, threadId) => resolveSp(grade(gradeId), thread(threadId), data.fine_pitch_note);

function close(actual, expected, rel, msg = '') {
  assert.ok(Math.abs(actual - expected) <= rel * Math.abs(expected),
    `${msg} expected ≈ ${expected}, got ${actual}`);
}

// Inch thread and kpsi strength in SI.
function inchSI(t, spKpsi) {
  return { d: t.d * UNIT.MM_PER_IN, At: t.At * UNIT.MM2_PER_IN2, Sp: spKpsi * UNIT.MPA_PER_KPSI };
}

// ------------------------------------------------------------ SPEC §9 table

test('SPEC 9.1: M6 x 1, Sp 970 MPa, f 0.75, K 0.20 -> Fi ~ 14.6 kN, T ~ 17.5 N-m', () => {
  const t = thread('M6x1');
  const r = calculate({ At: t.At, Sp: 970, d: t.d, f: 0.75, K: 0.20 });
  close(r.Fi / 1000, 14.6, 0.01, 'Fi (kN)');
  close(r.Tseat / 1000, 17.5, 0.01, 'T (N-m)');
});

test('SPEC 9.2: 1/4"-20, Sp 120 kpsi override, f 0.75, K 0.20 -> Fi ~ 2.86 kip, T ~ 143 lbf-in', () => {
  const si = inchSI(thread('1/4-20 UNC'), 120);
  const r = calculate({ ...si, f: 0.75, K: 0.20 });
  close(r.Fi / UNIT.N_PER_LBF / 1000, 2.86, 0.01, 'Fi (kip)');
  close(r.Tseat / UNIT.NMM_PER_LBFIN, 143, 0.01, 'T (lbf-in)');
});

test('SPEC 9.3: torque only, 3/4"-16, Fi 25 kip, K 0.2 -> T = 3750 lbf-in (Shigley Example 8-3)', () => {
  const t = thread('3/4-16 UNF');
  const T = torque(0.2, 25000 * UNIT.N_PER_LBF, t.d * UNIT.MM_PER_IN);
  close(T / UNIT.NMM_PER_LBFIN, 3750, 1e-12, 'T (lbf-in)');
  close(torque(0.2, 25000, 0.75), 3750, 1e-12, 'same in native inch units');
});

test('SPEC 9.4: M6 x 1, 12.9, K 0.30, Gamma 0.35 -> Fi_max ~ 1.01 Fp, W1 fires', () => {
  const t = thread('M6x1');
  const s = sp('ISO-12.9', 'M6x1');
  assert.equal(s.value, 970);
  const r = calculate({ At: t.At, Sp: s.value, d: t.d, f: 0.75, K: 0.30, gamma: 0.35 });
  close(r.FiMaxOverFp, 1.01, 0.005, 'Fi_max / Fp');
  const ws = warnings({ result: r, lubricant: lube('dry'), engagement: engagement('nut_steel'), f: 0.75, torqueShown: true });
  assert.ok(ws.some((w) => w.id === 'W1' && w.level === 'danger'));
});

test('SPEC 9.5: same case with K 0.18, Gamma 0.25 -> Fi_max ~ 0.94 Fp, no W1', () => {
  const t = thread('M6x1');
  const r = calculate({ At: t.At, Sp: 970, d: t.d, f: 0.75, K: 0.18, gamma: 0.25 });
  close(r.FiMaxOverFp, 0.94, 0.005, 'Fi_max / Fp');
  const ws = warnings({ result: r, lubricant: lube('lubricated'), engagement: engagement('nut_steel'), f: 0.75, torqueShown: true });
  assert.ok(!ws.some((w) => w.id === 'W1'));
});

test('SPEC 9.6: locking insert, T_prev 1.0 N-m -> T_inst = T_seat + 1.0', () => {
  const t = thread('M6x1');
  const r = calculate({ At: t.At, Sp: 970, d: t.d, f: 0.75, K: 0.20, lockingInsert: true, runningTorque: 1000 });
  close(r.Tinst, r.Tseat + 1000, 1e-12, 'T_inst (N-mm)');
  assert.equal(r.Tprev, 1000);
  assert.equal(r.runningTorqueMissing, false);
});

test('locking insert without running torque: T_seat only, flagged', () => {
  const t = thread('M6x1');
  const r = calculate({ At: t.At, Sp: 970, d: t.d, f: 0.75, K: 0.20, lockingInsert: true });
  assert.equal(r.Tinst, null);
  assert.ok(r.Tseat > 0);
  assert.equal(r.runningTorqueMissing, true);
});

test('running torque is ignored unless the insert is screw-locking', () => {
  const t = thread('M6x1');
  const r = calculate({ At: t.At, Sp: 970, d: t.d, f: 0.75, K: 0.20, lockingInsert: false, runningTorque: 1000 });
  assert.equal(r.Tinst, null);
  assert.equal(r.Tprev, null);
});

// ------------------------------------------------------------ At (SPEC §2)

test('tensile stress area matches the SPEC §2 Shigley rows within 1%', () => {
  const rows = [['metric', 6, 1, 20.1], ['metric', 8, 1, 39.2], ['metric', 12, 1.75, 84.3],
    ['inch', 0.25, 20, 0.0318], ['inch', 0.19, 32, 0.0200], ['inch', 0.75, 16, 0.373]];
  for (const [system, d, p, expected] of rows) close(tensileStressArea(system, d, p), expected, 0.01, `${system} ${d}/${p}`);
});

test('tensile stress area reproduces every At in the data (JS formula = build_standards.py)', () => {
  for (const t of data.threads) {
    close(tensileStressArea(t.system, t.d, t.system === 'metric' ? t.pitch : t.tpi), t.At, 1e-5, t.id);
  }
});

test('tensile stress area rejects impossible input', () => {
  assert.equal(tensileStressArea('metric', 0, 1), null);
  assert.equal(tensileStressArea('metric', 1, 2), null);
  assert.equal(tensileStressArea('inch', 0.25, 0), null);
});

// ------------------------------------------------------------ Sp lookup (SPEC §3)

test('Sp: Shigley first; M16 class 8.8 = 600 MPa with the ISO 580 cross-check shown', () => {
  const s = sp('ISO-8.8', 'M16x2');
  assert.equal(s.value, 600);
  assert.equal(s.sourceId, 'shigley');
  assert.ok(s.crossChecks.some((c) => c.value === 580 && !c.agrees));
});

test('Sp: class 8.8 below M16 comes from ISO 898-1 and is labeled non-Shigley', () => {
  const s = sp('ISO-8.8', 'M12x1.75');
  assert.equal(s.value, 580);
  assert.equal(s.sourceId, 'iso_898_1');
  assert.equal(s.fromShigley, false);
});

test('Sp: class 12.9 is 970 MPa in Shigley and ISO 898-1', () => {
  const s = sp('ISO-12.9', 'M8x1.25');
  assert.equal(s.value, 970);
  assert.equal(s.fromShigley, true);
  assert.ok(s.crossChecks.every((c) => c.agrees));
});

test('Sp: class 9.8 above M16 has no value', () => {
  const s = sp('ISO-9.8', 'M20x2.5');
  assert.equal(s.value, null);
  assert.match(s.reason, /16 mm/);
});

test('Sp: fine pitch below M8 gets the class value, flagged (A2-70 M5 x 0.5)', () => {
  const s = sp('ISO3506-A2-70', 'M5x0.5');
  assert.equal(s.value, 382.5);
  assert.equal(s.method, '0.85*Sy (Shigley p.434)');
  assert.equal(s.Sy, 450);
  assert.match(s.scopeNote, /M8 x 1/);
  assert.equal(sp('ISO3506-A2-70', 'M5x0.8').scopeNote, null);
});

test('Sp: SAE Grade 5 drops from 85 to 74 kpsi above 1 in; nothing below 1/4 in', () => {
  assert.equal(sp('SAE-J429-5', '1-8 UNC').value, 85);
  assert.equal(sp('SAE-J429-5', '1-1/8-7 UNC').value, 74);
  assert.equal(sp('SAE-J429-5', '1-1/8-7 UNC').sourceId, 'shigley');
  assert.equal(sp('SAE-J429-8', '#10-32 UNF').value, null);
});

test('Sp: inch alloy SHCS from ASTM A574 (140 / 135 kpsi)', () => {
  assert.equal(sp('ASTM-A574', '1/2-13 UNC').value, 140);
  assert.equal(sp('ASTM-A574', '5/8-11 UNC').value, 135);
});

test('Sp: inch stainless uses F593 condition CW, and F837 CW below 1/4 in', () => {
  assert.equal(sp('ASTM-F593-G1-CW', '1/4-20 UNC').value, 55.25);
  assert.equal(sp('ASTM-F593-G1-CW', '3/4-10 UNC').value, 38.25);
  const small = sp('ASTM-F593-G2-CW', '#10-32 UNF');
  assert.equal(small.value, 34);
  assert.equal(small.sourceId, 'astm_f837');
});

test('Sp: grade and thread systems must match', () => {
  const s = sp('ISO-12.9', '1/4-20 UNC');
  assert.equal(s.value, null);
  assert.match(s.reason, /metric grade/);
});

// ------------------------------------------------------------ K, Gamma, lubricant table (SPEC §4, §6)

test('lubricant K and Gamma match SPEC §4', () => {
  const expected = { dry: [0.30, 0.35], zinc: [0.20, 0.35], lubricated: [0.18, 0.25], cadmium: [0.16, 0.35],
    antiseize: [0.12, 0.25], pfpe: [0.18, 0.25], unknown: [0.20, 0.35] };
  for (const [id, [K, g]] of Object.entries(expected)) {
    assert.equal(lube(id).K.value, K, `${id} K`);
    assert.equal(lube(id).gamma.value, g, `${id} Gamma`);
  }
  assert.equal(lube('pfpe').K.source_id, 'ntrs_20150004064');
  for (const id of ['mos2', 'ptfe', 'silver']) assert.equal(lube(id).K.value, null);
});

test('K = null gives preload only', () => {
  const t = thread('M6x1');
  const r = calculate({ At: t.At, Sp: 970, d: t.d, f: 0.75, K: null, gamma: 0.25 });
  assert.ok(r.Fi > 0);
  assert.equal(r.Tseat, null);
  assert.ok(r.FiMin > 0 && r.FiMax > r.Fi);
});

test('preload range is (1 -/+ Gamma) Fi', () => {
  const r = calculate({ At: 100, Sp: 1000, d: 10, f: 0.75, K: 0.2, gamma: 0.25 });
  close(r.FiMin, 0.75 * r.Fi, 1e-12);
  close(r.FiMax, 1.25 * r.Fi, 1e-12);
});

test('comparison table: anti-seize at the dry torque gives 2.5x the target and exceeds Fp', () => {
  const t = thread('M10x1.5');
  const r = calculate({ At: t.At, Sp: 970, d: t.d, f: 0.75, K: 0.30, gamma: 0.35 });
  const rows = compareLubricants(data.lubricants, { Fi: r.Fi, Fp: r.Fp, d: t.d, selectedTorque: r.Tseat });
  const anti = rows.find((x) => x.id === 'antiseize');
  close(anti.ratio, 2.5, 1e-12);
  assert.equal(anti.overProof, true);
  const dry = rows.find((x) => x.id === 'dry');
  close(dry.ratio, 1, 1e-12);
  assert.equal(rows.find((x) => x.id === 'mos2').T, null);
  close(rows.find((x) => x.id === 'lubricated').T, torque(0.18, r.Fi, t.d), 1e-12);
});

// ------------------------------------------------------------ warnings (SPEC §7)

test('W2 fires when Sp is missing', () => {
  assert.ok(warnings({ spMissing: true }).some((w) => w.id === 'W2'));
});

test('W3 fires for stainless with dry or unknown lubrication only', () => {
  const ids = (l) => warnings({ stainless: true, lubricant: lube(l) }).map((w) => w.id);
  assert.ok(ids('dry').includes('W3'));
  assert.ok(ids('unknown').includes('W3'));
  assert.ok(!ids('antiseize').includes('W3'));
  assert.ok(!warnings({ stainless: false, lubricant: lube('dry') }).some((w) => w.id === 'W3'));
});

test('W4 fires when f exceeds 0.90', () => {
  assert.ok(warnings({ f: 0.95 }).some((w) => w.id === 'W4'));
  assert.ok(!warnings({ f: 0.90 }).some((w) => w.id === 'W4'));
});

test('W5 fires for tapped soft material', () => {
  assert.ok(warnings({ engagement: engagement('tapped_soft') }).some((w) => w.id === 'W5'));
  assert.ok(!warnings({ engagement: engagement('nut_steel') }).some((w) => w.id === 'W5'));
});

test('W6 names the lubricant and engagement whenever torque is shown; W7 always', () => {
  const ws = warnings({ lubricant: lube('lubricated'), engagement: engagement('insert_free'), torqueShown: true });
  const w6 = ws.find((w) => w.id === 'W6');
  assert.match(w6.text, /Lubricated \(oil or general grease\) on threads and under head/);
  assert.match(w6.text, /free-running helical insert/);
  assert.ok(ws.some((w) => w.id === 'W7'));
  assert.ok(warnings({}).some((w) => w.id === 'W7'));
  assert.ok(!warnings({ lubricant: lube('dry'), engagement: engagement('nut_steel') }).some((w) => w.id === 'W6'));
});

// ------------------------------------------------------------ units (SPEC §8.7)

test('unit conversions are exact', () => {
  close(UNIT.MPA_PER_KPSI, 6.894757293168361, 1e-15, 'MPa per kpsi');
  close(UNIT.NMM_PER_LBFIN / 1000, 0.1129848290276167, 1e-15, 'N-m per lbf-in');
  close(UNIT.NMM_PER_LBFFT / 1000, 1.3558179483314004, 1e-15, 'N-m per lbf-ft');
  close(UNIT.NMM_PER_LBFFT / UNIT.NMM_PER_LBFIN, 12, 1e-15, 'in per ft');
  assert.equal(UNIT.MM2_PER_IN2, UNIT.MM_PER_IN ** 2);
});

test('inch and SI paths give the same answer', () => {
  const t = thread('1/4-20 UNC');
  const native = { Fp: t.At * 140 * 1000, T: 0.2 * 0.75 * t.At * 140 * 1000 * t.d };   // lbf, lbf-in
  const r = calculate({ ...inchSI(t, 140), f: 0.75, K: 0.2 });
  close(r.Fp / UNIT.N_PER_LBF, native.Fp, 1e-12, 'Fp');
  close(r.Tseat / UNIT.NMM_PER_LBFIN, native.T, 1e-12, 'T');
});
