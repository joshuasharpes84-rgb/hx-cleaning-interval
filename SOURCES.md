# Sources — Cleaning Interval & Bundle Life

Where each type of information in this tool comes from. Topic-level, not number-by-number: the aim
is to show nothing was invented, and to point a reader to the right book and section if they want
to dig. Page numbers are in `README.md` and in the comments of `cleaning_engine.js`.

**Tiers**
- **Library** — reference textbook in `Downloads\ChemE\Textbooks (Level 1)\` or the Heat Exchangers
  project's `Reference Materals\` (used across projects)
- **Web** — public page, URL given
- **Cited via** — primary paper not held; used through the textbook that reproduces it
- **Own work** — derived, fitted or chosen in this project; the basis is stated

Copyrighted PDFs are cited here but never published.

| Topic | Source | Tier | Location |
|---|---|---|---|
| U(t) from logged temperatures: one-shell-pass ε-NTU relation and its inversion | Incropera et al., *Fundamentals of Heat and Mass Transfer*, Table 11.3/11.4, Eq. 11.30 | Library | `Heat Exchangers\Reference Materals\Heat and Mass Transfer Textbook.pdf` |
| Fouling cannot be predicted a priori; must come from the exchanger's own history | Perry's 9th, p. 11-22; Bott, *Fouling of Heat Exchangers*, §4.5 | Library | `Perry's 9th Edition.pdf`; `Heat Exchanger Fouling (Bott).pdf` |
| Falling-rate scale law 1/U² = a·t + c (inverse-solubility scale) | McCabe & Robinson (1924), via Peters & Timmerhaus, 5th ed., Eq. 9-53 | Library | `Plant Design and Economics for Chemical-Engineers-Peters.pdf`, pp. 395–400 |
| Asymptotic fouling model R_f = R_f*(1 − e^(−t/τ)), deposition vs. removal | Kern–Seaton / Taborek et al. (1972), via Bott Eqs. 8.19–8.21 | Library | `Heat Exchanger Fouling (Bott).pdf` |
| Demo data: CaCO₃ asymptote vs. surface temperature | Knudsen & Story (1978), via Bott Eq. 8.24 (units of E, R, T_s inferred; see README §4) | Cited via | Bott p. 117 |
| Treated cooling-tower-water fouling band 1.75–3.5 ×10⁻⁴ m²K/W | Bott Table 2.2 (TEMA-based) | Library | Bott |
| Langelier index: scaling vs. corrosive water | Bott p. 296 | Library | Bott |
| Cleaning-interval benchmark 6–12 months for cooling water | Bott pp. 480–481 (case history); Kern, *Process Heat Transfer*, problem 6.x | Library | Bott; `Core Textbooks\Heat Transfer Textbook (Kern).pdf` |
| Cost-optimal run length for cyclic operation (closed forms re-derived) | Peters & Timmerhaus, 5th ed., pp. 395–400, Eqs. 9-53 to 9-61 | Library | Peters |
| CW valve capacity and equal-percentage characteristic | Perry's 9th, Eq. 8-77 (p. 8-71), Eq. 8-88 | Library | Perry's Sec. 8 |
| Tube-side friction factor | Petukhov, via Incropera Eq. 8.21 (p. 490) | Library | Incropera |
| Return losses, four velocity heads per pass | Kern p. 148 | Library | Kern |
| Carbon-steel corrosion in cooling water: rates, velocity, temperature, under-deposit attack, cleaning reduces pitting | Uhlig, *Corrosion Handbook* (1948), pp. 125–135, 499, 551 | Library | `Equipment Handbooks\Corrosion Handbook.pdf` |
| Pitting factor (deepest pit ÷ average penetration), time and area dependence | Uhlig pp. 388–389, 1050–1051, glossary | Library | Uhlig |
| Allowance on average rate is invalid where pitting is active; CS temperature ceiling; corrosion-rate classes | Perry's 9th pp. 25-12, 25-13, Table 25-3 | Library | Perry's Sec. 25 |
| Materials check panel (Steps 1–6) | Joshua's Materials of Construction methodology | Own work | `ChemE\Plant Resources\Materials of Construction\` |
| Thermal cleaning limit R_f,allow = 1/U_required − 1/U_clean at full-open CW | Derived in this project from the ε-NTU inversion and the hydraulics above | Own work | `cleaning_engine.js` |
| Pitting-factor time law exponent n = 0.5, cap 10 | Chosen to reproduce Uhlig's short-term pitting rate (~0.04 ipy) and his "as high as ten times" bound | Own work | README §3.7 |
| Valve size, header pressures, costs, demo time constant | Illustrative defaults; replace with plant values | Own work | README §5 |
| Spreadsheet import | SheetJS 0.18.5 (Apache-2.0), Chart.js (MIT), bundled locally | Web | `lib/` |
