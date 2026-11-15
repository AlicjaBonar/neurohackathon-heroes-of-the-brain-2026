"""Standard processing built on the libraries recommended in the infopack.

fNIRS (MNE-Python):  read_raw_snirf -> optical_density -> scalp_coupling_index
                     -> temporal_derivative_distribution_repair (TDDR) -> beer_lambert_law
                     (age-dependent DPF per wavelength, Scholkmann & Wolf 2013)
Heart (NeuroKit2):   ppg_clean + ppg_peaks (Elgendi, artifact correction) on the pooled HbO pulse,
                     hrv_time for RMSSD / SDNN
Breathing (NeuroKit2): rsp_rate (trough method) on the HbO respiratory band

What the libraries do not provide stays in hob.io / hob.signal: accelerometer and gyroscope,
missing-sample flags, detector saturation / dark channels, 2D/3D probe geometry.
"""
from __future__ import annotations

import warnings
from dataclasses import dataclass

import mne
import neurokit2 as nk
import numpy as np

from . import signal as S
from .io import Recording

mne.set_log_level("error")
NK_FS = 100.0              # NeuroKit2 peak detection needs >= ~100 Hz for precise beat timing


@dataclass
class Hemo:
    fs: float
    pairs: list[str]            # order of the columns below (= order of rec.pairs)
    distance_mm: np.ndarray
    sci: np.ndarray             # MNE scalp coupling index per pair
    hbo: np.ndarray             # (n_samples, n_pairs) concentration change [uM], after TDDR
    hbr: np.ndarray


def hemo(rec: Recording, age: float | None = None, tddr: bool = True) -> Hemo:
    """Raw intensity -> HbO/HbR with MNE. Columns follow rec.pairs."""
    raw = mne.io.read_raw_snirf(rec.path, preload=True)
    data = raw._data
    if rec.missing is not None and rec.missing.any():          # flagged samples: linear interpolation
        m = rec.missing[: data.shape[1]]
        ok = np.where(~m)[0]
        for i in range(data.shape[0]):
            data[i, m] = np.interp(np.where(m)[0], ok, data[i, ok])
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")                         # negative intensities of dark channels
        od = mne.preprocessing.nirs.optical_density(raw)
        sci_ch = mne.preprocessing.nirs.scalp_coupling_index(od)
        if tddr:
            od = mne.preprocessing.nirs.temporal_derivative_distribution_repair(od)
        ppf = (S.dpf_scholkmann(760, age), S.dpf_scholkmann(850, age)) if age else 6.0
        hb = mne.preprocessing.nirs.beer_lambert_law(od, ppf=ppf)

    sci_by_pair = {n.split()[0]: v for n, v in zip(od.ch_names, sci_ch)}
    hbo_raw, hbr_raw = hb.copy().pick("hbo"), hb.copy().pick("hbr")
    io = {n.split()[0]: i for i, n in enumerate(hbo_raw.ch_names)}
    ir = {n.split()[0]: i for i, n in enumerate(hbr_raw.ch_names)}
    dist = mne.preprocessing.nirs.source_detector_distances(hbo_raw.info) * 1000.0
    cols_o = [io[p] for p in rec.pairs]
    cols_r = [ir[p] for p in rec.pairs]
    return Hemo(
        fs=float(raw.info["sfreq"]), pairs=list(rec.pairs), distance_mm=dist[cols_o],
        sci=np.array([sci_by_pair[p] for p in rec.pairs]),
        hbo=hbo_raw.get_data()[cols_o].T * 1e6 * HB_SCALE,
        hbr=hbr_raw.get_data()[cols_r].T * 1e6 * HB_SCALE,
    )


# Cross-check (scripts/04_crosscheck_cedalion.py, 367 channels / 8 files): MNE and Cedalion (Prahl
# spectrum) agree to 0.02 % in amplitude and r = 1.0000 in shape, so no rescaling is applied.
# (The earlier hand-written MBLL in hob.signal.mbll was ~2.3x too small and is no longer used.)
HB_SCALE = 1.0


# ----------------------------------------------------------------------------- NeuroKit2

def _to_nk_rate(x: np.ndarray, fs: float) -> tuple[np.ndarray, float]:
    if fs >= NK_FS:
        return np.asarray(x, float), fs
    t = np.arange(len(x)) / fs
    return np.interp(np.arange(0, t[-1], 1 / NK_FS), t, x), NK_FS


def pulse_signal(hbo: np.ndarray, fs: float, good: np.ndarray | None = None) -> tuple[np.ndarray, float]:
    """Pooled HbO pulse (z-scored good channels), cleaned with NeuroKit2 ppg_clean; returned at >= 100 Hz."""
    x = hbo if good is None or good.sum() == 0 else hbo[:, good]
    x = S.fill_nan(x)
    x = (x - x.mean(0)) / (x.std(0) + 1e-12)
    pooled, fs_nk = _to_nk_rate(x.mean(1), fs)
    return nk.ppg_clean(pooled, sampling_rate=fs_nk, method="elgendi"), fs_nk


def beats(hbo: np.ndarray, fs: float, good: np.ndarray | None = None) -> np.ndarray:
    """Heartbeat times [s] (NeuroKit2 Elgendi peaks with artifact correction)."""
    clean, fs_nk = pulse_signal(hbo, fs, good)
    try:
        _, info = nk.ppg_peaks(clean, sampling_rate=fs_nk, method="elgendi", correct_artifacts=True)
    except Exception:
        return np.array([])
    return np.asarray(info["PPG_Peaks"], float) / fs_nk


def hrv(beat_times: np.ndarray) -> dict:
    """HR and time-domain HRV from beat times (NeuroKit2 hrv_time)."""
    out = dict(hr_beats=np.nan, rmssd_ms=np.nan, sdnn_ms=np.nan)
    if len(beat_times) < 10:
        return out
    peaks = np.round(np.asarray(beat_times) * 1000).astype(int)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            h = nk.hrv_time(peaks, sampling_rate=1000)
    except Exception:
        return out
    return dict(hr_beats=60000.0 / float(h["HRV_MeanNN"].iloc[0]), rmssd_ms=float(h["HRV_RMSSD"].iloc[0]),
                sdnn_ms=float(h["HRV_SDNN"].iloc[0]))


def resp_rate(x: np.ndarray, fs: float) -> float:
    """Breathing rate [breaths/min] from a respiratory-band signal (NeuroKit2 rsp_rate, trough method)."""
    if len(x) < 20 * fs:
        return np.nan
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            r = nk.rsp_rate(np.asarray(x, float), sampling_rate=fs, method="trough")
            if not np.isfinite(r).any():
                # Short windows (e.g. 60 s live) give all-NaN on the raw band; cleaning first fixes it.
                r = nk.rsp_rate(nk.rsp_clean(np.asarray(x, float), sampling_rate=fs), sampling_rate=fs, method="trough")
    except Exception:
        return np.nan
    r = r[np.isfinite(r)]
    return float(np.median(r)) if r.size else np.nan
