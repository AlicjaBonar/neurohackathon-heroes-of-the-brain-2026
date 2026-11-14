"""Print the HDF5 tree of one SNIRF file from each dataset (structure sanity check).

Usage:  .venv/Scripts/python scripts/00_inspect_snirf.py
"""
import sys
from pathlib import Path

import h5py

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from hob.io import list_files  # noqa: E402


def show(path, max_ml=3):
    print(f"\n=== {path.name}")
    with h5py.File(path, "r") as f:
        def visit(name, obj):
            base = name.split("/")[-1]
            if base.startswith("measurementList"):
                n = int("".join(c for c in base if c.isdigit()) or 0)
                if n > max_ml:
                    return
            if isinstance(obj, h5py.Dataset):
                v = ""
                if obj.size <= 6:
                    v = obj[()]
                print(f"  {name:55s} {str(obj.shape):15s} {obj.dtype} {v}")
        f.visititems(visit)


if __name__ == "__main__":
    files = list_files()
    for ds, task in [("dot", "SPB"), ("dot", "BH"), ("supine", "BS"), ("supine", "BH")]:
        show(files[(files.dataset == ds) & (files.task == task)].path.iloc[0])
