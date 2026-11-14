"""Cross-check of the fNIRS conversion: MNE-Python vs Cedalion vs a manual Prahl implementation.

Runs in a separate Cedalion environment kept OUTSIDE the repository (Cedalion pins older
pandas/MNE than the main .venv and its install has ~10k files):
    py -3.12 -m venv %USERPROFILE%/.venvs/hob-cedalion
    %USERPROFILE%/.venvs/hob-cedalion/Scripts/python -m pip install cedalion
    %USERPROFILE%/.venvs/hob-cedalion/Scripts/python scripts/04_crosscheck_cedalion.py [--n 6]

For each file and each good long channel it compares HbO/HbR time courses (correlation, amplitude
ratio) of: MNE beer_lambert_law, Cedalion od2conc with the Prahl spectrum, and hob.signal.mbll
(Prahl table, written by hand). Also compares SCI (MNE vs Cedalion) and TDDR (MNE vs Cedalion).
Output: results/tables/crosscheck_libraries.csv
"""
from __future__ import annotations

import argparse
import importlib.metadata
import sys
import warnings
from pathlib import Path

import mne
import numpy as np
import pandas as pd
import xarray as xr

import cedalion
import cedalion.io
import cedalion.nirs
import cedalion.sigproc.motion_correct as mc
import cedalion.sigproc.quality as quality
from cedalion import units

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from hob import signal as S  # noqa: E402
from hob.io import list_files, load_snirf  # noqa: E402

warnings.filterwarnings("ignore")
mne.set_log_level("error")
AGE = 23.0


def r_and_ratio(a: np.ndarray, b: np.ndarray, fs: float) -> tuple[float, float]:
    a = S.bandpass(a, fs, 0.01, 0.5)
    b = S.bandpass(b, fs, 0.01, 0.5)
    return float(np.corrcoef(a, b)[0, 1]), float(np.std(a) / (np.std(b) + 1e-30))


def run_file(path: Path) -> list[dict]:
    rec = load_snirf(path)
    fs = rec.fs
    pairs = rec.pairs
    dpf = (S.dpf_scholkmann(760, AGE), S.dpf_scholkmann(850, AGE))

    # --- manual (Prahl, log10)
    od7, od8 = S.optical_density(rec.wl(760)), S.optical_density(rec.wl(850))
    man_o, man_r = S.mbll(S.fill_nan(od7), S.fill_nan(od8), rec.pair_table().distance_mm.to_numpy(), age=AGE)

    # --- MNE
    raw = mne.io.read_raw_snirf(path, preload=True)
    od = mne.preprocessing.nirs.optical_density(raw)
    sci_mne = {n.split()[0]: v for n, v in zip(od.ch_names, mne.preprocessing.nirs.scalp_coupling_index(od))}
    od_tddr = mne.preprocessing.nirs.temporal_derivative_distribution_repair(od.copy())
    hb = mne.preprocessing.nirs.beer_lambert_law(od, ppf=dpf)
    mo = {n.split()[0]: x * 1e6 for n, x in zip(hb.copy().pick("hbo").ch_names, hb.copy().pick("hbo").get_data())}
    mr = {n.split()[0]: x * 1e6 for n, x in zip(hb.copy().pick("hbr").ch_names, hb.copy().pick("hbr").get_data())}
    od_mne = {n: x for n, x in zip(od.ch_names, od.get_data())}
    od_mne_t = {n: x for n, x in zip(od_tddr.ch_names, od_tddr.get_data())}

    # --- Cedalion
    crec = cedalion.io.read_snirf(str(path))[0]
    amp = crec["amp"].pint.dequantify()
    dark = (amp <= 0).any(["wavelength", "time"])          # dark channels (no light) - excluded anyway
    amp = amp.sel(channel=~dark).pint.quantify("V")
    c_od = cedalion.nirs.int2od(amp)
    dpf_x = xr.DataArray(list(dpf), dims="wavelength", coords={"wavelength": amp.wavelength.values})
    conc = cedalion.nirs.od2conc(c_od, crec.geo3d, dpf_x, spectrum="prahl").pint.to("micromolar").pint.dequantify()
    sci_c, _ = quality.sci(amp, 5 * units.s, sci_thresh=0.7)
    sci_c = sci_c.pint.dequantify() if hasattr(sci_c, "pint") else sci_c
    sci_c = sci_c.where(np.isfinite(sci_c)).median("time")    # windowed SCI -> one value per channel
    c_od_t = mc.tddr(c_od).pint.dequantify()
    c_od = c_od.pint.dequantify()

    rows = []
    for k, p in enumerate(pairs):
        ch = p.replace("_", "")                          # Cedalion names channels 'S1D1'
        if p not in mo or ch not in conc.channel.values:
            continue
        good = sci_mne[p] > 0.8 and rec.pair_table().distance_mm.iloc[k] > 15 and np.nanmax(rec.wl(850)[:, k]) < 4.9
        if not good:
            continue
        ced_o = conc.sel(channel=ch, chromo="HbO").values
        ced_r = conc.sel(channel=ch, chromo="HbR").values
        n = min(len(ced_o), len(mo[p]), len(man_o))
        row = dict(file=path.name, pair=p)
        for name, a, b in [("cedalion_vs_manual_HbO", ced_o, man_o[:, k]), ("cedalion_vs_manual_HbR", ced_r, man_r[:, k]),
                           ("mne_vs_cedalion_HbO", mo[p], ced_o), ("mne_vs_cedalion_HbR", mr[p], ced_r),
                           ("mne_vs_manual_HbO", mo[p], man_o[:, k])]:
            r, ratio = r_and_ratio(a[:n], b[:n], fs)
            row[f"{name}_r"], row[f"{name}_ratio"] = r, ratio
        w = amp.wavelength.values[1]                     # 850 nm (float in Cedalion, int in MNE names)
        r, _ = r_and_ratio(od_mne_t[f"{p} {int(w)}"][:n], c_od_t.sel(channel=ch, wavelength=w).values[:n], fs)
        row["tddr_mne_vs_cedalion_r"] = r
        r, _ = r_and_ratio(od_mne[f"{p} {int(w)}"][:n], c_od.sel(channel=ch, wavelength=w).values[:n], fs)
        row["od_mne_vs_cedalion_r"] = r
        row["sci_mne"], row["sci_cedalion"] = sci_mne[p], float(sci_c.sel(channel=ch).values)
        rows.append(row)
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=6, help="files per dataset")
    a = ap.parse_args()
    files = list_files()
    picks = pd.concat([files[files.dataset == "dot"].sample(a.n, random_state=0),
                       files[files.dataset == "supine"].sample(a.n, random_state=0)])
    rows = []
    for p in picks.path:
        print("processing", p.name, flush=True)
        rows += run_file(p)
    df = pd.DataFrame(rows)
    out = ROOT / "results" / "tables" / "crosscheck_libraries.csv"
    df.to_csv(out, index=False)
    num = df.drop(columns=["file", "pair"])
    summary = num.median().round(4)
    summary["sci_corr_mne_vs_cedalion"] = round(float(np.corrcoef(df.sci_mne, df.sci_cedalion)[0, 1]), 4)
    print(f"\n{len(df)} good long channels from {len(picks)} files (cedalion {importlib.metadata.version("cedalion")}, mne {mne.__version__})")
    print(summary.to_string())


if __name__ == "__main__":
    main()
