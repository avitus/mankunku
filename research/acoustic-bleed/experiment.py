"""Controlled room mixtures of app renders and sampled/archived horn audio."""
import ctypes as C
import json
import subprocess
from pathlib import Path
import numpy as np
from scipy import signal
from scipy.io import wavfile
from cancel import clean, warp, db_ratio

SR = 48000
N = SR*32
ROOT = Path('/work')
rng = np.random.default_rng(16112026)

def decode(path):
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'f32le', '-ac', '1', '-ar', str(SR), '-'])
    return np.frombuffer(raw, '<f4').astype(float)

def sized(x): return np.resize(x, N)
def write(name, x):
    (ROOT/'results'/f'{name}.f32').write_bytes(x.astype('<f4').tobytes())
    wavfile.write(ROOT/'results'/f'{name}.wav', SR, np.clip(x*32767, -32768, 32767).astype('int16'))

def speex(mic, ref):
    lib = C.CDLL('libspeexdsp.so.1')
    lib.speex_echo_state_init.restype = C.c_void_p
    lib.speex_echo_state_init.argtypes = [C.c_int, C.c_int]
    lib.speex_echo_ctl.argtypes = [C.c_void_p, C.c_int, C.c_void_p]
    lib.speex_echo_cancellation.argtypes = [C.c_void_p, C.c_void_p, C.c_void_p, C.c_void_p]
    lib.speex_echo_state_destroy.argtypes = [C.c_void_p]
    st = lib.speex_echo_state_init(480, 14400)
    rate = C.c_int(SR); lib.speex_echo_ctl(st, 24, C.byref(rate))
    a = np.clip(mic*32767, -32768, 32767).astype('int16')
    b = np.clip(ref*32767, -32768, 32767).astype('int16')
    out = np.zeros_like(a)
    for i in range(0, len(a)-480+1, 480):
        lib.speex_echo_cancellation(st, a[i:].ctypes.data, b[i:].ctypes.data, out[i:].ctypes.data)
    lib.speex_echo_state_destroy(st)
    return out.astype(float)/32767

def main():
    backing = sized(decode(ROOT/'input/backing.wav'))
    metro = sized(np.fromfile(ROOT/'input/metronome.f32', '<f4'))
    backing *= .10/(np.sqrt(np.mean(backing**2))+1e-12)
    metro *= .08/(np.sqrt(np.mean(metro**2))+1e-12)
    near = np.zeros(N)
    notes = [60,62,63,65,65,67,70,67,65,63,62,60,60,67,65,60]
    for i, midi in enumerate(notes):
        sample = decode(ROOT/f'input/tenor-sax/f_{midi}.ogg')
        length = int((.65 if i%3 else .4)*SR)
        sample = sample[:length].copy()
        sample *= .13/(np.sqrt(np.mean(sample**2))+1e-12)
        sample[-480:] *= np.linspace(1,0,480)
        start = int((8+i*.9)*SR)
        near[start:start+len(sample)] += sample
    archived = np.zeros(N)
    clip = decode(ROOT/'input/archived.wav')[:SR*15]
    archived[8*SR:8*SR+len(clip)] = clip
    # Sparse reflections plus diffuse low-pass decaying tail, T60=.28 s.
    t = np.arange(int(.3*SR))/SR
    h = rng.normal(0,.012,len(t))*np.exp(-6.91*t/.28)
    for ms, amp in [(0, .7), (8.4,.22), (21.1,-.17),(54.3,.1),(99,.05)]: h[int(ms/1000*SR)] += amp
    h = signal.lfilter(*signal.butter(2, 7000, fs=SR), h)
    report=[]
    for name, source, target, ppm, changed, nonlinear in [
        ('backing_static',backing,near,0,False,False),
        ('metronome_static',metro,near,0,False,False),
        ('backing_drift_200ppm',backing,near,200,False,False),
        ('backing_room_move',backing,near,0,True,False),
        ('backing_clipping',backing,near,0,False,True),
        ('archived_preservation',backing,archived,0,False,False)]:
        warped = warp(source[:,None], .115*SR, ppm*1e-6)[:,0]
        played = np.tanh(warped*8)/8 if nonlinear else warped
        echo = signal.fftconvolve(played,h)[:N]
        if changed:
            shifted = np.pad(echo[:-240],(240,0))*.6
            echo[17*SR:] = shifted[17*SR:]
        mic = target+echo
        out, meta = clean(mic,source[:,None],SR,7,26)
        aligned_scalar = warp(source[:,None], .115*SR)[:,0]
        gain = np.dot(mic[:7*SR],aligned_scalar[:7*SR])/(np.dot(aligned_scalar[:7*SR],aligned_scalar[:7*SR])+1e-20)
        scalar = mic-gain*aligned_scalar
        no_drift, _ = clean(mic,source[:,None],SR,7,26,track_drift=False)
        # Adaptive baseline receives the true initial bulk delay but no drift.
        adaptive = speex(mic,warp(source[:,None],.115*SR)[:,0])
        play = slice(8*SR,25*SR)
        row=dict(case=name, **meta, input_sdr_db=db_ratio(target[play],echo[play]),
            cleaned_sdr_db=db_ratio(target[play],(out-target)[play]),
            adaptive_sdr_db=db_ratio(target[play],(adaptive-target)[play]),
            scalar_sdr_db=db_ratio(target[play],(scalar-target)[play]),
            no_drift_sdr_db=db_ratio(target[play],(no_drift-target)[play]),
            peak_input=float(np.max(np.abs(mic))))
        report.append(row)
        for suffix, audio in [('target',target),('original',mic),('cleaned',out),('speex',adaptive)]:
            write(name+'_'+suffix,audio)
        print(json.dumps(row),flush=True)
    unchanged, meta=clean(near,np.zeros((N,1)),SR,7,26)
    assert np.array_equal(unchanged, near) and not meta['accepted']
    (ROOT/'results/metrics.json').write_text(json.dumps(report,indent=2))

if __name__ == '__main__': main()
