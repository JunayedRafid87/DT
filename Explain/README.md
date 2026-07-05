# SAED — Seasonal-Aware Economic Dispatch + Digital Twin (PGCB)

A data-driven dispatch algorithm and digital twin for the Bangladesh power
system, calibrated from the PGCB hourly record (2015–2025). It shows **how
seasonal conditions change the generation mix** through an optimal merit-order
dispatch, and produces publication-ready figures and tables.

## What's here

| File | Description |
|------|-------------|
| `main.tex` / `main.pdf` | The write-up: math, the SAED algorithm + digital-twin pseudocode, calibrated parameter tables, and all result figures. **Upload the whole folder to Overleaf and compile `main.tex` (pdfLaTeX).** |
| `saed_core.py` | The engine: data cleaning, calibration, the SAED dispatch (Alg. 1) and the digital twin (Alg. 2). |
| `saed_outputs.py` | Generates every figure (`figures/`) and table (`tables/`). |
| `figures/` | Six figures as both `.pdf` (for LaTeX) and `.png` (for slides). |
| `tables/` | Five tables as `all_tables.tex` (input by `main.tex`) and individual `.csv`. |
| `calibration.json` | All learned parameters (base demand, diurnal profiles, capacities, availability matrix, growth). |

## The algorithm in one line
Classify the hour into a season → build firm available capacity
`P_max = C_g · α(g,s) · ψ(h)` → fill demand cheapest-source-first along the merit
order (provably optimal, Theorem 1) → record cost, CO₂, reserve margin and any
load shedding.

## Key seasonal findings
- **Hydro** availability collapses in winter (α=0.41) and saturates in the
  monsoon (1.00); **solar** peaks in the pre-monsoon (1.00).
- Optimal dispatch leans on cheap gas+coal and **largely avoids the expensive
  liquid-fuel peaking** the historical operation used — a recoverable efficiency
  margin.
- Under the historical ~7.9 %/yr demand growth, the **monsoon** reserve margin
  is the first to fall below the 8 % planning floor (~2029–2030): the binding
  season for capacity expansion.

## Reproduce
```bash
pip install pandas numpy matplotlib scipy openpyxl
python saed_outputs.py          # regenerates figures/ and tables/
# then, in Overleaf or locally:
pdflatex main.tex && pdflatex main.tex
```
Point `saed_core.load_clean(path)` at the source `.xlsx` if you move it.
