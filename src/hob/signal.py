"""Signal processing for CW-fNIRS: OD, MBLL, quality, spectra, HR, respiration, motion."""

from __future__ import annotations

import numpy as np
from scipy import signal as ss

# Molar extinction coefficients [cm^-1 / M], base-10 (Prahl, omlc.org) - same table as MNE/Homer
EXT = {
    760: (1486.5865, 3843.707),   # (HbO, HbR)
    850: (2526.391, 1798.643),
}

BANDS = {
    "vlf": (0.01, 0.05),      # vasomotion / slow drifts
    "mayer": (0.07, 0.13),    # Mayer waves (~0.1 Hz), also SPB breathing at 6/min
    "resp": (0.13, 0.6),      # spontaneous respiration (8-36 breaths/min)
    "cardiac": (0.7, 2.5),    # 42-150 bpm
}


# --------------------------------------------------------------------------- conversion

def optical_density(intensity: np.ndarray) -> np.ndarray:
    """OD = -log10(I / mean(I)), per column. Non-positive samples become NaN."""
    I = np.where(intensity > 0, intensity, np.nan)
    return -np.log10(I / np.nanmean(I, axis=0, keepdims=True))


def dpf_scholkmann(wavelength_nm: float, age: float) -> float:
    """Age- and wavelength-dependent DPF (Scholkmann & Wolf 2013)."""
    l = wavelength_nm
    return (223.3 + 0.05624 * age ** 0.8493 - 5.723e-7 * l ** 3
            + 0.001245 * l ** 2 - 0.9025 * l)


def mbll(od760: np.ndarray, od850: np.ndarray, distance_mm: np.ndarray,
         age: float | None = None, ppf: float = 6.0) -> tuple[np.ndarray, np.ndarray]:
    """Modified Beer-Lambert law -> (HbO, HbR) concentration changes in micromolar.

    DEPRECATED: gives values ~2.3x smaller than MNE-Python and Cedalion (which agree with each
    other); use hob.pipeline.hemo. Kept only for scripts/04_crosscheck_cedalion.py.

    od760/od850: (n_samples, n_pairs); distance_mm: (n_pairs,).
    If age is given an age-dependent DPF is used, otherwise a constant `ppf`.
    """
    dpf = np.array([dpf_scholkmann(760, age), dpf_scholkmann(850, age)]) if age else np.array([ppf, ppf])
    E = np.array([EXT[760], EXT[850]])                      # 2x2 [wl, chromophore]
    L = np.asarray(distance_mm, float) / 10.0               # cm
    Einv = np.linalg.inv(E)
    hbo = np.empty_like(od760); hbr = np.empty_like(od760)
    for j, d in enumerate(L):
        y = np.vstack([od760[:, j] / (d * dpf[0]), od850[:, j] / (d * dpf[1])])
        c = Einv @ y
        hbo[:, j], hbr[:, j] = c[0] * 1e6, c[1] * 1e6
    return hbo, hbr


# --------------------------------------------------------------------------- filtering / spectra

def fill_nan(x: np.ndarray) -> np.ndarray:
    """Linear interpolation of NaNs along axis 0 (needed before filtering)."""
    x = np.array(x, float, copy=True)
    if x.ndim == 1:
        x = x[:, None]; squeeze = True
    else:
        squeeze = False
    n = np.arange(x.shape[0])
    for j in range(x.shape[1]):
        bad = ~np.isfinite(x[:, j])
        if bad.all():
            x[:, j] = 0.0
        elif bad.any():
            x[bad, j] = np.interp(n[bad], n[~bad], x[~bad, j])
    return x[:, 0] if squeeze else x


def bandpass(x: np.ndarray, fs: float, lo: float | None, hi: float | None, order: int = 4) -> np.ndarray:
    nyq = fs / 2
    if lo and hi:
        sos = ss.butter(order, [lo / nyq, min(hi / nyq, 0.99)], "bandpass", output="sos")
    elif lo:
        sos = ss.butter(order, lo / nyq, "highpass", output="sos")
    else:
        sos = ss.butter(order, min(hi / nyq, 0.99), "lowpass", output="sos")
    return ss.sosfiltfilt(sos, fill_nan(x), axis=0)


def welch(x: np.ndarray, fs: float, seg_s: float = 60.0):
    nper = int(min(seg_s * fs, x.shape[0]))
    return ss.welch(fill_nan(x), fs=fs, nperseg=nper, axis=0, detrend="linear")


def band_power(f: np.ndarray, p: np.ndarray, band: tuple[float, float]) -> np.ndarray:
    m = (f >= band[0]) & (f < band[1])
    return np.trapezoid(p[m], f[m], axis=0)


def peak_freq(f: np.ndarray, p: np.ndarray, band: tuple[float, float]) -> float:
    """Frequency of the maximum of a 1-D spectrum inside `band` (parabolic refinement)."""
    m = np.where((f >= band[0]) & (f < band[1]))[0]
    if m.size < 3:
        return np.nan
    i = m[np.argmax(p[m])]
    if 0 < i < len(f) - 1:
        a, b, c = p[i - 1], p[i], p[i + 1]
        den = a - 2 * b + c
        off = 0.5 * (a - c) / den if den != 0 else 0.0
        off = float(np.clip(off, -0.5, 0.5))
        return float(f[i] + off * (f[1] - f[0]))
    return float(f[i])


# --------------------------------------------------------------------------- quality

def scalp_coupling_index(od760: np.ndarray, od850: np.ndarray, fs: float,
                         band=(0.7, 1.5)) -> np.ndarray:
    """SCI (Pollonini 2014): correlation of the cardiac band between wavelengths, per pair."""
    a = bandpass(od760, fs, *band, order=3)
    b = bandpass(od850, fs, *band, order=3)
    a = (a - a.mean(0)) / (a.std(0) + 1e-12)
    b = (b - b.mean(0)) / (b.std(0) + 1e-12)
    return (a * b).mean(0)


def saturation_fraction(intensity: np.ndarray) -> np.ndarray:
    """Fraction of samples sitting at the column maximum (detector clipping) per channel."""
    mx = np.nanmax(intensity, axis=0, keepdims=True)
    return (np.isclose(intensity, mx, rtol=0, atol=1e-9 * np.abs(mx) + 1e-12)).mean(0)


def flatline_fraction(intensity: np.ndarray) -> np.ndarray:
    """Fraction of zero first differences (stuck / clipped signal)."""
    return (np.diff(intensity, axis=0) == 0).mean(0)


# --------------------------------------------------------------------------- cardiac

def cardiac_component(hbo: np.ndarray, fs: float, good: np.ndarray | None = None) -> np.ndarray:
    """Pooled cardiac waveform: z-scored, band-passed HbO averaged over good channels."""
    x = hbo if good is None or good.sum() == 0 else hbo[:, good]
    x = bandpass(x, fs, 0.7, 3.0 if fs > 8 else fs / 2 * 0.9)
    x = (x - x.mean(0)) / (x.std(0) + 1e-12)
    # align polarity to the first principal direction
    return x.mean(1)


def heart_rate_spectral(card: np.ndarray, fs: float) -> float:
    f, p = welch(card, fs, seg_s=20)
    return 60.0 * peak_freq(f, p, BANDS["cardiac"])


def detect_beats(card: np.ndarray, fs: float, hr_bpm: float | None = None) -> np.ndarray:
    """Beat times [s] from pooled cardiac signal (peaks), refined with parabolic interpolation."""
    hr = hr_bpm if hr_bpm and np.isfinite(hr_bpm) else 70.0
    dist = max(1, int(fs * 60.0 / hr * 0.6))
    prom = 0.3 * np.std(card)
    pk, _ = ss.find_peaks(card, distance=dist, prominence=prom)
    t = pk.astype(float)
    ok = (pk > 0) & (pk < len(card) - 1)
    a, b, c = card[pk[ok] - 1], card[pk[ok]], card[pk[ok] + 1]
    den = a - 2 * b + c
    t[ok] += np.where(den != 0, 0.5 * (a - c) / np.where(den == 0, 1, den), 0)
    return t / fs


def hrv_metrics(beats_s: np.ndarray) -> dict:
    ibi = np.diff(beats_s)
    if ibi.size < 10:
        return dict(hr_beats=np.nan, sdnn_ms=np.nan, rmssd_ms=np.nan, ibi_valid_frac=np.nan)
    med = np.median(ibi)
    ok = (ibi > 0.6 * med) & (ibi < 1.4 * med) & (ibi > 0.33) & (ibi < 1.6)
    v = ibi[ok]
    d = np.diff(ibi)
    okd = ok[1:] & ok[:-1]
    return dict(
        hr_beats=60.0 / np.mean(v) if v.size else np.nan,
        sdnn_ms=1000 * np.std(v) if v.size > 5 else np.nan,
        rmssd_ms=1000 * np.sqrt(np.mean(d[okd] ** 2)) if okd.sum() > 5 else np.nan,
        ibi_valid_frac=ok.mean(),
    )


def pulse_template(card_raw: np.ndarray, beats_s: np.ndarray, fs: float,
                   pre: float = 0.25, post: float = 0.75) -> tuple[np.ndarray, np.ndarray]:
    """Beat-locked average pulse waveform (normalised 0..1) and its time axis [s]."""
    n0, n1 = int(pre * fs), int(post * fs)
    segs = []
    for b in beats_s:
        i = int(round(b * fs))
        if i - n0 >= 0 and i + n1 < len(card_raw):
            s = card_raw[i - n0:i + n1]
            segs.append(s - s.min())
    if len(segs) < 10:
        return np.array([]), np.array([])
    m = np.median(np.array(segs), axis=0)
    m = (m - m.min()) / (np.ptp(m) + 1e-12)
    return np.arange(-n0, n1) / fs, m


def pulse_shape_features(tt: np.ndarray, tpl: np.ndarray) -> dict:
    """Simple waveform descriptors of a normalised pulse template."""
    if tpl.size == 0:
        return dict(pulse_rise_ms=np.nan, pulse_width50_ms=np.nan, pulse_skew=np.nan)
    from scipy.stats import skew
    dt = tt[1] - tt[0]
    ip = int(np.argmax(tpl))
    foot = int(np.argmin(tpl[:ip])) if ip > 0 else 0
    rise = 1000 * (tt[ip] - tt[foot]) if 0 < foot < ip else np.nan
    # width of the contiguous region >= 50% around the peak
    lo = ip
    while lo > 0 and tpl[lo - 1] >= 0.5:
        lo -= 1
    hi = ip
    while hi < len(tpl) - 1 and tpl[hi + 1] >= 0.5:
        hi += 1
    w50 = 1000 * (hi - lo) * dt if 0 < lo and hi < len(tpl) - 1 else np.nan
    return dict(pulse_rise_ms=rise, pulse_width50_ms=w50, pulse_skew=float(skew(tpl)))


# --------------------------------------------------------------------------- respiration / slow

def resp_rate_spectral(x: np.ndarray, fs: float, band=BANDS["resp"]) -> tuple[float, float]:
    """Breathing rate [breaths/min] from pooled low-frequency signal + peak prominence.

    The 1/f background is removed first (power-law fit in log-log over 0.03-1 Hz),
    otherwise the maximum always sits at the lower band edge.
    Prominence = peak height above the 1/f fit (ratio); < ~2 means no clear peak.
    """
    f, p = welch(x, fs, seg_s=60)
    fit = (f >= 0.03) & (f <= 1.0) & (p > 0)
    if fit.sum() < 5:
        return np.nan, np.nan
    k, b = np.polyfit(np.log(f[fit]), np.log(p[fit]), 1)
    resid = np.full_like(p, -np.inf)
    resid[f > 0] = np.log(p[f > 0] + 1e-30) - (k * np.log(f[f > 0]) + b)
    m = np.where((f >= band[0]) & (f < band[1]))[0]
    if m.size < 3:
        return np.nan, np.nan
    rr = peak_freq(f, np.exp(resid), band)
    return 60.0 * rr, float(np.exp(resid[m].max()))


# --------------------------------------------------------------------------- motion (aux)

def split_aux(aux: dict) -> tuple[np.ndarray | None, np.ndarray | None]:
    """Return (acc[n,3], gyro[n,3]) from aux dict (names vary; fallback: first 3 = acc)."""
    names = list(aux)
    acc = [n for n in names if "acc" in n.lower()]
    gyr = [n for n in names if "gyr" in n.lower()]
    if len(acc) != 3 or len(gyr) != 3:
        acc, gyr = names[:3], names[3:6]
    A = np.column_stack([aux[n] for n in acc]) if len(acc) == 3 else None
    G = np.column_stack([aux[n] for n in gyr]) if len(gyr) == 3 else None
    return A, G


def motion_metrics(acc: np.ndarray | None, gyr: np.ndarray | None, fs: float) -> dict:
    out = {}
    if acc is not None:
        g = np.nanmedian(acc, axis=0)
        out["acc_gravity_norm"] = float(np.linalg.norm(g))
        gn = g / (np.linalg.norm(g) + 1e-12)
        out["tilt_x"], out["tilt_y"], out["tilt_z"] = map(float, gn)
        dyn = bandpass(acc, fs, 0.1, None, order=2)
        mag = np.linalg.norm(dyn, axis=1)
        out["acc_dyn_std"] = float(np.std(mag))
        out["acc_dyn_p99"] = float(np.percentile(mag, 99))
        thr = np.median(mag) + 8 * (np.median(np.abs(mag - np.median(mag))) + 1e-12)
        ev, _ = ss.find_peaks(mag, height=thr, distance=int(fs))
        out["motion_events_per_min"] = 60 * len(ev) / (len(mag) / fs)
    if gyr is not None:
        gm = np.linalg.norm(gyr - np.nanmedian(gyr, axis=0), axis=1)
        out["gyro_std"] = float(np.std(gm))
        out["gyro_p99"] = float(np.percentile(gm, 99))
    return out


# --------------------------------------------------------------------------- events

def epochs(x: np.ndarray, fs: float, onsets_s, tmin: float, tmax: float,
           baseline: tuple[float, float] | None = (None, 0.0)) -> tuple[np.ndarray, np.ndarray]:
    """Event-locked epochs (n_events, n_times, ...) with optional baseline subtraction."""
    i0, i1 = int(round(tmin * fs)), int(round(tmax * fs))
    tt = np.arange(i0, i1) / fs
    out = []
    for o in onsets_s:
        c = int(round(o * fs))
        if c + i0 >= 0 and c + i1 <= x.shape[0]:
            e = x[c + i0:c + i1].copy()
            if baseline is not None:
                b0 = tt[0] if baseline[0] is None else baseline[0]
                m = (tt >= b0) & (tt <= baseline[1])
                e = e - np.nanmean(e[m], axis=0, keepdims=True)
            out.append(e)
    return (np.array(out) if out else np.empty((0, i1 - i0) + x.shape[1:])), tt
