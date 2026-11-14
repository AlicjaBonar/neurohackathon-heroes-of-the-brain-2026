"""Extract features from every SNIRF file of both datasets.

Outputs (results/):
  subjects.csv            cleaned participant tables of both datasets
  files.csv               file inventory
  features.csv            one row per recording (quality, optics, HR/HRV, respiration, motion, task metrics)
  channels.csv            one row per source-detector pair per recording
  holds_supine.csv        one row per breath hold (supine BH)
  arrays.pkl              spectra, event-locked averages, pulse templates (for plotting)

Usage:  .venv/Scripts/python scripts/01_extract_features.py [--jobs N] [--limit K]
"""
from __future__ import annotations

import argparse
import pickle
import sys
import time
import traceback
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from hob import RESULTS  # noqa: E402
from hob.features import process_file  # noqa: E402
from hob.io import list_files  # noqa: E402
from hob.subjects import load_subjects  # noqa: E402


def _work(args):
    row, age = args
    try:
        return process_file(row, age), None
    except Exception:
        return None, f"{row.path.name}: {traceback.format_exc()}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs", type=int, default=6)
    ap.add_argument("--limit", type=int, default=0, help="process only K files per dataset/task (debug)")
    a = ap.parse_args()

    RESULTS.mkdir(exist_ok=True)
    subj = pd.concat([load_subjects("dot"), load_subjects("supine")], ignore_index=True)
    subj.to_csv(RESULTS / "subjects.csv", index=False)

    files = list_files()
    if a.limit:
        files = files.groupby(["dataset", "task"]).head(a.limit)
    files.drop(columns="path").assign(file=files.path.map(lambda p: p.name)).to_csv(RESULTS / "files.csv", index=False)
    ages = subj.set_index(["dataset", "subject"]).age

    jobs = [(r, float(ages.get((r.dataset, r.subject), np.nan))) for r in files.itertuples(index=False)]
    jobs = [(pd.Series(r._asdict()), age if np.isfinite(age) else None) for r, age in jobs]

    feats, chans, arrays, holds, errors = [], [], {}, [], []
    t0 = time.time()
    with ProcessPoolExecutor(max_workers=a.jobs) as ex:
        futs = [ex.submit(_work, j) for j in jobs]
        for i, fu in enumerate(as_completed(futs), 1):
            res, err = fu.result()
            if err:
                errors.append(err); print("ERROR", err.splitlines()[0]); continue
            f, arr, ch = res
            feats.append(f)
            chans.append(ch.assign(dataset=f["dataset"], subject=f["subject"], task=f["task"], session=f["session"]))
            arrays[f["file"]] = arr
            if "hold_durations" in arr:
                for k, (on, d) in enumerate(zip(arr["holds"], arr["hold_durations"]), 1):
                    holds.append(dict(subject=f["subject"], hold=k, onset_s=on, duration_s=d))
            if i % 20 == 0 or i == len(futs):
                print(f"{i}/{len(futs)}  {time.time() - t0:.0f}s", flush=True)

    fe = pd.DataFrame(feats).sort_values(["dataset", "subject", "task", "session"])
    fe.to_csv(RESULTS / "features.csv", index=False)
    pd.concat(chans, ignore_index=True).to_csv(RESULTS / "channels.csv", index=False)
    pd.DataFrame(holds).to_csv(RESULTS / "holds_supine.csv", index=False)
    with open(RESULTS / "arrays.pkl", "wb") as fh:
        pickle.dump(arrays, fh)
    (RESULTS / "errors.txt").write_text("\n\n".join(errors), encoding="utf-8")
    print(f"done: {len(fe)} files, {len(errors)} errors, {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
