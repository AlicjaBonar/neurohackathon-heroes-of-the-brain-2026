"""Exploratory data analysis of both datasets.

Reads results/ produced by 01_extract_features.py and writes:
  results/figures/*.png      plots
  results/tables/*.csv       summary tables (descriptives, correlations)
  results/summary.json       key numbers used in EDA_REPORT.md

Usage:  .venv/Scripts/python scripts/02_explore.py
"""
from __future__ import annotations

import json
import pickle
import sys
import warnings
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import seaborn as sns  # noqa: E402
from scipy import stats  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from hob import RESULTS  # noqa: E402
from hob.io import list_files, load_snirf  # noqa: E402
from hob import signal as S  # noqa: E402

warnings.filterwarnings("ignore")
FIG = RESULTS / "figures"; FIG.mkdir(parents=True, exist_ok=True)
TAB = RESULTS / "tables"; TAB.mkdir(parents=True, exist_ok=True)
sns.set_theme(style="whitegrid", context="notebook", font_scale=0.9)
PAL = {"dot": "#3b6fb6", "supine": "#d1495b"}
SUMMARY: dict = {}

subj = pd.read_csv(RESULTS / "subjects.csv")
fe = pd.read_csv(RESULTS / "features.csv")
ch = pd.read_csv(RESULTS / "channels.csv")
holds = pd.read_csv(RESULTS / "holds_supine.csv")
with open(RESULTS / "arrays.pkl", "rb") as fh:
    ARR = pickle.load(fh)

subj["sex_m"] = (subj.sex == "M").astype(int)
fe = fe.merge(subj, on=["dataset", "subject"], how="left")
fe["label"] = fe.dataset + "-" + fe.task


def save(fig, name):
    fig.savefig(FIG / f"{name}.png", dpi=120, bbox_inches="tight")
    plt.close(fig)
    print("saved", name)


def mean_se(a, axis=0):
    a = np.asarray(a, float)
    return np.nanmean(a, axis), np.nanstd(a, axis) / np.sqrt(np.sum(np.isfinite(a), axis))


# =============================================================================== A. subjects
def subjects_overview():
    cols = [("age", "Wiek [lata]"), ("bmi", "BMI [kg/m²]"), ("height_cm", "Wzrost [cm]"),
            ("activity", "Aktywność (Jurca)"), ("fitzpatrick", "Fitzpatrick"),
            ("hair_color_name", "Kolor włosów"), ("hair_type", "Typ włosów (0-4)"),
            ("sex", "Płeć")]
    fig, axs = plt.subplots(2, 4, figsize=(18, 8))
    for ax, (c, t) in zip(axs.flat, cols):
        if subj[c].dtype == object or c in ("fitzpatrick", "activity", "hair_type"):
            d = subj.groupby(["dataset", c]).size().reset_index(name="n")
            sns.barplot(d, x=c, y="n", hue="dataset", palette=PAL, ax=ax)
        else:
            sns.histplot(subj, x=c, hue="dataset", palette=PAL, ax=ax, bins=15, element="step")
        ax.set_title(t); ax.set_xlabel("")
    fig.suptitle("Charakterystyka uczestników (DOT n=17, supine n=60)", fontsize=13)
    save(fig, "01_subjects_overview")

    desc = subj.groupby("dataset")[["age", "bmi", "height_cm", "weight_kg", "activity",
                                    "fitzpatrick", "hair_color", "head_circ_cm"]].describe().T
    desc.to_csv(TAB / "subjects_descriptives.csv")
    SUMMARY["subjects"] = {
        ds: dict(n=int(len(g)), female=int((g.sex == "F").sum()),
                 age_mean=round(g.age.mean(), 1), age_range=[int(g.age.min()), int(g.age.max())],
                 bmi_mean=round(g.bmi.mean(), 1), bmi_range=[round(g.bmi.min(), 1), round(g.bmi.max(), 1)],
                 bmi_over30=int((g.bmi >= 30).sum()), bmi_25_30=int(((g.bmi >= 25) & (g.bmi < 30)).sum()),
                 fitz_counts=g.fitzpatrick.value_counts().sort_index().to_dict(),
                 hair_counts=g.hair_color_name.value_counts().to_dict(),
                 activity_counts=g.activity.value_counts().sort_index().to_dict())
        for ds, g in subj.groupby("dataset")}

    num = ["age", "bmi", "height_cm", "weight_kg", "sex_m", "activity", "fitzpatrick",
           "hair_color", "hair_type", "hair_texture", "head_circ_cm"]
    fig, axs = plt.subplots(1, 2, figsize=(16, 6.5))
    for ax, (ds, g) in zip(axs, subj.groupby("dataset")):
        c = g[num].corr("spearman")
        sns.heatmap(c, annot=True, fmt=".2f", cmap="RdBu_r", vmin=-1, vmax=1, ax=ax, cbar=False,
                    annot_kws={"size": 7})
        ax.set_title(f"{ds}: korelacje Spearmana między cechami osób")
    save(fig, "02_subjects_correlations")


# =============================================================================== B. inventory & quality
def inventory_quality():
    fig, axs = plt.subplots(1, 3, figsize=(18, 4.5))
    sns.boxplot(fe, x="label", y="duration_s", ax=axs[0], color="#bbb")
    sns.stripplot(fe, x="label", y="duration_s", ax=axs[0], size=3, color="k")
    axs[0].set_title("Długość nagrań [s]"); axs[0].tick_params(axis="x", rotation=30)
    sns.stripplot(fe, x="label", y="missing_pct", ax=axs[1], size=4, hue="dataset", palette=PAL, legend=False)
    axs[1].set_title("Brakujące próbki [%]"); axs[1].tick_params(axis="x", rotation=30)
    sns.boxplot(fe, x="label", y="good_pct", ax=axs[2], color="#bbb")
    sns.stripplot(fe, x="label", y="good_pct", ax=axs[2], size=3, color="k")
    axs[2].set_title("Dobre kanały długie [%] (SCI≥0.7, bez przesterowania)"); axs[2].tick_params(axis="x", rotation=30)
    save(fig, "03_inventory_quality")

    inv = fe.groupby("label").agg(files=("file", "count"), dur_mean=("duration_s", "mean"),
                                  dur_min=("duration_s", "min"), dur_max=("duration_s", "max"),
                                  missing_mean=("missing_pct", "mean"), good_pct=("good_pct", "mean"),
                                  sci_median=("sci_median", "mean"), fs=("fs", "mean"))
    inv.round(2).to_csv(TAB / "inventory.csv")
    SUMMARY["inventory"] = inv.round(2).reset_index().to_dict("records")

    # SCI per channel: heatmap subject x pair (DOT RS1 / supine BS)
    fig, axs = plt.subplots(1, 2, figsize=(18, 6), gridspec_kw={"width_ratios": [3, 1]})
    for ax, (ds, task) in zip(axs, [("dot", "RS"), ("supine", "BS")]):
        c = ch[(ch.dataset == ds) & (ch.task == task) & (ch.session == 1)]
        piv = c.pivot_table(index="subject", columns="pair", values="sci")
        order = c.groupby("pair").distance_mm.mean().sort_values().index
        sns.heatmap(piv[order], cmap="viridis", vmin=0, vmax=1, ax=ax, cbar_kws={"label": "SCI"})
        ax.set_title(f"{ds} {task}: SCI per kanał (posortowane wg odległości)")
        ax.set_xticks([])
    save(fig, "04_sci_heatmap")


def optics():
    """Intensity vs distance, saturation, and optics vs skin / hair."""
    fig, axs = plt.subplots(1, 3, figsize=(18, 4.8))
    for wl, col in ((760, "#7b3294"), (850, "#e66101")):
        axs[0].scatter(ch.distance_mm, ch[f"mean_i{wl}"], s=2, alpha=0.15, color=col, label=f"{wl} nm")
    axs[0].set_yscale("log"); axs[0].set_xlabel("odległość źródło-detektor [mm]"); axs[0].set_ylabel("średnie natężenie")
    axs[0].set_title("Natężenie vs odległość (wszystkie pliki)"); axs[0].legend(markerscale=5)
    allmax = np.concatenate([ch.max_i760, ch.max_i850])
    axs[1].hist(allmax, bins=200, color="#555"); axs[1].set_yscale("log")
    axs[1].set_title("Maksimum natężenia kanału (szukamy limitu detektora)"); axs[1].set_xlabel("max I")
    for wl, col in ((760, "#7b3294"), (850, "#e66101")):
        sns.ecdfplot(ch[f"flat{wl}"], ax=axs[2], color=col, label=f"{wl} nm")
    axs[2].set_xscale("symlog", linthresh=0.01); axs[2].set_title("Frakcja próbek 'płaskich' (przesterowanie)"); axs[2].legend()
    save(fig, "05_intensity_distance_saturation")

    sat_level = float(np.nanpercentile(allmax, 99.9))
    ch["sat760"] = ch.p99_i760 >= 0.98 * sat_level
    ch["sat850"] = ch.p99_i850 >= 0.98 * sat_level
    ch["dark"] = (ch.mean_i760 <= 0.01) | (ch.mean_i850 <= 0.01)
    per = ch.groupby(["dataset", "subject", "task", "session"]).agg(
        sat760=("sat760", "mean"), sat850=("sat850", "mean"), dark=("dark", "mean"),
        bad=("good", lambda x: 1 - x.mean())).reset_index()
    SUMMARY["dark_channel_pct"] = {ds: round(100 * g.dark.mean(), 1) for ds, g in per.groupby("dataset")}
    # channel status by distance (DOT)
    d = ch[ch.dataset == "dot"].copy()
    d["dist_bin"] = pd.cut(d.distance_mm, [0, 15, 25, 32, 38, 45])
    d["status"] = np.select([d.dark, d.sat760 | d.sat850, d.good], ["ciemny", "przesterowany", "dobry"], "słaby SCI")
    tab = pd.crosstab(d.dist_bin, d.status, normalize="index") * 100
    tab.round(1).to_csv(TAB / "dot_channel_status_by_distance.csv")
    fig, ax = plt.subplots(figsize=(9, 4))
    tab.plot(kind="bar", stacked=True, ax=ax, color={"dobry": "#1a9641", "słaby SCI": "#fdae61",
                                                      "przesterowany": "#d7191c", "ciemny": "#333"})
    ax.set_ylabel("% kanałów"); ax.set_title("DOT: status kanałów wg odległości źródło-detektor [mm]")
    save(fig, "05b_dot_channel_status_by_distance")
    sup = ch[ch.dataset == "supine"].copy()
    sup["status"] = np.select([sup.dark, sup.sat760 | sup.sat850, sup.good], ["ciemny", "przesterowany", "dobry"], "słaby SCI")
    (pd.crosstab(sup.pair, sup.status, normalize="index") * 100).round(1).to_csv(TAB / "supine_channel_status_by_pair.csv")
    per_s = per.groupby(["dataset", "subject"])[["sat760", "sat850", "bad"]].mean().reset_index().merge(subj)
    SUMMARY["saturation_level"] = round(sat_level, 3)
    SUMMARY["saturated_channel_pct"] = {ds: dict(w760=round(100 * g.sat760.mean(), 1), w850=round(100 * g.sat850.mean(), 1))
                                        for ds, g in per.groupby("dataset")}

    sub = fe.groupby(["dataset", "subject"])[["ratio_760_850_long", "log_i760_long", "log_i850_long",
                                              "sci_median", "good_pct", "cardiac_amp_uM"]].mean().reset_index()
    sub = sub.merge(per_s[["dataset", "subject", "sat760", "sat850", "bad"]]).merge(subj)
    sub["hair_color_name"] = pd.Categorical(sub.hair_color_name, ["none", "grey", "blonde", "brown", "black/red"])
    ys = [("ratio_760_850_long", "I760/I850 (kanały długie)"), ("log_i850_long", "log10 I850"),
          ("sat850", "frakcja przesterowanych kanałów 850"), ("good_pct", "% dobrych kanałów"),
          ("cardiac_amp_uM", "amplituda tętna HbO [µM]")]
    fig, axs = plt.subplots(2, len(ys), figsize=(4 * len(ys), 8))
    for j, (y, t) in enumerate(ys):
        for i, x in enumerate(["fitzpatrick", "hair_color_name"]):
            ax = axs[i, j]
            sns.boxplot(sub, x=x, y=y, ax=ax, color="#ddd", showfliers=False)
            sns.stripplot(sub, x=x, y=y, hue="dataset", palette=PAL, ax=ax, size=4, legend=(i == 0 and j == 0))
            ax.set_title(t, fontsize=9); ax.set_xlabel(x)
    fig.suptitle("Optyka i jakość sygnału vs skóra (Fitzpatrick) i kolor włosów", fontsize=13)
    save(fig, "06_optics_vs_skin_hair")
    sub.to_csv(TAB / "optics_per_subject.csv", index=False)


# =============================================================================== C. signals
def example_traces():
    files = list_files()
    picks = [("dot", "SPB", 3, 1), ("dot", "BH", 3, 1), ("supine", "BH", 10, 1)]
    for ds, task, sid, sess in picks:
        row = files[(files.dataset == ds) & (files.task == task) & (files.subject == sid) & (files.session == sess)]
        if row.empty:
            continue
        r = load_snirf(row.path.iloc[0])
        fs = r.fs
        pt = r.pair_table()
        od760, od850 = S.optical_density(r.wl(760)), S.optical_density(r.wl(850))
        sci = S.scalp_coupling_index(od760, od850, fs)
        hbo, hbr = S.mbll(S.fill_nan(od760), S.fill_nan(od850), pt.distance_mm.to_numpy(), age=23)
        long_ = (pt.distance_mm > 15).to_numpy(); good = (sci > 0.8) & long_
        hb_o = S.bandpass(hbo[:, good], fs, 0.005, 0.5).mean(1); hb_r = S.bandpass(hbr[:, good], fs, 0.005, 0.5).mean(1)
        # example channel: good SCI and far from the detector ceiling (~4.99)
        mx = np.maximum(np.nanmax(r.wl(760), 0), np.nanmax(r.wl(850), 0))
        j = int(np.argmax(np.where(good & (mx < 4.0), sci, -1)))
        A = np.column_stack([r.aux[k] for k in list(r.aux)[:3]])
        accm = np.linalg.norm(S.bandpass(A, fs, 0.1, None, 2), axis=1)
        fig, axs = plt.subplots(5, 1, figsize=(16, 13), sharex=True)
        axs[0].plot(r.time, r.wl(760)[:, j], lw=0.5, color="#7b3294", label="760 nm")
        axs[0].plot(r.time, r.wl(850)[:, j], lw=0.5, color="#e66101", label="850 nm")
        axs[0].set_title(f"{row.path.iloc[0].name}: surowe natężenie, kanał {r.pairs[j]} ({pt.distance_mm.iloc[j]:.0f} mm)"); axs[0].legend(loc="upper right")
        axs[1].plot(r.time, hb_o, color="#d7191c", label="HbO"); axs[1].plot(r.time, hb_r, color="#2c7bb6", label="HbR")
        axs[1].set_title("HbO/HbR średnia dobrych kanałów długich (0.005-0.5 Hz) [µM]"); axs[1].legend(loc="upper right")
        axs[2].plot(r.time, S.bandpass(hbo[:, good], fs, 0.05, 0.6).mean(1), color="#1a9641")
        axs[2].set_title("pasmo oddechowe / Mayera 0.05-0.6 Hz (HbO)")
        axs[3].plot(r.time, S.cardiac_component(hbo, fs, good), lw=0.5, color="k")
        axs[3].set_title("składowa sercowa (0.7-3 Hz, z-score)")
        axs[4].plot(r.time, accm, lw=0.5, color="#555"); axs[4].set_title("|akcelerometr| (bez grawitacji)")
        for ax in axs:
            for _, e in r.events.iterrows():
                ax.axvline(e.onset, color="orange", lw=0.6, alpha=0.6)
        axs[0].text(0, 1.25, "pomarańczowe linie = znaczniki: " + ", ".join(sorted(r.events.code.unique())),
                    transform=axs[0].transAxes, fontsize=9)
        axs[-1].set_xlabel("czas [s]")
        save(fig, f"07_example_{ds}_{task}")

        # zoom 20 s
        fig, axs = plt.subplots(2, 1, figsize=(14, 5), sharex=True)
        z = (r.time > 60) & (r.time < 80)
        axs[0].plot(r.time[z], od760[z, j] - od760[z, j].mean(), label="OD 760"); axs[0].plot(r.time[z], od850[z, j] - od850[z, j].mean(), label="OD 850")
        axs[0].legend(); axs[0].set_title(f"Zoom 20 s, {r.pairs[j]}: widoczne tętno i oddech")
        axs[1].plot(r.time[z], A[z] - A[z].mean(0)); axs[1].set_title("akcelerometr x/y/z")
        save(fig, f"07_example_{ds}_{task}_zoom")


def spectra():
    fig, axs = plt.subplots(1, 2, figsize=(17, 5.5))
    for ax, ds in zip(axs, ["dot", "supine"]):
        for task, g in fe[fe.dataset == ds].groupby("task"):
            ps = [ARR[f]["psd_hbo"] for f in g.file if "psd_hbo" in ARR.get(f, {})]
            L = min(len(p) for p in ps)
            fq = ARR[g.file.iloc[0]]["psd_f"][:L]
            m, se = mean_se(np.array([p[:L] for p in ps]))
            ax.loglog(fq[1:], m[1:], label=f"{task} (n={len(ps)})")
            ax.fill_between(fq[1:], (m - se)[1:], (m + se)[1:], alpha=0.2)
        for b, (lo, hi) in S.BANDS.items():
            ax.axvspan(lo, hi, alpha=0.07, color="k")
            ax.text(np.sqrt(lo * hi), 0.02, b, ha="center", fontsize=8, transform=ax.get_xaxis_transform())
        ax.set_xlim(0.005, 5); ax.set_xlabel("Hz"); ax.set_ylabel("znormalizowana moc HbO")
        ax.set_title(f"{ds}: średnie widmo HbO wg zadania"); ax.legend()
    save(fig, "08_psd_by_task")

    rel = fe.melt(id_vars=["label"], value_vars=["rel_vlf", "rel_mayer", "rel_resp", "rel_cardiac"],
                  var_name="pasmo", value_name="udział")
    fig, ax = plt.subplots(figsize=(14, 4.5))
    sns.boxplot(rel, x="pasmo", y="udział", hue="label", ax=ax, showfliers=False)
    ax.set_title("Względna moc pasm HbO wg zadania")
    save(fig, "08b_band_power_by_task")


def spb_cycles():
    sp = fe[(fe.dataset == "dot") & (fe.task == "SPB")]
    cyc = [ARR[f]["spb_cycle"] for f in sp.file if "spb_cycle" in ARR[f]]
    tt = ARR[sp.file.iloc[0]]["spb_cycle_t"]
    accs = [ARR[f]["spb_cycle_acc"] for f in sp.file if "spb_cycle_acc" in ARR[f]]
    fig, axs = plt.subplots(1, 3, figsize=(18, 4.5))
    c = np.array(cyc)
    for k, (lab, col) in enumerate([("HbO", "#d7191c"), ("HbR", "#2c7bb6")]):
        m, se = mean_se(c[:, :, k]); axs[0].plot(tt, m, color=col, label=lab); axs[0].fill_between(tt, m - se, m + se, color=col, alpha=0.2)
    axs[0].axvspan(0, 4.5, color="#cde", alpha=0.4, label="wdech 4.5 s"); axs[0].axvspan(4.5, 10, color="#edc", alpha=0.4, label="wydech 5.5 s")
    axs[0].set_title(f"SPB: HbO/HbR w cyklu oddechowym (n={len(c)} plików)"); axs[0].set_xlabel("s od znacznika cyklu"); axs[0].legend(fontsize=8)
    for f in sp.file[:68]:
        if "spb_cycle" in ARR[f]:
            axs[1].plot(tt, ARR[f]["spb_cycle"][:, 0], lw=0.6, alpha=0.4)
    axs[1].set_title("SPB: HbO w cyklu - każdy plik osobno"); axs[1].set_xlabel("s")
    if accs:
        a = np.array(accs)
        for k, col in enumerate(["#1b9e77", "#d95f02", "#7570b3"]):
            m, se = mean_se(a[:, :, k] - a[:, :, k].mean(1, keepdims=True)); axs[2].plot(tt, m, color=col, label="xyz"[k])
        axs[2].set_title("SPB: akcelerometr w cyklu (średnia)"); axs[2].legend()
    save(fig, "09_spb_cycle")

    fig, axs = plt.subplots(1, 3, figsize=(17, 4.5))
    sns.histplot(sp.spb_dom_rate_bpm, bins=20, ax=axs[0]); axs[0].axvline(6, color="r"); axs[0].set_title("SPB: dominujący rytm HbO [/min] (cel 6)")
    sns.histplot(sp.spb_phase_locking, bins=20, ax=axs[1]); axs[1].set_title("SPB: synchronizacja fazy HbO z cyklem (0-1)")
    both = fe[(fe.dataset == "dot") & fe.task.isin(["RS", "SPB"])]
    sns.boxplot(both, x="task", y="rel_mayer", ax=axs[2]); axs[2].set_title("moc 0.07-0.13 Hz: RS vs SPB")
    save(fig, "09b_spb_metrics")
    rs = both.pivot_table(index=["subject", "session"], columns="task", values="rel_mayer").dropna()
    w = stats.wilcoxon(rs.SPB, rs.RS)
    SUMMARY["spb"] = dict(dom_rate_median=round(sp.spb_dom_rate_bpm.median(), 2),
                          dom_rate_within_5_7=round(100 * sp.spb_dom_rate_bpm.between(5, 7).mean(), 1),
                          phase_locking_median=round(sp.spb_phase_locking.median(), 2),
                          mayer_rel_RS=round(rs.RS.median(), 3), mayer_rel_SPB=round(rs.SPB.median(), 3),
                          wilcoxon_p=float(w.pvalue))


def breath_holds():
    fig, axs = plt.subplots(2, 3, figsize=(19, 9))
    def plot_avg(ax, key, files, title, tkey):
        arr = [ARR[f][key] for f in files if key in ARR[f]]
        if not arr:
            return
        L = min(len(a) for a in arr); a = np.array([x[:L] for x in arr]); tt = ARR[[f for f in files if key in ARR[f]][0]][tkey][:L]
        for k, (lab, col) in enumerate([("HbO", "#d7191c"), ("HbR", "#2c7bb6")]):
            m, se = mean_se(a[:, :, k]); ax.plot(tt, m, color=col, label=lab); ax.fill_between(tt, m - se, m + se, color=col, alpha=0.2)
        ax.axvline(0, color="k", ls="--"); ax.set_title(f"{title} (n={len(a)})"); ax.legend(); ax.set_xlabel("s"); ax.set_ylabel("µM")
    dbh = fe[(fe.dataset == "dot") & (fe.task == "BH")].file
    sbh = fe[(fe.dataset == "supine") & (fe.task == "BH")].file
    plot_avg(axs[0, 0], "bh_short", dbh, "DOT: krótki bezdech 10 s (onset)", "bh_short_t")
    axs[0, 0].axvspan(0, 10, color="#eee")
    plot_avg(axs[0, 1], "bh_max", dbh, "DOT: maksymalny bezdech (onset, koniec nieznany)", "bh_max_t")
    plot_avg(axs[0, 2], "bh_hold", sbh, "supine: bezdech (onset)", "bh_hold_t")
    plot_avg(axs[1, 0], "bh_end", sbh, "supine: KONIEC bezdechu (marker 1)", "bh_end_t")
    acc = [ARR[f]["bh_end_acc"] for f in sbh if "bh_end_acc" in ARR[f]]
    if acc:
        L = min(len(a) for a in acc); a = np.array([x[:L] for x in acc]); tt = np.linspace(-20, 30, L)
        m, se = mean_se(a); axs[1, 1].plot(tt, m, color="#555"); axs[1, 1].fill_between(tt, m - se, m + se, alpha=0.2, color="#555")
        axs[1, 1].axvline(0, color="k", ls="--"); axs[1, 1].set_title("supine: |akcelerometr| wokół końca bezdechu")
    acc = [ARR[f]["bh_max_acc"] for f in dbh if "bh_max_acc" in ARR[f]]
    if acc:
        L = min(len(a) for a in acc); a = np.array([x[:L] for x in acc]); tt = np.linspace(-10, 110, L)
        m, se = mean_se(a); axs[1, 2].plot(tt, m, color="#555"); axs[1, 2].fill_between(tt, m - se, m + se, alpha=0.2, color="#555")
        axs[1, 2].axvline(0, color="k", ls="--"); axs[1, 2].set_title("DOT: |akcelerometr| od startu maks. bezdechu")
    save(fig, "10_breath_hold_responses")

    h = holds.merge(subj[subj.dataset == "supine"], on="subject")
    fig, axs = plt.subplots(1, 4, figsize=(20, 4.5))
    sns.histplot(h.duration_s.dropna(), bins=30, ax=axs[0]); axs[0].set_title("supine: czas bezdechu [s] (znane końce)")
    sns.boxplot(h, x="hold", y="duration_s", ax=axs[1]); axs[1].set_title("czas wg numeru bezdechu")
    hs = h.groupby("subject").agg(dur=("duration_s", "mean")).reset_index().merge(subj[subj.dataset == "supine"])
    for ax, x in zip(axs[2:], ["age", "activity"]):
        sns.regplot(hs, x=x, y="dur", ax=ax, scatter_kws={"s": 15})
        r, p = stats.spearmanr(hs[x], hs.dur, nan_policy="omit"); ax.set_title(f"średni bezdech vs {x}: rho={r:.2f}, p={p:.3f}")
    save(fig, "11_hold_durations")
    SUMMARY["holds"] = dict(n_known=int(h.duration_s.notna().sum()), median=round(h.duration_s.median(), 1),
                            range=[round(h.duration_s.min(), 1), round(h.duration_s.max(), 1)])
    bh = fe[(fe.dataset == "supine") & (fe.task == "BH")]
    SUMMARY["hold_response"] = dict(hbo_peak_median=round(bh.hold_hbo_peak.median(), 3),
                                    tpeak_median=round(bh.hold_hbo_tpeak.median(), 1),
                                    pos_slope_pct=round(100 * (bh.hold_hbo_slope > 0).mean(), 1))
    dbhf = fe[(fe.dataset == "dot") & (fe.task == "BH")]
    SUMMARY["dot_bh"] = dict(short_peak_median=round(dbhf.short_hold_hbo_peak.median(), 3),
                             short_tpeak_median=round(dbhf.short_hold_hbo_tpeak.median(), 1),
                             max_peak_median=round(dbhf.max_hold_hbo_peak.median(), 3),
                             max_tpeak_median=round(dbhf.max_hold_hbo_tpeak.median(), 1))


def pulse_waveforms():
    s = fe[(fe.dataset == "supine") & fe.pulse_rise_ms.notna()]
    fig, axs = plt.subplots(1, 4, figsize=(21, 4.8))
    cmap = plt.get_cmap("viridis"); amin, amax = s.age.min(), s.age.max()
    for _, r in s[s.task == "BS"].iterrows():
        a = ARR[r.file]
        if len(a.get("pulse_tpl", [])):
            axs[0].plot(a["pulse_t"], a["pulse_tpl"], color=cmap((r.age - amin) / (amax - amin)), lw=1, alpha=0.7)
    sm = plt.cm.ScalarMappable(cmap=cmap, norm=plt.Normalize(amin, amax)); fig.colorbar(sm, ax=axs[0], label="wiek")
    axs[0].set_title("supine BS: średnia fala tętna (HbO, kanały długie)"); axs[0].set_xlabel("s od szczytu")
    sub = s.groupby("subject")[["pulse_rise_ms", "pulse_width50_ms", "pulse_skew", "hr_beats"]].mean().reset_index().merge(subj[subj.dataset == "supine"])
    for ax, y in zip(axs[1:], ["pulse_rise_ms", "pulse_width50_ms", "pulse_skew"]):
        sns.regplot(sub, x="age", y=y, ax=ax, scatter_kws={"s": 15}, lowess=True)
        r, p = stats.spearmanr(sub.age, sub[y], nan_policy="omit"); ax.set_title(f"{y} vs wiek: rho={r:.2f} p={p:.3f}")
    save(fig, "12_pulse_waveform")


# =============================================================================== D. physiology indices
def physiology():
    fig, axs = plt.subplots(1, 4, figsize=(21, 4.8))
    sns.scatterplot(fe, x="hr_spectral_bpm", y="hr_beats", hue="dataset", palette=PAL, ax=axs[0], s=15)
    axs[0].plot([40, 110], [40, 110], "k--"); axs[0].set_title("HR: metoda widmowa vs detekcja uderzeń")
    sns.boxplot(fe, x="label", y="hr_beats", ax=axs[1]); axs[1].tick_params(axis="x", rotation=30); axs[1].set_title("HR [bpm] wg zadania")
    sns.boxplot(fe, x="label", y="rmssd_ms", ax=axs[2], showfliers=False); axs[2].tick_params(axis="x", rotation=30); axs[2].set_title("RMSSD [ms] (fNIRS PRV)")
    sns.boxplot(fe, x="label", y="resp_rate_bpm", ax=axs[3]); axs[3].tick_params(axis="x", rotation=30); axs[3].set_title("Częstość oddechu z HbO [/min] (0.13-0.6 Hz)")
    save(fig, "13_hr_hrv_resp")
    r, p = stats.pearsonr(*fe[["hr_spectral_bpm", "hr_beats"]].dropna().T.values)
    SUMMARY["hr_agreement_r"] = round(r, 3)
    SUMMARY["hr_by_task"] = fe.groupby("label").hr_beats.median().round(1).to_dict()

    fig, axs = plt.subplots(1, 3, figsize=(17, 4.8))
    sns.scatterplot(fe, x="resp_rate_bpm", y="acc_resp_rate_bpm", hue="label", ax=axs[0], s=15)
    axs[0].plot([5, 36], [5, 36], "k--"); axs[0].set_title("Oddech: fNIRS vs akcelerometr [/min]")
    sns.boxplot(fe, x="label", y="acc_dyn_std", ax=axs[1], showfliers=False); axs[1].set_yscale("log"); axs[1].tick_params(axis="x", rotation=30); axs[1].set_title("ruch: std |acc|")
    sns.boxplot(fe, x="label", y="motion_events_per_min", ax=axs[2], showfliers=False); axs[2].tick_params(axis="x", rotation=30); axs[2].set_title("zdarzenia ruchowe / min")
    save(fig, "14_resp_motion")


def day_trends():
    d = fe[fe.dataset == "dot"].copy()
    d["clock_h"] = pd.to_datetime(d.meas_time, format="%H:%M:%S.%f", errors="coerce").dt.hour + \
        pd.to_datetime(d.meas_time, format="%H:%M:%S.%f", errors="coerce").dt.minute / 60
    ys = ["hr_beats", "rmssd_ms", "rel_mayer", "hbo_std_uM", "sci_median", "acc_dyn_std"]
    fig, axs = plt.subplots(2, 3, figsize=(18, 8))
    for ax, y in zip(axs.flat, ys):
        sns.lineplot(d[d.task == "RS"], x="session", y=y, units="subject", estimator=None, ax=ax, alpha=0.3, color="#888")
        sns.pointplot(d[d.task.isin(["RS", "SPB"])], x="session", y=y, hue="task", ax=ax, dodge=0.2, errorbar="se")
        ax.set_title(f"{y} w ciągu dnia (sesja 1-4)")
    save(fig, "15_dot_day_trends")
    rs = d[d.task == "RS"].pivot_table(index="subject", columns="session", values="hr_beats").dropna()
    fr = stats.friedmanchisquare(*[rs[c] for c in rs.columns])
    SUMMARY["dot_hr_by_session"] = {int(k): round(v, 1) for k, v in rs.median().items()}
    SUMMARY["dot_hr_session_friedman_p"] = float(fr.pvalue)
    d[["subject", "task", "session", "clock_h"] + ys].to_csv(TAB / "dot_day_trends.csv", index=False)


# =============================================================================== E. correlations
FEATS = ["hr_beats", "rmssd_ms", "sdnn_ms", "cardiac_amp_uM", "resp_rate_bpm", "rel_vlf", "rel_mayer",
         "rel_resp", "rel_cardiac", "hbo_std_uM", "hbr_std_uM", "sci_median", "good_pct",
         "log_i760_long", "log_i850_long", "ratio_760_850_long", "acc_dyn_std", "gyro_std",
         "motion_events_per_min", "spb_cycle_amp_hbo", "spb_phase_locking", "spb_power_0p1",
         "short_hold_hbo_peak", "max_hold_hbo_peak", "hold_dur_mean_s", "hold_hbo_peak",
         "hold_hbo_slope", "hold_hbo_tpeak", "pulse_rise_ms", "pulse_width50_ms", "pulse_skew",
         "short_i760", "short_i850"]
TARGETS = ["age", "bmi", "height_cm", "weight_kg", "sex_m", "activity", "fitzpatrick",
           "hair_color", "hair_type", "hair_texture", "head_circ_cm"]


def subject_level(ds):
    g = fe[fe.dataset == ds]
    out = g.groupby("subject")[[c for c in FEATS if c in g]].mean()
    return out.dropna(axis=1, how="all").reset_index().merge(subj[subj.dataset == ds], on="subject")


def correlations():
    rows = []
    for ds in ["dot", "supine"]:
        s = subject_level(ds)
        feats = [c for c in FEATS if c in s and s[c].notna().sum() >= 10]
        rho = pd.DataFrame(index=feats, columns=TARGETS, dtype=float); pv = rho.copy()
        for f in feats:
            for t in TARGETS:
                ok = s[[f, t]].dropna()
                if len(ok) >= 8 and ok[t].nunique() > 1:
                    r, p = stats.spearmanr(ok[f], ok[t])
                    rho.loc[f, t], pv.loc[f, t] = r, p
                    rows.append(dict(dataset=ds, feature=f, target=t, rho=r, p=p, n=len(ok)))
        ann = rho.round(2).astype(str) + np.where(pv < 0.01, "**", np.where(pv < 0.05, "*", ""))
        fig, ax = plt.subplots(figsize=(13, 0.38 * len(feats) + 2))
        sns.heatmap(rho.astype(float), annot=ann, fmt="", cmap="RdBu_r", vmin=-0.8, vmax=0.8, ax=ax,
                    annot_kws={"size": 7}, cbar_kws={"label": "Spearman rho"})
        ax.set_title(f"{ds} (n={len(s)} osób): cechy fNIRS (średnia po plikach) vs cechy osób   * p<.05  ** p<.01 (bez korekty)")
        save(fig, f"16_corr_features_subjects_{ds}")
    ct = pd.DataFrame(rows)
    # Benjamini-Hochberg FDR within dataset
    ct["q_fdr"] = np.nan
    for ds, g in ct.groupby("dataset"):
        p = g.p.values; o = np.argsort(p); m = len(p)
        q = np.minimum.accumulate((p[o] * m / (np.arange(m) + 1))[::-1])[::-1]
        ct.loc[g.index[o], "q_fdr"] = np.minimum(q, 1)
    ct = ct.sort_values("p")
    ct.to_csv(TAB / "correlations_features_subjects.csv", index=False)
    SUMMARY["top_correlations"] = ct.head(25).round(4).to_dict("records")
    SUMMARY["n_tests"] = int(len(ct)); SUMMARY["n_fdr_sig"] = int((ct.q_fdr < 0.05).sum())

    top = ct.drop_duplicates(["feature", "target"]).head(12)
    fig, axs = plt.subplots(3, 4, figsize=(20, 12))
    for ax, (_, r) in zip(axs.flat, top.iterrows()):
        s = subject_level(r.dataset)
        sns.regplot(s, x=r.target, y=r.feature, ax=ax, scatter_kws={"s": 18}, color=PAL[r.dataset])
        ax.set_title(f"{r.dataset}: rho={r.rho:.2f} p={r.p:.1e} q={r.q_fdr:.2f}", fontsize=9)
    save(fig, "17_top_correlations")

    # features vs features (supine, subject level)
    s = subject_level("supine")
    feats = [c for c in FEATS if c in s and s[c].notna().sum() >= 10]
    fig, ax = plt.subplots(figsize=(14, 12))
    sns.heatmap(s[feats].corr("spearman"), cmap="RdBu_r", vmin=-1, vmax=1, ax=ax)
    ax.set_title("supine: korelacje między cechami fNIRS")
    save(fig, "18_feature_intercorrelation_supine")


def crf():
    """Jurca 2005 non-exercise CRF [METs] using resting HR measured with fNIRS."""
    rows = []
    for ds, task in [("dot", "RS"), ("supine", "BS")]:
        g = fe[(fe.dataset == ds) & (fe.task == task)].groupby("subject").hr_beats.mean().reset_index()
        g = g.merge(subj[subj.dataset == ds], on="subject"); g["dataset"] = ds
        rows.append(g)
    g = pd.concat(rows)
    g["crf_mets"] = 2.77 * g.sex_m - 0.10 * g.age - 0.17 * g.bmi - 0.03 * g.hr_beats + 1.00 * g.activity + 18.07
    g["crf_no_hr"] = 2.77 * g.sex_m - 0.10 * g.age - 0.17 * g.bmi - 0.03 * 70 + 1.00 * g.activity + 18.07
    fig, axs = plt.subplots(1, 3, figsize=(17, 4.8))
    sns.histplot(g, x="crf_mets", hue="dataset", palette=PAL, ax=axs[0], bins=20); axs[0].set_title("CRF (Jurca) z HR z fNIRS [MET]")
    sns.boxplot(g, x="activity", y="hr_beats", ax=axs[1], color="#ddd"); sns.stripplot(g, x="activity", y="hr_beats", hue="dataset", palette=PAL, ax=axs[1])
    r, p = stats.spearmanr(g.activity, g.hr_beats, nan_policy="omit"); axs[1].set_title(f"HR spoczynkowe vs aktywność: rho={r:.2f} p={p:.3f}")
    sns.scatterplot(g, x="bmi", y="hr_beats", hue="dataset", palette=PAL, ax=axs[2])
    r2, p2 = stats.spearmanr(g.bmi, g.hr_beats, nan_policy="omit"); axs[2].set_title(f"HR spoczynkowe vs BMI: rho={r2:.2f} p={p2:.3f}")
    save(fig, "19_crf_jurca")
    g.to_csv(TAB / "crf_jurca.csv", index=False)
    SUMMARY["crf"] = dict(mean=round(g.crf_mets.mean(), 2), sd=round(g.crf_mets.std(), 2),
                          hr_activity_rho=round(r, 3), hr_activity_p=round(p, 4),
                          hr_bmi_rho=round(r2, 3), hr_bmi_p=round(p2, 4))


if __name__ == "__main__":
    subjects_overview()
    inventory_quality()
    optics()
    example_traces()
    spectra()
    spb_cycles()
    breath_holds()
    pulse_waveforms()
    physiology()
    day_trends()
    correlations()
    crf()
    (RESULTS / "summary.json").write_text(json.dumps(SUMMARY, indent=2, default=float, ensure_ascii=False), encoding="utf-8")
    print("summary written")
