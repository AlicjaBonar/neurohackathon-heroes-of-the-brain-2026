"""How much about the person can be predicted from fNIRS features?

1. Partial Spearman correlations controlling for sex (many raw effects are sex-driven).
2. Subject-wise 10-fold CV prediction of subject characteristics from fNIRS features
   (ridge / logistic regression) with permutation tests against chance.

Outputs: results/tables/partial_corr_sex.csv, results/tables/predictability.csv,
         results/figures/20_predictability.png, results/figures/21_partial_corr_supine.png,
         results/predictability.json

Usage:  .venv/Scripts/python scripts/03_predictability.py
"""
from __future__ import annotations

import json
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
from sklearn.impute import SimpleImputer  # noqa: E402
from sklearn.linear_model import LogisticRegression, RidgeCV  # noqa: E402
from sklearn.metrics import balanced_accuracy_score, mean_absolute_error, roc_auc_score  # noqa: E402
from sklearn.model_selection import KFold, cross_val_predict  # noqa: E402
from sklearn.pipeline import make_pipeline  # noqa: E402
from sklearn.preprocessing import StandardScaler  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from hob import RESULTS  # noqa: E402

warnings.filterwarnings("ignore")
FIG = RESULTS / "figures"; TAB = RESULTS / "tables"
rng = np.random.default_rng(0)
N_PERM = 100
CV = KFold(10, shuffle=True, random_state=0)   # rows are subjects -> subject-wise CV

FEATS = {
    "optyka": ["log_i760_long", "log_i850_long", "ratio_760_850_long", "short_i760", "short_i850",
               "sci_median", "good_pct"],
    "serce": ["hr_beats", "rmssd_ms", "sdnn_ms", "cardiac_amp_uM", "pulse_rise_ms",
              "pulse_width50_ms", "pulse_skew"],
    "oddech/naczynia": ["resp_rate_bpm", "rel_vlf", "rel_mayer", "rel_resp", "rel_cardiac",
                        "hbo_std_uM", "hbr_std_uM", "hold_dur_mean_s", "hold_hbo_peak",
                        "hold_hbo_slope", "hold_hbo_tpeak", "spb_cycle_amp_hbo", "spb_phase_locking",
                        "short_hold_hbo_peak", "max_hold_hbo_peak"],
    "ruch": ["acc_dyn_std", "gyro_std", "motion_events_per_min"],
}
ALL = sum(FEATS.values(), [])

subj = pd.read_csv(RESULTS / "subjects.csv")
subj["sex_m"] = (subj.sex == "M").astype(int)
subj["high_activity"] = (subj.activity >= 3.03).astype(int)
subj["dark_hair"] = subj.hair_color.isin([3, 4]).astype(int)        # brown / black vs blonde/grey/none
subj["fitz_3plus"] = (subj.fitzpatrick >= 3).astype(int)
subj["bmi_25plus"] = (subj.bmi >= 25).astype(int)
fe = pd.read_csv(RESULTS / "features.csv")


def subject_table(ds):
    g = fe[fe.dataset == ds]
    s = g.groupby("subject")[[c for c in ALL if c in g]].mean().dropna(axis=1, how="all").reset_index()
    return s.merge(subj[subj.dataset == ds], on="subject")


# ------------------------------------------------------------------ partial correlations
def partial_corr():
    rows = []
    targets = ["age", "bmi", "height_cm", "activity", "fitzpatrick", "hair_color", "hair_texture"]
    for ds in ["supine", "dot"]:
        s = subject_table(ds)
        feats = [c for c in ALL if c in s and s[c].notna().sum() >= 10]
        rk = s[feats + targets + ["sex_m"]].rank()
        for f in feats:
            for t in targets:
                d = rk[[f, t, "sex_m"]].dropna()
                if len(d) < 10 or d[t].nunique() < 2:
                    continue
                X = np.column_stack([np.ones(len(d)), d.sex_m])
                rf = d[f] - X @ np.linalg.lstsq(X, d[f], rcond=None)[0]
                rt = d[t] - X @ np.linalg.lstsq(X, d[t], rcond=None)[0]
                r, p = stats.pearsonr(rf, rt)
                rows.append(dict(dataset=ds, feature=f, target=t, partial_rho=r, p=p, n=len(d)))
    pc = pd.DataFrame(rows)
    pc["q_fdr"] = np.nan
    for ds, g in pc.groupby("dataset"):
        p = g.p.values; o = np.argsort(p); m = len(p)
        q = np.minimum.accumulate((p[o] * m / (np.arange(m) + 1))[::-1])[::-1]
        pc.loc[g.index[o], "q_fdr"] = np.minimum(q, 1)
    pc = pc.sort_values("p")
    pc.to_csv(TAB / "partial_corr_sex.csv", index=False)

    s = pc[pc.dataset == "supine"].pivot(index="feature", columns="target", values="partial_rho")
    q = pc[pc.dataset == "supine"].pivot(index="feature", columns="target", values="p")
    ann = s.round(2).astype(str) + np.where(q < 0.01, "**", np.where(q < 0.05, "*", ""))
    fig, ax = plt.subplots(figsize=(10, 0.36 * len(s) + 2))
    sns.heatmap(s, annot=ann, fmt="", cmap="RdBu_r", vmin=-0.6, vmax=0.6, ax=ax, annot_kws={"size": 7})
    ax.set_title("supine (n=60): korelacje cząstkowe Spearmana, kontrola płci  * p<.05 ** p<.01")
    fig.savefig(FIG / "21_partial_corr_supine.png", dpi=120, bbox_inches="tight"); plt.close(fig)
    return pc


# ------------------------------------------------------------------ subject-wise CV prediction
def _reg_model():
    return make_pipeline(SimpleImputer(strategy="median"), StandardScaler(), RidgeCV(alphas=np.logspace(-1, 3, 8)))


def _clf_model():
    return make_pipeline(SimpleImputer(strategy="median"), StandardScaler(),
                         LogisticRegression(C=0.3, class_weight="balanced", max_iter=2000))


def evaluate(s, feats, target, kind):
    d = s[feats + [target]].dropna(subset=[target])
    X, y = d[feats].to_numpy(float), d[target].to_numpy()
    if kind == "reg":
        pred = cross_val_predict(_reg_model(), X, y, cv=CV)
        score = lambda yy, pp: -mean_absolute_error(yy, pp)  # noqa: E731
        sc = score(y, pred)
        base = -mean_absolute_error(y, np.array([np.mean(np.delete(y, i)) for i in range(len(y))]))
        null = [score(yp, cross_val_predict(_reg_model(), X, yp, cv=CV))
                for yp in (rng.permutation(y) for _ in range(N_PERM))]
        rho = stats.spearmanr(y, pred)[0]
        return dict(metric="MAE", model=-sc, baseline=-base, spearman_pred_true=rho,
                    p_perm=(1 + np.sum(np.array(null) >= sc)) / (N_PERM + 1), n=len(y))
    pred = cross_val_predict(_clf_model(), X, y, cv=CV, method="predict_proba")[:, 1]
    sc = balanced_accuracy_score(y, pred > 0.5)
    auc = roc_auc_score(y, pred)
    null = []
    for _ in range(N_PERM):
        yp = rng.permutation(y)
        pp = cross_val_predict(_clf_model(), X, yp, cv=CV, method="predict_proba")[:, 1]
        null.append(roc_auc_score(yp, pp))
    return dict(metric="AUC", model=auc, baseline=0.5, balanced_acc=sc,
                p_perm=(1 + np.sum(np.array(null) >= auc)) / (N_PERM + 1), n=len(y),
                minority=int(min(y.sum(), len(y) - y.sum())))


def predictability():
    tasks = [("age", "reg"), ("bmi", "reg"), ("activity", "reg"), ("fitzpatrick", "reg"),
             ("sex_m", "clf"), ("high_activity", "clf"), ("dark_hair", "clf"),
             ("fitz_3plus", "clf"), ("bmi_25plus", "clf")]
    rows = []
    for ds in ["supine", "dot"]:
        s = subject_table(ds)
        for group in ["wszystkie"] + list(FEATS):
            feats = [c for c in (ALL if group == "wszystkie" else FEATS[group]) if c in s and s[c].notna().sum() >= 10]
            for target, kind in tasks:
                if s[target].nunique() < 2 or (kind == "clf" and s[target].value_counts().min() < 3):
                    continue
                r = evaluate(s, feats, target, kind)
                rows.append(dict(dataset=ds, features=group, target=target, **r))
                print(ds, group, target, {k: (round(v, 3) if isinstance(v, float) else v) for k, v in r.items()})
    res = pd.DataFrame(rows)
    res.to_csv(TAB / "predictability.csv", index=False)

    s = res[(res.dataset == "supine")]
    fig, axs = plt.subplots(1, 2, figsize=(17, 5))
    c = s[s.metric == "AUC"].pivot(index="target", columns="features", values="model")
    p = s[s.metric == "AUC"].pivot(index="target", columns="features", values="p_perm")
    sns.heatmap(c, annot=c.round(2).astype(str) + np.where(p < 0.05, "*", ""), fmt="", cmap="RdYlGn",
                vmin=0.3, vmax=0.9, ax=axs[0])
    axs[0].set_title("supine: klasyfikacja CV10, AUC (0.5 = losowo)  * p_perm<.05")
    s2 = s[s.metric == "MAE"].copy(); s2["gain_pct"] = 100 * (1 - s2.model / s2.baseline)
    c = s2.pivot(index="target", columns="features", values="gain_pct")
    p = s2.pivot(index="target", columns="features", values="p_perm")
    sns.heatmap(c, annot=c.round(0).astype(int).astype(str) + "%" + np.where(p < 0.05, "*", ""), fmt="",
                cmap="RdYlGn", vmin=-30, vmax=30, ax=axs[1])
    axs[1].set_title("supine: regresja CV10, poprawa MAE vs średnia [%]  * p_perm<.05")
    fig.savefig(FIG / "20_predictability.png", dpi=120, bbox_inches="tight"); plt.close(fig)
    return res


if __name__ == "__main__":
    pc = partial_corr()
    res = predictability()
    out = dict(
        partial_top=pc.head(20).round(4).to_dict("records"),
        partial_fdr_sig=int((pc.q_fdr < 0.05).sum()),
        prediction=res.round(4).to_dict("records"),
    )
    (RESULTS / "predictability.json").write_text(json.dumps(out, indent=2, default=float, ensure_ascii=False), encoding="utf-8")
    print("done")
