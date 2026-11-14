"""Per-recording feature extraction used by the exploration scripts.

`process_file(row, age)` loads one SNIRF file and returns:
  feats   - dict of scalar features (one row of the feature table)
  arrays  - dict of arrays for plotting (spectra, event-locked averages, pulse template)
  chans   - per-pair DataFrame (distance, intensity, SCI, ...) for optics / quality analyses
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from . import signal as S
from .io import load_snirf

SCI_GOOD = 0.7
SHORT_MM = 15.0          # pairs below this separation are treated as short channels

# event codes (DATASET_DESCRIPTION)
DOT_CODES = {
    "RS": {"start": ["11", "12", "13", "14"]},
    "SPB": {"cycle": ["21", "23", "25", "27"], "break": ["22", "24", "26", "28"]},
    "BH": {"normal": ["71", "75"], "short_hold": ["72", "76"],
           "free": ["73", "77"], "max_hold": ["74", "78"]},
}
SUP_CODES = {"breathe": ["1"], "hold": ["2"]}


def _codes(events: pd.DataFrame, codes: list[str]) -> np.ndarray:
    return events.onset[events.code.astype(str).str.strip().isin(codes)].to_numpy()


def process_file(row: pd.Series, age: float | None = None) -> tuple[dict, dict, pd.DataFrame]:
    rec = load_snirf(row.path)
    fs = rec.fs
    feats: dict = dict(dataset=row.dataset, subject=int(row.subject), task=row.task,
                       session=int(row.session), file=row.path.name)
    arrays: dict = {}

    # ------------------------------------------------------------- crop
    n = rec.intensity.shape[0]
    if row.dataset == "dot" and row.task == "RS":
        n = min(n, int(600 * fs))          # nominal 600 s rest
    I = rec.intensity[:n]
    I = np.where(rec.missing[:n, None], np.nan, I) if rec.missing is not None else I
    t = rec.time[:n]

    feats.update(fs=fs, duration_s=rec.duration, n_channels=I.shape[1], n_pairs=len(rec.pairs),
                 missing_pct=100 * rec.missing.mean() if rec.missing is not None else 0.0,
                 n_events=len(rec.events),
                 meas_date=rec.meta.get("MeasurementDate"), meas_time=rec.meta.get("MeasurementTime"))

    # ------------------------------------------------------------- per-pair optics & quality
    pt = rec.pair_table()
    i760 = I[:, [rec.channels.index[(rec.channels.pair == p) & (rec.channels.wavelength == 760)][0] for p in rec.pairs]]
    i850 = I[:, [rec.channels.index[(rec.channels.pair == p) & (rec.channels.wavelength == 850)][0] for p in rec.pairs]]
    od760, od850 = S.optical_density(i760), S.optical_density(i850)
    sci = S.scalp_coupling_index(od760, od850, fs)
    sat760 = S.flatline_fraction(np.nan_to_num(i760)); sat850 = S.flatline_fraction(np.nan_to_num(i850))
    chans = pt.reset_index().assign(
        mean_i760=np.nanmean(i760, 0), mean_i850=np.nanmean(i850, 0),
        cv760=np.nanstd(i760, 0) / np.nanmean(i760, 0), cv850=np.nanstd(i850, 0) / np.nanmean(i850, 0),
        sci=sci, flat760=sat760, flat850=sat850,
        max_i760=np.nanmax(i760, 0), max_i850=np.nanmax(i850, 0),
        p99_i760=np.nanpercentile(i760, 99, 0), p99_i850=np.nanpercentile(i850, 99, 0),
    )
    chans["ratio_760_850"] = chans.mean_i760 / chans.mean_i850
    chans["short"] = chans.distance_mm < SHORT_MM
    long_ = ~chans.short.to_numpy()
    good = (sci >= SCI_GOOD) & (chans[["flat760", "flat850"]].max(1).to_numpy() < 0.2)
    chans["good"] = good

    feats.update(
        sci_median=float(np.median(sci[long_])), sci_mean=float(np.mean(sci[long_])),
        good_pct=100 * good[long_].mean(),
        flat_pct=100 * (chans[["flat760", "flat850"]].max(1) > 0.2)[long_].mean(),
        log_i760_long=float(np.nanmedian(np.log10(chans.mean_i760[long_]))),
        log_i850_long=float(np.nanmedian(np.log10(chans.mean_i850[long_]))),
        ratio_760_850_long=float(np.nanmedian(chans.ratio_760_850[long_])),
    )
    # attenuation slope: d log10(I) / d distance  (effective attenuation of tissue)
    for wl in (760, 850):
        y = np.log10(chans[f"mean_i{wl}"].to_numpy()); x = chans.distance_mm.to_numpy()
        ok = np.isfinite(y) & (chans[f"flat{wl}"] < 0.2).to_numpy()
        feats[f"atten_slope_{wl}"] = float(np.polyfit(x[ok], y[ok], 1)[0]) if ok.sum() > 3 and np.ptp(x[ok]) > 5 else np.nan
    if chans.short.any():
        feats["short_i760"] = float(np.nanmedian(np.log10(chans.mean_i760[chans.short])))
        feats["short_i850"] = float(np.nanmedian(np.log10(chans.mean_i850[chans.short])))
        feats["short_sci"] = float(np.median(sci[chans.short.to_numpy()]))

    # ------------------------------------------------------------- haemoglobin
    hbo, hbr = S.mbll(S.fill_nan(od760), S.fill_nan(od850), pt.distance_mm.to_numpy(), age=age)
    use = good & long_
    if use.sum() == 0:
        use = long_
    hbo_g, hbr_g = hbo[:, use], hbr[:, use]
    feats["n_good_long"] = int((good & long_).sum())

    # ------------------------------------------------------------- spectra (pooled HbO)
    f, p_hbo = S.welch(S.bandpass(hbo_g, fs, 0.005, None, order=2), fs, seg_s=60)
    _, p_hbr = S.welch(S.bandpass(hbr_g, fs, 0.005, None, order=2), fs, seg_s=60)
    zf = p_hbo / (p_hbo.sum(0, keepdims=True) + 1e-30)     # normalised per channel
    spec = zf.mean(1)
    keep = f <= min(5.0, fs / 2)
    arrays["psd_f"], arrays["psd_hbo"] = f[keep], spec[keep]
    arrays["psd_hbr"] = (p_hbr / (p_hbr.sum(0, keepdims=True) + 1e-30)).mean(1)[keep]
    tot = band_tot = S.band_power(f, spec, (0.01, min(2.5, fs / 2)))
    for b, rng in S.BANDS.items():
        feats[f"rel_{b}"] = float(S.band_power(f, spec, rng) / tot)
    feats["hbo_std_uM"] = float(np.nanmedian(np.nanstd(S.bandpass(hbo_g, fs, 0.01, None, 2), 0)))
    feats["hbr_std_uM"] = float(np.nanmedian(np.nanstd(S.bandpass(hbr_g, fs, 0.01, None, 2), 0)))
    feats["mayer_peak_hz"] = S.peak_freq(f, spec, (0.05, 0.15))
    del band_tot

    # ------------------------------------------------------------- cardiac: HR, HRV, pulse shape
    card = S.cardiac_component(hbo, fs, use)
    feats["hr_spectral_bpm"] = S.heart_rate_spectral(card, fs)
    beats = S.detect_beats(card, fs, feats["hr_spectral_bpm"])
    feats.update(S.hrv_metrics(beats))
    feats["cardiac_amp_uM"] = float(np.nanmedian(np.std(S.bandpass(hbo_g, fs, 0.7, min(3.0, fs / 2 * 0.9)), 0)))
    if fs > 50:  # pulse waveform only meaningful at high sampling rate
        raw_card = S.bandpass(hbo_g, fs, 0.5, 10.0).mean(1)
        tt, tpl = S.pulse_template(raw_card, beats, fs, pre=0.45, post=0.75)
        arrays["pulse_t"], arrays["pulse_tpl"] = tt, tpl
        feats.update(S.pulse_shape_features(tt, tpl))
        if chans.short.any():
            sc = S.bandpass(hbo[:, chans.short.to_numpy()], fs, 0.5, 10.0).mean(1)
            tt2, tpl2 = S.pulse_template(sc, beats, fs, pre=0.45, post=0.75)
            arrays["pulse_short_tpl"] = tpl2
            f2 = S.pulse_shape_features(tt2, tpl2)
            feats.update({k + "_short": v for k, v in f2.items()})

    # ------------------------------------------------------------- respiration (spontaneous)
    slow = S.bandpass(hbo_g, fs, 0.05, 0.8).mean(1)
    feats["resp_rate_bpm"], feats["resp_peak_prom"] = S.resp_rate_spectral(slow, fs)
    feats["slow_osc_rate_bpm"], _ = S.resp_rate_spectral(slow, fs, band=(0.05, 0.6))

    # ------------------------------------------------------------- motion (aux)
    A = None
    if rec.aux:
        A, G = S.split_aux({k: v[:n] for k, v in rec.aux.items()})
        feats.update(S.motion_metrics(A, G, fs))
        if A is not None:
            acc_resp = S.bandpass(A, fs, 0.05, 0.8)
            # dominant breathing-band axis
            ax = int(np.argmax(acc_resp.std(0)))
            feats["acc_resp_rate_bpm"], feats["acc_resp_peak_prom"] = S.resp_rate_spectral(acc_resp[:, ax], fs)
            feats["acc_slow_rate_bpm"], _ = S.resp_rate_spectral(acc_resp[:, ax], fs, band=(0.05, 0.6))

    # ------------------------------------------------------------- task-specific
    ev = rec.events
    hbo_mean = S.bandpass(hbo_g, fs, 0.005, 0.5).mean(1)
    hbr_mean = S.bandpass(hbr_g, fs, 0.005, 0.5).mean(1)
    hb2 = np.column_stack([hbo_mean, hbr_mean])
    accmag = np.linalg.norm(S.bandpass(A, fs, 0.1, None, 2), axis=1) if A is not None else None

    if row.dataset == "dot" and row.task == "SPB":
        cyc = _codes(ev, DOT_CODES["SPB"]["cycle"])
        feats["n_cycles"] = len(cyc)
        ep, tt = S.epochs(hb2, fs, cyc, 0, 10, baseline=None)
        if len(ep):
            ep = ep - ep.mean(1, keepdims=True)
            arrays["spb_cycle_t"], arrays["spb_cycle"] = tt, ep.mean(0)
            feats["spb_cycle_amp_hbo"] = float(np.ptp(ep.mean(0)[:, 0]))
            # phase consistency of HbO at 0.1 Hz across cycles (0..1)
            ph = np.angle(np.exp(-2j * np.pi * 0.1 * tt) @ ep[:, :, 0].T)
            feats["spb_phase_locking"] = float(np.abs(np.mean(np.exp(1j * ph))))
        if accmag is not None:
            epa, _ = S.epochs(S.bandpass(A, fs, 0.05, 0.8), fs, cyc, 0, 10, baseline=None)
            if len(epa):
                arrays["spb_cycle_acc"] = epa.mean(0)
        f0 = 60 * S.peak_freq(*S.welch(hbo_mean, fs, 100), (0.05, 0.2))
        feats["spb_dom_rate_bpm"] = f0
        f_, p_ = S.welch(hbo_mean, fs, 100)
        feats["spb_power_0p1"] = float(S.band_power(f_, p_, (0.09, 0.11)) / S.band_power(f_, p_, (0.01, 0.6)))

    if row.dataset == "dot" and row.task == "BH":
        sh = _codes(ev, DOT_CODES["BH"]["short_hold"])
        mx = _codes(ev, DOT_CODES["BH"]["max_hold"])
        feats["n_short_holds"], feats["n_max_holds"] = len(sh), len(mx)
        ep, tt = S.epochs(hb2, fs, sh, -5, 30, baseline=(-5, 0))
        if len(ep):
            arrays["bh_short_t"], arrays["bh_short"] = tt, ep.mean(0)
            m = ep.mean(0)[:, 0]
            feats["short_hold_hbo_peak"] = float(m[tt > 0].max())
            feats["short_hold_hbo_tpeak"] = float(tt[tt > 0][np.argmax(m[tt > 0])])
        ep, tt = S.epochs(hb2, fs, mx, -10, 110, baseline=(-10, 0))
        if len(ep):
            arrays["bh_max_t"], arrays["bh_max"] = tt, ep.mean(0)
            m = ep.mean(0)[:, 0]
            feats["max_hold_hbo_peak"] = float(m[tt > 0].max())
            feats["max_hold_hbo_tpeak"] = float(tt[tt > 0][np.argmax(m[tt > 0])])
        if accmag is not None:
            ea, tta = S.epochs(accmag[:, None], fs, mx, -10, 110, baseline=None)
            if len(ea):
                arrays["bh_max_acc"] = ea.mean(0)[:, 0]

    if row.dataset == "supine" and row.task == "BH":
        holds = _codes(ev, SUP_CODES["hold"])
        brs = _codes(ev, SUP_CODES["breathe"])
        durs = []
        for h in holds:
            nxt = brs[brs > h]
            durs.append(float(nxt[0] - h) if len(nxt) else np.nan)
        durs = np.array(durs)
        arrays["hold_durations"] = durs
        feats["n_holds"] = len(holds)
        feats["hold_dur_mean_s"] = float(np.nanmean(durs)) if np.isfinite(durs).any() else np.nan
        feats["hold_dur_max_s"] = float(np.nanmax(durs)) if np.isfinite(durs).any() else np.nan
        feats["last_hold_to_end_s"] = float(rec.duration - holds[-1]) if len(holds) else np.nan
        ep, tt = S.epochs(hb2, fs, holds, -10, 60, baseline=(-10, 0))
        if len(ep):
            arrays["bh_hold_t"], arrays["bh_hold"] = tt, ep.mean(0)
            m = ep.mean(0)[:, 0]
            feats["hold_hbo_peak"] = float(m[tt > 0].max())
            feats["hold_hbo_tpeak"] = float(tt[tt > 0][np.argmax(m[tt > 0])])
            # HbO slope during first 15 s of hold [uM/s]  (CO2 reactivity proxy)
            w = (tt > 0) & (tt < 15)
            feats["hold_hbo_slope"] = float(np.polyfit(tt[w], m[w], 1)[0])
        # breath-locked (end of hold) responses with known ends
        ends = np.array([brs[brs > h][0] for h in holds if (brs > h).any()])
        ep, tt = S.epochs(hb2, fs, ends, -20, 30, baseline=(-20, -10))
        if len(ep):
            arrays["bh_end_t"], arrays["bh_end"] = tt, ep.mean(0)
        if accmag is not None:
            ea, tta = S.epochs(accmag[:, None], fs, ends, -20, 30, baseline=None)
            if len(ea):
                arrays["bh_end_acc"] = ea.mean(0)[:, 0]
        # per-hold rows for a long table
        arrays["holds"] = holds

    return feats, arrays, chans
