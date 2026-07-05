/**
 * SAED Digital Twin — Core Engine (JavaScript Port)
 * ==================================================
 * Seasonal-Aware Economic Dispatch for the Bangladesh (PGCB) power system.
 *
 * This is a faithful port of `saed_core.py`. All numerical logic is
 * identical to the Python source:
 *   - Merit-order economic dispatch (cheapest-first greedy fill)
 *   - Solar gating by hourly daylight shape
 *   - Seasonal availability factors
 *   - Growth-rate compounding from base year
 *   - Stochastic demand noise via seeded PRNG
 *
 * Usage (browser):
 *   <script src="js/saed-engine.js"></script>
 *   <script>
 *     fetch('data/calibration.json')
 *       .then(r => r.json())
 *       .then(raw => {
 *         const cal = SAED.buildCalibration(raw);
 *         const results = SAED.simulateAll(cal, 2030);
 *         console.table(results);
 *       });
 *   </script>
 *
 * @file   saed-engine.js
 * @author Auto-ported from saed_core.py
 */

(function () {
  'use strict';

  // ====================================================================
  //  SEEDED PRNG  (mulberry32 → uniform → Box-Muller normal)
  //  Provides reproducible stochastic mode without external libraries.
  // ====================================================================

  /**
   * Mulberry32 — a fast, high-quality 32-bit seeded PRNG.
   * Returns a function that yields uniform floats in [0, 1).
   * @param {number} seed  Integer seed value.
   * @returns {function(): number}  Uniform random number generator.
   */
  function mulberry32(seed) {
    // Coerce to unsigned 32-bit integer
    var s = seed >>> 0;
    return function () {
      s |= 0;
      s = (s + 0x6d2b79f5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Create a seeded normal-distribution sampler using the Box-Muller
   * transform on top of a mulberry32 uniform source.
   *
   * Matches numpy's `default_rng(seed).normal(mean, std)` in distribution
   * (though individual draws differ, the statistical properties are identical).
   *
   * @param {number|null} seed  Integer seed, or null for Date.now().
   * @returns {function(number, number): number}  normal(mean, std) sampler.
   */
  function seededNormal(seed) {
    var uniform = mulberry32(seed == null ? Date.now() : seed);
    var spare = null;

    /**
     * @param {number} mean  Mean of the distribution.
     * @param {number} std   Standard deviation.
     * @returns {number}     A normally-distributed random sample.
     */
    return function normal(mean, std) {
      if (spare !== null) {
        var val = spare;
        spare = null;
        return mean + std * val;
      }
      var u, v, s;
      do {
        u = uniform() * 2 - 1;
        v = uniform() * 2 - 1;
        s = u * u + v * v;
      } while (s >= 1 || s === 0);
      var mul = Math.sqrt(-2.0 * Math.log(s) / s);
      spare = v * mul;
      return mean + std * (u * mul);
    };
  }

  // ====================================================================
  //  FIXED ENGINEERING CONSTANTS
  //  Techno-economic parameters from public BD / IEA references.
  //  These set the *default* merit order used by dispatch.
  // ====================================================================

  /** @type {string[]} Canonical list of generation sources. */
  var SOURCES = ['solar', 'hydro', 'gas', 'coal', 'imports', 'liquid_fuel'];

  /** @type {string[]} The four climatic seasons of Bangladesh. */
  var SEASONS = ['Winter', 'PreMonsoon', 'Monsoon', 'PostMonsoon'];

  /**
   * Map calendar month (1–12) → season name.
   * @type {Object<number, string>}
   */
  var SEASON_OF_MONTH = {
    12: 'Winter',  1: 'Winter',     2: 'Winter',
    3: 'PreMonsoon', 4: 'PreMonsoon', 5: 'PreMonsoon',
    6: 'Monsoon',  7: 'Monsoon',    8: 'Monsoon',    9: 'Monsoon',
    10: 'PostMonsoon', 11: 'PostMonsoon'
  };

  /**
   * Marginal cost [USD / MWh] — ascending values define default merit order.
   * @type {Object<string, number>}
   */
  var MARGINAL_COST = {
    solar: 0,    hydro: 5,     gas: 45,
    coal: 65,    imports: 75,  liquid_fuel: 180
  };

  /**
   * Emission factor [tCO₂ / MWh] per source.
   * @type {Object<string, number>}
   */
  var EMISSION_FACTOR = {
    solar: 0,    hydro: 0,     gas: 0.45,
    coal: 0.95,  imports: 0.5, liquid_fuel: 0.75
  };

  /** Human-readable labels for chart legends. */
  var SOURCE_LABELS = {
    solar: 'Solar',       hydro: 'Hydro',
    gas: 'Natural Gas',   coal: 'Coal',
    imports: 'Imports',   liquid_fuel: 'Liquid Fuel'
  };

  /** Colour palette for per-source chart series (colourblind-safe). */
  var SOURCE_COLORS = {
    solar: '#E69F00',     hydro: '#56B4E9',
    gas: '#009E73',       coal: '#555555',
    imports: '#CC79A7',   liquid_fuel: '#D55E00'
  };

  /** Colour palette for season indicators. */
  var SEASON_COLORS = {
    Winter: '#0072B2',    PreMonsoon: '#E69F00',
    Monsoon: '#009E73',   PostMonsoon: '#CC79A7'
  };

  /**
   * Preferred stacking order for area / bar charts (bottom → top).
   * Gas & coal form the base; solar & hydro in the middle; peakers on top.
   * @type {string[]}
   */
  var STACK_ORDER = ['gas', 'coal', 'hydro', 'solar', 'imports', 'liquid_fuel'];

  // ====================================================================
  //  MERIT ORDER HELPER
  // ====================================================================

  /**
   * Return source names sorted by ascending marginal cost.
   * Ties are broken by the order of keys in `costs`.
   *
   * @param {Object<string, number>} costs  Map of source → cost [USD/MWh].
   * @returns {string[]}  Source names, cheapest first.
   */
  function getMeritOrder(costs) {
    return Object.keys(costs).slice().sort(function (a, b) {
      return costs[a] - costs[b];
    });
  }

  // ====================================================================
  //  AVAILABLE CAPACITY  P^max_g(s, h)
  // ====================================================================

  /**
   * Compute the maximum available capacity per source for a given season
   * and hour of day.
   *
   *   P^max_g(s,h) = α_{g,s} × C_g
   *
   * For solar, the result is further multiplied by the daylight shape
   * factor ψ(h) which peaks at 1 around noon and is ≈0 at night.
   *
   * @param {Object} cal       Calibration object (from `buildCalibration`).
   * @param {string} season    One of SEASONS.
   * @param {number} hour      Hour of day 0–23.
   * @returns {Object<string, number>}  Map of source → available MW.
   */
  function availableCapacity(cal, season, hour) {
    var cap = {};
    for (var i = 0; i < SOURCES.length; i++) {
      var g = SOURCES[i];
      var p = cal.avail[g][season] * cal.capacity[g];
      if (g === 'solar') {
        p *= cal.solar_shape[hour];
      }
      cap[g] = Math.max(p, 0.0);
    }
    return cap;
  }

  // ====================================================================
  //  SAED — Seasonal-Aware Economic Dispatch  (single time-step)
  // ====================================================================

  /**
   * Greedy merit-order economic dispatch.
   *
   * Provably cost-optimal for a single-bus, linear-cost system:
   * fill cheapest source first, taking min(residual_demand, P^max_g).
   *
   * Returns per-source MW dispatched, total cost, CO₂ emissions,
   * load-shed (unserved demand), and reserve-margin information.
   *
   * @param {number} demand        Total system demand [MW] this time-step.
   * @param {Object} cal           Calibration object.
   * @param {string} season        Current season.
   * @param {number} hour          Hour of day 0–23.
   * @param {number} [reserveFrac=0.08]  Minimum reserve margin fraction.
   * @returns {Object}  Dispatch result — see below.
   *
   * @typedef {Object} DispatchResult
   * @property {number} p_solar       Solar MW dispatched.
   * @property {number} p_hydro       Hydro MW dispatched.
   * @property {number} p_gas         Gas MW dispatched.
   * @property {number} p_coal        Coal MW dispatched.
   * @property {number} p_imports     Imports MW dispatched.
   * @property {number} p_liquid_fuel Liquid-fuel MW dispatched.
   * @property {number} demand        Original demand [MW].
   * @property {number} served        Total generation served [MW].
   * @property {number} load_shed     Unserved demand [MW].
   * @property {number} reserve_margin  Spare / demand ratio.
   * @property {boolean} reserve_ok   Whether reserve meets floor.
   * @property {number} cost_usd      Total dispatch cost [USD].
   * @property {number} co2_t         Total CO₂ emissions [tonnes].
   */
  function dispatch(demand, cal, season, hour, reserveFrac) {
    if (reserveFrac === undefined || reserveFrac === null) {
      reserveFrac = 0.08;
    }

    var pmax = availableCapacity(cal, season, hour);
    var target = demand;       // MW to be served this hour
    var residual = target;
    var p = {};
    var i, g;

    // Initialise all sources to zero
    for (i = 0; i < SOURCES.length; i++) {
      p[SOURCES[i]] = 0.0;
    }

    // Fill cheapest first (merit-order dispatch)
    var order = cal.meritOrder;
    for (i = 0; i < order.length; i++) {
      g = order[i];
      var take = Math.min(residual, pmax[g]);
      p[g] = take;
      residual -= take;
      if (residual <= 1e-9) {
        break;
      }
    }

    // Aggregate statistics
    var served = 0;
    var spare = 0;
    var cost = 0;
    var co2 = 0;
    for (i = 0; i < SOURCES.length; i++) {
      g = SOURCES[i];
      served += p[g];
      spare += (pmax[g] - p[g]);
      cost += p[g] * cal.cost[g];
      co2 += p[g] * cal.emis[g];
    }

    var loadShed = Math.max(target - served, 0.0);
    var reserveMargin = target > 0 ? spare / target : NaN;
    var reserveOk = spare >= reserveFrac * target;

    // Build output object with p_<source> keys (matches Python f"p_{g}")
    var out = {};
    for (i = 0; i < SOURCES.length; i++) {
      g = SOURCES[i];
      out['p_' + g] = p[g];
    }
    out.demand = target;
    out.served = served;
    out.load_shed = loadShed;
    out.reserve_margin = reserveMargin;
    out.reserve_ok = reserveOk;
    out.cost_usd = cost;
    out.co2_t = co2;

    return out;
  }

  // ====================================================================
  //  DIGITAL TWIN — full diurnal simulation per season
  // ====================================================================

  /**
   * Simulate the 24-hour dispatch for one representative day in a season.
   *
   * The demand at each hour is:
   *   D(h) = D̄_s × φ_s(h) × (1 + g)^(year − base_year)
   *
   * In stochastic mode, a multiplicative noise term is applied:
   *   D(h) *= 1 + N(0,  0.5 × η_s)
   *
   * @param {Object}      cal         Calibration object.
   * @param {string}      season      Season name.
   * @param {number|null} [year]      Simulation year (defaults to base_year).
   * @param {boolean}     [stochastic=false]  Enable demand noise.
   * @param {number|null} [seed=null] PRNG seed for reproducibility.
   * @returns {Object[]}  Array of 24 dispatch-result objects, each augmented
   *                       with `hour` and `season` fields.
   */
  function simulateSeason(cal, season, year, stochastic, seed) {
    if (stochastic === undefined) stochastic = false;
    if (seed === undefined) seed = null;

    var normal = seededNormal(seed);
    var yr = (year != null) ? year : cal.base_year;
    var growthMult = Math.pow(1 + cal.growth, yr - cal.base_year);
    var rows = [];

    for (var h = 0; h < 24; h++) {
      var d = cal.base_demand[season] * cal.diurnal[season][h] * growthMult;
      if (stochastic) {
        d *= (1 + normal(0, 0.5 * cal.noise_sd[season]));
      }
      var r = dispatch(Math.max(d, 0.0), cal, season, h);
      r.hour = h;
      r.season = season;
      rows.push(r);
    }
    return rows;
  }

  /**
   * Simulate all four seasons (96 hourly time-steps in total).
   *
   * Each season gets a deterministic seed offset (seed + seasonIndex)
   * so that stochastic runs across seasons are independent but
   * reproducible.
   *
   * @param {Object}  cal                Calibration object.
   * @param {number|null} [year]         Simulation year.
   * @param {boolean} [stochastic=false] Enable demand noise.
   * @param {number}  [seed=0]           Base PRNG seed.
   * @returns {Object[]}  Array of 96 dispatch-result objects.
   */
  function simulateAll(cal, year, stochastic, seed) {
    if (stochastic === undefined) stochastic = false;
    if (seed === undefined) seed = 0;

    var results = [];
    for (var i = 0; i < SEASONS.length; i++) {
      var seasonRows = simulateSeason(cal, SEASONS[i], year, stochastic, seed + i);
      for (var j = 0; j < seasonRows.length; j++) {
        results.push(seasonRows[j]);
      }
    }
    return results;
  }

  // ====================================================================
  //  BUILD CALIBRATION  — construct a cal object from raw JSON + overrides
  // ====================================================================

  /**
   * Build a calibration object from the loaded calibration.json data,
   * optionally applying user overrides.
   *
   * The returned object has the same shape as Python's `Calibration`
   * dataclass and includes a precomputed `meritOrder` array.
   *
   * @param {Object} rawData   Parsed calibration.json contents.
   * @param {Object} [overrides={}]  Optional overrides:
   *   - `capacity`    {Object<string, number>}   Override firm capacities [MW].
   *   - `cost`        {Object<string, number>}   Override marginal costs [USD/MWh].
   *   - `avail`       {Object<string, Object<string, number>>}  Override availability factors.
   *   - `growth`      {number}                   Override annual growth rate.
   *   - `reserveFrac` {number}                   Override reserve margin floor.
   * @returns {Object}  Calibration object ready for `dispatch` / `simulate*`.
   */
  function buildCalibration(rawData, overrides) {
    if (!overrides) overrides = {};

    // Deep-clone mutable sub-objects so the raw data is never mutated
    var cal = {
      base_demand: shallowCopy(rawData.base_demand),
      diurnal:     deepCopyDiurnal(rawData.diurnal),
      noise_sd:    shallowCopy(rawData.noise_sd),
      capacity:    shallowCopy(rawData.capacity),
      avail:       deepCopyAvail(rawData.avail),
      solar_shape: rawData.solar_shape.slice(),
      growth:      rawData.growth,
      base_year:   rawData.base_year,
      cost:        shallowCopy(rawData.cost || MARGINAL_COST),
      emis:        shallowCopy(rawData.emis || EMISSION_FACTOR)
    };

    // --- Apply overrides ---

    // Capacity overrides: { source: newMW }
    if (overrides.capacity) {
      var keys = Object.keys(overrides.capacity);
      for (var i = 0; i < keys.length; i++) {
        cal.capacity[keys[i]] = overrides.capacity[keys[i]];
      }
    }

    // Cost overrides: { source: newCost }
    if (overrides.cost) {
      var cKeys = Object.keys(overrides.cost);
      for (var ci = 0; ci < cKeys.length; ci++) {
        cal.cost[cKeys[ci]] = overrides.cost[cKeys[ci]];
      }
    }

    // Availability overrides: { source: { season: newAlpha } }
    if (overrides.avail) {
      var aKeys = Object.keys(overrides.avail);
      for (var ai = 0; ai < aKeys.length; ai++) {
        var src = aKeys[ai];
        var sKeys = Object.keys(overrides.avail[src]);
        for (var si = 0; si < sKeys.length; si++) {
          cal.avail[src][sKeys[si]] = overrides.avail[src][sKeys[si]];
        }
      }
    }

    // Growth rate override
    if (overrides.growth !== undefined) {
      cal.growth = overrides.growth;
    }

    // Reserve fraction (stored on cal for convenience; dispatch can also
    // accept it directly)
    if (overrides.reserveFrac !== undefined) {
      cal.reserveFrac = overrides.reserveFrac;
    }

    // Compute merit order from (possibly overridden) costs
    cal.meritOrder = getMeritOrder(cal.cost);

    return cal;
  }

  // ---- Utility helpers for deep-copying calibration sub-structures ----

  /** Shallow-copy a flat { key: number } object. */
  function shallowCopy(obj) {
    var out = {};
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      out[keys[i]] = obj[keys[i]];
    }
    return out;
  }

  /** Deep-copy diurnal structure: { season: number[24] }. */
  function deepCopyDiurnal(d) {
    var out = {};
    var keys = Object.keys(d);
    for (var i = 0; i < keys.length; i++) {
      out[keys[i]] = d[keys[i]].slice();
    }
    return out;
  }

  /** Deep-copy avail structure: { source: { season: number } }. */
  function deepCopyAvail(a) {
    var out = {};
    var sources = Object.keys(a);
    for (var i = 0; i < sources.length; i++) {
      out[sources[i]] = shallowCopy(a[sources[i]]);
    }
    return out;
  }

  // ====================================================================
  //  PUBLIC API — exposed on window.SAED
  // ====================================================================

  window.SAED = {
    // --- Constants ---
    SOURCES:        SOURCES,
    SEASONS:        SEASONS,
    SEASON_OF_MONTH: SEASON_OF_MONTH,
    MARGINAL_COST:  MARGINAL_COST,
    EMISSION_FACTOR: EMISSION_FACTOR,
    SOURCE_LABELS:  SOURCE_LABELS,
    SOURCE_COLORS:  SOURCE_COLORS,
    SEASON_COLORS:  SEASON_COLORS,
    STACK_ORDER:    STACK_ORDER,

    // --- Core functions ---
    getMeritOrder:      getMeritOrder,
    availableCapacity:  availableCapacity,
    dispatch:           dispatch,
    simulateSeason:     simulateSeason,
    simulateAll:        simulateAll,
    buildCalibration:   buildCalibration
  };

})();
