# boltpreload.com

A static site that reads a pasted McMaster-Carr socket head cap screw (SHCS) or hex head cap screw title and recommends preload, tightening torque and lubrication, with a preload range and warnings.

The primary source is Shigley's *Mechanical Engineering Design*, 10th ed. (Budynas & Nisbett), Chapter 8. Where Shigley has no value, the governing standard is used, and the site labels every such number "not from Shigley".

## Run locally

The page loads its data with `fetch`, so it must be served over HTTP; opening `index.html` as a file will not work.

```bash
python3 -m http.server
```

Then open <http://localhost:8000>.

There is no build step. The site is plain HTML, CSS and ES modules.

## Layout

| Path | Purpose |
|---|---|
| `index.html`, `css/style.css` | Page and styles (light/dark via `prefers-color-scheme`) |
| `js/parser.js` | Title → thread, material, stated grade, finish; title-to-grade mapping |
| `js/calculator.js` | At, Sp lookup, Fp, Fi, torque, preload range, warnings, unit conversions |
| `js/ui.js` | DOM only: inputs, results, comparison table |
| `data/fastener_standards.json` | Generated data (threads, grades, lubricants, notes, sources) |
| `build_standards.py` | Generates the JSON |
| `validate_standards.py` | Checks the JSON and prints a full report |
| `tests/` | Node tests; `titles.txt` holds real McMaster titles |

## How it calculates

1. **At** = (π/4)(d − 0.9382 P)² metric, (π/4)(D − 0.9743/n)² unified (Shigley Tables 8-1 and 8-2 footnotes). Numbered sizes: D = 0.060 + 0.013 N.
2. **Sp** comes from Shigley Tables 8-9 to 8-11, otherwise from the governing standard. Where a standard gives only yield strength, Sp = 0.85 Sy (Shigley p. 434).
3. **Fp** = At·Sp (Eq. 8-32), then **Fi** = f·Fp with f = 0.75 for reusable joints or 0.90 for permanent ones (Eq. 8-31).
4. **T** = K·Fi·d (Eq. 8-27), with K from Shigley Table 8-15 (0.20 when the condition is unknown, p. 430).
5. **Fi,min / Fi,max** = (1 ∓ Γ)·Fi, with Γ = 0.35 non-lubricated or as-received and 0.25 lubricated (NASA-STD-5020B §4.3.3, Table 3).
6. **Screw-locking inserts:** T_inst = T_seat + the measured running torque.
7. **Head type:** socket and hex heads use the same equations and K. Shigley derives K (Eq. 8-26) for a hex washer face 1.5d across flats (p. 430). Head type only changes which grades apply (see below). Flanged, hex washer and heavy hex heads are out of scope.

## Data sources

| Value | Source |
|---|---|
| At formula; UNC/UNF sizes; metric coarse pitches and one fine pitch per size | Shigley Tables 8-1, 8-2 (pp. 404-405) |
| Other metric fine pitches, second-choice sizes | ISO 261:1998 Table 2 |
| UNEF; 1-1/8" and 1-3/8" UNC/UNF; numbered-size diameters | ASME B1.1 |
| Metric classes 4.6-12.9 | Shigley Table 8-11 (p. 427); ISO 898-1:2013 Table 3 where Shigley has no row |
| SAE Grades 2, 5, 8 | Shigley Table 8-9 (p. 425); SAE J429 as cross-check |
| A2/A4-70 and -80 stainless | ISO 3506-1:2020, Sp = 0.85·Rp0.2 |
| Inch alloy SHCS | ASTM A574 (proof load stress 140 kpsi ≤ 1/2", 135 kpsi above); socket heads only |
| Inch 18-8 / 316 stainless | ASTM F593 condition CW, Sp = 0.85·Sy; ASTM F837 condition CW below 1/4" (socket heads only) |
| K values | Shigley Table 8-15 (p. 431); PFPE grease from NASA NTRS 20150004064 |
| Γ (preload scatter) | NASA-STD-5020B §4.3.3, Table 3 |

The JSON's `sources` section lists the exact clause and the URLs used to verify each value. A few decisions are worth knowing:

- **Shigley wins when sources disagree.** Class 8.8 at M16 is 600 MPa (Shigley) rather than ISO 898-1's 580 MPa; the site shows both.
- **Fine pitch below M8.** ISO 898-1 and ISO 3506-1 cover fine pitch only from M8×1. Finer threads get the class value with a visible "outside the standard's scope" flag, and Sp stays editable.
- **Hex heads.** ASTM A574 and F837 are socket head specifications, so they aren't offered for hex heads. ASTM F593 covers hex cap screws directly from 1/4", so stainless hex heads below 1/4" have no verified Sp, and the site asks for one. "Alloy steel" on a hex head title doesn't infer a grade.
- **Shigley typo.** Table 8-2 prints At = 0.00880 in² for #5-44 UNF. The formula and ASTM A574/F837 give 0.00830, and the data uses the formula value.

The reference PDF is not in this repository (`refs/` is git-ignored). The code and JSON cite table, equation and page numbers only.

## Regenerate the JSON

```bash
python3 build_standards.py
```

```bash
python3 validate_standards.py
```

The validator checks:
- every At against the formula and against every Shigley Table 8-1/8-2 row;
- the grade tables, Sp lookup for every thread/grade pair, and source cross-checks;
- the SPEC lubrication and Γ values.

It also lists every unverified value and every value not taken from Shigley. It exits non-zero on any failure.

## Tests

Requires Node 21 or later; there are no dependencies.

```bash
node --test "tests/*.test.js"
```

## Disclaimer

Estimates based on Shigley's 10th ed. and cited standards. Verify against applicable standards and test critical joints. Not affiliated with McMaster-Carr.
