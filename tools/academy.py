"""Yaver background music: "Academy". A hopeful, curious A-minor piece in the spirit of a
clockwork academy of inventors: a piano ostinato that runs like a mechanism, the tick of an
escapement, a soft heartbeat pulse, cello and double bass underneath, French horn swells,
a solo violin melody, flute and harp answers, and a high hextech shimmer. Rendered from
recorded instrument samples (tonejs-instruments) with a small sampler, placed in a hall,
and folded so the end flows into the start (it loops seamlessly).
Run: SAMPLES=<folder with the unpacked tonejs-instrument-* npm packages: piano-mp3, violin,
cello-mp3, contrabass-mp3, harp-mp3, french-horn-mp3, flute-mp3, xylophone-mp3>
python3 tools/academy.py OUT.wav, then ffmpeg -i OUT.wav -c:a libmp3lame -b:a 112k sounds/academy.mp3.
Needs numpy, scipy, soundfile, ffmpeg.
"""
import sys, re, glob, os, subprocess
import numpy as np
from scipy.signal import fftconvolve, butter, sosfilt

SR = 44100
ROOT = os.environ.get('SAMPLES', 'samples')
rng = np.random.default_rng(7)
NAMES = {'C': 0, 'Cs': 1, 'D': 2, 'Ds': 3, 'E': 4, 'F': 5, 'Fs': 6, 'G': 7, 'Gs': 8, 'A': 9, 'As': 10, 'B': 11}


def decode(path):
    raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', path, '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).astype(np.float64)


def load(folder):
    bank = {}
    for f in glob.glob(os.path.join(ROOT, folder, '*.mp3')):
        m = re.fullmatch(r'([A-G]s?)(\d)\.mp3', os.path.basename(f))
        if not m:
            continue
        y = decode(f)
        i = np.argmax(np.abs(y).max(1) > 0.003)
        bank[12 * (int(m.group(2)) + 1) + NAMES[m.group(1)]] = y[max(0, i - 40):]
    return bank


PIANO = load('tonejs-instrument-piano-mp3/package')
VIOLIN = load('tonejs-instrument-violin/package/mp3')
CELLO = load('tonejs-instrument-cello-mp3/package')
BASS = load('tonejs-instrument-contrabass-mp3/package')
HARP = load('tonejs-instrument-harp-mp3/package')
HORN = load('tonejs-instrument-french-horn-mp3/package')
FLUTE = load('tonejs-instrument-flute-mp3/package')
XYLO = load('tonejs-instrument-xylophone-mp3/package')


def sustain(y, n):
    """Make a sample last n frames: loop its middle with long crossfades if it's too short."""
    if len(y) >= n:
        return y[:n]
    start = min(int(.5 * SR), len(y) // 3)
    body = y[start:len(y) - int(.25 * SR)]
    out = y[:start + len(body)].copy()
    xf = min(int(.35 * SR), len(body) // 3)
    while len(out) < n:
        seg = body[rng.integers(0, max(1, len(body) // 4)):]
        w = np.linspace(0, 1, xf)[:, None]
        out[-xf:] = out[-xf:] * (1 - w) + seg[:xf] * w
        out = np.concatenate([out, seg[xf:]])
    return out[:n]


def note(bank, midi, dur, vel=1.0, attack=.01, release=.6, hold=True):
    """One note: nearest sample, pitch-shifted by resampling. hold=False lets a struck note ring out."""
    src = min(bank, key=lambda m: (abs(m - midi), m > midi))
    ratio = 2 ** ((midi - src) / 12)
    n_out = int((dur + release) * SR)
    y = bank[src]
    y = sustain(y, int(n_out * ratio) + 2) if hold else np.concatenate([y, np.zeros((max(0, int(n_out * ratio) + 2 - len(y)), 2))])
    idx = np.arange(n_out) * ratio
    out = np.stack([np.interp(idx, np.arange(len(y)), y[:, c]) for c in (0, 1)], 1)
    env = np.ones(n_out)
    a = int(attack * SR)
    if a:
        env[:a] = np.sin(np.linspace(0, np.pi / 2, a)) ** 2
    r0 = int(dur * SR)
    env[r0:] *= np.cos(np.linspace(0, np.pi / 2, n_out - r0)) ** 2
    return out * env[:, None] * vel


BPM = 84
BEAT = 60 / BPM
BAR = 4 * BEAT
# (bass, chord tones) per bar. Intro, A, B (the lift), C (the answer), outro.
CH = {
    'Am': (45, [57, 60, 64]), 'F': (41, [57, 60, 65]), 'C': (48, [55, 60, 64]), 'G': (43, [55, 59, 62]),
    'Dm': (38, [57, 62, 65]), 'E': (40, [56, 59, 64]), 'Es': (40, [57, 59, 64]), 'Em': (40, [55, 59, 64]),
    'GB': (47, [55, 59, 62]),
}
SONG = ('Am F C G ' 'Am F C G Am F Dm E ' 'F G Em Am F G Es E ' 'C GB Am F Dm Am E E ' 'Am F C G').split()
N = len(SONG)
LEN = N * BAR
TAIL = 8.0
STEMS = ('piano', 'tick', 'pulse', 'cello', 'bass', 'horn', 'violin', 'flute', 'harp', 'shimmer')
mix = {k: np.zeros((int((LEN + TAIL) * SR), 2)) for k in STEMS}
INTRO, A, B, C, OUT = range(0, 4), range(4, 12), range(12, 20), range(20, 28), range(28, 32)


def put(stem, t, y, pan=0.0):
    i = int(t * SR)
    seg = y[: len(mix[stem]) - i].copy()
    if pan:
        seg[:, 0] *= 1 - max(0, pan)
        seg[:, 1] *= 1 + min(0, pan)
    mix[stem][i:i + len(seg)] += seg


# ---- piano: an ostinato of eighth notes that turns like a mechanism ----
for k, ch in enumerate(SONG):
    bass, t = CH[ch]
    v = [t[0], t[2], t[1] + 12, t[0] + 12, t[2] + 12 - 12 * (t[2] + 12 > 79)]
    pat = [0, 1, 2, 3, 4, 3, 2, 1]
    loud = .34 if k in C or k in OUT or k in INTRO else .28
    for j, p in enumerate(pat):
        acc = 1.15 if j in (0, 4) else 1.0
        put('piano', k * BAR + j * BEAT / 2 + rng.uniform(0, .006), note(PIANO, v[p], BEAT * .55, vel=loud * acc * rng.uniform(.9, 1.05), release=.5, hold=False), pan=(p - 2) * .12)
    # a low octave on the downbeat, struck lightly
    put('piano', k * BAR, note(PIANO, bass + 12, BAR * .9, vel=.22, release=1.0, hold=False))

# ---- clockwork: an escapement ticking on each beat, a lighter tock between ----
def tick(freq, dur=.05, bright=1.0):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    e = np.exp(-tt * 140)
    y = sum(np.sin(2 * np.pi * freq * h * tt + rng.uniform(0, 6)) * np.exp(-tt * (90 + 60 * i)) / (1 + i) for i, h in enumerate([1, 2.76, 5.4, 8.9]))
    y = y * .45 + sosfilt(butter(2, [1500 / (SR / 2), 7000 / (SR / 2)], 'band', output='sos'), rng.standard_normal(n)) * e * .9 * bright
    return np.stack([y, y], 1)

T1, T2 = tick(2400), tick(3100, bright=.6)
for k in range(N):
    if k in B:  # the lift breathes without the clock
        continue
    for b in range(4):
        put('tick', k * BAR + b * BEAT, T1 * (.9 if b == 0 else .7), pan=-.25)
        put('tick', k * BAR + b * BEAT + BEAT / 2, T2 * .45, pan=.25)

# ---- pulse: a soft heartbeat under the A and B sections ----
def thump(dur=.5):
    n = int(dur * SR)
    tt = np.arange(n) / SR
    f = 46 + 70 * np.exp(-tt * 30)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 7)
    return np.stack([y, y], 1)

TH = thump()
for k in list(A)[4:] + list(B) + list(C)[4:]:
    put('pulse', k * BAR, TH)
    put('pulse', k * BAR + 1.5 * BEAT, TH * .6)
    put('pulse', k * BAR + 2 * BEAT, TH * .85)

# ---- low strings ----
for k, ch in enumerate(SONG):
    bass, t = CH[ch]
    if k not in INTRO:
        put('bass', k * BAR, note(BASS, bass, BAR + .1, vel=.5 if k not in B else .62, attack=.35, release=1.2))
    if k in A or k in B or k in C:
        top = t[0] - 12 if k in A else t[1] - 12
        put('cello', k * BAR, note(CELLO, top, BAR * .5 + .1, vel=.42, attack=.3, release=.8))
        put('cello', k * BAR + BAR / 2, note(CELLO, t[2] - 12 if k in A else t[0] - 12, BAR * .5 + .1, vel=.4, attack=.3, release=.8))

# ---- French horn: swells that open the lift and the answer ----
for k in list(B) + [20, 21, 24, 25]:
    bass, t = CH[SONG[k]]
    for m in (t[0] - 12, t[2] - 12):
        put('horn', k * BAR, note(HORN, m, BAR + .2, vel=.3, attack=1.1, release=1.4))

# ---- violin: the melody of the lift (bar, beat, midi, beats) ----
MEL = {
    12: [(0, 72, 1.5), (1.5, 74, .5), (2, 77, 2)], 13: [(0, 79, 2), (2, 77, 1), (3, 74, 1)],
    14: [(0, 76, 3), (3, 71, 1)], 15: [(0, 72, 2), (2, 76, 2)],
    16: [(0, 81, 2), (2, 79, 1), (3, 77, 1)], 17: [(0, 79, 1.5), (1.5, 83, .5), (2, 84, 2)],
    18: [(0, 81, 4)], 19: [(0, 80, 2), (2, 83, 2)],
}
for k, notes in MEL.items():
    for b, m, d in notes:
        put('violin', k * BAR + b * BEAT, note(VIOLIN, m, d * BEAT + .12, vel=.78, attack=.18 if d >= 1 else .08, release=.9))

# ---- flute: the answer ----
FL = {
    20: [(0, 84, 2), (2, 79, 2)], 21: [(0, 83, 2), (2, 79, 2)], 22: [(0, 81, 3), (3, 76, 1)], 23: [(0, 77, 4)],
    24: [(0, 74, 2), (2, 77, 2)], 25: [(0, 76, 2), (2, 72, 2)], 26: [(0, 71, 2), (2, 68, 2)], 27: [(0, 71, 4)],
    6: [(2, 79, 1), (3, 76, 1)], 7: [(0, 74, 4)], 10: [(2, 77, 1), (3, 76, 1)], 11: [(0, 74, 2), (2, 71, 2)],
}
for k, notes in FL.items():
    for b, m, d in notes:
        put('flute', k * BAR + b * BEAT, note(FLUTE, m, d * BEAT + .08, vel=.5 if k >= 20 else .34, attack=.08, release=.7), pan=.2)

# ---- harp: rising arpeggios into each section ----
for k in (3, 11, 19, 27, 31):
    bass, t = CH[SONG[k]]
    ps = [t[0] + 12, t[1] + 12, t[2] + 12, t[0] + 24, t[1] + 24, t[2] + 24]
    for j, m in enumerate(ps):
        put('harp', k * BAR + 2 * BEAT + j * BEAT / 3, note(HARP, m, 1.2, vel=.32 + j * .03, release=1.2, hold=False), pan=-.3 + j * .1)

# ---- hextech shimmer: a high glassy pad and glints, brightest in the lift ----
for k, ch in enumerate(SONG):
    bass, t = CH[ch]
    n = int((BAR + 1.5) * SR)
    tt = np.arange(n) / SR
    pad = np.zeros(n)
    for m in (t[0] + 24, t[1] + 24, t[2] + 12):
        fr = 440 * 2 ** ((m - 69) / 12)
        pad += np.sin(2 * np.pi * fr * tt * (1 + .0015 * np.sin(2 * np.pi * .3 * tt))) * (.55 + .45 * np.sin(2 * np.pi * 4.5 * tt + m))
    env = np.minimum(1, tt / .8) * np.minimum(1, (BAR + 1.5 - tt) / 1.2)
    lvl = .05 if k in B else .025 if k in C or k in A else .015
    put('shimmer', k * BAR, np.stack([pad * env, np.roll(pad, 300) * env], 1) * lvl)
    if k in A or k in B:
        for g in range(2):
            m = rng.choice(t) + 24
            put('shimmer', k * BAR + rng.choice([1.5, 2.5, 3.5]) * BEAT, note(XYLO, int(m), .6, vel=.12, release=1.4, hold=False), pan=rng.uniform(-.5, .5))

# ---------- mix ----------
LEVEL = {'piano': 1.0, 'tick': .3, 'pulse': .55, 'cello': .7, 'bass': .6, 'horn': .75, 'violin': 1.0, 'flute': .85, 'harp': .7, 'shimmer': 1.0}
dry = sum(mix[k] * LEVEL[k] for k in mix)
dry = sosfilt(butter(2, 11000 / (SR / 2), 'low', output='sos'), dry, axis=0)
n = int(3.2 * SR)
t = np.linspace(0, 1, n)
ir = rng.standard_normal((n, 2)) * np.exp(-t * 8)[:, None]
ir = sosfilt(butter(1, 4200 / (SR / 2), 'low', output='sos'), ir, axis=0)
ir[:int(.02 * SR)] *= np.linspace(0, 1, int(.02 * SR))[:, None]
ir /= np.sqrt((ir ** 2).sum(0))
wet = np.stack([fftconvolve(dry[:, c], ir[:, c])[: len(dry)] for c in (0, 1)], 1)
y = dry * .82 + wet * .42
y = sosfilt(butter(2, 35 / (SR / 2), 'high', output='sos'), y, axis=0)
L = int(LEN * SR)
out = y[:L].copy()
out[: len(y) - L] += y[L:]
# gentle bus compression so the quiet intro and the lift sit closer together
env = np.sqrt(np.convolve((out ** 2).mean(1), np.ones(int(.3 * SR)) / int(.3 * SR), 'same')) + 1e-6
gain = np.minimum(1, (env / env.max()) ** -.35 * .55)
out = out * gain[:, None]
out = out / np.max(np.abs(out)) * .8

import soundfile as sf
sf.write(sys.argv[1] if len(sys.argv) > 1 else 'academy.wav', out, SR, subtype='PCM_16')
print(f'{LEN:.1f} s')
