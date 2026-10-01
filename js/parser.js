// Parser: McMaster-Carr product title -> structured values. No DOM.
// Needs the fastener_standards.json data to confirm the thread exists.

import { numberedDiameter } from './calculator.js';

const EPS = 1e-6;
const NUMBERED_SIZES = new Set([0, 1, 2, 3, 4, 5, 6, 8, 10, 12]);
const VULGAR = { '¼': '1/4', '½': '1/2', '¾': '3/4', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8' };

// ------------------------------------------------------------ text helpers

export function normalizeTitle(raw) {
  let s = String(raw ?? '').replace(/^﻿/, '');
  s = s.replace(/(\d)\s*([¼½¾⅛⅜⅝⅞])/g, (_, n, f) => `${n}-${VULGAR[f]}`)
    .replace(/[¼½¾⅛⅜⅝⅞]/g, (f) => VULGAR[f])
    .replace(/[“”„‟″ʺ˝〃]/g, '"')
    .replace(/''/g, '"')
    .replace(/[‘’′]/g, "'")
    .replace(/[×✕✖]/g, 'x')
    .replace(/[‐-―−﹣－]/g, '-')
    .replace(/[ \t\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s;
}

// tests/titles.txt format: each title is a block of 1-2 lines; blocks are
// separated by blank lines. Lines of a block are joined with a space.
export function splitTitleBlocks(text) {
  return String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => block.split('\n').map((l) => l.trim()).filter(Boolean).join(' '))
    .filter(Boolean);
}

function fractionValue(text) {
  const t = text.trim().replace(/\s+/, '-');
  const [whole, frac] = t.includes('/') ? (t.includes('-') ? t.split('-') : ['0', t]) : [t, null];
  let v = Number(whole);
  if (frac) {
    const [a, b] = frac.split('/').map(Number);
    if (!b) return NaN;
    v += a / b;
  }
  return v;
}

// ------------------------------------------------------------ thread

const METRIC_RE = /(?<![A-Za-z0-9.])M\s?(\d{1,2}(?:\.\d+)?)(?:\s?x\s?(\d(?:\.\d+)?)\s?(?:mm)?)?(?![\d.])/gi;
const FRACTION_RE = /(?<![\d/.-])(\d+[\s-]\d+\/\d+|\d+\/\d+|\d+(?="))"?\s?-\s?(\d{1,2})(?![\d/.])/g;
const NUMBERED_RE = /(?<![\d/.,"'-])(#\s?|No\.?\s?)?(\d{1,2})\s?-\s?(\d{2})(?![\d/."])/gi;
const THREAD_WORD = /^\s*(?:mm\s*)?(?:thread|unc|unf|unef|tpi)/i;

function candidates(s) {
  const out = [];
  const push = (m, c) => out.push({ ...c, index: m.index, text: m[0].trim(),
    score: THREAD_WORD.test(s.slice(m.index + m[0].length)) ? 2 : 0 });
  for (const m of s.matchAll(METRIC_RE)) {
    push(m, { system: 'metric', d: Number(m[1]), pitch: m[2] ? Number(m[2]) : null });
  }
  for (const m of s.matchAll(FRACTION_RE)) {
    const d = fractionValue(m[1]);
    if (d > 0) push(m, { system: 'inch', d, tpi: Number(m[2]), sizeText: `${m[1].replace(/\s/, '-')}"` });
  }
  for (const m of s.matchAll(NUMBERED_RE)) {
    const n = Number(m[2]);
    if (NUMBERED_SIZES.has(n)) {
      push(m, { system: 'inch', d: numberedDiameter(n), tpi: Number(m[3]), number: n, sizeText: `#${n}`, hash: Boolean(m[1]) });
    }
  }
  return out.sort((a, b) => b.score - a.score || a.index - b.index);
}

function findThread(data, c) {
  const ts = data.threads.filter((t) => t.system === c.system && Math.abs(t.d - c.d) < EPS);
  if (c.system === 'metric') {
    if (c.pitch == null) return ts.find((t) => t.series === 'coarse') || null;
    return ts.find((t) => Math.abs(t.pitch - c.pitch) < EPS) || null;
  }
  return ts.find((t) => t.tpi === c.tpi) || null;
}

function describe(c) {
  if (c.system === 'metric') return c.pitch == null ? `M${c.d}` : `M${c.d} × ${c.pitch}`;
  return `${c.sizeText}-${c.tpi}`;
}

// ------------------------------------------------------------ head, material, grade, finish

const HEADS = [
  [/socket[\s-]*head/i, 'socket head'],
  [/button[\s-]*head/i, 'button head screw'],
  [/flat[\s-]*head/i, 'flat head screw'],
  [/pan[\s-]*head/i, 'pan head screw'],
  [/hex[\s-]*head/i, 'hex head screw'],
  [/shoulder[\s-]*screw/i, 'shoulder screw'],
  [/set[\s-]*screw/i, 'set screw'],
  [/thumb[\s-]*screw/i, 'thumb screw'],
  [/carriage[\s-]*bolt/i, 'carriage bolt'],
  [/\bstud\b/i, 'stud'],
  [/\bnut\b/i, 'nut'],
  [/\bwasher\b/i, 'washer'],
];

function detectHead(s) {
  for (const [re, name] of HEADS) if (re.test(s)) return name;
  return null;
}

const OTHER_MATERIALS = /\b(brass|bronze|aluminum|aluminium|titanium|nylon|plastic|peek|copper|a286|inconel|monel|hastelloy|zinc alloy)\b/i;

function detectMaterial(s) {
  if (/stainless/i.test(s)) {
    if (/\b316L?\b|\bA4(?:-\d0)?\b/i.test(s)) return { key: 'ss_316', text: '316 stainless steel' };
    if (/\b18-8\b|\b304L?\b|\bA2(?:-\d0)?\b/i.test(s)) return { key: 'ss_18_8', text: '18-8 stainless steel' };
    return { key: 'ss_unknown', text: 'stainless steel (type not stated)' };
  }
  if (/\bA4-(?:70|80)\b/i.test(s)) return { key: 'ss_316', text: 'A4 stainless steel' };
  if (/\bA2-(?:70|80)\b/i.test(s)) return { key: 'ss_18_8', text: 'A2 stainless steel' };
  // Steel before other materials: "Alloy Steel ... with Nylon Patch" is steel.
  if (/\balloy[\s-]+steel\b/i.test(s)) return { key: 'alloy_steel', text: 'alloy steel' };
  if (/\bsteel\b/i.test(s)) return { key: 'steel', text: 'steel (alloy or carbon not stated)' };
  const other = s.match(OTHER_MATERIALS);
  if (other) return { key: 'other', text: other[1].toLowerCase() };
  return null;
}

function detectGrade(s) {
  let m = s.match(/\b(?:class|grade)\s+(4\.6|4\.8|5\.8|8\.8|9\.8|10\.9|12\.9)\b/i);
  if (m) return { id: `ISO-${m[1]}`, text: `Class ${m[1]}` };
  m = s.match(/\b(A[24])-(70|80)\b/i);
  if (m) return { id: `ISO3506-${m[1].toUpperCase()}-${m[2]}`, text: `${m[1].toUpperCase()}-${m[2]}` };
  m = s.match(/\bgrade\s+(\d+(?:\.\d)?)\b/i);
  if (m) {
    return ['2', '5', '8'].includes(m[1])
      ? { id: `SAE-J429-${m[1]}`, text: `Grade ${m[1]}` }
      : { id: null, text: `Grade ${m[1]}` };
  }
  if (/\bA574\b/i.test(s)) return { id: 'ASTM-A574', text: 'ASTM A574' };
  return null;
}

function detectFinish(s) {
  if (/black[\s-]*oxide/i.test(s)) return { key: 'black-oxide', text: 'black-oxide' };
  if (/zinc[\s-]*flake/i.test(s)) return { key: 'other', text: 'zinc-flake coated' };
  if (/zinc[\s-]*(?:yellow[\s-]*)?(?:chromate[\s-]*)?plated|yellow[\s-]*zinc/i.test(s)) return { key: 'zinc-plated', text: 'zinc-plated' };
  if (/cadmium/i.test(s)) return { key: 'cadmium-plated', text: 'cadmium-plated' };
  const m = s.match(/\b(nickel[\s-]*plated|chrome[\s-]*plated|silver[\s-]*plated|phosphate[\s-]*coated|ptfe[\s-]*coated|galvanized|dry[\s-]*film[\s-]*lubricated|xylan[\s-]*coated|passivated)\b/i);
  if (m) return { key: 'other', text: m[1].toLowerCase() };
  return null;
}

// ------------------------------------------------------------ public API

// Returns:
// { ok, status: 'ok' | 'not_shcs' | 'no_thread' | 'unknown_thread' | 'empty',
//   errors[], notes[], normalized, isSHCS, headType, thread (dataset row) | null,
//   threadText, rawThread, material, statedGrade, finish }
export function parseTitle(raw, data) {
  const s = normalizeTitle(raw);
  const res = { ok: false, status: 'empty', errors: [], notes: [], normalized: s, isSHCS: false,
    headType: null, thread: null, threadText: null, rawThread: null, material: null, statedGrade: null, finish: null };
  if (!s) return res;

  res.headType = detectHead(s);
  res.isSHCS = res.headType === 'socket head';
  res.material = detectMaterial(s);
  res.statedGrade = detectGrade(s);
  res.finish = detectFinish(s);

  const cands = candidates(s);
  if (!cands.length) {
    res.status = 'no_thread';
    res.errors.push('No thread size found. Expected something like "M8 x 1.25 mm", "1/4"-20" or "10-32".');
  } else {
    const c = cands[0];
    res.rawThread = { system: c.system, d: c.d, pitch: c.pitch ?? null, tpi: c.tpi ?? null, number: c.number ?? null };
    res.threadText = c.text;
    const t = findThread(data, c);
    if (t) {
      res.thread = t;
      if (c.system === 'metric' && c.pitch == null) {
        res.notes.push(`Pitch not stated: coarse pitch ${t.pitch} mm assumed (ISO designation without pitch means coarse).`);
      }
      const named = s.match(/\b(UNEF|UNC|UNF)\b/i);
      if (named && named[1].toUpperCase() !== t.series) {
        res.notes.push(`Title says ${named[1].toUpperCase()}, but ${t.designation} is ${t.series}.`);
      }
      const others = new Set(cands.filter((o) => o.score === c.score && o.index !== c.index).map(describe));
      others.delete(describe(c));
      if (others.size) res.notes.push(`Other thread-like text ignored: ${[...others].join(', ')}.`);
      res.status = 'ok';
    } else {
      res.status = 'unknown_thread';
      res.errors.push(`${describe(c)} is not a standard ${c.system === 'metric' ? 'ISO 261 metric' : 'UNC/UNF/UNEF'} thread in the data. Pick the thread manually.`);
    }
  }

  if (!res.isSHCS) {
    res.errors.unshift(res.headType
      ? `This looks like a ${res.headType}, not a socket head cap screw. boltpreload.com covers SHCS only; you can still enter values manually.`
      : 'Not recognized as a socket head screw. boltpreload.com covers SHCS only; you can still enter values manually.');
    res.status = 'not_shcs';
  }
  res.ok = res.isSHCS && res.thread != null;
  return res;
}

const MATERIAL_MESSAGES = {
  steel: 'Title says "Steel" without "alloy": the grade can\'t be inferred. Choose a grade.',
  ss_unknown: 'Stainless type not stated (18-8 or 316?). Choose a grade.',
  other: 'No grade data for this material. Choose a grade or enter Sp.',
};

// SPEC §3 title-to-grade mapping.
// Returns { gradeId | null, inferred: boolean, message | null }.
export function selectGrade(parse, data) {
  const system = parse.thread?.system ?? parse.rawThread?.system ?? null;
  const stated = parse.statedGrade;
  if (stated) {
    const g = data.grades.find((x) => x.id === stated.id);
    if (!g) return { gradeId: null, inferred: false, message: `Stated ${stated.text} isn't in the data. Choose a grade.` };
    if (system && g.system !== system) {
      return { gradeId: null, inferred: false,
        message: `Stated ${stated.text} is ${g.system === 'inch' ? 'an inch' : 'a metric'} grade but the thread is ${system}. Choose a grade.` };
    }
    return { gradeId: g.id, inferred: false, message: null };
  }
  if (!system) return { gradeId: null, inferred: false, message: null };
  const key = parse.material?.key;
  const rule = data.title_grade_map.find((m) => m.system === system && m.material === key);
  if (rule) return { gradeId: rule.grade, inferred: true, message: data.inferred_grade_flag };
  return { gradeId: null, inferred: false,
    message: MATERIAL_MESSAGES[key] || 'Material not found in the title. Choose a grade.' };
}
