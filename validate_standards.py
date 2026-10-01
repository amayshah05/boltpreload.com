#!/usr/bin/env python3
"""Validate data/fastener_standards.json and print a full report.

Checks:
  A. every At against its formula (SPEC §2)
  B. the SPEC §2 validation rows
  C. every Shigley Table 8-1 / 8-2 row that appears in the dataset (±1%)
  D. numbered-size diameters
  E. grade tables: integrity, Sp lookup for every thread, source cross-checks
  F. lubrication, preload fraction and Gamma against SPEC §4 and §6
  G. every unverified value
  H. every value not sourced from Shigley, with its source
  I. SPEC §9 spot checks with this data

Exit code 0 when every check passes (documented errata are reported, not
failed); 1 otherwise.

Usage:  python3 validate_standards.py
"""

import json
import math
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent / "data" / "fastener_standards.json"
EPS = 1e-9
SHIGLEY_TOL = 0.01          # SPEC §2: ±1% for the book's rounding
FORMULA_TOL = 1e-5          # stored At carries 6 significant figures

# Reference At values from Shigley 10th ed., Table 8-1 (p. 404), mm^2, and
# Table 8-2 (p. 405), in^2, for every row inside the dataset's coverage
# (M1.6-M36; #0 to 1-1/2 in). Used only for validation.
SHIGLEY_T8_1 = {
    "M1.6x0.35": 1.27, "M2x0.4": 2.07, "M2.5x0.45": 3.39, "M3x0.5": 5.03, "M3.5x0.6": 6.78,
    "M4x0.7": 8.78, "M5x0.8": 14.2, "M6x1": 20.1, "M8x1.25": 36.6, "M10x1.5": 58.0,
    "M12x1.75": 84.3, "M14x2": 115, "M16x2": 157, "M20x2.5": 245, "M24x3": 353,
    "M30x3.5": 561, "M36x4": 817,
    "M8x1": 39.2, "M10x1.25": 61.2, "M12x1.25": 92.1, "M14x1.5": 125, "M16x1.5": 167,
    "M20x1.5": 272, "M24x2": 384, "M30x2": 621, "M36x2": 915,
}
SHIGLEY_T8_2 = {
    "#0-80 UNF": 0.00180,
    "#1-64 UNC": 0.00263, "#1-72 UNF": 0.00278,
    "#2-56 UNC": 0.00370, "#2-64 UNF": 0.00394,
    "#3-48 UNC": 0.00487, "#3-56 UNF": 0.00523,
    "#4-40 UNC": 0.00604, "#4-48 UNF": 0.00661,
    "#5-40 UNC": 0.00796, "#5-44 UNF": 0.00880,
    "#6-32 UNC": 0.00909, "#6-40 UNF": 0.01015,
    "#8-32 UNC": 0.0140, "#8-36 UNF": 0.01474,
    "#10-24 UNC": 0.0175, "#10-32 UNF": 0.0200,
    "#12-24 UNC": 0.0242, "#12-28 UNF": 0.0258,
    "1/4-20 UNC": 0.0318, "1/4-28 UNF": 0.0364,
    "5/16-18 UNC": 0.0524, "5/16-24 UNF": 0.0580,
    "3/8-16 UNC": 0.0775, "3/8-24 UNF": 0.0878,
    "7/16-14 UNC": 0.1063, "7/16-20 UNF": 0.1187,
    "1/2-13 UNC": 0.1419, "1/2-20 UNF": 0.1599,
    "9/16-12 UNC": 0.182, "9/16-18 UNF": 0.203,
    "5/8-11 UNC": 0.226, "5/8-18 UNF": 0.256,
    "3/4-10 UNC": 0.334, "3/4-16 UNF": 0.373,
    "7/8-9 UNC": 0.462, "7/8-14 UNF": 0.509,
    "1-8 UNC": 0.606, "1-12 UNF": 0.663,
    "1-1/4-7 UNC": 0.969, "1-1/4-12 UNF": 1.073,
    "1-1/2-6 UNC": 1.405, "1-1/2-12 UNF": 1.581,
}
SHIGLEY_T8_2_DIAMETERS = {0: 0.0600, 1: 0.0730, 2: 0.0860, 3: 0.0990, 4: 0.1120,
                          5: 0.1250, 6: 0.1380, 8: 0.1640, 10: 0.1900, 12: 0.2160}

# SPEC §2 validation table.
SPEC_ROWS = [("M6x1", 20.1, "Table 8-1"), ("M8x1", 39.2, "Table 8-1"), ("M12x1.75", 84.3, "Table 8-1"),
             ("1/4-20 UNC", 0.0318, "Table 8-2"), ("#10-32 UNF", 0.0200, "Table 8-2"),
             ("3/4-16 UNF", 0.373, "Table 8-2")]

# Shigley rows that fail ±1% for a documented reason.
ERRATA = {
    "#5-44 UNF": "Shigley Table 8-2 prints 0.00880 in^2, but its own footnote formula gives 0.00831 and "
                 "ASTM A574-04e1 Table 3 lists 0.00830 for 0.125-44. Treated as a typo in the book; "
                 "the dataset keeps the formula value.",
}

# SPEC §4 lubricant table (K, Gamma) and §6 preload fractions.
SPEC_LUBES = {"dry": (0.30, 0.35), "zinc": (0.20, 0.35), "lubricated": (0.18, 0.25),
              "cadmium": (0.16, 0.35), "antiseize": (0.12, 0.25), "pfpe": (0.18, 0.25),
              "unknown": (0.20, 0.35)}
SPEC_F = {"reusable": 0.75, "permanent": 0.90}
REQUIRED_GRADES = ["ISO-4.6", "ISO-4.8", "ISO-5.8", "ISO-8.8", "ISO-9.8", "ISO-10.9", "ISO-12.9",
                   "ISO3506-A2-70", "ISO3506-A4-70", "ISO3506-A2-80", "ISO3506-A4-80",
                   "SAE-J429-2", "SAE-J429-5", "SAE-J429-8", "ASTM-A574",
                   "ASTM-F593-G1-CW", "ASTM-F593-G2-CW"]
ROW_KEYS = ["d_min", "d_max", "d_unit", "d_min_exclusive", "d_max_exclusive", "fine_pitch_d_min",
            "size_text", "value", "unit", "Sy", "method", "source", "source_id", "priority",
            "verified", "note"]
DIRECT = "direct proof strength"
FROM_SY = "0.85*Sy (Shigley p.434)"


class Report:
    def __init__(self):
        self.passed = 0
        self.failed = []
        self.errata = []

    def ok(self, cond, msg):
        if cond:
            self.passed += 1
        else:
            self.failed.append(msg)
        return cond

    @staticmethod
    def section(title):
        print()
        print("=" * 78)
        print(title)
        print("=" * 78)


def sig(x, n=6):
    return float(f"{x:.{n}g}")


def at_formula(t):
    if t["system"] == "metric":
        return math.pi / 4 * (t["d"] - 0.9382 * t["pitch"]) ** 2
    return math.pi / 4 * (t["d"] - 0.9743 / t["tpi"]) ** 2


def in_range(d, r):
    lo = d > r["d_min"] + EPS if r["d_min_exclusive"] else d >= r["d_min"] - EPS
    hi = d < r["d_max"] - EPS if r["d_max_exclusive"] else d <= r["d_max"] + EPS
    return lo and hi


def out_of_fine_scope(r, thread):
    fp = r.get("fine_pitch_d_min")
    return thread["series"] == "fine" and fp is not None and thread["d"] < fp - EPS


def resolve(grade, thread):
    """Return (best_row, other_matching_rows, reason_if_none, out_of_scope). Same rule as the app."""
    if grade["system"] != thread["system"]:
        return None, [], "system mismatch", False
    matches = [r for r in grade["rows"] if in_range(thread["d"], r)]
    if not matches:
        return None, [], "no row covers this size", False
    matches.sort(key=lambda r: (r["priority"], out_of_fine_scope(r, thread)))
    best = matches[0]
    return best, matches[1:], None, out_of_fine_scope(best, thread)


def fmt_pct(x):
    return f"{x * 100:+.2f}%"


def main():
    data = json.loads(DATA.read_text(encoding="utf-8"))
    rep = Report()
    threads = data["threads"]
    by_id = {t["id"]: t for t in threads}
    grades = {g["id"]: g for g in data["grades"]}
    sources = data["sources"]

    print("boltpreload.com - fastener standards validation report")
    print(f"Data: {DATA.name}  |  threads: {len(threads)} "
          f"({sum(t['system'] == 'metric' for t in threads)} metric, "
          f"{sum(t['system'] == 'inch' for t in threads)} inch)  |  grades: {len(grades)}  |  "
          f"lubricants: {len(data['lubricants'])}")

    # ---------------------------------------------------------------- A
    Report.section("A. At vs formula (every thread)")
    worst = (0, None)
    for t in threads:
        calc = at_formula(t)
        rel = abs(t["At"] - calc) / calc
        worst = max(worst, (rel, t["id"]))
        rep.ok(rel <= FORMULA_TOL, f"A: {t['id']} At {t['At']} != formula {calc:.6g}")
    metric_ok = all(abs(t["At"] - at_formula(t)) / at_formula(t) <= FORMULA_TOL for t in threads)
    print(f"Metric: At = (pi/4)(d - 0.9382 P)^2   Unified: At = (pi/4)(D - 0.9743/n)^2")
    print(f"{len(threads)} threads checked; largest relative difference {worst[0]:.1e} ({worst[1]}) "
          f"-> {'PASS' if metric_ok else 'FAIL'}")

    # ---------------------------------------------------------------- B
    Report.section("B. SPEC §2 validation rows (tolerance ±1%)")
    print(f"{'Thread':<14}{'Dataset At':>12}{'Shigley':>10}{'Diff':>9}  Source      Result")
    for tid, expected, table in SPEC_ROWS:
        t = by_id.get(tid)
        if not rep.ok(t is not None, f"B: SPEC row {tid} missing from dataset"):
            print(f"{tid:<14}  MISSING")
            continue
        diff = (t["At"] - expected) / expected
        good = rep.ok(abs(diff) <= SHIGLEY_TOL, f"B: {tid} {t['At']} vs {expected}")
        print(f"{t['designation']:<14}{t['At']:>12.5g}{expected:>10g}{fmt_pct(diff):>9}  {table:<11} "
              f"{'PASS' if good else 'FAIL'}")

    # ---------------------------------------------------------------- C
    Report.section("C. Every Shigley Table 8-1 / 8-2 row in the dataset (tolerance ±1%)")
    for label, ref, page in [("Table 8-1 (p. 404), mm^2", SHIGLEY_T8_1, 404),
                             ("Table 8-2 (p. 405), in^2", SHIGLEY_T8_2, 405)]:
        print(f"\nShigley {label}")
        print(f"{'Thread':<16}{'Dataset At':>12}{'Shigley':>10}{'Diff':>9}  Result")
        for tid, expected in ref.items():
            t = by_id.get(tid)
            if not rep.ok(t is not None, f"C: Shigley row {tid} missing from dataset"):
                print(f"{tid:<16}  MISSING FROM DATASET  FAIL")
                continue
            diff = (t["At"] - expected) / expected
            if abs(diff) <= SHIGLEY_TOL:
                rep.passed += 1
                result = "PASS"
            elif tid in ERRATA:
                rep.errata.append((tid, ERRATA[tid]))
                result = "MISMATCH - documented erratum (see below)"
            else:
                rep.failed.append(f"C: {tid} {t['At']} vs Shigley {expected} ({fmt_pct(diff)})")
                result = "FAIL"
            print(f"{t['designation']:<16}{t['At']:>12.5g}{expected:>10g}{fmt_pct(diff):>9}  {result}")
        print(f"{len(ref)} rows checked.")
    for tid, why in rep.errata:
        print(f"\nErratum {tid}: {why}")

    # ---------------------------------------------------------------- D
    Report.section("D. Numbered-size diameters, D = 0.060 + 0.013 N")
    for n, shig in SHIGLEY_T8_2_DIAMETERS.items():
        ds = {t["d"] for t in threads if t.get("number") == n}
        formula = round(0.060 + 0.013 * n, 4)
        good = rep.ok(ds == {formula} and abs(formula - shig) < EPS, f"D: #{n} diameter {ds} vs {shig}")
        print(f"#{n:<3} dataset {sorted(ds)}  formula {formula:.4f}  Shigley T8-2 {shig:.4f}  "
              f"{'PASS' if good else 'FAIL'}")

    # ---------------------------------------------------------------- E
    Report.section("E. Grades: integrity, Sp lookup for every thread, cross-checks")
    for gid in REQUIRED_GRADES:
        rep.ok(gid in grades, f"E: required grade {gid} missing")
    missing = [g for g in REQUIRED_GRADES if g not in grades]
    print(f"Required grades (SPEC §3): {len(REQUIRED_GRADES) - len(missing)}/{len(REQUIRED_GRADES)} present"
          + (f"; MISSING: {missing}" if missing else ""))
    for g in data["grades"]:
        unit = "MPa" if g["system"] == "metric" else "kpsi"
        for r in g["rows"]:
            where = f"{g['id']} [{r['size_text']}]"
            rep.ok(all(k in r for k in ROW_KEYS), f"E: {where} missing keys")
            rep.ok(r["unit"] == unit, f"E: {where} unit {r['unit']}")
            rep.ok(r["method"] in (DIRECT, FROM_SY), f"E: {where} method {r['method']}")
            rep.ok(r["source_id"] in sources, f"E: {where} unknown source {r['source_id']}")
            rep.ok(r["priority"] == (1 if r["source_id"] == "shigley" else 2), f"E: {where} priority")
            if r["value"] is None:
                rep.ok(r["verified"] is False and r["note"], f"E: {where} null value needs verified=false + note")
            if r["method"] == FROM_SY and r["value"] is not None:
                rep.ok(r["Sy"] is not None and abs(r["value"] - sig(0.85 * r["Sy"])) < 1e-9,
                       f"E: {where} Sp != 0.85*Sy")
    for m in data["title_grade_map"]:
        rep.ok(m["grade"] in grades, f"E: title map -> unknown grade {m['grade']}")
    print(f"Row integrity and title-to-grade map checked ({sum(len(g['rows']) for g in data['grades'])} rows).")

    used_rows = {}          # id(row) -> list of thread designations resolved to it
    conflicts, unresolved, extended = [], {}, {}
    resolved_count = 0
    for g in data["grades"]:
        for t in threads:
            if t["system"] != g["system"]:
                continue
            best, others, reason, out_of_scope = resolve(g, t)
            if best is None or best["value"] is None:
                why = reason or best["note"]
                unresolved.setdefault((g["id"], why), []).append(t["designation"])
                continue
            resolved_count += 1
            used_rows.setdefault(id(best), []).append(t["designation"])
            if out_of_scope:
                extended.setdefault((g["id"], best["source"], best["value"], best["unit"]), []).append(t["designation"])
            for o in others:
                if o["value"] is not None and abs(o["value"] - best["value"]) > 1e-9:
                    conflicts.append((g["id"], t["designation"], best, o))

    print(f"\nSp lookups: {resolved_count} thread/grade pairs resolve to a value.")
    print("\nCross-check disagreements (the higher-priority source is used):")
    if not conflicts:
        print("  none")
    seen = set()
    for gid, des, best, other in conflicts:
        key = (gid, best["source"], other["source"], best["value"], other["value"])
        sizes = sorted({c[1] for c in conflicts if (c[0], c[2]["source"], c[3]["source"], c[2]["value"], c[3]["value"]) == key})
        if key in seen:
            continue
        seen.add(key)
        print(f"  {gid}: {best['value']:g} {best['unit']} ({best['source']}) vs "
              f"{other['value']:g} {other['unit']} ({other['source']}) for: {', '.join(sizes)}")

    print("\nFine pitch below M8: class value applied by extension, flagged in the app (editable):")
    if not extended:
        print("  none")
    for (gid, src, val, unit), sizes in sorted(extended.items()):
        print(f"  {gid}: {val:g} {unit} ({src})")
        print(f"      {len(sizes)} threads: {', '.join(sizes)}")
    rep.ok("{source}" in data.get("fine_pitch_note", ""), "E: fine_pitch_note template missing")

    print("\nThread/grade pairs with no Sp (the app shows W2 and asks for Sp):")
    for (gid, why), sizes in sorted(unresolved.items()):
        print(f"  {gid}: {why}")
        print(f"      {len(sizes)} threads: {', '.join(sizes)}")

    # ---------------------------------------------------------------- F
    Report.section("F. Lubrication, preload fraction, Gamma (SPEC §4, §6)")
    lubes = {l["id"]: l for l in data["lubricants"]}
    print(f"{'Option':<36}{'K':>6}{'Gamma':>7}  K source")
    for l in data["lubricants"]:
        kv, gv = l["K"]["value"], l["gamma"]["value"]
        exp = SPEC_LUBES.get(l["id"])
        status = ""
        if exp:
            good = rep.ok(kv == exp[0] and gv == exp[1], f"F: {l['id']} K/Gamma {kv}/{gv} vs SPEC {exp}")
            status = "PASS" if good else f"FAIL (SPEC {exp})"
        elif l["K"].get("user_input"):
            status = "user input"
        else:
            rep.ok(kv is None and l["K"]["note"] == "Use vendor data or torque-tension testing.",
                   f"F: {l['id']} extra lubricant must have K null + SPEC note")
            status = "K null by design"
        print(f"{l['label']:<36}{'-' if kv is None else f'{kv:.2f}':>6}"
              f"{'-' if gv is None else f'{gv:.2f}':>7}  {l['K']['source']}  [{status}]")
    for lid in SPEC_LUBES:
        rep.ok(lid in lubes, f"F: SPEC lubricant {lid} missing")
    rep.ok("custom" in lubes, "F: custom option missing")
    pf = {o["id"]: o for o in data["preload_fraction"]["options"]}
    for fid, fval in SPEC_F.items():
        rep.ok(fid in pf and pf[fid]["f"] == fval, f"F: preload fraction {fid}")
    rep.ok(pf["reusable"]["default"] is True, "F: reusable must be the default")
    print(f"\nPreload fraction: reusable f = {pf['reusable']['f']} (default), permanent f = {pf['permanent']['f']}"
          f"  - {data['preload_fraction']['source']}")
    gp = data["gamma_policy"]
    rep.ok(gp["lubricated"] == 0.25 and gp["non_lubricated_or_as_received"] == 0.35, "F: gamma policy")
    print(f"Gamma: {gp['lubricated']} lubricated / {gp['non_lubricated_or_as_received']} non-lubricated or "
          f"as-received - {gp['clause']} (verified: {gp['verified']})")
    sc = data["shigley_scatter"]
    rep.ok(abs(sc["unlubricated"]["cov"] - 0.14) < 0.01 and abs(sc["lubricated"]["cov"] - 0.08) < 0.01,
           "F: Shigley scatter should be ~14% / ~8%")
    print(f"Shigley scatter: dry {sc['unlubricated']['std_kN']}/{sc['unlubricated']['mean_kN']} kN = "
          f"{sc['unlubricated']['cov']:.1%} ({sc['unlubricated']['table']}); lubricated "
          f"{sc['lubricated']['std_kN']}/{sc['lubricated']['mean_kN']} kN = {sc['lubricated']['cov']:.1%} "
          f"({sc['lubricated']['table']})")
    ri = data["reused_insert"]
    print(f"\nReused-insert note: {ri['note']}")
    if not ri["spec_text_matches_source"]:
        print(f"  REVIEW: SPEC text \"{ri['spec_text']}\" does not match the source. {ri['spec_text_note']}")

    # ---------------------------------------------------------------- G
    Report.section("G. Unverified values (verified: false)")
    n_unverified = 0
    for g in data["grades"]:
        for r in g["rows"]:
            if r["verified"] is False:
                n_unverified += 1
                v = "null" if r["value"] is None else f"{r['value']:g} {r['unit']}"
                print(f"  {g['id']} [{r['size_text']}]: Sp = {v}. {r['note']}")
    for l in data["lubricants"]:
        for key in ("K", "gamma"):
            if l[key].get("verified") is False:
                n_unverified += 1
                print(f"  Lubricant '{l['label']}': {key} = {l[key]['value']}. {l[key].get('note', '')}")
    if data["gamma_policy"]["verified"] is False:
        n_unverified += 1
        print("  Gamma policy unverified")
    print(f"Total: {n_unverified}")
    user_inputs = [l["label"] for l in data["lubricants"] if l["K"].get("user_input")]
    print(f"User-supplied at runtime (not stored values): {', '.join(user_inputs)} K and Gamma; "
          "running torque; Gamma override; Sp override.")

    # ---------------------------------------------------------------- H
    Report.section("H. Values NOT from Shigley, with source")
    print("H1. Thread pitch / TPI (At is still computed with Shigley's footnote formula)")
    groups = {}
    for t in threads:
        if t["pitch_source_id"] != "shigley":
            groups.setdefault(t["pitch_source"], []).append(t["designation"])
    for src, items in groups.items():
        print(f"  {src} ({len(items)} threads):")
        print(f"      {', '.join(items)}")
    print("\nH2. Numbered-size diameter formula")
    f = data["formulas"]["numbered_diameter"]
    print(f"  {f['expression']} - {f['source']}")
    print("\nH3. Proof strength rows (value, method, source; where the app uses them)")
    for g in data["grades"]:
        for r in g["rows"]:
            if r["source_id"] == "shigley":
                continue
            v = "null" if r["value"] is None else f"{r['value']:g} {r['unit']}"
            sy = f" (Sy {r['Sy']:g})" if r["Sy"] is not None else ""
            used = used_rows.get(id(r), [])
            usage = f"used for {len(used)} threads" if used else "cross-check only (Shigley row takes priority)" \
                if r["value"] is not None else "no value"
            print(f"  {g['id']:<16} {r['size_text']:<28} {v:>11}{sy}  {r['method']}")
            print(f"  {'':<16} source: {r['source']}; {usage}")
    print("\nH4. Torque coefficient K")
    for l in data["lubricants"]:
        if l["K"]["value"] is not None and l["K"]["source_id"] != "shigley":
            print(f"  {l['label']}: K = {l['K']['value']} - {l['K']['source']}")
    print("\nH5. Preload scatter Gamma (every lubricant)")
    print(f"  0.25 lubricated / 0.35 non-lubricated or as-received - {data['gamma_policy']['clause']}")
    print("\nH6. Notes")
    print(f"  Reused insert: {data['reused_insert']['source']}")
    for l in data["lubricants"]:
        if l["id"] == "pfpe":
            print(f"  PFPE notes: {sources['ntrs_20150004064']['citation']}")
    print("\nH7. Sources consulted")
    for sid, s in sources.items():
        if not s["is_shigley"]:
            print(f"  [{sid}] {s['citation']}")
            print(f"      {s.get('verification', '')}")
            for u in s.get("urls", []):
                print(f"      {u}")

    # ---------------------------------------------------------------- I
    Report.section("I. SPEC §9 spot checks with this data")
    m6, q20, q16 = by_id["M6x1"], by_id["1/4-20 UNC"], by_id["3/4-16 UNF"]
    sp129 = resolve(grades["ISO-12.9"], m6)[0]["value"]
    small_ss = resolve(grades["ASTM-F593-G2-CW"], by_id["#10-32 UNF"])[0]
    rep.ok(small_ss["value"] == 34 and small_ss["source_id"] == "astm_f837", "I: #10-32 316 -> F837 CW")
    print(f"#10-32 316 stainless (inferred grade): Sp = {small_ss['value']:g} kpsi - {small_ss['source']}")
    m5f, a270 = by_id["M5x0.5"], grades["ISO3506-A2-70"]
    best, _, _, oos = resolve(a270, m5f)
    rep.ok(best["value"] == 382.5 and oos, "I: M5x0.5 A2-70 applied by extension")
    print(f"M5x0.5 A2-70: Sp = {best['value']:g} MPa, flagged outside fine-pitch scope: {oos}")
    fi = 0.75 * m6["At"] * sp129 / 1000
    t = 0.20 * fi * 6
    rep.ok(abs(fi - 14.6) / 14.6 < 0.01 and abs(t - 17.5) / 17.5 < 0.01, "I: M6 case")
    print(f"M6x1, Sp {sp129:g} MPa, f 0.75, K 0.20: Fi = {fi:.2f} kN (SPEC ~14.6), T = {t:.2f} N-m (SPEC ~17.5)")
    fi = 0.75 * q20["At"] * 120
    t = 0.20 * fi * 1000 * 0.25
    rep.ok(abs(fi - 2.86) / 2.86 < 0.01 and abs(t - 143) / 143 < 0.01, "I: 1/4-20 case")
    print(f"1/4-20, Sp 120 kpsi, f 0.75, K 0.20: Fi = {fi:.3f} kip (SPEC ~2.86), T = {t:.1f} lbf-in (SPEC ~143)")
    t = 0.2 * 25000 * q16["d"]
    rep.ok(abs(t - 3750) < 1e-9, "I: Example 8-3")
    print(f"3/4-16, Fi 25 kip, K 0.2: T = {t:.0f} lbf-in (Shigley Example 8-3: 3750)")
    for kk, gg, expect_w1 in [(0.30, 0.35, True), (0.18, 0.25, False)]:
        ratio = (1 + gg) * 0.75
        rep.ok((ratio > 1) == expect_w1, "I: W1 case")
        print(f"M6 12.9, K {kk}, Gamma {gg}: Fi_max = {ratio:.4f} Fp -> W1 {'fires' if ratio > 1 else 'does not fire'}")

    # ---------------------------------------------------------------- summary
    Report.section("SUMMARY")
    print(f"Checks passed: {rep.passed}")
    print(f"Checks failed: {len(rep.failed)}")
    for f in rep.failed:
        print(f"  FAIL {f}")
    print(f"Documented errata: {len(rep.errata)}" + "".join(f"\n  {e[0]}" for e in rep.errata))
    print(f"Unverified values: {n_unverified}")
    print("RESULT:", "PASS" if not rep.failed else "FAIL")
    return 0 if not rep.failed else 1


if __name__ == "__main__":
    sys.exit(main())
