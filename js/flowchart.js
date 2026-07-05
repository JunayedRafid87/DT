/* ================================================================
   SAED Digital Twin — Flowchart Module
   Interactive data processing pipeline visualization
   ================================================================ */

(function () {
  'use strict';

  // ── Pipeline Stage Data (sourced from saed_explainer.jsx STAGES) ──
  const STAGES = [
    {
      id: 'pgcb-data',
      emoji: '📋',
      tag: 'The Raw Material',
      title: 'PGCB Data',
      subtitle: '92,650 hourly records',
      description: 'Think of this as a massive logbook. Every single hour for 10 years, someone recorded exactly what was happening on Bangladesh\'s power grid — how much electricity people were demanding, and which power plants were running to supply it.',
      details: [
        { icon: '📅', label: 'Time span', value: 'April 2015 → June 2025 (10 years)' },
        { icon: '📊', label: 'Total rows', value: '~92,650 hourly records' },
        { icon: '⚡', label: 'What\'s recorded', value: 'Total demand, plus how much each power plant type was generating' },
        { icon: '🏭', label: 'Plant types tracked', value: 'Gas, Coal, Hydro, Solar, Liquid fuel, Imports from India/Nepal' }
      ],
      analogy: {
        icon: '📔',
        title: 'Think of it like a diary',
        text: 'Imagine a doctor keeping a detailed diary of a patient\'s health every hour for 10 years — heart rate, blood pressure, temperature, diet. That diary is what we have for Bangladesh\'s grid.'
      }
    },
    {
      id: 'clean-label',
      emoji: '🧹',
      tag: 'Stage 1',
      title: 'Clean & Label',
      subtitle: 'Remove outliers, tag seasons',
      description: 'Before we can learn anything useful, we need to fix the messy parts. Some entries in the logbook have obvious typos — like a reading of 64,000,000 MW when the entire country\'s grid only ever reaches about 17,000 MW. We throw those out.',
      details: [
        { icon: '🚫', label: 'Bad values removed', value: 'Any reading above 20,000 MW — physically impossible' },
        { icon: '🔗', label: 'Import channels merged', value: '4 separate India/Nepal import columns → combined into 1 \'imports\' column' },
        { icon: '🗓️', label: 'Labels added', value: 'Each row gets tagged: month, hour of day, year, season' },
        { icon: '🗑️', label: 'Incomplete rows', value: 'Any row missing the demand reading is dropped entirely' }
      ],
      analogy: {
        icon: '🩺',
        title: 'Like cleaning medical records',
        text: 'If our patient\'s diary said their heart rate was 5,000 bpm one Tuesday, we\'d assume that\'s a typo and cross it out. Same idea here.'
      }
    },
    {
      id: 'calibration',
      emoji: '🧠',
      tag: 'Stage 2 — The most important step',
      title: 'Calibration',
      subtitle: '~100 learned parameters',
      description: 'This is where the magic happens. We take all 92,650 rows and distill them down to about 100 key numbers that capture how the grid behaves. After this step, we don\'t need the raw data anymore — those 100 numbers ARE the model.',
      details: [
        { icon: '📈', label: 'About demand', value: 'Typical demand for each season, and how demand rises/falls hour by hour' },
        { icon: '🏭', label: 'About supply', value: 'How much each power plant type can reliably deliver, and how that changes by season' },
        { icon: '📉', label: 'About growth', value: 'Bangladesh\'s electricity demand grows at about 7.9% every year' },
        { icon: '💾', label: 'Output', value: 'All ~100 numbers go into calibration.json — the \'brain\' of the twin' }
      ],
      formulas: [
        { label: 'Demand model', tex: 'D(s,h,y) = \\bar{D}_s \\cdot \\phi_s(h) \\cdot (1+g)^{y-y_0}' },
        { label: 'Available capacity', tex: 'P^{\\max}_g(s,h) = C_g \\cdot \\alpha_{g,s} \\cdot \\psi_g(h)' }
      ],
      analogy: {
        icon: '🧬',
        title: 'Like creating a DNA profile',
        text: 'Instead of keeping 10 years of hourly diary entries, we extract the essential patterns — the \'DNA\' of how this grid behaves.'
      }
    },
    {
      id: 'saed-dispatch',
      emoji: '⚙️',
      tag: 'Stage 3 — The decision engine',
      title: 'SAED Dispatch',
      subtitle: 'Merit-order greedy fill',
      description: 'Given a demand number and a season, the dispatch algorithm decides which power plants to turn on — in what order, and how much — to serve that demand at the lowest possible cost.',
      details: [
        { icon: '📋', label: 'The rule', value: 'Always use the cheapest available source first, then the next cheapest, until demand is met' },
        { icon: '✅', label: 'Why optimal', value: 'Mathematically proven: no other ordering can cost less (Theorem 1)' },
        { icon: '⚡', label: 'Speed', value: 'One simple pass through 6 sources. Runs in microseconds.' },
        { icon: '📐', label: 'Key formula', value: 'P_max = Firm Capacity × Seasonal Availability × Time-of-day shape' }
      ],
      meritOrder: [
        { rank: 1, source: 'Solar', cost: '$0/MWh', color: '#E69F00', why: 'Sunlight is free. Always use it first.' },
        { rank: 2, source: 'Hydro', cost: '$5/MWh', color: '#56B4E9', why: 'Water flowing through turbines is nearly free.' },
        { rank: 3, source: 'Gas', cost: '$45/MWh', color: '#009E73', why: 'Cheap and abundant — the backbone.' },
        { rank: 4, source: 'Coal', cost: '$65/MWh', color: '#555555', why: 'More expensive but still reasonable.' },
        { rank: 5, source: 'Imports', cost: '$75/MWh', color: '#CC79A7', why: 'Buying from India/Nepal.' },
        { rank: 6, source: 'Liquid Fuel', cost: '$180/MWh', color: '#D55E00', why: 'Only turned on as a last resort.' }
      ],
      formulas: [
        { label: 'Greedy dispatch', tex: 'p_{g_{(k)}} = \\min\\!\\left(D - \\sum_{j<k} p_{g_{(j)}},\\, P^{\\max}_{g_{(k)}}\\right)' }
      ],
      analogy: {
        icon: '🛒',
        title: 'Like grocery shopping on a budget',
        text: 'You need 100 items. You start with the cheapest store (Solar — free!), buy everything they have, then move to the next cheapest. That\'s exactly what the dispatch does with megawatts.'
      }
    },
    {
      id: 'digital-twin',
      emoji: '🔄',
      tag: 'Stage 4',
      title: 'Digital Twin',
      subtitle: '4 seasons × 24 hours replay',
      description: 'Now we put it all together. The \'twin\' runs through all 24 hours of a representative day, for all 4 seasons. At each step it rebuilds what demand would be (from the learned patterns), then calls the dispatch engine.',
      details: [
        { icon: '🔁', label: 'What it loops over', value: '4 seasons × 24 hours = 96 dispatch decisions per scenario' },
        { icon: '📅', label: 'The year dial', value: 'Set it to 2025 for validation, or 2030 for stress-testing growth' },
        { icon: '⏱️', label: 'How fast', value: 'Milliseconds — you can run thousands of scenarios cheaply' },
        { icon: '🎲', label: 'Stochastic mode', value: 'Add random noise to demand to simulate real-world uncertainty' }
      ],
      formulas: [
        { label: 'Demand reconstruction', tex: 'D = \\bar{D}_s \\cdot \\phi_s(h) \\cdot (1+g)^{y-y_0}' },
        { label: 'Reserve margin', tex: '\\text{RM} = \\frac{\\sum_g (P^{\\max}_g - p_g)}{D}' }
      ],
      analogy: {
        icon: '🎮',
        title: 'Like a flight simulator',
        text: 'A flight simulator doesn\'t fly a real plane — it recreates the physics of flight in software. Our twin recreates the economics of the grid in software.'
      }
    },
    {
      id: 'outputs',
      emoji: '📊',
      tag: 'Stage 5',
      title: 'Outputs',
      subtitle: '6 figures, 5 tables, paper',
      description: 'Finally, all those dispatch results get turned into the charts, tables, and paper text that communicate the findings to the world.',
      details: [
        { icon: '📈', label: '6 Figures', value: 'Demand profiles, dispatch stacks, validation, heatmap, cost/emissions, stress test' },
        { icon: '📋', label: '5 Tables', value: 'Demand params, source capacities, availability matrix, dispatch results, validation errors' },
        { icon: '📄', label: 'The paper', value: '9-page LaTeX paper — ready to submit' },
        { icon: '💾', label: 'Reproducible', value: 'Anyone with the data can run two commands and get identical outputs' }
      ],
      analogy: {
        icon: '📰',
        title: 'Like writing up a science experiment',
        text: 'You\'ve done all the real work — now you package the results in a way that other researchers can read, verify, and build on.'
      }
    }
  ];

  let _activeNode = null;
  let _containerEl = null;
  let _infoPanelEl = null;

  // ── Build DOM ────────────────────────────────────────────────────
  function buildFlowchart(containerId, infoPanelId) {
    _containerEl = document.getElementById(containerId);
    _infoPanelEl = document.getElementById(infoPanelId);
    if (!_containerEl || !_infoPanelEl) return;

    // Build node + arrow elements
    const wrapper = document.createElement('div');
    wrapper.className = 'flowchart-wrapper';

    STAGES.forEach((stage, i) => {
      // Node
      const node = document.createElement('div');
      node.className = 'flow-node';
      node.dataset.nodeId = stage.id;
      node.setAttribute('role', 'button');
      node.setAttribute('tabindex', '0');
      node.setAttribute('aria-label', `Pipeline stage: ${stage.title}`);
      node.innerHTML = `
        <div class="flow-node-icon">${stage.emoji}</div>
        <div class="flow-node-title">${stage.title}</div>
        <div class="flow-node-sub">${stage.subtitle}</div>
      `;

      node.addEventListener('click', () => setActiveNode(stage.id));
      node.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setActiveNode(stage.id);
        }
      });

      wrapper.appendChild(node);

      // Arrow (except after last)
      if (i < STAGES.length - 1) {
        const arrow = document.createElement('div');
        arrow.className = 'flow-arrow';
        arrow.innerHTML = `<div class="flow-arrow-line"></div><div class="flow-arrow-head"></div>`;
        wrapper.appendChild(arrow);
      }
    });

    _containerEl.appendChild(wrapper);

    // Set first node active
    setActiveNode(STAGES[0].id);
  }

  // ── Render Info Panel ────────────────────────────────────────────
  function renderInfoPanel(stage) {
    if (!_infoPanelEl) return;

    let html = '';

    // Header
    html += `
      <div class="info-header">
        <div class="info-icon">${stage.emoji}</div>
        <div>
          <div class="info-tag">${stage.tag}</div>
          <div class="info-title">${stage.title}</div>
        </div>
      </div>
    `;

    // Description
    html += `<div class="info-desc">${stage.description}</div>`;

    // Details grid
    if (stage.details && stage.details.length > 0) {
      html += '<div class="info-details">';
      stage.details.forEach(d => {
        html += `
          <div class="detail-item">
            <div class="detail-icon">${d.icon}</div>
            <div>
              <div class="detail-label">${d.label}</div>
              <div class="detail-value">${d.value}</div>
            </div>
          </div>
        `;
      });
      html += '</div>';
    }

    // Formulas
    if (stage.formulas && stage.formulas.length > 0) {
      stage.formulas.forEach(f => {
        html += `
          <div class="formula-block">
            <div class="formula-label">${f.label}</div>
            <div class="formula-katex" data-tex="${escapeAttr(f.tex)}"></div>
          </div>
        `;
      });
    }

    // Merit order table
    if (stage.meritOrder) {
      html += '<table class="merit-table">';
      stage.meritOrder.forEach((item, i) => {
        const bg = i % 2 === 0 ? '#f8f9fa' : '#fff';
        html += `
          <tr style="background:${bg}; border-radius: 6px;">
            <td><span class="rank-badge" style="background:${item.color}">${item.rank}</span></td>
            <td><strong>${item.source}</strong></td>
            <td style="color:${item.color}; font-weight:700;">${item.cost}</td>
            <td style="font-size:11px; color:#777;">${item.why}</td>
          </tr>
        `;
      });
      html += '</table>';
    }

    // Analogy
    if (stage.analogy) {
      html += `
        <div class="analogy-box">
          <div class="analogy-title">${stage.analogy.icon} ${stage.analogy.title}</div>
          <div class="analogy-text">${stage.analogy.text}</div>
        </div>
      `;
    }

    _infoPanelEl.innerHTML = html;

    // Render KaTeX formulas
    if (typeof katex !== 'undefined') {
      _infoPanelEl.querySelectorAll('.formula-katex').forEach(el => {
        const tex = el.dataset.tex;
        try {
          katex.render(tex, el, { displayMode: true, throwOnError: false });
        } catch (e) {
          el.textContent = tex;
        }
      });
    }
  }

  function escapeAttr(str) {
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── Set Active Node ──────────────────────────────────────────────
  function setActiveNode(nodeId) {
    if (!_containerEl) return;

    // Remove previous active
    _containerEl.querySelectorAll('.flow-node').forEach(n => n.classList.remove('active'));

    // Set new active
    const activeEl = _containerEl.querySelector(`[data-node-id="${nodeId}"]`);
    if (activeEl) {
      activeEl.classList.add('active');
    }

    // Find stage data
    const stage = STAGES.find(s => s.id === nodeId);
    if (stage) {
      _activeNode = nodeId;
      renderInfoPanel(stage);
    }
  }

  // ── Public API ───────────────────────────────────────────────────
  window.Flowchart = {
    init: function (containerId, infoPanelId) {
      buildFlowchart(containerId, infoPanelId);
    },
    setActiveNode: setActiveNode
  };

})();
