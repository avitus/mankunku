"""Research-only offline linear echo cancellation. Never imported by the app."""
import numpy as np
from scipy import signal
from scipy.sparse.linalg import LinearOperator, cg

RATE = 24000

def warp(x, delay, drift=0.):
    t = np.arange(len(x), dtype=float)
    return np.stack([np.interp(t-delay-drift*t, t, c, left=0, right=0) for c in x.T], axis=1)

def lag_estimate(x, y, sr, start, end):
    a, b = int(start*sr), int(end*sr)
    x = np.diff(x[a:b].mean(axis=1), prepend=0)
    y = np.diff(y[a:b], prepend=0)
    corr = signal.correlate(y, x, mode='full', method='fft')
    corr = corr[len(x)-1:len(x)+int(.4*sr)]
    p = int(np.argmax(np.abs(corr)))
    mag = np.abs(corr)
    frac = 0.
    if 0 < p < len(mag)-1:
        den = mag[p-1]-2*mag[p]+mag[p+1]
        if den: frac = .5*(mag[p-1]-mag[p+1])/den
    strength = float(mag[p]/(np.linalg.norm(x)*np.linalg.norm(y)+1e-20))
    return p+frac, strength

def fit_filter(x, y, taps, iterations=100):
    # Ridge-regularized FIR system identification; no player samples enter y.
    n, channels = x.shape
    def forward(h):
        return sum(signal.fftconvolve(x[:, c], h[c*taps:(c+1)*taps])[:n] for c in range(channels))
    def adjoint(v):
        return np.concatenate([signal.correlate(v, x[:, c], mode='full', method='fft')[n-1:n-1+taps] for c in range(channels)])
    ridge = float(np.sum(x*x)/channels)*.001
    op = LinearOperator((taps*channels, taps*channels), matvec=lambda h: adjoint(forward(h))+ridge*h)
    h, info = cg(op, adjoint(y), rtol=1e-5, maxiter=iterations)
    return h.reshape(channels, taps), int(info)

def predict(x, h):
    return sum(signal.fftconvolve(x[:, c], h[c])[:len(x)] for c in range(x.shape[1]))

def db_ratio(a, b):
    return float(10*np.log10((np.mean(np.square(a))+1e-20)/(np.mean(np.square(b))+1e-20)))

def clean(mic, reference, sr, calibration_end, tail_start=None, track_drift=True):
    """Fit first 70% of silent calibration, validate last 25%, freeze for playing.

    Only reference is resampled/warped. Microphone sample timeline stays intact.
    Endpoint drift estimate is offline and assumes a stable room/path; confidence
    is diagnostic, not proof. A caller must retain raw audio for comparison.
    """
    from math import gcd
    g = gcd(sr, RATE)
    y = signal.resample_poly(mic, RATE//g, sr//g)
    x = signal.resample_poly(reference, RATE//g, sr//g, axis=0)
    if x.ndim == 1: x = x[:, None]
    # Collapse an exactly duplicated channel; keep genuine stereo references.
    if x.shape[1] == 2 and np.max(np.abs(x[:, 0]-x[:, 1])) < 1e-8: x = x[:, :1]
    lag, confidence = lag_estimate(x, y, RATE, .3, calibration_end-.2)
    drift = 0.
    tail_lag, tail_conf = None, None
    if track_drift and tail_start is not None and len(y)/RATE-tail_start > 2.5:
        tail_lag, tail_conf = lag_estimate(x, y, RATE, tail_start+.3, len(y)/RATE-.2)
        first_mid = (.3+calibration_end-.2)/2
        tail_mid = (tail_start+.3+len(y)/RATE-.2)/2
        candidate = (tail_lag-lag)/((tail_mid-first_mid)*RATE)
        if confidence > .06 and tail_conf > .06 and abs(candidate) <= .0005:
            drift = candidate
            lag -= drift*first_mid*RATE
    aligned = warp(x, lag, drift)
    train_end = int(calibration_end*.7*RATE)
    h, convergence = fit_filter(aligned[:train_end], y[:train_end], int(.2*RATE))
    echo = predict(aligned, h)
    validation = slice(int(calibration_end*.75*RATE), int((calibration_end-.05)*RATE))
    reduction = db_ratio(y[validation], (y-echo)[validation])
    accepted = bool(np.isfinite(echo).all() and confidence > .06 and reduction >= 3.)
    # Upsample the estimate, not the original: zero reference must be identity.
    echo_full = signal.resample_poly(echo, sr//g, RATE//g)[:len(mic)]
    echo_full = np.pad(echo_full, (0, max(0, len(mic)-len(echo_full))))
    output = mic-echo_full if accepted else mic.copy()
    return output, dict(accepted=accepted, delay_ms=lag/RATE*1000,
        drift_ppm=drift*1e6, initial_correlation=confidence, tail_correlation=tail_conf,
        validation_reduction_db=reduction, filter_ms=200, solver_status=convergence,
        channels=x.shape[1], warnings=[
            'Experimental. Calibration must contain no playing.',
            'Endpoint drift can confuse clock drift with room movement.',
            'Filter is frozen during playing; changed room paths are not tracked.',
            '24 kHz model leaves energy above 12 kHz largely untreated.'
        ])
