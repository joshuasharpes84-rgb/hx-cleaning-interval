/* Cleaning-interval / bundle-life engine (v2, TIC basis).
 * Shell-and-tube cooler, process shell-side, cooling water (CW) tube-side. A temperature controller (TIC)
 * holds the process outlet by throttling the CW valve, so CW flow rises as the tubes scale - until the
 * valve runs out of capacity. CaCO3 scaling + carbon-steel corrosion, hydroblast cleaning.
 * Units: SI internally (m, kg/s, kJ/kg-K, kW, degC, bar, days); corrosion in mils and years.
 * Every equation is cited inline; README.md has the page-level detail.
 */
(function (global) {
  "use strict";

  const MM_PER_MIL = 0.0254;

  // ---------------------------------------------------------------------------------------------
  // Heat transfer - one shell pass, 2/4/... tube passes (Incropera Table 11.3/11.4, Eqs 11.30a-c)
  // ---------------------------------------------------------------------------------------------
  function eps12(NTU, Cr) {
    const s = Math.sqrt(1 + Cr * Cr), e = Math.exp(-NTU * s);
    return 2 / (1 + Cr + s * (1 + e) / (1 - e));
  }
  function ntu12(eps, Cr) {
    const s = Math.sqrt(1 + Cr * Cr), E = (2 / eps - (1 + Cr)) / s;
    return E > 1 ? -Math.log((E - 1) / (E + 1)) / s : NaN;
  }
  function geometry(g) {
    const Do = g.od_mm / 1000, Di = (g.od_mm - 2 * g.wall_mm) / 1000;
    return { Do, Di, area: g.nTubes * Math.PI * Do * g.len_m, perPass: g.nTubes / g.passes,
             flowArea: (g.nTubes / g.passes) * Math.PI * Di * Di / 4, len: g.len_m, passes: g.passes };
  }
  // duty of the exchanger for a given U and both flows / inlet temperatures
  function duty(U, geo, mp, cpp, mw, cpw, tpi, twi) {
    const Cp = mp * cpp, Cw = mw * cpw, Cmin = Math.min(Cp, Cw), Cr = Cmin / Math.max(Cp, Cw);
    return eps12(U * geo.area / 1000 / Cmin, Cr) * Cmin * (tpi - twi);
  }

  // ---------------------------------------------------------------------------------------------
  // CW hydraulics (TIC basis)
  //   Tube-side dP: Darcy-Weisbach, Petukhov smooth-tube f (Incropera Eq 8.21, p.490; 64/Re laminar)
  //                 + return losses of 4 velocity heads per pass (Kern p.148).
  //   Valve: w[kg/h] = 27.3 Cv sqrt(rho dp[bar]) (Perry's 9th Eq 8-77, p.8-71); characteristic
  //          linear Cv(y) = Cv_r y, or equal-percentage Cv(y) = Cv_r exp((y-1) ln R) (Eq 8-88).
  //   Header: dP_available = dP_valve + dP_exchanger + dP_other, dP_other scaled with flow^2.
  // ---------------------------------------------------------------------------------------------
  function hxDP(mw, geo, h) {                                      // bar
    const v = mw / h.rho / geo.flowArea, Re = h.rho * v * geo.Di / h.mu;
    const f = Re < 2300 ? 64 / Math.max(Re, 1) : Math.pow(0.790 * Math.log(Re) - 1.64, -2);
    const pa = f * (geo.passes * geo.len / geo.Di) * h.rho * v * v / 2 + 4 * geo.passes * h.rho * v * v / 2;
    return pa / 1e5;
  }
  function darcyFriction(Re) {
    return Re < 2300 ? 64 / Math.max(Re, 1) : Math.pow(0.790 * Math.log(Re) - 1.64, -2);
  }
  function tubeSideFilm(mw, geo, p) {
    const velocity = mw / p.rho / geo.flowArea, Re = p.rho * velocity * geo.Di / p.mu;
    const Pr = p.cpw * 1000 * p.mu / p.k;
    if (!(Re >= 3000 && Re <= 5e6 && Pr >= 0.5 && Pr <= 2000)) return null;
    const f = darcyFriction(Re), Nu = (f / 8) * (Re - 1000) * Pr /
      (1 + 12.7 * Math.sqrt(f / 8) * (Math.pow(Pr, 2 / 3) - 1));
    return { h: Nu * p.k / geo.Di, Re, velocity, shear: f * p.rho * velocity ** 2 / 8 };
  }
  function cvAt(y, h) { return h.char === "eq" ? h.cv * Math.exp((y - 1) * Math.log(h.R)) : h.cv * y; }
  function flowAtOpening(y, geo, h) {                               // kg/s at valve fraction y (0..1)
    const avail = h.pSup - h.pRet, cv = cvAt(y, h);
    const resid = w => {                                              // valve flow at what's left - w
      const left = avail - hxDP(w, geo, h) - h.dpOther * (w / h.wRef) ** 2;
      return (left > 0 ? 27.3 * cv * Math.sqrt(h.rho * left) / 3600 : 0) - w;
    };
    let lo = 0, hi = 2000;
    if (resid(hi) > 0) return hi;
    for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; resid(m) > 0 ? (lo = m) : (hi = m); }
    return lo;
  }
  function openingForFlow(w, geo, h) {                              // valve fraction needed for flow w
    if (flowAtOpening(1, geo, h) < w) return NaN;
    let lo = 0, hi = 1;
    for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; flowAtOpening(m, geo, h) < w ? (lo = m) : (hi = m); }
    return hi;
  }
  function headerSummary(geo, h) {
    const wMax = flowAtOpening(1, geo, h);
    return { wMax, dpHxAtMax: hxDP(wMax, geo, h), velAtMax: wMax / h.rho / geo.flowArea };
  }

  // Minimum dirty U needed to meet the process outlet setpoint at full-open CW flow.
  function thermalLimit(geo, b, op, wMax, Uclean) {
    const Qreq = b.mp * op.cpp * (b.tpi - b.tset);
    const Cp = b.mp * op.cpp, Cw = wMax * op.cpw;
    const Cmin = Math.min(Cp, Cw), Cr = Cmin / Math.max(Cp, Cw);
    const epsReq = Qreq / (Cmin * (b.tpi - b.twi));
    const epsMax = eps12(1e8, Cr);
    if (!(Qreq > 0) || !(b.tpi > b.twi) || !(wMax > 0) || !(epsReq > 0) || epsReq >= epsMax) {
      return { feasible: false, Qreq, Urequired: Infinity, RfAllow: -Infinity };
    }
    const NTUrequired = ntu12(epsReq, Cr);
    const Urequired = NTUrequired * Cmin * 1000 / geo.area;
    const RfAllow = 1 / Urequired - 1 / Uclean;
    return { feasible: Number.isFinite(Urequired) && Urequired > 0, Qreq, epsReq, NTUrequired,
      Urequired, RfAllow };
  }

  // ---------------------------------------------------------------------------------------------
  // One logged row -> duty, CW flow, U.  CW flow from (priority set by the user):
  //   "measured" column  |  "balance" = process-side duty / (cp dT_cw)  |  "valve" = hydraulics at valve %
  // ---------------------------------------------------------------------------------------------
  function rowU(r, op, geo, hyd, source) {
    const mp = Number.isFinite(r.mp) ? r.mp : op.mp;
    const Qp = mp * op.cpp * (r.tpi - r.tpo);
    let mw = NaN, how = source;
    if (source === "measured") mw = r.mw;
    else if (source === "valve") mw = Number.isFinite(r.valve) ? flowAtOpening(r.valve / 100, geo, hyd) : NaN;
    if (!Number.isFinite(mw)) { mw = Qp / (op.cpw * (r.two - r.twi)); how = "balance"; }
    const Qw = mw * op.cpw * (r.two - r.twi), Q = how === "balance" ? Qp : 0.5 * (Qp + Qw);
    const Cp = mp * op.cpp, Cw = mw * op.cpw, Cmin = Math.min(Cp, Cw), Cr = Cmin / Math.max(Cp, Cw);
    const U = ntu12(Q / (Cmin * (r.tpi - r.twi)), Cr) * Cmin * 1000 / geo.area;
    return { t: r.t, Q, mw, how, imbalance: how === "balance" ? 0 : (Qp - Qw) / Q, U };
  }

  // ---------------------------------------------------------------------------------------------
  // Trend models on w(t) = 1/U(t)  (deck "Fouling Trends")
  //   asymptotic : w = w0 + Rs (1 - e^(-t/tau))         Kern-Seaton, Bott Eq 8.20     (lower bound)
  //   linear     : w = w0 + r t                                                     (upper bound)
  //   falling    : 1/U^2 = a t + c                       McCabe-Robinson, Peters Eq 9-53 (prediction)
  // The clean-surface intercept is fitted unless the user fixes clean U.
  // ---------------------------------------------------------------------------------------------
  function linStats(x, y) {
    const n = x.length, mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
    let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; }
    const b = sxy / sxx, a = my - b * mx;
    const s2 = y.reduce((s, yi, i) => s + (yi - a - b * x[i]) ** 2, 0) / Math.max(n - 2, 1);
    return { a, b, n, mx, sxx, s2 };
  }
  const sse = (p, y) => y.reduce((s, yi, i) => s + (yi - p[i]) ** 2, 0);
  const aicc = (S, n, k) => n * Math.log(S / n) + 2 * k + (2 * k * (k + 1)) / Math.max(n - k - 1, 1);
  // Student-t quantile (normal quantile + Cornish-Fisher expansion; accurate to ~1e-3 for df >= 5)
  function tQuant(p, df) {
    const q = p < 0.5 ? p : 1 - p, u = Math.sqrt(-2 * Math.log(q));
    let z = u - (2.515517 + 0.802853 * u + 0.010328 * u * u) / (1 + 1.432788 * u + 0.189269 * u * u + 0.001308 * u ** 3);
    if (p < 0.5) z = -z;
    const g1 = (z ** 3 + z) / 4, g2 = (5 * z ** 5 + 16 * z ** 3 + 3 * z) / 96, g3 = (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / 384;
    return z + g1 / df + g2 / df ** 2 + g3 / df ** 3;
  }

  function model(key, p) {                                           // y(t) = 1/U(t)
    if (key === "linear") return t => p.w0 + p.r * t;
    if (key === "asymptotic") return t => p.w0 + p.Rs * (1 - Math.exp(-t / p.tau));
    return t => Math.sqrt(Math.max(p.a * t + p.c, 1e-30));          // falling
  }
  function w0Of(key, p) { return key === "falling" ? Math.sqrt(Math.max(p.c, 1e-30)) : p.w0; }

  function fitAll(pts, UcleanFixed, conf) {
    const t = pts.map(p => p.t), w = pts.map(p => 1 / p.U), n = t.length;
    const fixed = UcleanFixed > 0, w0f = fixed ? 1 / UcleanFixed : null;
    const through = (x, y, y0) => x.reduce((s, xi, i) => s + xi * (y[i] - y0), 0) / x.reduce((s, xi) => s + xi * xi, 0);
    const out = {};
    { let p; if (fixed) p = { w0: w0f, r: through(t, w, w0f) }; else { const L = linStats(t, w); p = { w0: L.a, r: L.b }; }
      out.linear = { key: "linear", params: p, k: fixed ? 1 : 2 }; }
    { let best = null;
      for (let lt = 0; lt <= 4; lt += 0.01) {
        const tau = 10 ** lt, g = t.map(x => 1 - Math.exp(-x / tau));
        let w0, Rs; if (fixed) { w0 = w0f; Rs = through(g, w, w0); } else { const L = linStats(g, w); w0 = L.a; Rs = L.b; }
        const S = sse(g.map(gi => w0 + Rs * gi), w); if (!best || S < best.S) best = { S, p: { w0, Rs, tau } };
      }
      out.asymptotic = { key: "asymptotic", params: best.p, k: fixed ? 2 : 3 }; }
    { const z = w.map(x => x * x), L = linStats(t, z); let p;
      if (fixed) { const c = w0f * w0f; p = { c, a: through(t, z, c) }; } else p = { a: L.b, c: L.a };
      // confidence band on the mean trend (the "cone"): z_hat +/- t_q s sqrt(1/n + (t-tbar)^2/Sxx)
      const tq = tQuant(0.5 + conf / 2, Math.max(n - 2, 1)), s = Math.sqrt(L.s2);
      p.band = tt => tq * s * Math.sqrt(1 / n + (tt - L.mx) ** 2 / L.sxx);
      out.falling = { key: "falling", params: p, k: fixed ? 1 : 2, stats: { tq, s, n } }; }
    Object.values(out).forEach(F => { F.y = model(F.key, F.params); F.sse = sse(t.map(F.y), w);
      F.rmse = Math.sqrt(F.sse / n); F.aicc = aicc(Math.max(F.sse, 1e-40), n, F.k); });
    return { t, w, models: out };
  }
  // falling-rate cone: 1/U at time t for the lower/upper edge of the confidence band
  function fallingEdge(p, sign) { return t => Math.sqrt(Math.max(p.a * t + p.c + sign * p.band(t), 1e-30)); }

  // ---------------------------------------------------------------------------------------------
  // TIC projection: for U(t), the CW flow needed to hold the process outlet at setpoint; the run ends
  // (cleaning trigger) when that flow exceeds the valve's full-open capacity, or R_f hits the design
  // allowance - whichever is first.
  // ---------------------------------------------------------------------------------------------
  function cwNeeded(U, geo, b, op) {                                // kg/s, Infinity if unreachable
    const Qreq = b.mp * op.cpp * (b.tpi - b.tset);
    if (duty(U, geo, b.mp, op.cpp, 1e5, op.cpw, b.tpi, b.twi) < Qreq) return Infinity;
    let lo = 0.01, hi = 1e5;
    for (let i = 0; i < 80; i++) { const m = Math.sqrt(lo * hi); duty(U, geo, b.mp, op.cpp, m, op.cpw, b.tpi, b.twi) < Qreq ? (lo = m) : (hi = m); }
    return hi;
  }
  function trigger(y, w0, geo, b, op, wMax, rfAllow, horizon) {
    if (rfAllow <= 0) return { day: 0, why: "clean U below required dirty U" };
    for (let t = 0; t <= horizon; t++) {
      const wt = y(t), Rf = wt - w0;
      if (Rf >= rfAllow) return { day: t, why: "required dirty U" };
      if (cwNeeded(1 / wt, geo, b, op) > wMax) return { day: t, why: "CW valve at full open" };
    }
    return { day: null, why: `none within ${horizon} d` };
  }

  // ---------------------------------------------------------------------------------------------
  // Economics on the TIC basis (approved structure: lost duty + cleaning + bundle replacement / life).
  // Before saturation the controller compensates: fouling costs only the extra CW circulated.
  // After saturation the process outlet rises: fouling costs the duty shortfall.
  // ---------------------------------------------------------------------------------------------
  function costRows(y, geo, b, op, wMax, ec, corr, horizon) {
    const Qreq = b.mp * op.cpp * (b.tpi - b.tset);
    const w0clean = cwNeeded(1 / y(0), geo, b, op);
    const step = []; let cwExtra = 0, lostMWh = 0;
    for (let t = 0; t <= horizon; t++) {                       // daily integration
      const need = cwNeeded(1 / y(t), geo, b, op);
      if (need <= wMax) cwExtra += (need - w0clean) * 86400 / 1000;                       // m3 (rho ~ 1000)
      else lostMWh += (Qreq - duty(1 / y(t), geo, b.mp, op.cpp, wMax, op.cpw, b.tpi, b.twi)) * 24 / 1000;
      step.push({ cwExtra, lostMWh });
    }
    const rows = [];
    for (let th = 5; th <= horizon; th += th < 120 ? 5 : 10) {
      const s = step[th], cycle = th + ec.downDays;
      const downMWh = ec.spare ? 0 : Qreq * ec.downDays * 24 / 1000;
      const perCycle = ec.cleanCost + s.cwExtra * ec.cwCost + (s.lostMWh + downMWh) * ec.dutyValue;
      const life = bundleLife(corr, geo.area, cycle);
      rows.push({ th, cycle, perYr: perCycle * 365 / cycle + ec.bundleCost / life, cleanPart: perCycle * 365 / cycle,
                  bundlePart: ec.bundleCost / life, life });
    }
    const opt = rows.reduce((m, r) => (r.perYr < m.perYr ? r : m));
    return { rows, opt, interior: opt.th < rows[rows.length - 1].th };
  }

  // ---------------------------------------------------------------------------------------------
  // Corrosion / bundle life (Uhlig 1948). Pitting factor PF = deepest pit / average penetration.
  // d_max(t) = min(PF10 (t/10)^(n-1), PFcap) * r * t * (A/Aref)^a  [+ per-cleaning penetration x N]
  // PF10 = 2.5 (descaled steel ~10 yr, pp.388-389); n = 0.5 reproduces the ~0.04 ipy short-term
  // pitting rate; cap 10 ("as high as ten times", p.130). Per-cleaning penetration default 0 (assumption).
  // ---------------------------------------------------------------------------------------------
  function pitDepth(tYr, c, areaM2) {
    if (tYr <= 0) return 0;
    const pf = Math.min(c.pf10 * Math.pow(tYr / 10, c.n - 1), c.pfMax);
    return pf * c.rate * tYr * (c.aExp > 0 ? Math.pow(Math.max(areaM2 / c.aRef, 1), c.aExp) : 1);
  }
  function wallLoss(tYr, cleanings, c, areaM2) { return pitDepth(tYr, c, areaM2) + cleanings * c.perClean; }
  function bundleLife(c, areaM2, cycleDays) {
    const loss = y => wallLoss(y, Math.floor(y * 365 / cycleDays), c, areaM2);
    if (loss(60) < c.allowMils) return 60;
    let lo = 0, hi = 60;
    for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; loss(m) >= c.allowMils ? (hi = m) : (lo = m); }
    return hi;
  }
  // where the bundle stands today, and what's left at a given cleaning cycle
  function currentState(c, areaM2, ageYr, cleaningsDone, cycleDays) {
    const avg = c.rate * ageYr, deep = wallLoss(ageYr, cleaningsDone, c, areaM2);
    const loss = y => wallLoss(y, cleaningsDone + Math.floor((y - ageYr) * 365 / cycleDays), c, areaM2);
    let lo = ageYr, hi = 60;
    if (loss(60) >= c.allowMils) for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; loss(m) >= c.allowMils ? (hi = m) : (lo = m); }
    const remainYr = Math.max(hi - ageYr, 0);
    return { avg, deep, pfNow: ageYr > 0 ? deep / Math.max(avg, 1e-9) : NaN, marginLeft: c.allowMils - deep,
             remainYr, remainCycles: Math.floor(remainYr * 365 / cycleDays), usedFrac: deep / c.allowMils };
  }

  // ---------------------------------------------------------------------------------------------
  // Literature-shaped demo log on the TIC basis
  //   CaCO3 asymptote: Knudsen & Story (1978) via Bott Eq 8.24, Rf_inf = 3e11 exp(-42000/(R Ts))
  //   [hr-ft2-F/Btu, 1 m/s]; degR with R = 1.987 Btu/lbmol-R is INFERRED (Bott gives no units for E/R/Ts).
  //   Plus an optional slow linear term (a second, unbounded mechanism - Perry's p.11-22: falling-rate
  //   fouling usually comes from mechanisms combined). tau and the linear term are ASSUMED demo inputs.
  // ---------------------------------------------------------------------------------------------
  function knudsenRfInf(TsC) { return 3e11 * Math.exp(-42000 / (1.987 * (TsC + 273.15) * 1.8)) * 0.1761; }
  function coupledFoulingScenario(geo, op, hyd, basis, calibration, scenario, props) {
    const wMax = flowAtOpening(1, geo, hyd), Uclean = calibration.Uclean;
    const profile = (Rf, tpi) => {
      const calcAtFlow = mw => {
        const film = tubeSideFilm(mw, geo, props);
        if (!film) return null;
        const Rcw = geo.Do / (geo.Di * film.h);
        const U = 1 / (profileData.Rhot + profileData.Rwall + Rcw + Rf);
        return { film, Rcw, U, Q: duty(U, geo, basis.mp, op.cpp, mw, op.cpw, tpi, basis.twi) };
      };
      const Qreq = basis.mp * op.cpp * (tpi - basis.tset);
      if (!(Qreq > 0) || !(tpi > basis.twi)) return { invalid: true, reason: "Heat duty must be positive and process inlet must exceed CW inlet." };
      let low = 0.01, high = wMax, highState = calcAtFlow(high);
      if (!highState) return { invalid: true, reason: "Full-open CW flow is outside the tube-film correlation range." };
      let saturated = highState.Q < Qreq;
      if (!saturated) {
        for (let i = 0; i < 60; i++) {
          const mid = (low + high) / 2, state = calcAtFlow(mid);
          if (!state) return { invalid: true, reason: `Required flow entered the tube-film correlation's invalid range near ${mid.toFixed(2)} kg/s.` };
          if (state.Q < Qreq) low = mid; else high = mid;
        }
      }
      const mw = saturated ? wMax : high, state = calcAtFlow(mw);
      if (!state) return { invalid: true, reason: "Solved flow is outside the tube-film correlation range." };
      const Q = state.Q, tpo = tpi - Q / (basis.mp * op.cpp), two = basis.twi + Q / (mw * op.cpw);
      const qFlux = Q * 1000 / geo.area, tProcessMean = (tpi + tpo) / 2, tWaterMean = (basis.twi + two) / 2;
      const wallHot = tProcessMean - qFlux * profileData.Rhot;
      const wallCold = tWaterMean + qFlux * (state.Rcw + Rf);
      const valve = saturated ? 1 : openingForFlow(mw, geo, hyd);
      return { ...state, mw, Q, tpo, two, wallHot, wallCold, wallC: wallCold,
        tInterface: tWaterMean + qFlux * state.Rcw, saturated, valve };
    };
    const cp = { rho: props.rho, mu: props.mu, cpw: op.cpw, k: props.k };
    const profileData = { Rwall: geo.Do * Math.log(geo.Do / geo.Di) / (2 * props.kTube) };
    const cleanAtMax = tubeSideFilm(wMax, geo, cp);
    const cleanFlow = cwNeeded(Uclean, geo, basis, op);
    const cleanAtFlow = tubeSideFilm(Math.min(cleanFlow, wMax), geo, cp);
    if (!cleanAtMax || !cleanAtFlow) return { feasible: false, reason: "Tube-side Gnielinski correlation is outside its stated Re/Pr range." };
    const RcwClean = geo.Do / (geo.Di * cleanAtFlow.h);
    profileData.Rhot = 1 / Uclean - profileData.Rwall - RcwClean;
    if (!(profileData.Rhot > 0)) return { feasible: false, reason: "Clean-U and estimated tube-side film resistance leave no positive process-side film resistance." };
    const ref = profile(0, basis.tpi);
    if (ref.invalid) return { feasible: false, reason: ref.reason };
    if (!(ref.film.shear > 0) || !(ref.wallC > -273.15)) return { feasible: false, reason: `Clean reference returned invalid wall temperature (${ref.wallC}) or shear (${ref.film.shear}).` };
    const refRfInf = knudsenRfInf(ref.wallC);
    if (!(refRfInf > 0) || (calibration.Rs != null && !(calibration.Rs > 0)) || !(calibration.tau > 0)) {
      return { feasible: false, reason: "A positive fitted or correlation-based asymptote and time constant are required." };
    }
    const RsReference = calibration.Rs ?? refRfInf;
    const cleanScenario = profile(0, scenario.tpi);
    if (cleanScenario.invalid) return { feasible: false, reason: cleanScenario.reason };
    let rfAllow = 0;
    if (!cleanScenario.saturated) {
      let lo = 0, hi = Math.max(RsReference, 1e-6), bracketed = false;
      for (let i = 0; i < 64; i++) {
        const state = profile(hi, scenario.tpi);
        if (state.invalid) return { feasible: false, reason: state.reason };
        if (state.saturated) { bracketed = true; break; }
        hi *= 2;
      }
      if (bracketed) {
        for (let i = 0; i < 64; i++) {
          const mid = (lo + hi) / 2, state = profile(mid, scenario.tpi);
          if (state.invalid) return { feasible: false, reason: state.reason };
          state.saturated ? (hi = mid) : (lo = mid);
        }
        rfAllow = hi;
      } else rfAllow = Infinity;
    }
    const commonLimit = { feasible: true, RfAllow: rfAllow };
    const nDays = Math.max(1, Math.round(scenario.days || 270)), sampleEvery = Math.max(1, Math.round(scenario.every || 3));
    let Rf = 0, saturatedDay = null, maxWall = -Infinity, minWall = Infinity;
    let maxHotWall = -Infinity, minHotWall = Infinity, maxInterface = -Infinity, minInterface = Infinity;
    const samples = [];
    for (let day = 0; day <= nDays; day++) {
      const state = profile(Rf, scenario.tpi);
      if (state.invalid) return { feasible: false, reason: state.reason };
      if (day % sampleEvery === 0 || day === nDays || state.saturated) {
        const U = 1 / (profileData.Rhot + profileData.Rwall + geo.Do / (geo.Di * state.film.h) + Rf);
        samples.push({ t: day, U, Rf, tpi: scenario.tpi, tpo: state.tpo, twi: basis.twi, two: state.two,
          mp: basis.mp, mw: state.mw, valve: 100 * state.valve, wallC: state.wallC,
          interfaceC: state.tInterface, shear: state.film.shear });
      }
      maxWall = Math.max(maxWall, state.wallC); minWall = Math.min(minWall, state.wallC);
      maxHotWall = Math.max(maxHotWall, state.wallHot); minHotWall = Math.min(minHotWall, state.wallHot);
      maxInterface = Math.max(maxInterface, state.tInterface); minInterface = Math.min(minInterface, state.tInterface);
      if (state.saturated && saturatedDay === null) saturatedDay = day;
      if (state.saturated || day === nDays) break;
      const rfInf = RsReference * (knudsenRfInf(state.wallC) / refRfInf) * (ref.film.shear / state.film.shear);
      const tau = calibration.tau * ref.film.shear / state.film.shear;
      if (!(rfInf >= 0) || !(tau > 0) || !Number.isFinite(rfInf + tau)) {
        return { feasible: false, reason: "The coupled deposition/removal calculation became non-finite." };
      }
      Rf += (rfInf - Rf) * (1 - Math.exp(-1 / tau));
    }
    const foulingPts = samples.map(p => ({ t: p.t, U: 1 / (1 / Uclean + p.Rf) }));
    const fitted = fitAll(foulingPts, Uclean, 0.95);
    const trends = {};
    const triggerAtLimit = (y, w0) => {
      if (rfAllow <= 0) return 0;
      for (let day = 0; day <= 1460; day++) if (y(day) - w0 >= rfAllow) return day;
      return null;
    };
    ["falling", "linear", "asymptotic"].forEach(key => {
      const F = fitted.models[key];
      trends[key] = { params: F.params, cleanU: Uclean,
        trigger: triggerAtLimit(F.y, w0Of(key, F.params)),
        limit: commonLimit };
    });
    return { feasible: true, samples, trends, Rhot: profileData.Rhot, hHot: 1 / profileData.Rhot,
      referenceWallC: ref.wallC, minWallC: minWall, maxWallC: maxWall, minHotWallC: minHotWall,
      maxHotWallC: maxHotWall, minInterfaceC: minInterface, maxInterfaceC: maxInterface, referenceShear: ref.film.shear,
      saturatedDay, wMax, Uclean, RsReference };
  }
  function demoLog(op, geo, hyd, d) {
    let seed = 12345; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
    const RfInf = knudsenRfInf(d.TsC), rows = [], b = { mp: op.mp, tpi: d.tpi, twi: d.twi, tset: d.tset };
    const start = new Date(d.startDate + "T00:00:00Z"), wMax = flowAtOpening(1, geo, hyd);
    for (let t = 0; t <= d.days; t += d.every) {
      const Rf = RfInf * (1 - Math.exp(-t / d.tau)) + d.linRate * t, U = 1 / (1 / d.Uclean + Rf);
      let mw = cwNeeded(U, geo, b, op);
      const sat = !(mw <= wMax); if (sat) mw = wMax;
      const Q = duty(U, geo, op.mp, op.cpp, mw, op.cpw, d.tpi, d.twi);
      const n = () => d.noise * gauss(), date = new Date(start.getTime() + t * 86400000);
      rows.push({ date: date.toISOString().slice(0, 10), t, tpi: d.tpi + n(), tpo: d.tpi - Q / (op.mp * op.cpp) + n(),
        twi: d.twi + n(), two: d.twi + Q / (mw * op.cpw) + n(), mp: op.mp * (1 + 0.003 * gauss()), mw: NaN,
        valve: sat ? 100 : 100 * openingForFlow(mw, geo, hyd) + 0.5 * gauss() });
    }
    return { rows, RfInf };
  }

  // ---------------------------------------------------------------------------------------------
  // Implicit MOC validation (Materials of Construction methodology Steps 1-6, carbon steel)
  // ---------------------------------------------------------------------------------------------
  function mocChecks(inp, vel, corr, lifeYr, areaM2) {
    const out = [], add = (status, item, detail) => out.push({ status, item, detail }), r = corr.rate;
    add(inp.maxT <= 425 ? "ok" : "fail", "Temperature limit", `Max ${inp.maxT.toFixed(0)} °C vs. carbon-steel ceiling 425 °C (Perry's 9th p.25-12).`);
    const cls = r < 1 ? "Noncorrosive" : r < 2 ? "Slightly corrosive" : r < 16 ? "Moderately corrosive" : r < 32 ? "Corrosive" : "Severely corrosive";
    add(r < 16 ? (r < 2 ? "ok" : "warn") : "fail", "General corrosion class", `${r} mpy → ${cls} (Perry's Table 25-3). Uhlig p.130: 2–6 mpy in quiet aerated soft water.`);
    const d = pitDepth(lifeYr, corr, areaM2);
    add("warn", "Localized corrosion governs", `Deepest pit at retirement ${d.toFixed(0)} mils = ${(d / Math.max(r * lifeYr, 1e-9)).toFixed(1)}× average penetration. A corrosion allowance on the average rate is invalid when pitting is active (Perry's p.25-13).`);
    add(inp.lsi < 0 ? "warn" : "ok", inp.lsi < 0 ? "Water: corrosive (LSI < 0)" : "Water: scaling (LSI ≥ 0)", inp.lsi < 0
      ? `CaCO₃ dissolves; "assumed... corrosive towards steel in the presence of oxygen" (Bott p.296). Raise the rate input.`
      : `Protective CaCO₃ layer impedes O₂ (Uhlig p.130); patchy scale → under-deposit pitting (p.126); cleaning off tubercles reduces pitting (p.499).`);
    add(vel < 1 ? "warn" : "info", "Tube-side velocity", `${vel.toFixed(2)} m/s at clean conditions. Below ~1 m/s deposition is favored (Knudsen–Story basis 1 m/s); higher velocity raises steel corrosion (Uhlig p.135).`);
    add("info", "Chloride", `${inp.chloride} ppm. Chloride SCC is an austenitic-stainless mechanism (Perry's p.25-13); for steel, salts raise conductivity and the rate (Uhlig p.130).`);
    return out;
  }

  global.CleanEngine = { eps12, ntu12, geometry, duty, hxDP, cvAt, flowAtOpening, openingForFlow, headerSummary, thermalLimit,
    rowU, fitAll, model, w0Of, fallingEdge, cwNeeded, trigger, costRows, pitDepth, wallLoss, bundleLife, currentState,
    knudsenRfInf, coupledFoulingScenario, tubeSideFilm, demoLog, mocChecks, tQuant, MM_PER_MIL };
})(typeof window !== "undefined" ? window : globalThis);
