"""SNIRF loading (h5py) and file discovery for both datasets.

`load_snirf` returns a `Recording` with raw intensity, channel table,
events, aux (accelerometer + gyroscope), probe geometry and metadata.
For MNE-based processing use `mne.io.read_raw_snirf(path)` directly.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import h5py
import numpy as np
import pandas as pd

from . import DOT_DIR, SUP_DIR


def _s(v) -> str:
    v = v[()] if isinstance(v, h5py.Dataset) else v
    if isinstance(v, np.ndarray):
        v = v.item() if v.size == 1 else v[0]
    return v.decode() if isinstance(v, bytes) else str(v)


@dataclass
class Recording:
    path: Path
    fs: float
    time: np.ndarray                    # (n_samples,)
    intensity: np.ndarray               # (n_samples, n_channels) raw CW intensity
    channels: pd.DataFrame              # source, detector, wavelength, distance_mm, pair
    events: pd.DataFrame                # onset [s], code (str)
    aux: dict = field(default_factory=dict)       # name -> (n_samples,) array
    aux_time: np.ndarray | None = None
    meta: dict = field(default_factory=dict)
    missing: np.ndarray | None = None   # bool mask of flagged missing samples
    src_pos: np.ndarray | None = None   # (n_src, 3)
    det_pos: np.ndarray | None = None   # (n_det, 3)
    landmarks: pd.DataFrame | None = None

    @property
    def duration(self) -> float:
        return float(self.time[-1] - self.time[0])

    @property
    def pairs(self) -> list[str]:
        return list(dict.fromkeys(self.channels.pair))

    def wl(self, wavelength: int) -> np.ndarray:
        """Intensity matrix (n_samples, n_pairs) for one wavelength, ordered as `pairs`."""
        ch = self.channels
        idx = [ch.index[(ch.pair == p) & (ch.wavelength == wavelength)][0] for p in self.pairs]
        return self.intensity[:, idx]

    def pair_table(self) -> pd.DataFrame:
        return (self.channels.drop_duplicates("pair")
                .set_index("pair")[["source", "detector", "distance_mm"]]
                .loc[self.pairs])


def load_snirf(path: str | Path, load_aux: bool = True, load_data: bool = True) -> Recording:
    """`load_data=False` skips the (large) intensity matrix: `intensity` is then empty (0, n_channels),
    for callers that only need the channel table, probe geometry, events and metadata."""
    path = Path(path)
    with h5py.File(path, "r") as f:
        nirs = f["nirs"]
        d = nirs["data1"]
        ts = d["dataTimeSeries"]
        n_samples = ts.shape[0]
        data = ts[()].astype(np.float64) if load_data else np.empty((0, ts.shape[1]))
        t = d["time"][()].ravel().astype(np.float64)
        if t.size == 2 and n_samples > 2:          # [start, step] form
            t = t[0] + np.arange(n_samples) * t[1]
        fs = 1.0 / np.median(np.diff(t))

        probe = nirs["probe"]
        wls = probe["wavelengths"][()].ravel()
        unit = _s(nirs["metaDataTags"]["LengthUnit"]) if "LengthUnit" in nirs["metaDataTags"] else "mm"
        scale = {"m": 1000.0, "cm": 10.0, "mm": 1.0}.get(unit, 1.0)
        key = "sourcePos3D" if "sourcePos3D" in probe else "sourcePos2D"
        src = probe[key][()] * scale
        det = probe[key.replace("source", "detector")][()] * scale

        rows = []
        ml_keys = sorted((k for k in d if k.startswith("measurementList")),
                         key=lambda k: int(re.sub(r"\D", "", k) or 0))
        for k in ml_keys:
            m = d[k]
            s = int(m["sourceIndex"][()]); de = int(m["detectorIndex"][()])
            w = int(wls[int(m["wavelengthIndex"][()]) - 1])
            dist = float(np.linalg.norm(src[s - 1, :3] - det[de - 1, :3]))
            rows.append(dict(source=s, detector=de, wavelength=w,
                             distance_mm=dist, pair=f"S{s}_D{de}"))
        channels = pd.DataFrame(rows)

        ev = []
        for k in nirs:
            if k.startswith("stim"):
                name = _s(nirs[k]["name"])
                sd = nirs[k]["data"][()]
                sd = np.atleast_2d(sd)
                for r in sd:
                    if r.size:
                        ev.append(dict(onset=float(r[0]), code=name))
        events = pd.DataFrame(ev, columns=["onset", "code"]).sort_values("onset", ignore_index=True)

        aux, aux_t = {}, None
        if load_aux:
            for k in sorted((k for k in nirs if k.startswith("aux")),
                            key=lambda k: int(re.sub(r"\D", "", k))):
                a = nirs[k]
                aux[_s(a["name"]) if "name" in a else k] = a["dataTimeSeries"][()].ravel().astype(np.float64)
                if aux_t is None and "time" in a:
                    aux_t = a["time"][()].ravel().astype(np.float64)

        meta, missing = {}, None
        for k, v in nirs["metaDataTags"].items():
            if k == "missing_sample":
                missing = np.asarray(v[()]).ravel()
            else:
                try:
                    meta[k] = _s(v)
                except Exception:
                    meta[k] = None

        lm = None
        if "landmarkLabels" in probe:
            lp = "landmarkPos3D" if "landmarkPos3D" in probe else "landmarkPos2D"
            lab = [_s(x) for x in probe["landmarkLabels"][()]]
            lm = pd.DataFrame(probe[lp][()][:, :3] * scale, columns=["x", "y", "z"][: probe[lp].shape[1]])
            lm.insert(0, "label", lab)

    if missing is not None:
        missing = _missing_mask(missing, len(t))

    return Recording(path=path, fs=float(fs), time=t, intensity=data, channels=channels,
                     events=events, aux=aux, aux_time=aux_t, meta=meta, missing=missing,
                     src_pos=src, det_pos=det, landmarks=lm)


def _missing_mask(v: np.ndarray, n: int) -> np.ndarray:
    """metaDataTags/missing_sample may be a 0/1 mask or a list of indices."""
    v = np.asarray(v)
    if v.size == n and set(np.unique(v)).issubset({0, 1}):
        return v.astype(bool)
    mask = np.zeros(n, bool)
    idx = v.astype(int)
    idx = idx[(idx >= 0) & (idx < n)]
    mask[idx] = True
    return mask


# --------------------------------------------------------------------------- file discovery

_DOT_RE = re.compile(r"^(?P<sub>\d+)_(?P<ini>[A-Z]+)_(?P<task>RS|SPB|BH)(?P<sess>\d)\.snirf$")
_SUP_BS_RE = re.compile(r"^(?P<sub>\d+)_(?P<ini>[A-Z]+)_BS_(?P<dt>[\d-]+)\.snirf$")
_SUP_BH_RE = re.compile(r"^Breath holding_V2_(?P<sub>\d+)_(?P<ini>[A-Z]+)_(?:BH2?|BS)_(?P<dt>[\d-]+)\.snirf$")


def list_dot_files() -> pd.DataFrame:
    rows = []
    for p in sorted((DOT_DIR / "data").glob("*/*.snirf")):
        m = _DOT_RE.match(p.name)
        if not m:
            raise ValueError(f"Unexpected DOT file name: {p.name}")
        rows.append(dict(dataset="dot", subject=int(m["sub"]), initials=m["ini"],
                         task=m["task"], session=int(m["sess"]), path=p))
    return pd.DataFrame(rows)


def list_supine_files() -> pd.DataFrame:
    rows = []
    for p in sorted((SUP_DIR / "data" / "baseline").glob("*.snirf")):
        m = _SUP_BS_RE.match(p.name)
        if not m:
            raise ValueError(f"Unexpected baseline file name: {p.name}")
        rows.append(dict(dataset="supine", subject=int(m["sub"]), initials=m["ini"],
                         task="BS", session=1, path=p, start=m["dt"]))
    for p in sorted((SUP_DIR / "data" / "BH").glob("*.snirf")):
        m = _SUP_BH_RE.match(p.name)
        if not m:
            raise ValueError(f"Unexpected BH file name: {p.name}")
        rows.append(dict(dataset="supine", subject=int(m["sub"]), initials=m["ini"],
                         task="BH", session=1, path=p, start=m["dt"]))
    df = pd.DataFrame(rows)
    df["start"] = pd.to_datetime(df.start, format="%Y-%m-%d-%H-%M-%S")
    return df


def list_files(dataset: str | None = None) -> pd.DataFrame:
    if dataset == "dot":
        return list_dot_files()
    if dataset == "supine":
        return list_supine_files()
    return pd.concat([list_dot_files(), list_supine_files()], ignore_index=True)
