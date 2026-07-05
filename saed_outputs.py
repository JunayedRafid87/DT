"""
SAED Digital Twin -- publication output layer.
Generates 300-dpi figures (PDF+PNG) and LaTeX/CSV tables from the calibrated
twin and the historical record.
"""
import os, json
import numpy as np
import pandas as pd
import matplotlib as mpl
import matplotlib.pyplot as plt
from matplotlib.ticker import MaxNLocator
import saed_core as sc

OUT = "/mnt/user-data/outputs"
FIG = os.path.join(OUT, "figures")
TAB = os.path.join(OUT, "tables")
os.makedirs(FIG, exist_ok=True)
os.makedirs(TAB, exist_ok=True)

# ---- publication styling -------------------------------------------------
mpl.rcParams.update({
    "font.family": "serif",
    "font.serif": ["DejaVu Serif", "Times New Roman"],
    "font.size": 11, "axes.titlesize": 12, "axes.labelsize": 11,
    "axes.linewidth": 0.8, "axes.spines.top": False, "axes.spines.right": False,
    "legend.fontsize": 9, "legend.frameon": False,
    "xtick.labelsize": 9.5, "ytick.labelsize": 9.5,
    "figure.dpi": 120, "savefig.dpi": 300, "savefig.bbox": "tight",
})
# colour-blind-safe palette, one stable colour per source
CSRC = {"solar":"#E69F00", "hydro":"#56B4E9", "gas":"#009E73",
        "coal":"#555555", "imports":"#CC79A7", "liquid_fuel":"#D55E00"}
LBL = {"solar":"Solar","hydro":"Hydro","gas":"Natural gas","coal":"Coal",
       "imports":"Imports","liquid_fuel":"Liquid fuel"}
CSEASON = {"Winter":"#0072B2","PreMonsoon":"#E69F00",
           "Monsoon":"#009E73","PostMonsoon":"#CC79A7"}
STACK_ORDER = ["gas","coal","hydro","solar","imports","liquid_fuel"]


def savefig(fig, name):
    for ext in ("pdf","png"):
        fig.savefig(os.path.join(FIG, f"{name}.{ext}"))
    plt.close(fig)


# ======================================================================
def fig_demand_profiles(cal):
    fig, ax = plt.subplots(figsize=(6.2, 4.0))
    hrs = np.arange(24)
    for s in sc.SEASONS:
        prof = cal.base_demand[s]*cal.diurnal[s]
        ax.plot(hrs, prof, color=CSEASON[s], lw=2, marker="o", ms=3, label=s)
    ax.set_xlabel("Hour of day"); ax.set_ylabel("Demand (MW)")
    ax.set_title("(a) Calibrated seasonal diurnal demand profiles")
    ax.set_xticks(range(0,24,3)); ax.set_xlim(0,23)
    ax.legend(title="Season", ncol=2)
    ax.grid(alpha=.25, lw=.5)
    savefig(fig, "fig1_demand_profiles")


def fig_dispatch_stacks(cal, year):
    fig, axes = plt.subplots(2, 2, figsize=(8.6, 6.4), sharex=True, sharey=True)
    hrs = np.arange(24)
    for ax, s in zip(axes.ravel(), sc.SEASONS):
        sim = sc.simulate_season(cal, s, year=year)
        stacks = [sim[f"p_{g}"].values for g in STACK_ORDER]
        ax.stackplot(hrs, *stacks,
                     colors=[CSRC[g] for g in STACK_ORDER],
                     labels=[LBL[g] for g in STACK_ORDER], alpha=.92)
        ax.plot(hrs, sim["demand"].values, color="k", lw=1.4, ls="--", label="Demand")
        ax.set_title(s, fontsize=11)
        ax.set_xticks(range(0,24,4)); ax.set_xlim(0,23)
        ax.grid(alpha=.2, lw=.5)
    for ax in axes[:,0]: ax.set_ylabel("Power (MW)")
    for ax in axes[1,:]: ax.set_xlabel("Hour of day")
    h,l = axes[0,0].get_legend_handles_labels()
    fig.legend(h, l, ncol=7, loc="lower center", bbox_to_anchor=(.5,-.03))
    fig.suptitle(f"Seasonal merit-order dispatch stacks (SAED, year {year})",
                 y=.98, fontsize=12.5)
    fig.tight_layout(rect=[0,.03,1,.97])
    savefig(fig, "fig2_dispatch_stacks")


def fig_validation(cal, df):
    sim = sc.simulate_all(cal, year=cal.base_year)
    srcs = STACK_ORDER
    simm = sim.groupby("season")[[f"p_{g}" for g in srcs]].mean()
    simm.columns = srcs
    hism = df.groupby("season")[srcs].mean()
    fig, axes = plt.subplots(1, 4, figsize=(10.2, 3.4), sharey=True)
    x = np.arange(len(srcs)); w=.38
    for ax, s in zip(axes, sc.SEASONS):
        ax.bar(x-w/2, hism.loc[s, srcs].values, w, color="#999999", label="Historical")
        ax.bar(x+w/2, simm.loc[s, srcs].values, w,
               color=[CSRC[g] for g in srcs], edgecolor="k", lw=.4, label="SAED twin")
        ax.set_title(s, fontsize=10.5)
        ax.set_xticks(x); ax.set_xticklabels([LBL[g] for g in srcs],
                                             rotation=55, ha="right", fontsize=8)
        ax.grid(axis="y", alpha=.2, lw=.5)
    axes[0].set_ylabel("Mean output (MW)")
    from matplotlib.patches import Patch
    fig.legend(handles=[Patch(fc="#999999",label="Historical"),
                        Patch(fc="#009E73",ec="k",label="SAED twin")],
               ncol=2, loc="lower center", bbox_to_anchor=(.5,-.06))
    fig.suptitle("Digital-twin validation: SAED dispatch vs. historical generation mix",
                 y=1.02, fontsize=12)
    fig.tight_layout()
    savefig(fig, "fig3_validation")


def fig_availability_heatmap(cal):
    M = np.array([[cal.avail[g][s] for s in sc.SEASONS] for g in sc.SOURCES])
    fig, ax = plt.subplots(figsize=(5.6, 4.0))
    im = ax.imshow(M, cmap="YlGnBu", vmin=0, vmax=1, aspect="auto")
    ax.set_xticks(range(len(sc.SEASONS))); ax.set_xticklabels(sc.SEASONS, rotation=20, ha="right")
    ax.set_yticks(range(len(sc.SOURCES))); ax.set_yticklabels([LBL[g] for g in sc.SOURCES])
    for i in range(M.shape[0]):
        for j in range(M.shape[1]):
            ax.text(j, i, f"{M[i,j]:.2f}", ha="center", va="center",
                    color="white" if M[i,j]>.6 else "black", fontsize=9)
    cb = fig.colorbar(im, ax=ax, fraction=.046, pad=.04)
    cb.set_label(r"Availability factor $\alpha_{g,s}$")
    ax.set_title("Calibrated seasonal availability matrix")
    savefig(fig, "fig4_availability_heatmap")


def fig_cost_emissions(cal):
    sim = sc.simulate_all(cal, year=cal.base_year)
    agg = sim.groupby("season")[["cost_usd","co2_t","demand"]].sum().reindex(sc.SEASONS)
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(8.8, 3.6))
    x = np.arange(len(sc.SEASONS))
    ax1.bar(x, agg["cost_usd"]/1e3, color=[CSEASON[s] for s in sc.SEASONS])
    ax1.set_xticks(x); ax1.set_xticklabels(sc.SEASONS, rotation=20, ha="right")
    ax1.set_ylabel("Daily operating cost (10³ USD)")
    ax1.set_title("(a) Seasonal operating cost"); ax1.grid(axis="y",alpha=.2,lw=.5)
    ax2.bar(x, agg["co2_t"]/1e3, color=[CSEASON[s] for s in sc.SEASONS])
    ax2.set_xticks(x); ax2.set_xticklabels(sc.SEASONS, rotation=20, ha="right")
    ax2.set_ylabel("Daily CO₂ emissions (10³ t)")
    ax2.set_title("(b) Seasonal carbon emissions"); ax2.grid(axis="y",alpha=.2,lw=.5)
    fig.tight_layout()
    savefig(fig, "fig5_cost_emissions")


def fig_stress(cal, years):
    rows=[]
    for yr in years:
        sim = sc.simulate_all(cal, year=yr)
        g = sim.groupby("season")
        liq = g["p_liquid_fuel"].sum()
        # peak-hour (h=19) reserve margin -- the binding planning metric
        peak = sim[sim.hour==19].set_index("season")["reserve_margin"]
        for s in sc.SEASONS:
            rows.append(dict(year=yr, season=s,
                             liq_GWh=liq[s]/1e3, reserve=peak[s]*100))
    R = pd.DataFrame(rows)
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(9.4, 3.7), sharex=True)
    for s in sc.SEASONS:
        d = R[R.season==s]
        ax1.plot(d.year, d.liq_GWh, color=CSEASON[s], marker="o", ms=4, label=s)
        ax2.plot(d.year, d.reserve, color=CSEASON[s], marker="s", ms=4, label=s)
    ax1.set_title("(a) Liquid-fuel peaking energy"); ax1.set_ylabel("GWh per representative day")
    ax2.axhline(8, color="k", ls=":", lw=1.2)
    ax2.text(years[0], 9.5, "8% minimum reserve", fontsize=8, style="italic")
    ax2.set_title("(b) Peak-hour reserve margin"); ax2.set_ylabel("Reserve margin (%)")
    for ax in (ax1, ax2):
        ax.set_xlabel("Year"); ax.grid(alpha=.25, lw=.5)
        ax.xaxis.set_major_locator(MaxNLocator(integer=True))
    ax1.legend(title="Season", ncol=2)
    fig.suptitle("Digital-twin demand-growth stress test by season", y=1.02, fontsize=12)
    fig.tight_layout()
    savefig(fig, "fig6_stress_test")


# ======================================================================
#  TABLES  (LaTeX booktabs + CSV)
# ======================================================================
def _latex(df, caption, label, fmt=None, floatfmt="%.2f"):
    col_fmt = "l" + "r"*(df.shape[1])
    body = df.to_latex(index=True, escape=False, column_format=col_fmt,
                       float_format=lambda x: floatfmt % x, na_rep="--")
    body = body.replace("\\toprule","\\toprule").replace("\\midrule","\\midrule")
    return (f"\\begin{{table}}[htbp]\n\\centering\n"
            f"\\caption{{{caption}}}\n\\label{{{label}}}\n"
            f"\\small\n{body}\\end{{table}}\n")


def make_tables(cal, df):
    # T1 seasonal demand params
    t1 = pd.DataFrame({
        "Mean demand (MW)": {s: cal.base_demand[s] for s in sc.SEASONS},
        "Peak factor": {s: cal.diurnal[s].max() for s in sc.SEASONS},
        "Trough factor": {s: cal.diurnal[s].min() for s in sc.SEASONS},
        "Volatility $\\eta_s$": {s: cal.noise_sd[s] for s in sc.SEASONS},
    }).reindex(sc.SEASONS)
    # T2 techno-economic + capacity
    t2 = pd.DataFrame({
        "Firm cap. $C_g$ (MW)": {g: cal.capacity[g] for g in sc.SOURCES},
        "Cost (USD/MWh)": {g: cal.cost[g] for g in sc.SOURCES},
        "Emission (tCO$_2$/MWh)": {g: cal.emis[g] for g in sc.SOURCES},
        "Merit rank": {g: cal.merit_order.index(g)+1 for g in sc.SOURCES},
    }).reindex(sc.SOURCES)
    t2.index = [LBL[g] for g in t2.index]
    # T3 availability matrix
    t3 = pd.DataFrame(cal.avail).T.reindex(sc.SOURCES)[sc.SEASONS]
    t3.index = [LBL[g] for g in t3.index]
    # T4 dispatch results
    sim = sc.simulate_all(cal, year=cal.base_year)
    agg = sim.groupby("season")
    t4 = pd.DataFrame({
        "Energy (GWh/d)": agg["served"].sum()/1e3,
        "Cost (k\\$/d)": agg["cost_usd"].sum()/1e3,
        "CO$_2$ (kt/d)": agg["co2_t"].sum()/1e3,
        "Avg cost (\\$/MWh)": agg["cost_usd"].sum()/agg["served"].sum(),
        "Reserve margin": agg["reserve_margin"].mean(),
    }).reindex(sc.SEASONS)
    # T5 validation metrics
    srcs = STACK_ORDER
    simm = sim.groupby("season")[[f"p_{g}" for g in srcs]].mean(); simm.columns=srcs
    hism = df.groupby("season")[srcs].mean().reindex(sc.SEASONS)
    mae = (simm-hism).abs().mean(axis=1)
    rmse = np.sqrt(((simm-hism)**2).mean(axis=1))
    t5 = pd.DataFrame({"MAE (MW)": mae, "RMSE (MW)": rmse}).reindex(sc.SEASONS)

    tex = ""
    tex += _latex(t1, "Calibrated seasonal demand-model parameters.",
                  "tab:demand", floatfmt="%.3f")
    tex += _latex(t2, "Source techno-economic parameters and firm capacities.",
                  "tab:source", floatfmt="%.1f")
    tex += _latex(t3, "Calibrated seasonal availability matrix $\\alpha_{g,s}$.",
                  "tab:avail", floatfmt="%.2f")
    tex += _latex(t4, "SAED dispatch results by season (representative day).",
                  "tab:dispatch", floatfmt="%.1f")
    tex += _latex(t5, "Twin-validation error vs. historical mix (per source).",
                  "tab:valid", floatfmt="%.1f")
    with open(os.path.join(TAB, "all_tables.tex"), "w") as f:
        f.write(tex)
    for nm, t in [("t1_demand",t1),("t2_source",t2),("t3_avail",t3),
                  ("t4_dispatch",t4),("t5_validation",t5)]:
        t.to_csv(os.path.join(TAB, nm+".csv"))
    return dict(t1=t1,t2=t2,t3=t3,t4=t4,t5=t5)


# ======================================================================
def main():
    df = sc.load_clean("/mnt/user-data/uploads/PGCB_date_power_demand.xlsx")
    cal = sc.calibrate(df)
    fig_demand_profiles(cal)
    fig_dispatch_stacks(cal, year=cal.base_year)
    fig_validation(cal, df)
    fig_availability_heatmap(cal)
    fig_cost_emissions(cal)
    fig_stress(cal, years=list(range(cal.base_year, cal.base_year+6)))
    tabs = make_tables(cal, df)
    # dump calibration for the record
    calib = dict(
        base_demand=cal.base_demand, noise_sd=cal.noise_sd,
        capacity=cal.capacity, avail=cal.avail, growth=cal.growth,
        base_year=cal.base_year, merit_order=cal.merit_order,
        cost=cal.cost, emis=cal.emis,
        diurnal={s: cal.diurnal[s].tolist() for s in sc.SEASONS},
        solar_shape=cal.solar_shape.tolist())
    with open(os.path.join(OUT, "calibration.json"), "w") as f:
        json.dump(calib, f, indent=2)
    print("Figures:", sorted(os.listdir(FIG)))
    print("Tables :", sorted(os.listdir(TAB)))
    print("\nValidation (MAE MW):")
    print(tabs["t5"].round(1))

if __name__ == "__main__":
    main()
