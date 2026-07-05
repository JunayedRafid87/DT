/* ================================================================
   SAED Digital Twin — Charts Module
   Manages all 6 Chart.js (+ canvas) charts
   ================================================================ */

(function () {
  'use strict';

  // ── Chart.js Defaults ────────────────────────────────────────────
  if (typeof Chart !== 'undefined') {
    Chart.defaults.font.family = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif";
    Chart.defaults.font.size = 11;
    Chart.defaults.color = '#64748b';
    Chart.defaults.animation.duration = 400;
    Chart.defaults.plugins.legend.display = false;
    Chart.defaults.responsive = true;
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.plugins.tooltip.backgroundColor = '#0f1f3a';
    Chart.defaults.plugins.tooltip.titleFont = { weight: '700', size: 12, family: "'Inter', sans-serif" };
    Chart.defaults.plugins.tooltip.bodyFont = { size: 11, family: "'Inter', sans-serif" };
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.cornerRadius = 8;
    Chart.defaults.plugins.tooltip.boxPadding = 4;
  }

  const HOURS = Array.from({ length: 24 }, (_, i) => i);
  const HOUR_LABELS = HOURS.map(h => `${String(h).padStart(2, '0')}:00`);

  let chartDispatch = null;
  let chartDemand = null;
  let chartCost = null;
  let chartStress = null;
  // chart-heatmap and chart-merit are canvas-drawn, no Chart.js instance

  // ── Helpers ──────────────────────────────────────────────────────
  function hexToRGBA(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function getSeasonResults(simResults, season) {
    if (!season || season === 'all') return simResults;
    return simResults.filter(r => r.season === season);
  }

  function getDefaultDisplaySeason(season) {
    return (!season || season === 'all') ? 'Monsoon' : season;
  }

  // ── Chart 1: Dispatch Stack (stacked area) ──────────────────────
  function createDispatchChart() {
    const ctx = document.getElementById('chart-dispatch');
    if (!ctx) return null;
    return new Chart(ctx, {
      type: 'line',
      data: { labels: HOUR_LABELS, datasets: [] },
      options: {
        scales: {
          x: {
            title: { display: true, text: 'Hour', font: { weight: '600' } },
            grid: { display: false },
            ticks: { maxTicksLimit: 12 }
          },
          y: {
            title: { display: true, text: 'Power (MW)', font: { weight: '600' } },
            stacked: true,
            beginAtZero: true,
            grid: { color: 'rgba(0,0,0,0.04)' }
          }
        },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return `${ctx.dataset.label}: ${Math.round(ctx.parsed.y).toLocaleString()} MW`;
              }
            }
          }
        }
      }
    });
  }

  function updateDispatchChart(chart, simResults, options) {
    if (!chart) return;
    const season = options.season;
    const reserveFloor = options.reserveFloor || 8;
    const displaySeason = getDefaultDisplaySeason(season);
    const seasonData = simResults.filter(r => r.season === displaySeason);
    if (seasonData.length === 0) return;

    const SAED = window.SAED;
    const datasets = [];

    // Stacked area per source
    SAED.STACK_ORDER.forEach(src => {
      const key = `p_${src}`;
      datasets.push({
        label: SAED.SOURCE_LABELS[src],
        data: HOURS.map(h => {
          const row = seasonData.find(r => r.hour === h);
          return row ? row[key] : 0;
        }),
        backgroundColor: hexToRGBA(SAED.SOURCE_COLORS[src], 0.85),
        borderColor: SAED.SOURCE_COLORS[src],
        borderWidth: 1,
        fill: true,
        pointRadius: 0,
        tension: 0.3,
        stack: 'stack0',
        order: SAED.STACK_ORDER.length - SAED.STACK_ORDER.indexOf(src)
      });
    });

    // Demand line
    datasets.push({
      label: 'Demand',
      data: HOURS.map(h => {
        const row = seasonData.find(r => r.hour === h);
        return row ? row.demand : 0;
      }),
      borderColor: '#1a1a2e',
      borderWidth: 2,
      borderDash: [6, 4],
      fill: false,
      pointRadius: 0,
      tension: 0.3,
      stack: undefined,
      order: 0
    });

    // Required capacity line (Demand + Reserve Margin)
    datasets.push({
      label: `Required Cap (${reserveFloor}%)`,
      data: HOURS.map(h => {
        const row = seasonData.find(r => r.hour === h);
        return row ? row.demand * (1 + reserveFloor / 100) : 0;
      }),
      borderColor: '#d97706',
      borderWidth: 2.5,
      borderDash: [4, 4],
      fill: false,
      pointRadius: 0,
      tension: 0.3,
      stack: undefined,
      order: 1
    });

    chart.data.datasets = datasets;
    chart.options.scales.y.stacked = true;
    chart.update('none');
  }

  // ── Chart 2: Demand Profiles (multi-line) ────────────────────────
  function createDemandChart() {
    const ctx = document.getElementById('chart-demand');
    if (!ctx) return null;
    return new Chart(ctx, {
      type: 'line',
      data: { labels: HOUR_LABELS, datasets: [] },
      options: {
        scales: {
          x: {
            title: { display: true, text: 'Hour', font: { weight: '600' } },
            grid: { display: false },
            ticks: { maxTicksLimit: 12 }
          },
          y: {
            title: { display: true, text: 'Demand (MW)', font: { weight: '600' } },
            beginAtZero: false,
            grid: { color: 'rgba(0,0,0,0.04)' }
          }
        },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return `${ctx.dataset.label}: ${Math.round(ctx.parsed.y).toLocaleString()} MW`;
              }
            }
          }
        }
      }
    });
  }

  function updateDemandChart(chart, cal, options) {
    if (!chart || !cal) return;
    const SAED = window.SAED;
    const year = options.year || cal.base_year;
    const growthMult = Math.pow(1 + (options.growth / 100 || cal.growth), year - cal.base_year);
    const datasets = [];

    SAED.SEASONS.forEach(season => {
      const color = SAED.SEASON_COLORS[season];
      datasets.push({
        label: season,
        data: HOURS.map(h => {
          return cal.base_demand[season] * cal.diurnal[season][h] * growthMult;
        }),
        borderColor: color,
        backgroundColor: hexToRGBA(color, 0.1),
        borderWidth: 2.5,
        pointRadius: 2,
        pointBackgroundColor: color,
        tension: 0.3,
        fill: false
      });
    });

    chart.data.datasets = datasets;
    chart.update('none');
  }

  // ── Chart 3: Cost & Emissions (grouped bar) ──────────────────────
  function createCostChart() {
    const ctx = document.getElementById('chart-cost');
    if (!ctx) return null;
    return new Chart(ctx, {
      type: 'bar',
      data: { labels: [], datasets: [] },
      options: {
        scales: {
          x: {
            grid: { display: false }
          },
          yCost: {
            type: 'linear',
            position: 'left',
            title: { display: true, text: 'Cost (k$/day)', font: { weight: '600' } },
            beginAtZero: true,
            grid: { color: 'rgba(0,0,0,0.04)' }
          },
          yCO2: {
            type: 'linear',
            position: 'right',
            title: { display: true, text: 'CO₂ (kt/day)', font: { weight: '600' } },
            beginAtZero: true,
            grid: { display: false }
          }
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: function (ctx) {
                const unit = ctx.dataset.yAxisID === 'yCost' ? 'k$' : 'kt';
                return `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)} ${unit}`;
              }
            }
          }
        }
      }
    });
  }

  function updateCostChart(chart, simResults) {
    if (!chart) return;
    const SAED = window.SAED;
    const costBySeason = {};
    const co2BySeason = {};

    SAED.SEASONS.forEach(s => {
      const rows = simResults.filter(r => r.season === s);
      costBySeason[s] = rows.reduce((a, r) => a + r.cost_usd, 0) / 1000;
      co2BySeason[s] = rows.reduce((a, r) => a + r.co2_t, 0) / 1000;
    });

    chart.data.labels = SAED.SEASONS;
    chart.data.datasets = [
      {
        label: 'Daily Cost',
        data: SAED.SEASONS.map(s => costBySeason[s]),
        backgroundColor: hexToRGBA('#0d9488', 0.8),
        borderColor: '#0d9488',
        borderWidth: 1,
        borderRadius: 4,
        yAxisID: 'yCost'
      },
      {
        label: 'Daily CO₂',
        data: SAED.SEASONS.map(s => co2BySeason[s]),
        backgroundColor: hexToRGBA('#d97706', 0.8),
        borderColor: '#d97706',
        borderWidth: 1,
        borderRadius: 4,
        yAxisID: 'yCO2'
      }
    ];
    chart.update('none');
  }

  // ── Chart 4: Reserve Margin Stress (line over years) ─────────────
  function createStressChart() {
    const ctx = document.getElementById('chart-stress');
    if (!ctx) return null;
    return new Chart(ctx, {
      type: 'line',
      data: { labels: [], datasets: [] },
      options: {
        scales: {
          x: {
            title: { display: true, text: 'Year', font: { weight: '600' } },
            grid: { display: false }
          },
          y: {
            title: { display: true, text: 'Reserve Margin (%)', font: { weight: '600' } },
            grid: { color: 'rgba(0,0,0,0.04)' },
            min: 0
          }
        },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`;
              }
            }
          }
        }
      }
    });
  }

  function updateStressChart(chart, cal, options) {
    if (!chart || !cal || !window.SAED) return;
    const SAED = window.SAED;
    const baseYear = cal.base_year;
    const years = Array.from({ length: 11 }, (_, i) => baseYear + i);
    const reserveFloor = options.reserveFloor || 8;

    const datasets = [];
    SAED.SEASONS.forEach(season => {
      const data = years.map(yr => {
        const results = SAED.simulateAll(cal, yr, false, 0);
        const peakRow = results.find(r => r.season === season && r.hour === 19);
        return peakRow ? peakRow.reserve_margin * 100 : 0;
      });
      datasets.push({
        label: season,
        data: data,
        borderColor: SAED.SEASON_COLORS[season],
        backgroundColor: 'transparent',
        borderWidth: 2.5,
        pointRadius: 3,
        pointBackgroundColor: SAED.SEASON_COLORS[season],
        tension: 0.3
      });
    });

    // Reserve floor line
    datasets.push({
      label: `Floor (${reserveFloor}%)`,
      data: years.map(() => reserveFloor),
      borderColor: '#dc2626',
      borderWidth: 1.5,
      borderDash: [8, 4],
      pointRadius: 0,
      fill: false
    });

    chart.data.labels = years;
    chart.data.datasets = datasets;
    chart.update('none');
  }

  // ── Chart 5: Availability Heatmap (custom canvas) ────────────────
  function drawHeatmap(cal) {
    const canvas = document.getElementById('chart-heatmap');
    if (!canvas || !cal) return;
    const ctx = canvas.getContext('2d');
    const SAED = window.SAED;

    // Sizing
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    const W = rect.width;
    const H = Math.max(rect.height, 260);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.scale(dpr, dpr);

    const sources = SAED.SOURCES;
    const seasons = SAED.SEASONS;
    const leftPad = 90;
    const topPad = 36;
    const rightPad = 16;
    const bottomPad = 12;
    const cellW = (W - leftPad - rightPad) / seasons.length;
    const cellH = (H - topPad - bottomPad) / sources.length;

    const isDark = document.body.classList.contains('dark-theme');

    ctx.clearRect(0, 0, W, H);

    // Column headers
    ctx.font = '600 10px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = isDark ? '#9ca3af' : '#64748b';
    seasons.forEach((s, j) => {
      ctx.fillText(s, leftPad + j * cellW + cellW / 2, topPad - 10);
    });

    // Draw cells
    sources.forEach((src, i) => {
      // Row label
      ctx.textAlign = 'right';
      ctx.font = '600 11px Inter, sans-serif';
      ctx.fillStyle = isDark ? '#f3f4f6' : '#1a1a2e';
      ctx.fillText(SAED.SOURCE_LABELS[src], leftPad - 10, topPad + i * cellH + cellH / 2 + 4);

      seasons.forEach((season, j) => {
        const alpha = cal.avail[src] ? (cal.avail[src][season] || 0) : 0;
        const x = leftPad + j * cellW;
        const y = topPad + i * cellH;

        // Cell color interpolation: background-neutral → teal-accent
        // In dark mode, start from dark-gray (#1f2937 = rgb(31,41,55))
        const startR = isDark ? 31 : 255;
        const startG = isDark ? 41 : 255;
        const startB = isDark ? 55 : 255;
        const r = Math.round(startR - alpha * (startR - 13));
        const g = Math.round(startG - alpha * (startG - 148));
        const b = Math.round(startB - alpha * (startB - 136));
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.beginPath();
        ctx.roundRect(x + 2, y + 2, cellW - 4, cellH - 4, 4);
        ctx.fill();

        // Border
        ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Value text
        ctx.textAlign = 'center';
        ctx.font = '700 12px "SF Mono", monospace';
        ctx.fillStyle = alpha > 0.5 ? '#fff' : (isDark ? '#f3f4f6' : '#1a1a2e');
        ctx.fillText(alpha.toFixed(2), x + cellW / 2, y + cellH / 2 + 5);
      });
    });
  }

  // ── Chart 6: Merit Order Waterfall (horizontal bar) ──────────────
  function drawMeritOrder(simResults, options) {
    const canvas = document.getElementById('chart-merit');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const SAED = window.SAED;

    const season = options.season;
    const reserveFloor = options.reserveFloor || 8;
    const displaySeason = getDefaultDisplaySeason(season);
    const seasonData = simResults.filter(r => r.season === displaySeason);
    // Pick peak hour (hour 19)
    const peakRow = seasonData.find(r => r.hour === 19) || seasonData[seasonData.length - 1];
    if (!peakRow) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.parentElement.getBoundingClientRect();
    const W = rect.width;
    const H = Math.max(rect.height, 260);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    const leftPad = 90;
    const rightPad = 30;
    const topPad = 30;
    const bottomPad = 40;
    const chartW = W - leftPad - rightPad;
    const barH = 32;
    const barGap = 8;

    // Merit order sources
    const meritSources = SAED.STACK_ORDER.slice().sort((a, b) => {
      return (SAED.MARGINAL_COST[a] || 0) - (SAED.MARGINAL_COST[b] || 0);
    });

    // Get max value for scale
    const demand = peakRow.demand || 0;
    const totalCap = meritSources.reduce((a, s) => a + (peakRow[`p_${s}`] || 0), 0);
    const maxVal = Math.max(demand, totalCap) * 1.1;
    const scale = chartW / maxVal;

    const isDark = document.body.classList.contains('dark-theme');

    // Title
    ctx.font = '600 11px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = isDark ? '#9ca3af' : '#64748b';
    ctx.fillText(`Peak hour (19:00) · ${displaySeason}`, leftPad, topPad - 8);

    // Draw bars
    meritSources.forEach((src, i) => {
      const mw = peakRow[`p_${src}`] || 0;
      const y = topPad + i * (barH + barGap);
      const barWidth = mw * scale;

      // Label
      ctx.textAlign = 'right';
      ctx.font = '600 11px Inter, sans-serif';
      ctx.fillStyle = isDark ? '#f3f4f6' : '#1a1a2e';
      ctx.fillText(SAED.SOURCE_LABELS[src], leftPad - 10, y + barH / 2 + 4);

      // Bar
      if (barWidth > 0) {
        ctx.fillStyle = SAED.SOURCE_COLORS[src];
        ctx.beginPath();
        ctx.roundRect(leftPad, y, Math.max(barWidth, 2), barH, 4);
        ctx.fill();

        // MW text inside bar
        if (barWidth > 50) {
          ctx.textAlign = 'left';
          ctx.font = '700 10px Inter, sans-serif';
          ctx.fillStyle = '#fff';
          ctx.fillText(`${Math.round(mw).toLocaleString()} MW`, leftPad + 8, y + barH / 2 + 4);
        } else if (mw > 0) {
          ctx.textAlign = 'left';
          ctx.font = '600 10px Inter, sans-serif';
          ctx.fillStyle = isDark ? '#f3f4f6' : '#1a1a2e';
          ctx.fillText(`${Math.round(mw)}`, leftPad + barWidth + 4, y + barH / 2 + 4);
        }
      }
    });

    // Demand dashed line
    const demandX = leftPad + demand * scale;
    const totalH = topPad + meritSources.length * (barH + barGap);
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(demandX, topPad - 4);
    ctx.lineTo(demandX, totalH);
    ctx.stroke();
    ctx.setLineDash([]);

    // Demand label
    ctx.textAlign = 'center';
    ctx.font = '700 10px Inter, sans-serif';
    ctx.fillStyle = '#dc2626';
    ctx.fillText(`Demand: ${Math.round(demand).toLocaleString()} MW`, demandX, totalH + 16);

    // Required Capacity dashed line
    const reqCap = demand * (1 + reserveFloor / 100);
    const reqCapX = leftPad + reqCap * scale;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(reqCapX, topPad - 4);
    ctx.lineTo(reqCapX, totalH);
    ctx.stroke();
    ctx.setLineDash([]);

    // Required Capacity label
    ctx.textAlign = 'center';
    ctx.font = '700 10px Inter, sans-serif';
    ctx.fillStyle = '#d97706';
    ctx.fillText(`Min Req: ${Math.round(reqCap).toLocaleString()} MW`, reqCapX, totalH + 28);

    // X-axis
    ctx.font = '500 10px Inter, sans-serif';
    ctx.fillStyle = isDark ? '#9ca3af' : '#64748b';
    ctx.textAlign = 'center';
    const ticks = 5;
    for (let i = 0; i <= ticks; i++) {
      const val = (maxVal / ticks) * i;
      const x = leftPad + val * scale;
      ctx.fillText(Math.round(val).toLocaleString(), x, totalH + 42);
      // Tick line
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, topPad - 4);
      ctx.lineTo(x, totalH);
      ctx.stroke();
    }
  }

  // ── Public API ───────────────────────────────────────────────────
  let _lastStressParams = null;

  window.DashboardCharts = {
    init: function () {
      chartDispatch = createDispatchChart();
      chartDemand = createDemandChart();
      chartCost = createCostChart();
      chartStress = createStressChart();
    },

    updateAll: function (simResults, cal, options) {
      if (!simResults || !cal) return;

      // Always update these 4
      updateDispatchChart(chartDispatch, simResults, options);
      updateDemandChart(chartDemand, cal, options);
      updateCostChart(chartCost, simResults);
      drawHeatmap(cal);
      drawMeritOrder(simResults, options);

      // Stress chart: only update on meaningful param changes
      const stressKey = JSON.stringify({
        growth: options.growth,
        reserveFloor: options.reserveFloor,
        cap: cal.capacity,
        cost: cal.cost,
        avail: cal.avail
      });
      if (stressKey !== _lastStressParams) {
        _lastStressParams = stressKey;
        updateStressChart(chartStress, cal, options);
      }
    },

    destroy: function () {
      [chartDispatch, chartDemand, chartCost, chartStress].forEach(c => {
        if (c) c.destroy();
      });
      chartDispatch = chartDemand = chartCost = chartStress = null;
      _lastStressParams = null;
    },

    resize: function () {
      [chartDispatch, chartDemand, chartCost, chartStress].forEach(c => {
        if (c) c.resize();
      });
    }
  };

})();
