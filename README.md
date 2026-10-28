# Cleaning Interval & Bundle Life — Tool Package

**What it answers:** for a shell-and-tube cooler on cooling water, *when will this exchanger need
cleaning, how sure are we, what does that schedule cost, and how many cleanings does the tube
bundle have left?*

> **Make it yours, free:** download this repo (**Code → Download ZIP**, or `git clone`), open the folder in
> VS Code or any editor, and extend it for your own case with your AI assistant. This README is written for
> both of you. Taking these tools further is a free service of
> [Sharpes Process Engineering](https://jsharpes-portfolio.netlify.app); the site's Ask box can point you to the right starting file.

**Who this file is for:** the engineer using the tool, and that engineer's AI assistant. It is
self-contained: hand it to an assistant together with your data and it has everything needed to
check, challenge or adapt the method.

| | |
|---|---|
| Files | `tools/cleaning-interval/index.html` (tool), `cleaning_engine.js` (all calculations, commented with sources), `lib/` (Chart.js, SheetJS — local, no CDN), `SOURCES.md` (sources by topic), `DECISIONS.md` (engineering calls) |
| Status | v2, 2026-10-09. Screening (FEL) tool, not a design or inspection deliverable. |
| Runs | Live at https://jsharpes-portfolio.netlify.app/#cleaning-tool, or open `tools/cleaning-interval/index.html` in any browser, offline. Nothing is uploaded anywhere. |

---

## 1. Service and control basis

- **Exchanger:** shell-and-tube, 1 shell pass, 2/4/6 tube passes. Process on the shell side,
  cooling water (CW) in the tubes.
- **Fouling:** CaCO₃ scale on the CW side. Calcium carbonate has inverse solubility, so it deposits on
  the hot tube wall (Peters & Timmerhaus p.396; Bott Ch.8).
- **Control:** a temperature controller (TIC) holds the process outlet by throttling the CW valve.
  As scale builds and U falls, the controller opens the valve. Fouling therefore shows up as **rising
  CW flow and falling CW outlet temperature, not a hotter process outlet**, until the valve is fully
  open. After that the process outlet rises and the loop has lost control. **That saturation point is
  the cleaning trigger.**
- **Tubes:** carbon steel. **Cleaning:** hydroblast.

## 2. Inputs, in order of importance

1. **Plant data, current run** (spreadsheet): date *or* day, process in/out, CW in/out (°C).
   Optional: process flow, metered CW flow, CW valve %. Paste from Excel, type, or upload CSV/XLSX
   (column headers are matched by name). Changes to the grid and tool inputs recalculate the
   analysis automatically. Dates are converted to days from the last-cleaning date.
2. **Current cycle & bundle:** last cleaning date, years in service, cleanings to date.
3. **Projection basis & limits:** process flow, inlet, outlet setpoint, CW supply (blank = median of
   your log), confidence level. The thermal fouling limit is calculated from this basis, the
   exchanger geometry and the hydraulically calculated full-open CW flow; no generic fouling
   allowance is entered. The calculated required dirty U and falling-rate fouling allowance are
   displayed directly beneath the exchanger/valve/header inputs in the expanded secondary-inputs
   panel.
4. Secondary (collapsed): geometry, fluid properties, CW header and valve, economics, corrosion
   parameters, water chemistry, demo generator.

## 3. Calculation chain

### 3.1 U from each logged row
- Duty from the process side: `Q = ṁ_p·c_p·(T_p,in − T_p,out)`.
- CW flow, by the chosen source:
  - *energy balance* (default): `ṁ_w = Q / (c_p,w·ΔT_w)`;
  - *valve position*: hydraulics at the logged opening (§3.4);
  - *metered*: the CW-flow column.
  When a row lacks the chosen column, the energy balance is used for that row.
- U by inverting the one-shell-pass effectiveness relation (Incropera Table 11.3/11.4, Eq. 11.30a–c):
  `ε = Q/(C_min·(T_p,in − T_w,in))` → NTU → `U = NTU·C_min/A`. No F-correction chart needed.

### 3.2 Three fouling trends on 1/U(t)

| Trend | Equation | Role | Source |
|---|---|---|---|
| Falling rate | `1/U² = a·t + c` | **Prediction** | McCabe & Robinson (1924), Peters & Timmerhaus Eq. 9-53 (scale formation) |
| Linear | `R_f = r·t` | **Upper bound** (never slows → soonest cleaning) | Bott Fig. 4.1 curve A; Perry's 9th p.11-22 |
| Asymptotic | `R_f = R_f*·(1 − e^(−t/τ))` | **Lower bound** (levels off) | Kern & Seaton (1959), Bott Eq. 8.20 |

- Clean U (the intercept) is **fitted** for each trend unless you fix it. Estimating it from the first
  few noisy points biased R_f* about 20 % low in testing.
- Fit quality: RMSE on 1/U and AICc (which penalizes extra parameters).
- **Every trend's parameters are editable** in its row (Apply / Reset to fit). Use this to impose
  plant experience, e.g. a known R_f*.

### 3.3 The confidence cone
For the falling-rate fit, the band on the regression line in 1/U² space is
`ẑ ± t_(α,n−2) · s · √(1/n + (t − t̄)²/S_xx)` (confidence interval of the mean trend), carried
forward and converted back to R_f and to required CW flow. The Student-t quantile uses a
normal-quantile + Cornish–Fisher approximation (checked: 2.229 vs. table 2.228 at df = 10).

> **What the cone does not cover.** It reflects scatter and record length only. It does **not**
> cover the risk that falling-rate is the wrong shape for your exchanger — that is what the linear
> and asymptotic bounds are for. In the verification run (§6) the true trigger fell outside the cone
> but inside the bounds. Read the cone and the bounds together.

### 3.4 CW hydraulics (TIC capacity)
- Header balance: `ΔP_available = P_supply − P_return = ΔP_valve + ΔP_exchanger + ΔP_other`,
  with ΔP_other scaled by (flow / reference flow)².
- Exchanger tube-side ΔP: Darcy–Weisbach with Petukhov's smooth-tube friction factor
  `f = (0.790 ln Re − 1.64)⁻²` (Incropera Eq. 8.21, p.490; 64/Re if laminar), plus return losses of
  **four velocity heads per pass** (Kern, *Process Heat Transfer*, p.148).
- Valve: `w [kg/h] = 27.3 · C_V · √(ρ·Δp [bar])` (Perry's 9th Eq. 8-77, p.8-71), with
  `C_V(y) = C_V,rated·y` (linear) or `C_V,rated·exp((y − 1)·ln R)` (equal-percentage, Eq. 8-88).
- Full-open flow = the TIC's capacity. For each future day the tool solves for the CW flow needed to
  hold the setpoint at the projected U (ε-NTU, §3.1). It also inverts the same one-shell-pass
  ε-NTU relation at full-open flow to calculate the minimum dirty U that still meets the process
  outlet setpoint, i.e. the fouling threshold at which the CW valve is fully open and can just
  maintain the target:
  `Q_req = ṁ_p·c_p·(T_p,in − T_p,set)`,
  `ε_req = Q_req/[C_min·(T_p,in − T_CW,in)]`,
  `U_req = NTU_12(ε_req, C_r)·C_min/A`.
  For each trend's clean-U baseline, the corresponding thermal fouling headroom is
  `R_f,threshold = 1/U_req − 1/U_clean`. The R_f(t) chart plots this calculated threshold across
  the fitted fouling curves. The run ends when that threshold is reached or the
  required CW flow exceeds full-open capacity; these are two numerical views of the same TIC
  capacity constraint, and the earlier is used. If the clean U is already below `U_req`, the target
  is infeasible at the start; if even infinite U cannot deliver the target at full-open flow, the
  thermal limit is reported as unachievable. This calculated limit is based on the entered process
  setpoint and hydraulic capacity, not a generic TEMA fouling-factor allowance.

### 3.5 Process-inlet temperature / fouling sensitivity (scenario only)
The slider varies process inlet by ±20 °C around the projection basis. It does **not** shift a
temperature-dependent coefficient while leaving the exchanger unchanged: each scenario day solves
for the CW flow needed to hold the outlet setpoint, then recalculates tube-side film transfer,
wall temperatures and wall shear at that controlled flow.

- CW-side `h` is estimated with Gnielinski (Heat and Mass Transfer Textbook, Eq. 8.62, pp. 515–516;
  used only within the stated `Re = 3,000–5×10⁶`, `Pr = 0.5–2,000` range). Process-side film
  resistance is the residual from the fitted clean U after subtracting the CW film and tube-wall
  resistances; it is held constant across the scenario. Tube-wall resistance is
  `R_wall = D_o·ln(D_o/D_i)/(2·k_tube)` and the CW-film resistance on the outside-area basis is
  `R_CW = D_o/(D_i·h_CW)`.
- Each day, the model estimates tube-wall and deposit/CW-interface temperatures from the thermal
  resistance split and recalculates tube-wall shear from controlled flow. The temperature
  correlation uses the estimated CW-side tube wall (metal/deposit interface); the separately
  displayed deposit/CW interface is not substituted, because Bott's cited correlation does not
  resolve that interface definition here. It advances the
  asymptotic fouling state by one day using `Rf_next = Rf + (Rf∞ − Rf)·(1 − e^(−1/τ))`.
- The scenario asymptote is **anchored to the current fitted asymptotic `Rf*`**. Only its relative
  temperature response uses Knudsen & Story (1978) via Bott Eq. 8.24:
  `Rf∞,scenario = Rf*,fit·[K(T_wall)/K(T_wall,reference)]·[shear_reference/shear]`.
  The time constant is scaled as `τ_scenario = τ_fit·shear_reference/shear`, representing Bott
  Eq. 8.21's shear dependence with scale properties held fixed. This avoids treating the uncertain
  absolute correlation as a direct plant prediction.
- The calculation uses the main analysis's **falling-rate clean-U intercept as one shared
  clean-U basis**; the asymptotic `Rf*` and `τ` still come from the asymptotic fit. Each trend is
  fitted to the simulated fouling resistance on that same clean-U basis, not to changes in overall
  U caused merely by the CW-film coefficient changing with flow. One common fouling threshold is
  found by increasing `Rf` until the profile model at full-open CW flow can no longer meet the
  process outlet setpoint; it therefore includes the flow-dependent Gnielinski film coefficient.
  The simulated trajectory stops at valve saturation. The output is a **sensitivity of the assumed
  model**, not a
  validated forecast: Knudsen & Story's energy/gas-constant/temperature units are inferred in Bott,
  not confirmed against the primary paper; water chemistry and scale properties stay fixed; the
  inferred process-side resistance stays fixed; and deposit-induced tube constriction / pressure
  drop is not modeled.

**Correction to the initial sensitivity output:** it independently refit each trend's clean-U
intercept, then compared them to trend-specific thresholds in the table while drawing only the
falling-rate threshold on the chart. This made the asymptotic line visibly cross the red line even
when its table said “never.” The sensitivity now uses one shared clean-U basis and one
geometry-coupled full-open threshold, fits the generated fouling resistance rather than
flow-affected U, and stops at saturation.

On the current 150 °C demo basis, the model estimates a 46.1–49.99 °C CW-side tube wall over the
four-year run. The common full-open threshold is about `3.097×10⁻⁴ m²K/W`; the long-run simulated
asymptote is about `3.073×10⁻⁴`, just below it, so the asymptotic trend does not trigger. Falling
and linear trigger at approximately 989 and 988 days. This small asymptote/threshold margin is
within the model's uncertainty and should not be interpreted as a confident “never.” At 130 °C,
falling/linear trigger at about 1,411/1,340 days and asymptotic does not trigger. At 170 °C, the
valve saturates at about day 36 and the trends trigger at about days 35/35/36 (falling/linear/
asymptotic); simulation stops there rather than extrapolating post-saturation wall heating into a
runaway fouling trajectory. These are reproducible demo sensitivities, not plant-life estimates.

### 3.6 Economics (structure approved 2026-10-06)
Annual cost for a run length θ: `[C_clean + C_CW·(extra CW circulated) + value_duty·(duty lost after
saturation + duty lost while down)] · 365/(θ + θ_down) + C_bundle / L_bundle`. This is Peters &
Timmerhaus' semicontinuous-cycle framework (pp.395–400). Its closed forms for `1/U² = a·t + c` at
fixed ΔT are θ = θ_c + 2√(cθ_c/a) (maximum heat transferred) and θ = C_c/S_b + 2√(c·C_c/(a·S_b))
(minimum cost); both were re-derived by hand. The tool solves the TIC case numerically.
**Recommendation = the earlier of valve saturation and the cost optimum.** The cost optimum can fall
after saturation when lost duty is cheap; the tool flags this rather than recommending a run with an
uncontrolled outlet.

### 3.7 Tube life — pitting, not average corrosion (Uhlig, *Corrosion Handbook*, 1948)
- **Pitting factor** = deepest pit ÷ average penetration from weight loss (glossary).
- Values: ≈ 2.5 for descaled steel after ~10 yr, higher at short exposures (pp.388–389). Fresh-water
  pitting reaches "as high as ten times" the mean rate (p.130), and pitting behaves "approximately the
  same in fresh waters as in sea water."
- Deepest pit grows with time and exposed area: `P = k·Tⁿ`, `P = b·Aᵃ` (pp.1050–1051).
- Model: `d_max(t) = min(PF₁₀·(t/10)^(n−1), PF_cap) · r · t · (A/A_ref)^a  + δ_clean·N_cleanings`.
  Defaults: PF₁₀ = 2.5, n = 0.5 (reproduces Uhlig's ~0.04 ipy short-term pitting rate), cap 10,
  area scaling off, δ_clean = 0.
- Retire when d_max reaches **nominal wall − minimum required wall**. Perry's 9th p.25-13: an
  allowance sized on the average rate is invalid where pitting is active.
- Current state (section 2 of the tool): average penetration, theoretical deepest pit, % of margin
  used, years and cleanings left at the predicted cycle.

### 3.8 Materials validation (implicit)
The Materials of Construction methodology (Steps 1–6, `Plant Resources\Materials of Construction`)
runs as a check panel, not a selection. It covers: carbon-steel temperature ceiling (Perry's p.25-12);
general-rate class (Perry's Table 25-3); pitting governs (p.25-13); Langelier index — negative =
corrosive (Bott p.296), positive = protective scale but under-deposit risk (Uhlig pp.126, 130);
tubercle removal by cleaning reduces pitting (Uhlig p.499); velocity (Uhlig p.135); chloride.

## 4. Demo data (literature-shaped, not measured)
- CaCO₃ asymptote from **Knudsen & Story (1978)** via Bott Eq. 8.24:
  `R_f∞ = 3×10¹¹·exp(−42,000/(R·T_s))`, hr·ft²·°F/Btu, CaCO₃ at 1 m/s.
  Bott does not state E, R or T_s units. **°R with R = 1.987 Btu/lb-mol·°R is an inference**: it
  gives TEMA-range values, while kelvin does not. Confirm against the primary paper before using it
  outside the demo.
- Time constant τ and a slow second mechanism are **assumed**. Perry's p.11-22: falling-rate fouling
  usually comes from mechanisms combined.
- Run on the TIC basis: controller-solved CW flow, valve % from hydraulics, Gaussian instrument noise.

## 5. Defaults you should replace

| Input | Default | Basis |
|---|---|---|
| Average corrosion rate | 2 mpy | Uhlig p.130 gives 2–6 mpy in quiet aerated soft water; scaling (hard) water lower; velocity raises it (p.135) |
| Pitting factor | 2.5 @ 10 yr, n = 0.5 | Uhlig pp.388–389 (sea water); calibrate to your eddy-current / IRIS data |
| Cleaning interval benchmark | 6–12 months | Bott pp.480–481 case history; Kern problem 6.x |
| Valve, header pressures, costs | illustrative | Use your plant's values |

## 6. Verification (Node, 2026-10-06/07)
- ε-NTU inverse reproduces NTU to 4 decimals. Energy balances close exactly on noise-free data.
- Noise-free demo recovers R_f* and τ exactly. At σ = 0.15 °C, R_f* is within 7 %. At σ = 0.3 °C the
  three trends are statistically indistinguishable.
- TIC demo: the true trigger was ~350 d; the falling-rate prediction gave 280 d (cone 267–294 d);
  the bounds gave 273 d to never. **Truth inside the bounds, outside the cone** (see §3.3).
- Headless-browser render checked for script errors.

## 7. Limits
- Single-mechanism scaling physics in the demo. Real cooling water combines scaling, particulate,
  biofouling and corrosion products.
- Uniform deposit assumed for U. Scale thickening the tube wall and adding ΔP is not modeled.
- The inlet-temperature slider is a model sensitivity, not a plant-predictive kinetic model. Its
  relative temperature response inherits the unverified units/conditions of the Knudsen–Story
  correlation; water chemistry and scale properties are fixed, the process-side resistance is
  inferred from clean U and held constant, and shear effects follow an assumed proportionality from
  Bott Eq. 8.21. See §3.5 and `SOURCES.md`.
- Pitting constants come from sea-water and soil data. They are screening values, not inspection
  results.
- No model of chemical treatment changes, upsets or seasonal CW temperature.

## 8. Asking your AI about this tool
Useful prompts, with this file and your data attached:
- "Check whether my data supports falling-rate over asymptotic, and what record length would."
- "Recompute the trigger if my CW header pressure drops 0.5 bar in summer."
- "Given my inspection pit depths, back out a pitting factor and update the bundle life."
