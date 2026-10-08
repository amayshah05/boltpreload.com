#!/usr/bin/env python3
"""Generate data/fastener_standards.json for boltpreload.com (SPEC §2–§6).

Primary source: Shigley's Mechanical Engineering Design, 10th ed. (Budynas &
Nisbett), Chapter 8. Page numbers are the book's printed page numbers.
Only table/equation/page references and the numeric values the app needs are
recorded here; no text from the book is reproduced.

Secondary sources (only where Shigley has no value) are listed in SOURCES with
the URLs used to verify each number. A value that could not be verified is
stored as null with "verified": false and a note.

Usage:  python3 build_standards.py
"""

import json
import math
from fractions import Fraction
from pathlib import Path

OUT = Path(__file__).resolve().parent / "data" / "fastener_standards.json"

SIG_FIGS = 6  # stored precision for computed areas and derived strengths


def sig(x, n=SIG_FIGS):
    return float(f"{x:.{n}g}")


# ---------------------------------------------------------------------------
# Sources
# ---------------------------------------------------------------------------

SOURCES = {
    "shigley": {
        "citation": "Budynas & Nisbett, Shigley's Mechanical Engineering Design, 10th ed., McGraw-Hill, Chapter 8",
        "is_shigley": True,
        "pages_used": "pp. 403-405, 424-427, 429-434 (printed page numbers)",
    },
    "iso_898_1": {
        "citation": "ISO 898-1:2013, Mechanical properties of fasteners made of carbon steel and alloy steel - Part 1: Bolts, screws and studs, Table 3 (row 5, stress under proof load Sp,nom) and Clause 1 (scope)",
        "is_shigley": False,
        "urls": ["https://cdn.standards.iteh.ai/samples/60610/e211f7b6697643f192d041ceceb1f2be/ISO-898-1-2013.pdf"],
        "verification": "Table 3 and scope read in the official ISO preview.",
    },
    "iso_3506_1": {
        "citation": "ISO 3506-1:2020, Fasteners - Mechanical properties of corrosion-resistant stainless steel fasteners - Part 1: Bolts, screws and studs, Clause 1 (scope) and austenitic property-class table (Rm, Rp0.2)",
        "is_shigley": False,
        "urls": [
            "https://cdn.standards.iteh.ai/samples/70045/fb49ed71dded4afab0e595bcdb6871e8/ISO-3506-1-2020.pdf",
            "https://bssa.org.uk/wp-content/uploads/2022/08/Microsoft-Word-SSAS2.31-Fastener-Grades-A1A2_A3_-A4_A5_-to-BS-EN-ISO-3506-1.pdf",
            "https://andrewsfasteners.uk/standards/mechanical-properties-for-austenitic-stainless-steel/",
            "https://boltport.com/specifications/iso-3506-1/",
        ],
        "verification": "Scope (M1.6-M39 coarse, M8x1-M39x3 fine) read in the ISO preview. The property table is not in the free preview; Rp0.2 values confirmed in three published reproductions (BSSA SSAS 2.31, Andrews Fasteners, Boltport). The 2020 edition tabulates class 70/80 loads up to M39; the 2009 edition limited classes 70/80 to M24 (BSSA).",
        "note": "Bolts, screws and studs have no proof stress in ISO 3506-1 (only nuts do), so Sp = 0.85*Sy per Shigley p. 434.",
    },
    "iso_261": {
        "citation": "ISO 261:1998, ISO general purpose metric screw threads - General plan, Table 2 (nominal diameter/pitch)",
        "is_shigley": False,
        "urls": ["https://cdn.standards.iteh.ai/samples/4165/ec50482690954e82931c52fdce3bc8bb/ISO-261-1998.pdf"],
        "verification": "Table 2 read in full in the official ISO preview.",
    },
    "asme_b1_1": {
        "citation": "ASME B1.1, Unified Inch Screw Threads (UN and UNR thread form)",
        "is_shigley": False,
        "urls": [
            "https://www.efunda.com/designstandards/screws/screwunef.cfm",
            "https://www.ring-plug-thread-gages.com/PDChart/UNEF-thread-data.html",
            "https://en.wikipedia.org/wiki/Unified_Thread_Standard",
        ],
        "verification": "UNEF sizes/TPI confirmed in two ASME B1.1 data charts (efunda, ring-plug-thread-gages). 1-1/8 and 1-3/8 UNC/UNF TPI confirmed in ASTM A574-04e1 Tables 2-3 and the Wikipedia UTS table. Numbered-size diameter formula confirmed in the Wikipedia UTS article and matches every diameter in Shigley Table 8-2.",
    },
    "astm_a574": {
        "citation": "ASTM A574, Standard Specification for Alloy Steel Socket-Head Cap Screws (checked in A574-04e1), Tables 2-3, footnote C: proof load (length measurement method) based on 140 ksi for 0.500 in and smaller, 135 ksi for larger; scope 0.060-4 in",
        "is_shigley": False,
        "urls": ["https://www.badensteel.com/astm-a574"],
        "verification": "Read in a copy of ASTM A574-04e1; same values in the current Baden Steel summary.",
    },
    "astm_f593": {
        "citation": "ASTM F593, Standard Specification for Stainless Steel Bolts, Hex Cap Screws, and Studs: Groups 1 and 2, condition CW (furnished unless otherwise specified); CW1 1/4-5/8 in, CW2 3/4-1-1/2 in; scope 1/4-1-1/2 in",
        "is_shigley": False,
        "urls": [
            "https://www.portlandbolt.com/technical/specifications/astm-f593/",
            "https://www.aptp.com/technical/astm-specifications/astm-f593-specifications/",
            "https://boltport.com/specifications/astm-f593/",
        ],
        "verification": "Yield strengths, size ranges and default condition confirmed in three published summaries. F593 gives tensile and yield only, no proof load, so Sp = 0.85*Sy per Shigley p. 434.",
    },
    "astm_f837": {
        "citation": "ASTM F837-20, Standard Specification for Stainless Steel Socket Head Cap Screws, Table 1: Groups 1 and 2, condition CW (yield 40 ksi min) and CW1 (yield 65 ksi min), 0.060-0.750 in; scope 0.060-1.500 in",
        "is_shigley": False,
        "urls": ["https://torqbolt.com/astm-f837-f837m-stainless-steel-screws-specifications-suppliers-manufacturers"],
        "verification": "Table 1 read in the ASTM F837-20 redline (vs F837-13(2018)); same values in the Torqbolt summary. "
                        "F837 gives machined-specimen yield but no proof load, so Sp = 0.85*Sy per Shigley p. 434. "
                        "F837 names no default condition (Sec. 4.1.4: the order must state it).",
    },
    "sae_j429": {
        "citation": "SAE J429, Mechanical and Material Requirements for Externally Threaded Fasteners",
        "is_shigley": False,
        "urls": ["https://www.portlandbolt.com/technical/specifications/sae-j429/"],
        "verification": "Grades 2, 5, 8 proof loads confirmed; used only as a cross-check of Shigley Table 8-9.",
    },
    "nasa_std_5020b": {
        "citation": "NASA-STD-5020B (approved 2021-08-06), Requirements for Threaded Fastening Systems in Spaceflight Hardware, Sec. 4.3.3 [TFSR 7], Table 3 'Preload Variation Determination' and Appendix A.2",
        "is_shigley": False,
        "urls": [
            "https://standards.nasa.gov/sites/default/files/standards/NASA/B/0/2021-08-06-nasa-std-5020b_final.pdf",
            "https://standards.nasa.gov/sites/default/files/standards/NASA/B/0/Historical/nasa-std-5020a_w-chg_1.pdf",
        ],
        "verification": "Read in the standard. Same values and clause in NASA-STD-5020A w/Change 1.",
    },
    "ntrs_20150004064": {
        "citation": "Hemminger, Posey & Dube, 'Torque Tension Testing of Fasteners used for NASA Flight Hardware Applications', Proc. 42nd Aerospace Mechanisms Symposium, NASA GSFC, May 2014, pp. 231-244 (NTRS 20150004064)",
        "is_shigley": False,
        "urls": [
            "https://ntrs.nasa.gov/citations/20150004064",
            "https://ntrs.nasa.gov/api/citations/20150004064/downloads/20150004064.pdf",
        ],
        "verification": "Read in the paper.",
    },
}


# ---------------------------------------------------------------------------
# Formulas (SPEC §1, §2)
# ---------------------------------------------------------------------------

# SPEC §2 constants. Shigley's Table 8-1/8-2 footnotes take At from the mean of
# the pitch and minor diameters: metric (1.226869 + 0.649519)/2 = 0.938194,
# unified (1.299038 + 0.649519)/2 = 0.974279. SPEC rounds these to 4 places.
METRIC_K = 0.9382
UNIFIED_K = 0.9743


def at_metric(d, p):
    return math.pi / 4 * (d - METRIC_K * p) ** 2


def at_unified(d, n):
    return math.pi / 4 * (d - UNIFIED_K / n) ** 2


def numbered_diameter(n):
    return round(0.060 + 0.013 * n, 4)


FORMULAS = {
    "At_metric": {
        "expression": "At = (pi/4) * (d - 0.9382*P)^2",
        "unit": "mm^2",
        "source": "Shigley Table 8-1 footnote, p. 404 (mean of pitch and minor diameters); constant as rounded in SPEC §2",
        "source_id": "shigley",
    },
    "At_unified": {
        "expression": "At = (pi/4) * (D - 0.9743/n)^2",
        "unit": "in^2",
        "source": "Shigley Table 8-2 footnote, p. 405 (mean of pitch and minor diameters); constant as rounded in SPEC §2",
        "source_id": "shigley",
    },
    "numbered_diameter": {
        "expression": "D = 0.060 + 0.013*N  [in]",
        "source": "ASME B1.1 numbered sizes (SPEC §2); matches every numbered-size diameter in Shigley Table 8-2, p. 405",
        "source_id": "asme_b1_1",
    },
    "proof_load": {"expression": "Fp = At * Sp", "source": "Shigley Eq. 8-32, p. 434", "source_id": "shigley"},
    "preload": {"expression": "Fi = f * Fp", "source": "Shigley Eq. 8-31, p. 434", "source_id": "shigley"},
    "torque": {"expression": "T = K * Fi * d", "source": "Shigley Eq. 8-27, p. 430", "source_id": "shigley"},
    "torque_coefficient": {
        "expression": "K = (dm/2d)*((tan(lambda) + f*sec(alpha))/(1 - f*tan(lambda)*sec(alpha))) + 0.625*fc",
        "source": "Shigley Eq. 8-26, p. 430 (derivation only; the app uses tabulated K)",
        "source_id": "shigley",
    },
    "installation_torque": {
        "expression": "T_inst = T_seat + T_prevailing (screw-locking inserts only)",
        "source": "SPEC §5",
        "source_id": None,
    },
    "preload_range": {
        "expression": "Fi_min = (1 - Gamma)*Fi,  Fi_max = (1 + Gamma)*Fi",
        "source": "NASA-STD-5020B Sec. 4.3.1 Eqs. 3-4 with c_max = c_min = 1 (no torque tolerance)",
        "source_id": "nasa_std_5020b",
    },
    "approx_proof_strength": {
        "expression": "Sp = 0.85*Sy",
        "source": "Shigley p. 434 (for materials not in Tables 8-9 to 8-11)",
        "source_id": "shigley",
    },
}


# ---------------------------------------------------------------------------
# Thread data (SPEC §2). At is always computed, never typed.
# ---------------------------------------------------------------------------

# (d, P) pairs listed in Shigley Table 8-1, p. 404, inside M1.6-M36.
# Used only to label where each pitch comes from.
SHIGLEY_T8_1_PAIRS = {
    (1.6, 0.35), (2, 0.4), (2.5, 0.45), (3, 0.5), (3.5, 0.6), (4, 0.7), (5, 0.8),
    (6, 1), (8, 1.25), (10, 1.5), (12, 1.75), (14, 2), (16, 2), (20, 2.5),
    (24, 3), (30, 3.5), (36, 4),
    (8, 1), (10, 1.25), (12, 1.25), (14, 1.5), (16, 1.5), (20, 1.5), (24, 2),
    (30, 2), (36, 2),
}

# ISO 261:1998 Table 2, first- and second-choice diameters M1.6-M36:
# (d, choice, coarse pitch, fine pitches). Excluded on purpose:
#   M14 x 1.25 (footnote a: spark plugs only);
#   M30 x 3 and M33 x 3 (shown in parentheses: "to be avoided as far as possible");
#   third-choice diameters (5.5, 9, 11, 15, 17, 25, 26, 28, 32, 35).
ISO_261 = [
    (1.6, 1, 0.35, [0.2]),
    (1.8, 2, 0.35, [0.2]),
    (2, 1, 0.4, [0.25]),
    (2.2, 2, 0.45, [0.25]),
    (2.5, 1, 0.45, [0.35]),
    (3, 1, 0.5, [0.35]),
    (3.5, 2, 0.6, [0.35]),
    (4, 1, 0.7, [0.5]),
    (4.5, 2, 0.75, [0.5]),
    (5, 1, 0.8, [0.5]),
    (6, 1, 1, [0.75]),
    (7, 2, 1, [0.75]),
    (8, 1, 1.25, [1, 0.75]),
    (10, 1, 1.5, [1.25, 1, 0.75]),
    (12, 1, 1.75, [1.5, 1.25, 1]),
    (14, 2, 2, [1.5, 1]),
    (16, 1, 2, [1.5, 1]),
    (18, 2, 2.5, [2, 1.5, 1]),
    (20, 1, 2.5, [2, 1.5, 1]),
    (22, 2, 2.5, [2, 1.5, 1]),
    (24, 1, 3, [2, 1.5, 1]),
    (27, 2, 3, [2, 1.5, 1]),
    (30, 1, 3.5, [2, 1.5, 1]),
    (33, 2, 3.5, [2, 1.5]),
    (36, 1, 4, [3, 2, 1.5]),
]

# Unified numbered sizes: {N: TPI}. UNC/UNF from Shigley Table 8-2 (p. 405);
# #12-32 UNEF from ASME B1.1.
NUMBERED_UNC = {1: 64, 2: 56, 3: 48, 4: 40, 5: 40, 6: 32, 8: 32, 10: 24, 12: 24}
NUMBERED_UNF = {0: 80, 1: 72, 2: 64, 3: 56, 4: 48, 5: 44, 6: 40, 8: 36, 10: 32, 12: 28}
NUMBERED_UNEF = {12: 32}
NUMBERED_SIZES = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12]

# Fractional sizes: (label, UNC, UNF, UNEF). UNC/UNF from Shigley Table 8-2
# except 1-1/8 and 1-3/8 (not in Table 8-2; ASME B1.1). UNEF from ASME B1.1.
# UNEF-only sizes (11/16, 13/16, 15/16, 1-1/16, ...) are omitted: they have no
# UNC/UNF and are not socket-head-cap-screw sizes.
FRACTIONAL = [
    ("1/4", 20, 28, 32),
    ("5/16", 18, 24, 32),
    ("3/8", 16, 24, 32),
    ("7/16", 14, 20, 28),
    ("1/2", 13, 20, 28),
    ("9/16", 12, 18, 24),
    ("5/8", 11, 18, 24),
    ("3/4", 10, 16, 20),
    ("7/8", 9, 14, 20),
    ("1", 8, 12, 20),
    ("1-1/8", 7, 12, 18),
    ("1-1/4", 7, 12, 18),
    ("1-3/8", 6, 12, 18),
    ("1-1/2", 6, 12, 18),
]
NOT_IN_SHIGLEY_T8_2 = {"1-1/8", "1-3/8"}


def fraction_value(label):
    if "-" in label:
        whole, frac = label.split("-")
        return float(int(whole) + Fraction(frac))
    return float(Fraction(label))


def fmt_num(x):
    return f"{x:g}"


def metric_threads():
    out = []
    for d, choice, coarse, fines in ISO_261:
        for series, p in [("coarse", coarse)] + [("fine", f) for f in fines]:
            in_shigley = (d, p) in SHIGLEY_T8_1_PAIRS
            out.append({
                "id": f"M{fmt_num(d)}x{fmt_num(p)}",
                "system": "metric",
                "designation": f"M{fmt_num(d)} × {fmt_num(p)}",
                "size": f"M{fmt_num(d)}",
                "series": series,
                "d": d,
                "d_unit": "mm",
                "pitch": p,
                "pitch_unit": "mm",
                "tpi": None,
                "At": sig(at_metric(d, p)),
                "At_unit": "mm^2",
                "At_formula": "At_metric",
                "pitch_source": "Shigley Table 8-1, p. 404" if in_shigley else "ISO 261:1998 Table 2",
                "pitch_source_id": "shigley" if in_shigley else "iso_261",
                "iso_261_choice": choice,
            })
    return out


def unified_thread(size, number, d, series, tpi, source_id, source):
    size_label = f"#{number}" if number is not None else f'{size}"'
    return {
        "id": f"{size}-{tpi} {series}",
        "system": "inch",
        "designation": f"{size_label}-{tpi} {series}",
        "size": size,
        "number": number,
        "series": series,
        "d": d,
        "d_unit": "in",
        "pitch": sig(1 / tpi),
        "pitch_unit": "in",
        "tpi": tpi,
        "At": sig(at_unified(d, tpi)),
        "At_unit": "in^2",
        "At_formula": "At_unified",
        "pitch_source": source,
        "pitch_source_id": source_id,
    }


def inch_threads():
    out = []
    shigley = ("shigley", "Shigley Table 8-2, p. 405")
    asme = ("asme_b1_1", "ASME B1.1")
    for n in NUMBERED_SIZES:
        d = numbered_diameter(n)
        size = f"#{n}"
        for series, table, src in [("UNC", NUMBERED_UNC, shigley),
                                   ("UNF", NUMBERED_UNF, shigley),
                                   ("UNEF", NUMBERED_UNEF, asme)]:
            if n in table:
                out.append(unified_thread(size, n, d, series, table[n], *src))
    for label, unc, unf, unef in FRACTIONAL:
        d = fraction_value(label)
        base = asme if label in NOT_IN_SHIGLEY_T8_2 else shigley
        out.append(unified_thread(label, None, d, "UNC", unc, *base))
        out.append(unified_thread(label, None, d, "UNF", unf, *base))
        out.append(unified_thread(label, None, d, "UNEF", unef, *asme))
    return out


# ---------------------------------------------------------------------------
# Head types (SPEC §1). Both use the same K: Shigley's Eq. 8-26 takes the
# bearing face as a hex washer face, 1.5d across flats (p. 430).
# ---------------------------------------------------------------------------

ALL_PRODUCTS = ("shcs", "hex")
SHCS_ONLY = ("shcs",)
HEX_ONLY = ("hex",)

PRODUCTS = {
    "options": [
        {"id": "shcs", "label": "Socket head cap screw", "default": True},
        {"id": "hex", "label": "Hex head cap screw", "default": False},
    ],
    "bearing_face_note": "Shigley's Eq. 8-26 takes the bearing face as a hex washer face, 1.5d across flats "
                         "(dc = 1.25d), so hex heads use the same K as socket heads. Flanged, hex washer and heavy "
                         "hex heads bear on a larger face and are out of scope.",
    "source": "Shigley p. 430 (derivation of Eq. 8-26)",
    "source_id": "shigley",
}


# ---------------------------------------------------------------------------
# Grade data (SPEC §3)
#
# Each grade holds the size-range rows of every source consulted. Lookup rule
# (same in the app): among rows whose size range contains d and whose
# "products" include the head type (and whose fine-pitch scope admits the
# thread), take the lowest "priority"; 1 = Shigley Tables 8-9 to 8-11,
# 2 = governing standard. Lower-priority rows that also match are cross-checks.
# ---------------------------------------------------------------------------

SHIGLEY_T8_9 = "Shigley Table 8-9, p. 425"
SHIGLEY_T8_11 = "Shigley Table 8-11, p. 427"
ISO_898_1_T3 = "ISO 898-1:2013 Table 3"
DIRECT = "direct proof strength"
FROM_SY = "0.85*Sy (Shigley p.434)"


def row(d_min, d_max, value, unit, source_id, source, method, priority, *,
        d_unit, size_text, verified=True, note="", Sy=None,
        d_min_exclusive=False, d_max_exclusive=False, fine_pitch_d_min=None,
        products=ALL_PRODUCTS):
    return {
        "d_min": d_min,
        "d_max": d_max,
        "d_unit": d_unit,
        "d_min_exclusive": d_min_exclusive,
        "d_max_exclusive": d_max_exclusive,
        "fine_pitch_d_min": fine_pitch_d_min,
        "products": list(products),
        "size_text": size_text,
        "value": value,
        "unit": unit,
        "Sy": Sy,
        "method": method,
        "source": source,
        "source_id": source_id,
        "priority": priority,
        "verified": verified,
        "note": note,
    }


def mm(*args, **kw):
    return row(*args, d_unit="mm", **kw)


def inch(*args, **kw):
    return row(*args, d_unit="in", **kw)


# ISO 898-1 and ISO 3506-1 cover fine pitch from M8x1 only. For finer threads
# below M8 the class value is still applied, but flagged (see FINE_PITCH_NOTE).
ISO_FINE_SCOPE = 8
FINE_PITCH_NOTE = ("{source} covers fine pitch from M8 x 1 only. The class value is applied to this "
                   "thread by extension: verify with the supplier or enter Sp.")


def iso_898_row(d_min, d_max, sp, size_text, **kw):
    return mm(d_min, d_max, sp, "MPa", "iso_898_1", ISO_898_1_T3, DIRECT, 2,
              size_text=size_text, fine_pitch_d_min=ISO_FINE_SCOPE, **kw)


def shigley_metric_row(d_min, d_max, sp, size_text):
    return mm(d_min, d_max, sp, "MPa", "shigley", SHIGLEY_T8_11, DIRECT, 1, size_text=size_text)


def metric_class(cls, material, shigley_rows, iso_rows, note=""):
    return {
        "id": f"ISO-{cls}",
        "label": f"Class {cls} (ISO 898-1)",
        "system": "metric",
        "standard": "ISO 898-1",
        "material": material,
        "products": list(ALL_PRODUCTS),
        "aliases": [f"class {cls}", f"property class {cls}", f"{cls}"],
        "note": note,
        "rows": shigley_rows + iso_rows,
    }


def stainless_3506(grade, cls, steel):
    sy = {"70": 450, "80": 600}[cls]
    return {
        "id": f"ISO3506-{grade}-{cls}",
        "label": f"{grade}-{cls} (ISO 3506-1)",
        "system": "metric",
        "standard": "ISO 3506-1",
        "material": f"austenitic stainless steel ({steel})",
        "products": list(ALL_PRODUCTS),
        "aliases": [f"{grade}-{cls}", f"{grade.lower()}-{cls}"],
        "note": "",
        "rows": [
            mm(1.6, 39, sig(0.85 * sy), "MPa", "iso_3506_1",
               "ISO 3506-1:2020 austenitic property classes (Rp0.2 min)", FROM_SY, 2,
               size_text="M1.6-M39 coarse; fine M8x1 and larger", Sy=sy,
               fine_pitch_d_min=ISO_FINE_SCOPE,
               note=f"ISO 3506-1 gives Rp0.2 min = {sy} MPa and no proof stress for bolts and screws. "
                    "The 2009 edition limited classes 70 and 80 to M24; the 2020 edition covers M1.6-M39."),
        ],
    }


def sae_grade(grade, shigley_rows, j429_rows, material):
    below_quarter = inch(0.06, 0.25, None, "kpsi", "sae_j429", "SAE J429 / Shigley Table 8-9", DIRECT, 2,
                         size_text="below 1/4 in", verified=False, d_max_exclusive=True,
                         note="Shigley Table 8-9 and SAE J429 tabulate 1/4 in and larger only. "
                              "No verified proof strength for smaller sizes; enter Sp from supplier data.")
    return {
        "id": f"SAE-J429-{grade}",
        "label": f"SAE J429 Grade {grade}",
        "system": "inch",
        "standard": "SAE J429",
        "material": material,
        "products": list(ALL_PRODUCTS),
        "aliases": [f"grade {grade}", f"sae grade {grade}", f"sae j429 grade {grade}"],
        "note": "",
        "rows": shigley_rows + j429_rows + [below_quarter],
    }


def sae_shigley(d_min, d_max, sp, size_text):
    return inch(d_min, d_max, sp, "kpsi", "shigley", SHIGLEY_T8_9, DIRECT, 1, size_text=size_text)


def sae_j429(d_min, d_max, sp, size_text, **kw):
    return inch(d_min, d_max, sp, "kpsi", "sae_j429", "SAE J429 (via Portland Bolt summary)", DIRECT, 2,
                size_text=size_text, **kw)


def f837_row(group, condition, sy, d_min, d_max, size_text, **kw):
    return inch(d_min, d_max, sig(0.85 * sy), "kpsi", "astm_f837",
                f"ASTM F837 Table 1, Group {group} condition {condition} (0.060-0.750 in)", FROM_SY, 2,
                size_text=size_text, Sy=sy,
                note=f"F837 gives machined-specimen yield {sy} ksi min, no proof load.", **kw)


def f593_group(group, alloys):
    src = "ASTM F593 Group %d, condition CW" % group
    return {
        "id": f"ASTM-F593-G{group}-CW",
        "label": f"{alloys} stainless, condition CW (ASTM F593 Group {group}; F837 below 1/4 in)",
        "label_by_product": {"hex": f"{alloys} stainless, condition CW (ASTM F593 Group {group})"},
        "system": "inch",
        "standard": "ASTM F593 / ASTM F837",
        "material": f"austenitic stainless steel ({alloys})",
        "products": list(ALL_PRODUCTS),
        "condition": "CW (cold worked). F593: the condition furnished unless otherwise specified. "
                     "F837: no default; CW is the lower of its two cold-worked conditions.",
        "aliases": [f"f593 group {group}"],
        "note": "F593 covers bolts, hex cap screws and studs from 1/4 to 1-1/2 in. Below 1/4 in the "
                "stainless socket-head-cap-screw specification ASTM F837 (condition CW) is used for "
                "socket heads; hex heads below 1/4 in have no value.",
        "rows": [
            inch(0.25, 0.625, sig(0.85 * 65), "kpsi", "astm_f593", src + "1 (1/4-5/8 in)", FROM_SY, 2,
                 size_text="1/4-5/8 in", Sy=65,
                 note="F593 gives yield strength 65 ksi min (tensile 100-150 ksi), no proof load."),
            inch(0.75, 1.5, sig(0.85 * 45), "kpsi", "astm_f593", src + "2 (3/4-1-1/2 in)", FROM_SY, 2,
                 size_text="3/4-1-1/2 in", Sy=45,
                 note="F593 gives yield strength 45 ksi min (tensile 85-140 ksi), no proof load."),
            f837_row(group, "CW", 40, 0.06, 0.25, "#0 to below 1/4 in (F837)", d_max_exclusive=True,
                     products=SHCS_ONLY),
            inch(0.06, 0.25, None, "kpsi", "astm_f593", "ASTM F593 scope (1/4-1-1/2 in)", FROM_SY, 2,
                 size_text="#0 to below 1/4 in (hex head)", d_max_exclusive=True, verified=False,
                 products=HEX_ONLY,
                 note="ASTM F593 covers hex cap screws from 1/4 in, and ASTM F837 covers socket heads only. "
                      "No verified proof strength for stainless hex heads below 1/4 in; enter Sp from "
                      "supplier data."),
        ],
    }


def f837_grade(group, alloys, condition, sy):
    return {
        "id": f"ASTM-F837-G{group}-{condition}",
        "label": f"ASTM F837 Group {group} ({alloys}), condition {condition}",
        "system": "inch",
        "standard": "ASTM F837",
        "material": f"austenitic stainless steel ({alloys})",
        "products": list(SHCS_ONLY),
        "condition": condition,
        "aliases": [f"f837 group {group} {condition.lower()}"],
        "note": "Stainless socket head cap screws. Above 0.750 in, CW/CW1 properties are by agreement.",
        "rows": [
            f837_row(group, condition, sy, 0.06, 0.75, "0.060-0.750 in", products=SHCS_ONLY),
            inch(0.75, 1.5, None, "kpsi", "astm_f837", "ASTM F837 Table 1, footnote A", FROM_SY, 2,
                 size_text="over 0.750 in", d_min_exclusive=True, verified=False, products=SHCS_ONLY,
                 note="F837 leaves CW/CW1 properties above 0.750 in to agreement between user and "
                      "manufacturer. Enter Sp from supplier data."),
        ],
    }


def grades():
    g = []
    g.append(metric_class("4.6", "low or medium carbon steel",
                          [shigley_metric_row(5, 36, 225, "M5-M36")],
                          [iso_898_row(1.6, 39, 225, "M1.6-M39")]))
    g.append(metric_class("4.8", "low or medium carbon steel",
                          [shigley_metric_row(1.6, 16, 310, "M1.6-M16")],
                          [iso_898_row(1.6, 39, 310, "M1.6-M39")]))
    g.append(metric_class("5.8", "low or medium carbon steel",
                          [shigley_metric_row(5, 24, 380, "M5-M24")],
                          [iso_898_row(1.6, 39, 380, "M1.6-M39")]))
    g.append(metric_class(
        "8.8", "medium carbon steel, quenched and tempered",
        [shigley_metric_row(16, 36, 600, "M16-M36")],
        [iso_898_row(1.6, 16, 580, "d <= 16 mm"),
         iso_898_row(16, 39, 600, "d > 16 mm", d_min_exclusive=True)],
        note="Shigley lists 8.8 for M16-M36 only; ISO 898-1 is used below M16. At M16 the sources differ: "
             "Shigley 600 MPa (used, per SPEC source priority) vs ISO 898-1 580 MPa (d <= 16 mm)."))
    g.append(metric_class(
        "9.8", "medium carbon steel, quenched and tempered",
        [shigley_metric_row(1.6, 16, 650, "M1.6-M16")],
        [iso_898_row(1.6, 16, 650, "d <= 16 mm"),
         mm(16, 39, None, "MPa", "iso_898_1", ISO_898_1_T3, DIRECT, 2, size_text="d > 16 mm",
            d_min_exclusive=True, verified=False,
            note="Class 9.8 is defined only for d <= 16 mm (ISO 898-1 Table 3; Shigley Table 8-11).")],
        note="Class 9.8 exists only up to M16."))
    g.append(metric_class("10.9", "low-carbon martensite, quenched and tempered",
                          [shigley_metric_row(5, 36, 830, "M5-M36")],
                          [iso_898_row(1.6, 39, 830, "M1.6-M39")]))
    g.append(metric_class("12.9", "alloy steel, quenched and tempered",
                          [shigley_metric_row(1.6, 36, 970, "M1.6-M36")],
                          [iso_898_row(1.6, 39, 970, "M1.6-M39")]))

    g.append(stainless_3506("A2", "70", "18-8 / 304 type"))
    g.append(stainless_3506("A4", "70", "316 type"))
    g.append(stainless_3506("A2", "80", "18-8 / 304 type"))
    g.append(stainless_3506("A4", "80", "316 type"))

    g.append(sae_grade("2",
                       [sae_shigley(0.25, 0.75, 55, "1/4-3/4 in"), sae_shigley(0.875, 1.5, 33, "7/8-1-1/2 in")],
                       [sae_j429(0.25, 0.75, 55, "1/4 thru 3/4 in"),
                        sae_j429(0.75, 1.5, 33, "over 3/4 thru 1-1/2 in", d_min_exclusive=True)],
                       "low or medium carbon steel"))
    g.append(sae_grade("5",
                       [sae_shigley(0.25, 1.0, 85, "1/4-1 in"), sae_shigley(1.125, 1.5, 74, "1-1/8-1-1/2 in")],
                       [sae_j429(0.25, 1.0, 85, "1/4 thru 1 in"),
                        sae_j429(1.0, 1.5, 74, "over 1 thru 1-1/2 in", d_min_exclusive=True)],
                       "medium carbon steel, quenched and tempered"))
    g.append(sae_grade("8",
                       [sae_shigley(0.25, 1.5, 120, "1/4-1-1/2 in")],
                       [sae_j429(0.25, 1.5, 120, "1/4 thru 1-1/2 in")],
                       "medium-carbon alloy steel, quenched and tempered"))

    a574_src = "ASTM A574 Tables 2-3, footnote C (proof load, length measurement method)"
    g.append({
        "id": "ASTM-A574",
        "label": "ASTM A574 (alloy steel socket head cap screw)",
        "system": "inch",
        "standard": "ASTM A574",
        "material": "alloy steel, quenched and tempered",
        "products": list(SHCS_ONLY),
        "aliases": ["a574", "astm a574"],
        "note": "Not in Shigley Table 8-10. Socket head cap screws only.",
        "rows": [
            inch(0.06, 0.5, 140, "kpsi", "astm_a574", a574_src, DIRECT, 2, size_text="0.500 in and smaller",
                 products=SHCS_ONLY),
            inch(0.5, 4.0, 135, "kpsi", "astm_a574", a574_src, DIRECT, 2, size_text="larger than 0.500 in",
                 d_min_exclusive=True, products=SHCS_ONLY),
        ],
    })

    g.append(f593_group(1, "18-8"))
    g.append(f593_group(2, "316"))
    g.append(f837_grade(1, "18-8", "CW", 40))
    g.append(f837_grade(1, "18-8", "CW1", 65))
    g.append(f837_grade(2, "316", "CW", 40))
    g.append(f837_grade(2, "316", "CW1", 65))
    return g


# SPEC §3 title-to-grade mapping. "inferred" rows raise the flag
# "Grade inferred from material - verify against the product page."
# Hex heads have no alloy-steel rows on purpose: A574 covers socket heads only
# and 12.9 is the socket-head convention, so the user chooses.
TITLE_GRADE_MAP = [
    {"product": "shcs", "system": "metric", "material": "alloy_steel", "grade": "ISO-12.9"},
    {"product": "shcs", "system": "metric", "material": "ss_18_8", "grade": "ISO3506-A2-70"},
    {"product": "shcs", "system": "metric", "material": "ss_316", "grade": "ISO3506-A4-70"},
    {"product": "shcs", "system": "inch", "material": "alloy_steel", "grade": "ASTM-A574"},
    {"product": "shcs", "system": "inch", "material": "ss_18_8", "grade": "ASTM-F593-G1-CW"},
    {"product": "shcs", "system": "inch", "material": "ss_316", "grade": "ASTM-F593-G2-CW"},
    {"product": "hex", "system": "metric", "material": "ss_18_8", "grade": "ISO3506-A2-70"},
    {"product": "hex", "system": "metric", "material": "ss_316", "grade": "ISO3506-A4-70"},
    {"product": "hex", "system": "inch", "material": "ss_18_8", "grade": "ASTM-F593-G1-CW"},
    {"product": "hex", "system": "inch", "material": "ss_316", "grade": "ASTM-F593-G2-CW"},
]
INFERRED_GRADE_FLAG = "Grade inferred from material — verify against the product page."


# ---------------------------------------------------------------------------
# Lubrication: torque coefficient K and preload scatter Gamma (SPEC §4, §6)
# ---------------------------------------------------------------------------

T8_15 = "Shigley Table 8-15, p. 431"
GAMMA_SRC = "NASA-STD-5020B Sec. 4.3.3, Table 3 (torque control)"


def gamma(value, basis):
    return {"value": value, "basis": basis, "source": GAMMA_SRC, "source_id": "nasa_std_5020b", "verified": True}


G_LUB = lambda: gamma(0.25, "lubricated")
G_DRY = lambda: gamma(0.35, "non-lubricated")
G_ASREC = lambda: gamma(0.35, "as-received")


def k(value, source, source_id, note="", verified=True):
    return {"value": value, "source": source, "source_id": source_id, "verified": verified, "note": note}


K_NULL_NOTE = "Use vendor data or torque-tension testing."

LUBRICANTS = [
    {"id": "dry", "label": "Dry / nonplated black finish",
     "K": k(0.30, T8_15 + " (nonplated, black finish)", "shigley"), "gamma": G_DRY(), "notes": []},
    {"id": "zinc", "label": "Zinc-plated, as received",
     "K": k(0.20, T8_15 + " (zinc-plated)", "shigley"), "gamma": G_ASREC(), "notes": []},
    {"id": "lubricated", "label": "Lubricated (oil or general grease)",
     "K": k(0.18, T8_15 + " (lubricated)", "shigley"), "gamma": G_LUB(), "notes": []},
    {"id": "cadmium", "label": "Cadmium-plated",
     "K": k(0.16, T8_15 + " (cadmium-plated)", "shigley"), "gamma": G_ASREC(), "notes": []},
    {"id": "antiseize", "label": "Anti-seize",
     "K": k(0.12, T8_15 + " (Bowman Anti-Seize)", "shigley"), "gamma": G_LUB(),
     "notes": ["Shigley's value is for Bowman Anti-Seize; other brands vary."]},
    {"id": "pfpe", "label": "PFPE grease (Krytox, Braycote)",
     "K": k(0.18, "NASA NTRS 20150004064, pp. 236 and 238-239 (not Shigley)", "ntrs_20150004064",
            note="Paper recommends K = 0.18 for A286 fasteners with Braycote 601EF in phosphor-bronze "
                 "helical inserts; combined mean of all its data = 0.180."),
     "gamma": G_LUB(),
     "notes": [
         "Mean K from NASA torque-tension tests of A286 fasteners with Braycote 601EF (PFPE) in "
         "phosphor-bronze helical inserts. Use your own test data for flight hardware.",
         "Only Braycote was tested; Krytox was not.",
         "The paper's measured torques include insert running torque (p. 233), so adding a measured "
         "running torque on top of this K may double-count it.",
     ]},
    {"id": "unknown", "label": "Condition unknown",
     "K": k(0.20, "Shigley p. 430 (default when the bolt condition is not stated)", "shigley"),
     "gamma": gamma(0.35, "non-lubricated or as-received (conservative)"), "notes": []},
    {"id": "mos2", "label": "MoS₂ paste",
     "K": k(None, "no cited source", None, note=K_NULL_NOTE, verified=False),
     "gamma": G_LUB(), "notes": ["No K without a cited source: preload only."]},
    {"id": "ptfe", "label": "PTFE dry film",
     "K": k(None, "no cited source", None, note=K_NULL_NOTE, verified=False),
     "gamma": G_LUB(), "notes": ["No K without a cited source: preload only."]},
    {"id": "silver", "label": "Silver-plated",
     "K": k(None, "no cited source", None, note=K_NULL_NOTE, verified=False),
     "gamma": G_ASREC(),
     "notes": ["No K without a cited source: preload only.",
               "Plating is not an applied lubricant under NASA-STD-5020B, so Gamma = 0.35."]},
    {"id": "custom", "label": "Custom",
     "K": {"value": None, "source": "user input", "source_id": None, "user_input": True},
     "gamma": {"value": None, "source": "user input", "source_id": None, "user_input": True},
     "notes": []},
]

LUBRICATION_NOTES = {
    "always": "K assumes lubricant on BOTH the threads and the under-head bearing face.",
    "no_preselect": "No lubricant is pre-selected: the choice moves preload by up to 2.5x.",
    "finish_hints": {
        "black-oxide": "Black-oxide screws often ship lightly oiled. Choose Dry if degreased, Lubricated if as-received.",
        "zinc-plated": "Zinc-plated: Shigley Table 8-15 gives K = 0.20 as received. Choose Lubricated if you oil them.",
        "cadmium-plated": "Cadmium-plated: Shigley Table 8-15 gives K = 0.16.",
        "other": "Shigley gives no K for this finish. Use vendor data (Custom) or pick the closest condition.",
    },
}


# ---------------------------------------------------------------------------
# Thread engagement (SPEC §5)
# ---------------------------------------------------------------------------

ENGAGEMENT = [
    {"id": "nut_steel", "label": "Nut, or tapped steel", "insert": False, "warnings": [], "notes": []},
    {"id": "tapped_soft", "label": "Tapped aluminum or other soft material", "insert": False,
     "warnings": ["W5"], "notes": []},
    {"id": "insert_free", "label": "Free-running helical insert", "insert": True, "warnings": [],
     "notes": ["K depends on insert coating and wear."]},
    {"id": "insert_locking", "label": "Screw-locking helical insert", "insert": True, "warnings": [],
     "notes": [], "requires_running_torque": True,
     "running_torque_prompt": "Run the screw in with a torque wrench and record the torque just before the head seats.",
     "missing_running_torque_label": "EXCLUDES running torque"},
]

REUSED_INSERT = {
    "applies_to": ["insert_free", "insert_locking"],
    "note": "K changes as inserts are reused: in NASA tests it rose with repeated cycles for dry installs "
            "and fell for lubricated installs (NASA NTRS 20150004064, pp. 235 and 242). Re-check "
            "torque-tension for reused inserts.",
    "source": "NASA NTRS 20150004064, p. 235 (conclusion 1) and p. 242 (conclusion 4)",
    "source_id": "ntrs_20150004064",
    "verified": True,
    "spec_text": "K tends to rise as inserts wear (NASA NTRS 20150004064).",
    "spec_text_matches_source": False,
    "spec_text_note": "The paper reports a rise only for dry (unlubricated) installs; lubricated installs trended down.",
}


# ---------------------------------------------------------------------------
# Preload fraction and scatter (SPEC §6)
# ---------------------------------------------------------------------------

PRELOAD_FRACTION = {
    "options": [
        {"id": "reusable", "label": "Reusable / nonpermanent", "f": 0.75, "default": True},
        {"id": "permanent", "label": "Permanent", "f": 0.90, "default": False},
    ],
    "max_recommended": 0.90,
    "source": "Shigley Eq. 8-31, p. 434",
    "source_id": "shigley",
}

GAMMA_POLICY = {
    "lubricated": 0.25,
    "non_lubricated_or_as_received": 0.35,
    "source": GAMMA_SRC,
    "source_id": "nasa_std_5020b",
    "clause": "NASA-STD-5020B Sec. 4.3.3 [TFSR 7], Table 3; Appendix A.2 (same in NASA-STD-5020A w/Change 1)",
    "applicability": "Torque control, non-separation-critical joints, alternate (non-statistical) method. "
                     "These are floors: use the larger test-measured variation if you have one. "
                     "Separation-critical joints need a statistical basis from lot-specific tests.",
    "lubricated_definition": "Lubricated means a solid-film, grease or liquid lubricant on the threads AND the "
                             "turning bearing surface (NASA-STD-5020B Sec. 4.3.3).",
    "verified": True,
    "user_overridable": True,
}

SHIGLEY_SCATTER = {
    "description": "Preload scatter at equal torque (1/2-20 UNF bolts, 800 lbf-in, reported in SI as 90 N-m)",
    "unlubricated": {"table": "Shigley Table 8-13, p. 430", "n": 20, "mean_kN": 34.3, "std_kN": 4.91,
                     "cov": sig(4.91 / 34.3, 3)},
    "lubricated": {"table": "Shigley Table 8-14, p. 431", "n": 10, "mean_kN": 34.18, "std_kN": 2.88,
                   "cov": sig(2.88 / 34.18, 3)},
    "source_id": "shigley",
}


def build():
    threads = metric_threads() + inch_threads()
    ids = [t["id"] for t in threads]
    assert len(ids) == len(set(ids)), "duplicate thread ids"
    grade_list = grades()
    by_id = {g["id"]: g for g in grade_list}
    for m in TITLE_GRADE_MAP:
        assert m["grade"] in by_id and m["product"] in by_id[m["grade"]]["products"], m
    return {
        "schema_version": 2,
        "generator": "build_standards.py",
        "primary_source": "Shigley's Mechanical Engineering Design, 10th ed. (printed page numbers)",
        "lookup_rule": "Sp: among grade rows whose size range contains d and whose products include the head "
                       "type, use the lowest priority number (1 = Shigley, 2 = standard), preferring rows whose "
                       "scope covers the thread. A fine-pitch thread below a row's fine_pitch_d_min still uses "
                       "that row, flagged with fine_pitch_note.",
        "fine_pitch_note": FINE_PITCH_NOTE,
        "sources": SOURCES,
        "formulas": FORMULAS,
        "products": PRODUCTS,
        "threads": threads,
        "grades": grade_list,
        "title_grade_map": TITLE_GRADE_MAP,
        "inferred_grade_flag": INFERRED_GRADE_FLAG,
        "lubricants": LUBRICANTS,
        "lubrication_notes": LUBRICATION_NOTES,
        "engagement": ENGAGEMENT,
        "reused_insert": REUSED_INSERT,
        "preload_fraction": PRELOAD_FRACTION,
        "gamma_policy": GAMMA_POLICY,
        "shigley_scatter": SHIGLEY_SCATTER,
    }


def main():
    data = build()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    n_threads = len(data["threads"])
    n_metric = sum(t["system"] == "metric" for t in data["threads"])
    print(f"Wrote {OUT.relative_to(Path.cwd()) if OUT.is_relative_to(Path.cwd()) else OUT}")
    print(f"  threads: {n_threads} ({n_metric} metric, {n_threads - n_metric} inch)")
    print(f"  grades: {len(data['grades'])}, lubricants: {len(data['lubricants'])}")


if __name__ == "__main__":
    main()
