/* ================================================================
   SAED Digital Twin — App Orchestration
   Main controller: init, event wiring, update cycle
   ================================================================ */

(function () {
  'use strict';

  // ── State ────────────────────────────────────────────────────────
  let rawCalData = null;    // Raw JSON from calibration.json
  let currentCal = null;    // Built calibration object
  let simResults = null;    // Latest simulation results

  // ── Debounce utility ─────────────────────────────────────────────
  function debounce(fn, ms) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  // ── Format helpers ───────────────────────────────────────────────
  function fmt1(n) { return isFinite(n) ? n.toFixed(1) : '—'; }
  function fmtInt(n) { return isFinite(n) ? Math.round(n).toLocaleString() : '—'; }

  // ── Read all control values ──────────────────────────────────────
  function readControls() {
    const season = document.getElementById('select-season').value;
    const year = parseInt(document.getElementById('slider-year').value);
    const growth = parseFloat(document.getElementById('slider-growth').value);
    const stochastic = document.getElementById('chk-stochastic').checked;
    const reserveFloor = parseFloat(document.getElementById('slider-reserve').value);

    // Firm capacity, marginal cost, and seasonal availability are model
    // predictions derived from calibration — not user-adjustable.
    return {
      season, year, growth, stochastic, reserveFloor,
      overrides: {
        growth: growth / 100,
        reserveFrac: reserveFloor / 100
      }
    };
  }

  // ── Compute KPIs from sim results ────────────────────────────────
  function computeKPIs(results, season, reserveFloor) {
    let filtered = results;
    if (season && season !== 'all') {
      filtered = results.filter(r => r.season === season);
    }
    if (filtered.length === 0) return null;

    const totalCost = filtered.reduce((a, r) => a + r.cost_usd, 0);
    const totalCO2 = filtered.reduce((a, r) => a + r.co2_t, 0);
    const totalServed = filtered.reduce((a, r) => a + r.served, 0);
    const minReserve = Math.min(...filtered.map(r => r.reserve_margin));
    const totalShed = filtered.reduce((a, r) => a + r.load_shed, 0);

    return {
      dailyCost: totalCost / 1000,
      dailyCO2: totalCO2 / 1000,
      avgCost: totalServed > 0 ? totalCost / totalServed : 0,
      minReserve: minReserve * 100,
      loadShed: totalShed,
      reserveOk: (minReserve * 100) >= reserveFloor,
      shedOk: totalShed <= 0.01
    };
  }

  // ── Update KPI cards ─────────────────────────────────────────────
  function updateKPIs(kpis) {
    if (!kpis) return;

    const costEl = document.getElementById('kpi-cost-val');
    const co2El = document.getElementById('kpi-co2-val');
    const avgCostEl = document.getElementById('kpi-avg-cost-val');
    const reserveEl = document.getElementById('kpi-reserve-val');
    const shedEl = document.getElementById('kpi-shed-val');

    if (costEl) costEl.textContent = fmt1(kpis.dailyCost);
    if (co2El) co2El.textContent = fmt1(kpis.dailyCO2);
    if (avgCostEl) avgCostEl.textContent = fmt1(kpis.avgCost);

    if (reserveEl) {
      reserveEl.textContent = fmt1(kpis.minReserve);
      reserveEl.className = 'kpi-value ' + (kpis.reserveOk ? 'safe' : 'danger');
    }
    if (shedEl) {
      shedEl.textContent = fmt1(kpis.loadShed);
      shedEl.className = 'kpi-value ' + (kpis.shedOk ? 'safe' : 'danger');
    }
  }

  // ── Main update cycle ────────────────────────────────────────────
  function update() {
    const SAED = window.SAED;
    if (!SAED || !rawCalData) return;

    const controls = readControls();

    // Build calibration with overrides
    currentCal = SAED.buildCalibration(rawCalData, controls.overrides);

    // Run simulation
    simResults = SAED.simulateAll(
      currentCal,
      controls.year,
      controls.stochastic,
      42  // seed for reproducibility
    );

    // Update KPIs
    const kpis = computeKPIs(simResults, controls.season, controls.reserveFloor);
    updateKPIs(kpis);

    // Update charts
    if (window.DashboardCharts) {
      window.DashboardCharts.updateAll(simResults, currentCal, {
        season: controls.season,
        year: controls.year,
        reserveFloor: controls.reserveFloor,
        stochastic: controls.stochastic,
        growth: controls.growth
      });
    }
  }

  const debouncedUpdate = debounce(update, 50);
  const debouncedUpdateSlow = debounce(update, 200);

  // ── Initialize control values from calibration ───────────────────
  function initControls(cal) {
    const SAED = window.SAED;

    // Year slider
    const yearSlider = document.getElementById('slider-year');
    if (yearSlider) {
      yearSlider.value = cal.base_year;
      document.getElementById('val-year').textContent = cal.base_year;
    }

    // Growth slider
    const growthSlider = document.getElementById('slider-growth');
    if (growthSlider) {
      const g = (cal.growth * 100).toFixed(1);
      growthSlider.value = g;
      document.getElementById('val-growth').textContent = g + '%';
    }

    // Reserve slider
    const reserveSlider = document.getElementById('slider-reserve');
    if (reserveSlider) {
      reserveSlider.value = 8;
      document.getElementById('val-reserve').textContent = '8.0%';
    }

    // Populate read-only model prediction tables
    populateModelTables(cal);
  }

  // ── Populate read-only model prediction tables ───────────────────
  function populateModelTables(cal) {
    const SAED = window.SAED;
    const SOURCE_LABELS = {
      solar: 'Solar', hydro: 'Hydro', gas: 'Natural Gas',
      coal: 'Coal', imports: 'Imports', liquid_fuel: 'Liquid Fuel'
    };
    const SOURCE_COLORS = SAED.SOURCE_COLORS;

    // Firm capacity table
    const capBody = document.getElementById('model-cap-body');
    if (capBody) {
      capBody.innerHTML = SAED.SOURCES.map(src => {
        const cap = Math.round(cal.capacity[src] || 0);
        return `<tr>
          <td><span class="source-dot" style="background:${SOURCE_COLORS[src]};"></span>${SOURCE_LABELS[src]}</td>
          <td class="model-val">${cap.toLocaleString()} MW</td>
        </tr>`;
      }).join('');
    }

    // Marginal cost table
    const costBody = document.getElementById('model-cost-body');
    if (costBody) {
      costBody.innerHTML = SAED.SOURCES.map(src => {
        const cost = cal.cost[src] !== undefined ? cal.cost[src] : SAED.MARGINAL_COST[src];
        return `<tr>
          <td><span class="source-dot" style="background:${SOURCE_COLORS[src]};"></span>${SOURCE_LABELS[src]}</td>
          <td class="model-val">$${cost}/MWh</td>
        </tr>`;
      }).join('');
    }

    // Seasonal availability table
    const availBody = document.getElementById('model-avail-body');
    if (availBody && cal.avail) {
      availBody.innerHTML = SAED.SOURCES.map(src => {
        const cells = SAED.SEASONS.map(s => {
          const v = cal.avail[src] ? (cal.avail[src][s] || 0) : 0;
          const r = Math.round(13 + v * (0 - 13));
          const g = Math.round(148 + v * (100 - 148));
          const b = Math.round(136 + v * (80 - 136));
          const bg = `rgb(${r},${g},${b})`;
          const fg = v > 0.45 ? '#fff' : '#1a1a2e';
          return `<td class="avail-ro-cell" style="background:${bg};color:${fg};">${v.toFixed(2)}</td>`;
        }).join('');
        return `<tr><td>${SOURCE_LABELS[src]}</td>${cells}</tr>`;
      }).join('');
    }
  }

  // ── Tab Switching ────────────────────────────────────────────────
  function initTabs() {
    const tabs = document.querySelectorAll('.nav-tab');
    const contents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;

        // Remove active from all
        tabs.forEach(t => t.classList.remove('active'));
        contents.forEach(c => c.classList.remove('active'));

        // Set active
        tab.classList.add('active');
        const targetEl = document.getElementById(`tab-${target}`);
        if (targetEl) targetEl.classList.add('active');

        // Resize charts when switching to dashboard
        if (target === 'dashboard' && window.DashboardCharts) {
          setTimeout(() => window.DashboardCharts.resize(), 100);
        }
      });
    });
  }

  // ── Collapsible Sections ─────────────────────────────────────────
  function initCollapsibles() {
    document.querySelectorAll('.section-toggle').forEach(toggle => {
      toggle.addEventListener('click', () => {
        const section = toggle.closest('.section-collapse');
        if (section) section.classList.toggle('open');
      });
    });
  }

  // ── Wire Event Listeners ─────────────────────────────────────────
  function wireEvents() {
    // Season select
    const seasonSelect = document.getElementById('select-season');
    if (seasonSelect) seasonSelect.addEventListener('change', update);

    // Year slider
    const yearSlider = document.getElementById('slider-year');
    if (yearSlider) {
      yearSlider.addEventListener('input', () => {
        document.getElementById('val-year').textContent = yearSlider.value;
        debouncedUpdate();
      });
    }

    // Growth slider
    const growthSlider = document.getElementById('slider-growth');
    if (growthSlider) {
      growthSlider.addEventListener('input', () => {
        document.getElementById('val-growth').textContent = parseFloat(growthSlider.value).toFixed(1) + '%';
        debouncedUpdate();
      });
    }

    // Stochastic checkbox
    const chkStoch = document.getElementById('chk-stochastic');
    if (chkStoch) chkStoch.addEventListener('change', update);

    // Reserve slider
    const reserveSlider = document.getElementById('slider-reserve');
    if (reserveSlider) {
      reserveSlider.addEventListener('input', () => {
        document.getElementById('val-reserve').textContent = parseFloat(reserveSlider.value).toFixed(1) + '%';
        debouncedUpdate();
      });
    }

    // Reset button
    const btnReset = document.getElementById('btn-reset');
    if (btnReset) btnReset.addEventListener('click', reset);

    // Dark Mode Toggle
    const btnDarkMode = document.getElementById('btn-dark-mode');
    if (btnDarkMode) btnDarkMode.addEventListener('click', toggleDarkMode);

    // Window resize for canvas charts
    window.addEventListener('resize', debounce(() => {
      if (simResults && currentCal) {
        const controls = readControls();
        if (window.DashboardCharts) {
          window.DashboardCharts.updateAll(simResults, currentCal, {
            season: controls.season,
            year: controls.year,
            reserveFloor: controls.reserveFloor,
            stochastic: controls.stochastic,
            growth: controls.growth
          });
        }
      }
    }, 250));
  }

  // ── Toggle Dark Mode ─────────────────────────────────────────────
  function toggleDarkMode() {
    const isDark = document.body.classList.toggle('dark-theme');
    const sunIcon = document.querySelector('#btn-dark-mode .sun-icon');
    const moonIcon = document.querySelector('#btn-dark-mode .moon-icon');
    
    if (sunIcon && moonIcon) {
      if (isDark) {
        sunIcon.style.display = 'none';
        moonIcon.style.display = 'block';
      } else {
        sunIcon.style.display = 'block';
        moonIcon.style.display = 'none';
      }
    }
    
    if (window.DashboardCharts) {
      if (typeof Chart !== 'undefined') {
        Chart.defaults.color = isDark ? '#9ca3af' : '#64748b';
      }
      update();
    }
  }

  // ── Reset ────────────────────────────────────────────────────────
  function reset() {
    if (!rawCalData || !window.SAED) return;
    const cal = window.SAED.buildCalibration(rawCalData);
    initControls(cal);
    document.getElementById('select-season').value = 'all';
    document.getElementById('chk-stochastic').checked = false;
    // Clear dark mode on reset to be clean
    document.body.classList.remove('dark-theme');
    const sunIcon = document.querySelector('#btn-dark-mode .sun-icon');
    const moonIcon = document.querySelector('#btn-dark-mode .moon-icon');
    if (sunIcon && moonIcon) {
      sunIcon.style.display = 'block';
      moonIcon.style.display = 'none';
    }
    if (typeof Chart !== 'undefined') {
      Chart.defaults.color = '#64748b';
    }
    update();
  }

  // ── Init ─────────────────────────────────────────────────────────
  async function init() {
    try {
      // 1. Fetch calibration data
      const resp = await fetch('data/calibration.json');
      if (!resp.ok) throw new Error('Failed to load calibration.json');
      rawCalData = await resp.json();

      const SAED = window.SAED;
      if (!SAED) {
        console.error('SAED engine not loaded');
        return;
      }

      // 2. Build initial calibration
      currentCal = SAED.buildCalibration(rawCalData);

      // 3. Init controls from calibration
      initControls(currentCal);

      // 4. Run initial simulation
      simResults = SAED.simulateAll(currentCal, currentCal.base_year, false, 42);

      // 5. Init charts
      if (window.DashboardCharts) {
        window.DashboardCharts.init();
      }

      // 6. Update everything with initial data
      const kpis = computeKPIs(simResults, 'all', 8);
      updateKPIs(kpis);

      if (window.DashboardCharts) {
        window.DashboardCharts.updateAll(simResults, currentCal, {
          season: 'all',
          year: currentCal.base_year,
          reserveFloor: 8,
          stochastic: false,
          growth: currentCal.growth * 100
        });
      }

      // 7. Init flowchart
      if (window.Flowchart) {
        window.Flowchart.init('flowchart-container', 'flowchart-info');
      }

      // 8. Wire events
      initTabs();
      initCollapsibles();
      wireEvents();

      console.log('SAED Digital Twin Dashboard initialized successfully');

    } catch (err) {
      console.error('Initialization error:', err);
    }
  }

  // ── Public API ───────────────────────────────────────────────────
  window.App = {
    init: init,
    reset: reset
  };

  // ── Auto-init ────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => App.init());

})();
