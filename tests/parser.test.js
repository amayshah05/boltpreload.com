// Parser tests (SPEC §9). Real McMaster-Carr titles come from tests/titles.txt;
// synthetic titles cover cases the real list doesn't (marked below).
// Run: node --test "tests/*.test.js"

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseTitle, selectGrade, splitTitleBlocks, normalizeTitle } from '../js/parser.js';

const data = JSON.parse(fs.readFileSync(new URL('../data/fastener_standards.json', import.meta.url), 'utf8'));
const titlesText = fs.readFileSync(new URL('./titles.txt', import.meta.url), 'utf8');

// Expected results for every block in tests/titles.txt, keyed by the joined title.
// status: 'ok' = socket or hex head with a thread found; 'out_of_scope' = any other head.
const REAL = {
  'Zinc-Plated Alloy Steel Socket Head Screw US Origin, 1/4"-20 Thread Size, 1" Long':
    { status: 'ok', thread: '1/4-20 UNC', material: 'alloy_steel', finish: 'zinc-plated', grade: 'ASTM-A574', inferred: true },
  'Mil. Spec. 18-8 Stainless Steel Socket Head Screw US Origin, 1/4"-20 Thread Size, 2" Long':
    { status: 'ok', thread: '1/4-20 UNC', material: 'ss_18_8', finish: null, grade: 'ASTM-F593-G1-CW', inferred: true },
  'Black-Oxide 18-8 Stainless Steel Socket Head Screws M5 x 0.8 mm Thread Size, 20 mm Long':
    { status: 'ok', thread: 'M5x0.8', material: 'ss_18_8', finish: 'black-oxide', grade: 'ISO3506-A2-70', inferred: true },
  '18-8 Stainless Steel Socket Head Screws M5 x 0.5 mm Thread Size, 25 mm Long, Fully Threaded':
    { status: 'ok', thread: 'M5x0.5', material: 'ss_18_8', finish: null, grade: 'ISO3506-A2-70', inferred: true },
  'Zinc-Plated Steel Pan Head Phillips Screw 8-32 Thread, 1-1/8" Long':
    { status: 'out_of_scope', head: 'pan head screw', thread: '#8-32 UNC', material: 'steel', finish: 'zinc-plated', grade: null },
  'Brass Button Head Hex-Drive Screw 10-24 Thread Size, 1-1/8" Long':
    { status: 'out_of_scope', head: 'button head screw', thread: '#10-24 UNC', material: 'other', finish: null, grade: null },
  '18-8 Stainless Steel Shoulder Screw 1/8" Shoulder Diameter, 2" Shoulder Length, 4-40 Thread Size':
    { status: 'out_of_scope', head: 'shoulder screw', thread: '#4-40 UNC', material: 'ss_18_8', finish: null, grade: 'ASTM-F593-G1-CW', inferred: true },
  '18-8 Stainless Steel Slotted Flat Head Screw M1.6 x 0.35 mm Thread Size, 2 mm Long':
    { status: 'out_of_scope', head: 'flat head screw', thread: 'M1.6x0.35', material: 'ss_18_8', finish: null, grade: 'ISO3506-A2-70', inferred: true },
  'Mil. Spec. Steel Socket Head Screw 3/8"-16 Thread Size, 1" Long':
    { status: 'ok', thread: '3/8-16 UNC', material: 'steel', finish: null, grade: null },
  'Medium-Strength Grade 5 Steel Hex Head Screw Zinc-Plated, 1/4"-20 Thread Size, 3-1/2" Long, Partially Threaded':
    { status: 'ok', head: 'hex head screw', product: 'hex', thread: '1/4-20 UNC', material: 'steel', finish: 'zinc-plated', stated: 'SAE-J429-5', grade: 'SAE-J429-5', inferred: false },
  'Black-Oxide Alloy Steel Socket Head Screw US Origin, 1/2"-20 Thread Size, 1" Long':
    { status: 'ok', thread: '1/2-20 UNF', material: 'alloy_steel', finish: 'black-oxide', grade: 'ASTM-A574', inferred: true },
  'Black-Oxide Alloy Steel Socket Head Screw M14 x 2 mm Thread Size, 20 mm Long':
    { status: 'ok', thread: 'M14x2', material: 'alloy_steel', finish: 'black-oxide', grade: 'ISO-12.9', inferred: true },
  '18-8 Stainless Steel Socket Head Screw US Origin, 1/4"-28 Thread Size, 1" Long':
    { status: 'ok', thread: '1/4-28 UNF', material: 'ss_18_8', finish: null, grade: 'ASTM-F593-G1-CW', inferred: true },
  'Sealing Socket Head Screw 316 Stainless Steel with Buna-N O-Ring, 10-32 Thread, 5/8" Long':
    { status: 'ok', thread: '#10-32 UNF', material: 'ss_316', finish: null, grade: 'ASTM-F593-G2-CW', inferred: true },
  'Zinc-Flake-Coated Alloy Steel Socket Head Screw US Origin, 10-32 Thread Size, 1/2" Long':
    { status: 'ok', thread: '#10-32 UNF', material: 'alloy_steel', finish: 'other', grade: 'ASTM-A574', inferred: true },
};

// Synthetic titles in McMaster's format for cases the real list lacks.
const SYNTHETIC = {
  // mixed fraction
  'Black-Oxide Alloy Steel Socket Head Screw 1-1/4"-7 Thread Size, 4" Long':
    { status: 'ok', thread: '1-1/4-7 UNC', material: 'alloy_steel', grade: 'ASTM-A574', inferred: true },
  // numbered size written with "#"
  '18-8 Stainless Steel Socket Head Screw #10-32 Thread Size, 3/4" Long':
    { status: 'ok', thread: '#10-32 UNF', material: 'ss_18_8', grade: 'ASTM-F593-G1-CW', inferred: true },
  // whole-inch size
  'Alloy Steel Socket Head Screw 1"-8 Thread Size, 3" Long':
    { status: 'ok', thread: '1-8 UNC', material: 'alloy_steel', grade: 'ASTM-A574', inferred: true },
  // stated metric class; metric fine
  'High-Strength Class 10.9 Steel Socket Head Screw M10 x 1.25 mm Thread Size, 30 mm Long':
    { status: 'ok', thread: 'M10x1.25', material: 'steel', stated: 'ISO-10.9', grade: 'ISO-10.9', inferred: false },
  // stated stainless class
  'A4-80 Stainless Steel Socket Head Screw M8 x 1.25 mm Thread Size, 25 mm Long':
    { status: 'ok', thread: 'M8x1.25', material: 'ss_316', stated: 'ISO3506-A4-80', grade: 'ISO3506-A4-80', inferred: false },
  // cadmium finish, UNEF
  'Cadmium-Plated Alloy Steel Socket Head Screw 3/8"-32 Thread Size, 1" Long':
    { status: 'ok', thread: '3/8-32 UNEF', material: 'alloy_steel', finish: 'cadmium-plated', grade: 'ASTM-A574', inferred: true },
  // typographic quotes and multiplication sign, as pasted from some browsers
  'Black-Oxide Alloy Steel Socket Head Screw M8 × 1.25 mm Thread Size, 30 mm Long':
    { status: 'ok', thread: 'M8x1.25', material: 'alloy_steel', grade: 'ISO-12.9', inferred: true },
  'Alloy Steel Socket Head Screw 5/16″-18 Thread Size, 1″ Long':
    { status: 'ok', thread: '5/16-18 UNC', material: 'alloy_steel', grade: 'ASTM-A574', inferred: true },
  // must fail: no thread
  'Black-Oxide Alloy Steel Socket Head Screw, 20 mm Long':
    { status: 'no_thread', thread: null, material: 'alloy_steel' },
  // must fail: not a standard pitch
  'Alloy Steel Socket Head Screw M6 x 0.6 mm Thread Size, 20 mm Long':
    { status: 'unknown_thread', thread: null, material: 'alloy_steel' },
  // must fail: out of scope and no thread
  'Zinc-Plated Steel Hex Nut':
    { status: 'out_of_scope', head: 'nut', thread: null },
};

// Hex head cap screws (SPEC §9), synthetic titles in McMaster's format. The
// real hex title in titles.txt is covered above.
const HEX = {
  // stated SAE grade, zinc yellow-chromate finish
  'High-Strength Grade 8 Steel Hex Head Screw Zinc Yellow-Chromate Plated, 3/8"-16 Thread Size, 1-1/2" Long, Partially Threaded':
    { status: 'ok', product: 'hex', thread: '3/8-16 UNC', material: 'steel', finish: 'zinc-plated', stated: 'SAE-J429-8', grade: 'SAE-J429-8', inferred: false },
  // stated metric class
  'Medium-Strength Class 8.8 Steel Hex Head Screw Zinc-Plated, M8 x 1.25 mm Thread, 30 mm Long':
    { status: 'ok', product: 'hex', thread: 'M8x1.25', material: 'steel', stated: 'ISO-8.8', grade: 'ISO-8.8', inferred: false },
  // inch stainless -> ASTM F593, which covers hex cap screws directly
  '18-8 Stainless Steel Hex Head Screw 1/4"-20 Thread Size, 1" Long':
    { status: 'ok', product: 'hex', thread: '1/4-20 UNC', material: 'ss_18_8', grade: 'ASTM-F593-G1-CW', inferred: true },
  '316 Stainless Steel Hex Head Screw 1/2"-13 Thread Size, 2" Long':
    { status: 'ok', product: 'hex', thread: '1/2-13 UNC', material: 'ss_316', grade: 'ASTM-F593-G2-CW', inferred: true },
  // numbered size: grade inferred, but Sp is null below 1/4 in (calculator test)
  '18-8 Stainless Steel Hex Head Screw 10-24 Thread Size, 1/2" Long':
    { status: 'ok', product: 'hex', thread: '#10-24 UNC', material: 'ss_18_8', grade: 'ASTM-F593-G1-CW', inferred: true },
  // metric stainless
  '18-8 Stainless Steel Hex Head Screw M6 x 1 mm Thread, 20 mm Long':
    { status: 'ok', product: 'hex', thread: 'M6x1', material: 'ss_18_8', grade: 'ISO3506-A2-70', inferred: true },
  '316 Stainless Steel Hex Head Screw M10 x 1.5 mm Thread, 30 mm Long':
    { status: 'ok', product: 'hex', thread: 'M10x1.5', material: 'ss_316', grade: 'ISO3506-A4-70', inferred: true },
  // alloy steel with no stated grade: no inference (not A574, not 12.9)
  'Alloy Steel Hex Head Screw 1/2"-13 Thread Size, 2" Long':
    { status: 'ok', product: 'hex', thread: '1/2-13 UNC', material: 'alloy_steel', grade: null },
  'Black-Oxide Alloy Steel Hex Head Screw M12 x 1.75 mm Thread, 40 mm Long':
    { status: 'ok', product: 'hex', thread: 'M12x1.75', material: 'alloy_steel', finish: 'black-oxide', grade: null },
  // steel without alloy or grade
  'Low-Strength Steel Hex Head Screw Zinc-Plated, 1/4"-20 Thread Size, 1" Long':
    { status: 'ok', product: 'hex', thread: '1/4-20 UNC', material: 'steel', grade: null },
  // stated grade that covers socket heads only
  'ASTM A574 Alloy Steel Hex Head Screw 1/4"-20 Thread Size, 1" Long':
    { status: 'ok', product: 'hex', thread: '1/4-20 UNC', stated: 'ASTM-A574', grade: null },
  // "hex cap screw" wording
  'Grade 5 Steel Hex Cap Screw 5/8"-11 Thread Size, 2" Long':
    { status: 'ok', product: 'hex', head: 'hex head screw', thread: '5/8-11 UNC', stated: 'SAE-J429-5', grade: 'SAE-J429-5', inferred: false },
  // must fail: bearing face larger than Shigley's 1.5d
  'Zinc-Plated Grade 5 Steel Serrated Flange Hex Head Screw 5/16"-18 Thread Size, 1" Long':
    { status: 'out_of_scope', product: null, head: 'flanged hex head screw', thread: '5/16-18 UNC' },
  'Zinc-Plated Steel Hex Washer Head Screw 10-24 Thread Size, 1/2" Long':
    { status: 'out_of_scope', product: null, head: 'hex washer head screw', thread: '#10-24 UNC' },
  'High-Strength Grade 8 Steel Heavy Hex Head Screw 3/4"-10 Thread Size, 3" Long':
    { status: 'out_of_scope', product: null, head: 'heavy hex head screw', thread: '3/4-10 UNC' },
};

function check(title, exp) {
  const p = parseTitle(title, data);
  assert.equal(p.status, exp.status, 'status');
  assert.equal(p.ok, exp.status === 'ok', 'ok flag');
  assert.equal(p.thread?.id ?? null, exp.thread, 'thread');
  if ('product' in exp) assert.equal(p.product, exp.product, 'product');
  if ('material' in exp) assert.equal(p.material?.key ?? null, exp.material, 'material');
  if ('finish' in exp) assert.equal(p.finish?.key ?? null, exp.finish, 'finish');
  if ('head' in exp) assert.equal(p.headType, exp.head, 'head type');
  if ('stated' in exp) assert.equal(p.statedGrade?.id ?? null, exp.stated, 'stated grade');
  if (exp.status !== 'ok') assert.ok(p.errors.length > 0, 'failures carry an error message');
  if ('grade' in exp) {
    const g = selectGrade(p, data);
    assert.equal(g.gradeId, exp.grade, 'grade');
    if ('inferred' in exp) assert.equal(g.inferred, exp.inferred, 'inferred flag');
    if (exp.grade == null) assert.ok(g.message, 'a missing grade explains why');
  }
  return p;
}

// ------------------------------------------------------------ titles.txt

const blocks = splitTitleBlocks(titlesText);

test('titles.txt: every block has an expectation', () => {
  assert.equal(blocks.length, 15);
  for (const b of blocks) assert.ok(b in REAL, `no expectation for: ${b}`);
});

for (const title of blocks) {
  test(`real title: ${title}`, () => check(title, REAL[title]));
}

for (const [title, exp] of Object.entries(SYNTHETIC)) {
  test(`synthetic title: ${title}`, () => check(title, exp));
}

for (const [title, exp] of Object.entries(HEX)) {
  test(`hex title: ${title}`, () => check(title, exp));
}

// ------------------------------------------------------------ SPEC §9 coverage

test('coverage: at least 12 titles, at least 2 that must fail', () => {
  const all = [...blocks, ...Object.keys(SYNTHETIC)];
  assert.ok(all.length >= 12);
  const failing = all.filter((t) => !parseTitle(t, data).ok);
  assert.ok(failing.length >= 2);
});

test('coverage: at least 8 hex head titles, plus flanged, hex washer and heavy hex failures', () => {
  const hex = [...blocks, ...Object.keys(HEX)].filter((t) => parseTitle(t, data).product === 'hex');
  assert.ok(hex.length >= 8);
  const heads = Object.keys(HEX).map((t) => parseTitle(t, data)).filter((p) => !p.inScope).map((p) => p.headType);
  assert.deepEqual(heads.sort(), ['flanged hex head screw', 'heavy hex head screw', 'hex washer head screw']);
});

test('every socket head title is still in scope as a socket head', () => {
  const all = { ...REAL, ...SYNTHETIC };
  for (const t of Object.keys(all).filter((x) => /socket head/i.test(x))) {
    const p = parseTitle(t, data);
    assert.equal(p.product, 'shcs', t);
    assert.equal(p.isSHCS, true, t);
  }
});

// ------------------------------------------------------------ details

test('blocks: BOM, CRLF and multiple blank lines; lines of a block are joined', () => {
  const text = '﻿Line one\r\nLine two\r\n\r\n\r\n\r\nSecond title\r\n';
  assert.deepEqual(splitTitleBlocks(text), ['Line one Line two', 'Second title']);
});

test('a pasted two-line title parses the same as the joined line', () => {
  const a = parseTitle('Black-Oxide Alloy Steel Socket Head Screw\nM14 x 2 mm Thread Size, 20 mm Long', data);
  const b = parseTitle('Black-Oxide Alloy Steel Socket Head Screw M14 x 2 mm Thread Size, 20 mm Long', data);
  assert.equal(a.thread.id, b.thread.id);
});

test('metric size without pitch: coarse, with a visible note', () => {
  const p = parseTitle('Alloy Steel Socket Head Screw, M12 Thread, 40 mm Long', data);
  assert.equal(p.thread.id, 'M12x1.75');
  assert.ok(p.notes.some((n) => /coarse/.test(n)));
});

test('lengths and fractions that are not threads are ignored', () => {
  assert.equal(parseTitle('Alloy Steel Socket Head Screw 3/8"-24 Thread Size, 1-1/2" Long', data).thread.id, '3/8-24 UNF');
  assert.equal(parseTitle('Alloy Steel Socket Head Screw 1-1/2"-6 Thread Size, 1-1/2" Long', data).thread.id, '1-1/2-6 UNC');
});

test('18-8 is never read as a thread', () => {
  const p = parseTitle('18-8 Stainless Steel Socket Head Screw', data);
  assert.equal(p.status, 'no_thread');
});

test('stated SAE grade on a metric thread is not applied', () => {
  const p = parseTitle('Grade 8 Steel Socket Head Screw M8 x 1.25 mm Thread Size', data);
  const g = selectGrade(p, data);
  assert.equal(g.gradeId, null);
  assert.match(g.message, /inch grade/);
});

test('head type drives grade inference: alloy steel infers A574 for socket heads only', () => {
  const hex = parseTitle('Alloy Steel Hex Head Screw 1/2"-13 Thread Size, 2" Long', data);
  assert.equal(selectGrade(hex, data).gradeId, null);
  assert.match(selectGrade(hex, data).message, /A574 covers socket heads only/);
  assert.equal(selectGrade(hex, data, 'shcs').gradeId, 'ASTM-A574');      // user switches to socket head
  const shcs = parseTitle('Alloy Steel Socket Head Screw 1/2"-13 Thread Size, 2" Long', data);
  assert.equal(selectGrade(shcs, data, 'hex').gradeId, null);              // user switches to hex head
  const metric = parseTitle('Alloy Steel Hex Head Screw M8 x 1.25 mm Thread, 20 mm Long', data);
  assert.equal(selectGrade(metric, data, 'shcs').gradeId, 'ISO-12.9');
  assert.equal(selectGrade(metric, data, 'hex').gradeId, null);
});

test('a stated socket-head-only grade is not applied to a hex head', () => {
  const g = selectGrade(parseTitle('ASTM A574 Alloy Steel Hex Head Screw 1/4"-20 Thread Size', data), data);
  assert.equal(g.gradeId, null);
  assert.match(g.message, /does not cover hex head cap screws/);
});

test('large-bearing-face hex variants explain why they are out of scope', () => {
  for (const t of ['Serrated Flange Hex Head Screw 1/4"-20', 'Hex Washer Head Screw 10-24', 'Heavy Hex Head Screw 1/2"-13']) {
    const p = parseTitle(t, data);
    assert.equal(p.status, 'out_of_scope', t);
    assert.match(p.errors[0], /bearing face is larger than the 1\.5d/, t);
  }
});

test('hex nuts are still nuts, not hex head screws', () => {
  for (const t of ['Zinc-Plated Steel Hex Nut', 'Grade 8 Steel Heavy Hex Nut 1/2"-13', 'Steel Flange Nut 1/4"-20']) {
    assert.equal(parseTitle(t, data).headType, 'nut', t);
  }
});

test('empty input', () => {
  assert.equal(parseTitle('   ', data).status, 'empty');
});

test('normalizeTitle handles typographic characters', () => {
  assert.equal(normalizeTitle('1/4”–20 × ½'), '1/4"-20 x 1/2');
});
