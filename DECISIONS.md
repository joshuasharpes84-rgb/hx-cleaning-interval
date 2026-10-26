# Engineering Decisions — Cleaning Interval & Bundle Life

The calls that shaped the tool: what was decided, what was rejected, and why. Sources for each
topic are in `SOURCES.md`.

*Built by Joshua Sharpes, EIT, with AI assistance (Claude) for drafting, coding and checks. Scope,
method selection, validation criteria and the corrections below are his.*

## Basis

**Temperature control, not fixed water flow.** The cooler sits on a TIC that throttles cooling
water to hold the process outlet. Fouling therefore shows up as a rising CW flow and valve opening,
not as a drifting outlet temperature. The first build assumed fixed CW flow; it was rebuilt on the
TIC basis because that is how these coolers actually run.

**The cleaning trigger is valve saturation.** Once the CW valve is full open, the outlet can no
longer be held. The tool calculates the CW capacity at full open from the valve equation and tube
hydraulics, and cleans before that point.

**A calculated fouling allowance, not a table value.** An earlier version asked for a generic
design fouling factor. It now inverts the ε-NTU relation at full-open CW to find the lowest U that
still holds the setpoint, so the allowance is `1/U_required − 1/U_clean` for this exchanger and
this water supply. A TEMA table value says nothing about how much headroom a specific unit has.

## Prediction

**Three trends, not one.** Falling-rate (`1/U² = a·t + c`, the classic law for inverse-solubility
scale) is the prediction; linear and asymptotic are the bounds. Fitting only one form hides the
real uncertainty.

**Clean U is fitted, not measured from the first points.** Estimating it from the first few noisy
rows biased the fouling resistance about 20 % low, so clean U is fitted as each trend's intercept.

**The confidence cone is shown, and its limit is stated.** The cone covers scatter in the data, not
the choice of trend. In verification the true trigger (~350 days) fell outside the falling-rate
cone (267–294 days) but inside the linear-to-asymptotic bounds. The page and README say so.

**Key finding: the trend form, not the arithmetic, sets the answer.** On the same demo data an
asymptotic fit says no cleaning ever pays back, while a linear reading says about 13 months. At
±0.3 °C instrument noise the three trends cannot be told apart statistically. The practical
message: record length and instrument quality decide whether the interval can be trusted.

## Economics

**A cooler's penalty is lost duty, not labor.** Peters & Timmerhaus' cyclic-operation optimum was
written for an evaporator at fixed ΔT. For a cooler the cost of running dirty is extra CW pumped and
duty lost after the valve saturates, so the cost model was adapted to: cleaning cost + extra CW +
value of lost duty, per cycle, plus bundle replacement spread over its life. Peters' printed
closed forms were OCR-garbled and were re-derived by hand before use.

**Recommendation = the earlier of saturation and the cost optimum.** When lost duty is cheap the
cost optimum can fall after saturation; the tool flags that instead of recommending a run with an
uncontrolled outlet.

## Bundle life

**Pitting governs, not average corrosion.** Uhlig shows the deepest pit runs 2.5–10× the average
penetration, and Perry's states that an allowance sized on the average rate is invalid where
pitting is active. Bundle life is set by the deepest pit reaching the wall margin, using Uhlig's
time-dependent pitting factor.

**Materials check runs implicitly.** The Materials of Construction methodology runs as a validation
panel (temperature ceiling, rate class, Langelier index, velocity, chloride) rather than a separate
document, because the tool's question is when to clean, not what to build the bundle from.

## Honesty about the demo

**The demo data is literature-shaped, not measured.** It is built from the Knudsen & Story CaCO₃
correlation (via Bott), with an assumed time constant, and labeled that way on the page. Bott does
not state the correlation's units; the inferred units reproduce TEMA-range values and are flagged
for confirmation against the primary paper.
