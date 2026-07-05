"""
SAED Digital Twin -- Core engine
Seasonal-Aware Economic Dispatch for the Bangladesh (PGCB) power system.

This module:
  (1) ingests and cleans the PGCB historical record,
  (2) calibrates a seasonal demand model + per-source seasonal availability,
  (3) implements the SAED merit-order economic-dispatch algorithm,
  (4) exposes a deterministic + stochastic "twin" simulator.

All seasonal parameters are *learned from the data*, not assumed.
"""
from __future__ import annotations
import numpy as np
import pandas as pd
from dataclasses import dataclass, field

# ----------------------------------------------------------------------
# Fixed engineering constants (techno-economic, from public BD/IEA refs)
# Marginal cost [USD/MWh] and emission factor [tCO2/MWh].
# These set the *merit order* used by the dispatch.
# ----------------------------------------------------------------------
SOURCES = ["solar", "hydro", "gas", "coal", "imports", "liquid_fuel"]

MARGINAL_COST = {           # USD / MWh  (ascending -> merit order)
    "solar":        0.0,
    "hydro":        5.0,
    "gas":         45.0,
    "coal":        65.0,
    "imports":     75.0,
    "liquid_fuel": 180.0,
}
EMISSION_FACTOR = {         # tCO2 / MWh
    "solar":        0.00,
    "hydro":        0.00,
    "gas":          0.45,
    "coal":         0.95,
    "imports":      0.50,
    "liquid_fuel":  0.75,
}

SEASON_OF_MONTH = {12:"Winter",1:"Winter",2:"Winter",
                   3:"PreMonsoon",4:"PreMonsoon",5:"PreMonsoon",
                   6:"Monsoon",7:"Monsoon",8:"Monsoon",9:"Monsoon",
                   10:"PostMonsoon",11:"PostMonsoon"}
SEASONS = ["Winter", "PreMonsoon", "Monsoon", "PostMonsoon"]
PLAUSIBLE_MAX = 20000.0     # MW -- BD grid ceiling; above => data-entry error


# ======================================================================
#  1. DATA INGESTION + CLEANING
# ======================================================================
def load_clean(path: str) -> pd.DataFrame:
    df = pd.read_excel(path)
    df["datetime"] = pd.to_datetime(df["datetime"])
    imp_cols = ["india_bheramara_hvdc", "india_tripura", "india_adani", "nepal"]
    raw = ["generation_mw", "demand_mw", "gas", "liquid_fuel",
           "coal", "hydro", "solar", "wind"] + imp_cols
    for c in raw:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df["imports"] = df[imp_cols].fillna(0).sum(axis=1)
    # remove physically impossible records (extra-digit entry errors)
    for c in ["generation_mw", "demand_mw", "gas", "liquid_fuel",
              "coal", "hydro", "solar", "imports"]:
        df.loc[df[c] > PLAUSIBLE_MAX, c] = np.nan
    df["month"] = df["datetime"].dt.month
    df["hour"]  = df["datetime"].dt.hour
    df["year"]  = df["datetime"].dt.year
    df["season"] = df["month"].map(SEASON_OF_MONTH)
    df = df.dropna(subset=["demand_mw"])
    return df


# ======================================================================
#  2. CALIBRATION  ->  learns all model parameters from the record
# ======================================================================
@dataclass
class Calibration:
    base_demand: dict           # Dbar_s   [MW]
    diurnal: dict               # phi_s(h) -> np.array(24), mean=1
    noise_sd: dict              # eta_s    relative demand volatility
    capacity: dict              # C_g      [MW]  effective capacity
    avail: dict                 # alpha_{g,s}  seasonal availability factor
    solar_shape: np.ndarray     # psi(h)   solar diurnal availability, max=1
    growth: float               # annual demand growth g
    base_year: int
    cost: dict = field(default_factory=lambda: dict(MARGINAL_COST))
    emis: dict = field(default_factory=lambda: dict(EMISSION_FACTOR))

    @property
    def merit_order(self):
        return sorted(SOURCES, key=lambda g: self.cost[g])


def calibrate(df: pd.DataFrame) -> Calibration:
    # ---- seasonal base demand & volatility ----
    base_demand = df.groupby("season")["demand_mw"].mean().to_dict()
    noise_sd = (df.groupby("season")["demand_mw"].std()
                / df.groupby("season")["demand_mw"].mean()).to_dict()

    # ---- normalized diurnal profile phi_s(h)  (mean over hours = 1) ----
    diurnal = {}
    piv = df.pivot_table(index="hour", columns="season",
                         values="demand_mw", aggfunc="mean")
    for s in SEASONS:
        col = piv[s].reindex(range(24)).interpolate().bfill().ffill().values
        diurnal[s] = col / col.mean()

    # ---- firm capacity C_g and seasonal availability alpha_{g,s} ----
    # Firm seasonally-available output = P95 of observed output in that season.
    # This implicitly encodes fuel-supply (gas), water (hydro) and maintenance
    # limits as they actually manifest -- the binding reality in the BD grid.
    #   C_g          = max_s  P95_g(s)           (best firm delivery)
    #   alpha_{g,s}  = P95_g(s) / C_g  in [0,1]  (seasonal availability factor)
    p95_season = {g: {s: float(np.nanpercentile(df.loc[df.season == s, g], 95))
                      for s in SEASONS} for g in SOURCES}
    capacity = {g: max(p95_season[g].values()) for g in SOURCES}
    avail = {g: {s: (p95_season[g][s] / capacity[g] if capacity[g] > 0 else 0.0)
                 for s in SEASONS} for g in SOURCES}

    # ---- solar diurnal availability psi(h)  (normalized to peak 1) ----
    solar_h = df.pivot_table(index="hour", values="solar",
                             aggfunc="mean").reindex(range(24))["solar"]
    solar_h = solar_h.fillna(0).values
    solar_shape = solar_h / solar_h.max() if solar_h.max() > 0 else solar_h

    # ---- annual demand growth (log-linear on yearly peak) ----
    yr_peak = df.groupby("year")["demand_mw"].max()
    yr_peak = yr_peak[yr_peak > 0]
    yrs = yr_peak.index.values.astype(float)
    growth = float(np.exp(np.polyfit(yrs, np.log(yr_peak.values), 1)[0]) - 1)
    base_year = int(yrs.max())

    return Calibration(base_demand, diurnal, noise_sd, capacity, avail,
                       solar_shape, growth, base_year)


# ======================================================================
#  3. SAED  --  Seasonal-Aware Economic Dispatch (one time-step)
# ======================================================================
def available_capacity(cal: Calibration, season: str, hour: int) -> dict:
    """P^max_g(s,h) = alpha_{g,s} * C_g, with solar gated by daylight psi(h)."""
    cap = {}
    for g in SOURCES:
        p = cal.avail[g][season] * cal.capacity[g]
        if g == "solar":
            p *= cal.solar_shape[hour]
        cap[g] = max(p, 0.0)
    return cap


def dispatch(demand: float, cal: Calibration, season: str, hour: int,
             reserve_frac: float = 0.08) -> dict:
    """
    Greedy merit-order economic dispatch (provably cost-optimal for a
    single-bus linear-cost system).  Returns per-source MW, cost, CO2,
    load-shed and reserve margin.
    """
    pmax = available_capacity(cal, season, hour)
    target = demand                     # MW to be served this hour
    residual = target
    p = {g: 0.0 for g in SOURCES}
    for g in cal.merit_order:           # fill cheapest first
        take = min(residual, pmax[g])
        p[g] = take
        residual -= take
        if residual <= 1e-9:
            break
    served = sum(p.values())
    load_shed = max(target - served, 0.0)
    spare = sum(pmax[g] - p[g] for g in SOURCES)
    reserve_margin = spare / target if target > 0 else np.nan
    reserve_ok = spare >= reserve_frac * target
    cost = sum(p[g] * cal.cost[g] for g in SOURCES)
    co2  = sum(p[g] * cal.emis[g] for g in SOURCES)
    out = {f"p_{g}": p[g] for g in SOURCES}
    out.update(demand=target, served=served, load_shed=load_shed,
               reserve_margin=reserve_margin, reserve_ok=reserve_ok,
               cost_usd=cost, co2_t=co2)
    return out


# ======================================================================
#  4. DIGITAL TWIN  --  full diurnal simulation per season
# ======================================================================
def simulate_season(cal: Calibration, season: str, year: int | None = None,
                    stochastic: bool = False, seed: int | None = None) -> pd.DataFrame:
    """Simulate the 24-hour dispatch for one representative day in a season."""
    rng = np.random.default_rng(seed)
    yr = year if year is not None else cal.base_year
    growth_mult = (1 + cal.growth) ** (yr - cal.base_year)
    rows = []
    for h in range(24):
        d = cal.base_demand[season] * cal.diurnal[season][h] * growth_mult
        if stochastic:
            d *= (1 + rng.normal(0, 0.5 * cal.noise_sd[season]))
        r = dispatch(max(d, 0.0), cal, season, h)
        r["hour"] = h
        r["season"] = season
        rows.append(r)
    return pd.DataFrame(rows)


def simulate_all(cal: Calibration, year: int | None = None,
                 stochastic: bool = False, seed: int = 0) -> pd.DataFrame:
    return pd.concat(
        [simulate_season(cal, s, year, stochastic, seed + i)
         for i, s in enumerate(SEASONS)],
        ignore_index=True)
