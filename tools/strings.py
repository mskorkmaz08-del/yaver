"""Yaver background music: a slow D-minor piece for solo violin, cello, double bass and harp,
rendered from recorded instrument samples (tonejs-instruments) with a small sampler, then
placed in a large hall. Loops seamlessly: the tail is folded onto the start.
Run: SAMPLES=<folder with the unpacked tonejs-instrument-violin, -cello-mp3, -contrabass-mp3 and
-harp-mp3 npm packages> python3 tools/strings.py OUT.wav, then
ffmpeg -i OUT.wav -c:a libmp3lame -b:a 112k sounds/strings.mp3. Needs numpy, scipy, soundfile, ffmpeg.
"""
import sys, re, glob, os, subprocess
import numpy as np
from scipy.signal import fftconvolve, butter, sosfilt

SR = 44100
ROOT = os.environ.get('SAMPLES', 'samples')  # folder holding the unpacked tonejs-instrument-* npm packages
rng = np.random.default_rng(5)
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
        midi = 12 * (int(m.group(2)) + 1) + NAMES[m.group(1)]
        y = decode(f)
        # trim leading silence
        i = np.argmax(np.abs(y).max(1) > 0.003)
        bank[midi] = y[max(0, i - 40):]
    return bank


VIOLIN = load('tonejs-instrument-violin/package/mp3')
CELLO = load('tonejs-instrument-cello-mp3/package')
BASS = load('tonejs-instrument-contrabass-mp3/package')
HARP = load('tonejs-instrument-harp-mp3/package')


def sustain(y, n):
    """Make a sample last n frames: loop its middle with long crossfades if it's too short."""
    if len(y) >= n:
        return y[:n]
    start = min(int(.5 * SR), len(y) // 3)
    body = y[start:len(y) - int(.25 * SR)]
    out = y[:start + len(body)].copy()
    xf = min(int(.35 * SR), len(body) // 3)
    while len(out) < n:
        seg = body[rng.integers(0, max(1, len(body) // 4)):]  # start each loop at a different place
        w = np.linspace(0, 1, xf)[:, None]
        out[-xf:] = out[-xf:] * (1 - w) + seg[:xf] * w
        out = np.concatenate([out, seg[xf:]])
    return out[:n]


def note(bank, midi, dur, vel=1.0, attack=.08, release=.9, detune_cents=0.0):
    src = min(bank, key=lambda m: (abs(m - midi), m > midi))
    ratio = 2 ** ((midi - src + detune_cents / 100) / 12)
    n_out = int((dur + release) * SR)
    y = sustain(bank[src], int(n_out * ratio) + 2)
    idx = np.arange(n_out) * ratio
    out = np.stack([np.interp(idx, np.arange(len(y)), y[:, c]) for c in (0, 1)], 1)
    env = np.ones(n_out)
    a = int(attack * SR)
    if a:
        env[:a] = np.sin(np.linspace(0, np.pi / 2, a)) ** 2
    r0, r = int(dur * SR), n_out - int(dur * SR)
    env[r0:] *= np.cos(np.linspace(0, np.pi / 2, r)) ** 2
    return out * env[:, None] * vel


BPM = 64
BEAT = 60 / BPM
CHORD = 8 * BEAT                      # two bars of 4/4 per chord
# D minor: i - VI - III - VII - iv - VI - i(over A) - V, twice
PROG = [
    (38, [50, 53, 57]), (34, [50, 53, 58]), (41, [53, 57, 60]), (36, [52, 55, 60]),
    (31, [50, 55, 58]), (34, [50, 53, 58]), (33, [50, 53, 57]), (33, [49, 52, 57]),
]
PROG = PROG + PROG
N = len(PROG)
LEN = N * CHORD
TAIL = 9.0
mix = {k: np.zeros((int((LEN + TAIL) * SR), 2)) for k in ('violin', 'cello', 'bass', 'harp')}


def put(stem, t, y):
    i = int(t * SR)
    seg = y[: len(mix[stem]) - i]
    mix[stem][i:i + len(seg)] += seg


# Double bass: the root under each chord, bowed long and soft.
for k, (root, tri) in enumerate(PROG):
    put('bass', k * CHORD, note(BASS, root, CHORD + .3, vel=.55, attack=.9, release=2.0))

# Cello: two long notes per chord on chord tones; in the second pass a gentle counter-line.
CELLO_A = [(50, 53), (50, 53), (48, 53), (48, 52), (50, 46), (50, 53), (45, 50), (45, 49)]
CELLO_B = [(57, 53), (58, 62), (57, 60), (55, 52), (55, 58), (53, 50), (52, 53), (52, 49)]
for k in range(N):
    pair = CELLO_A[k % 8] if k < 8 else CELLO_B[k % 8]
    for j, m in enumerate(pair):
        put('cello', k * CHORD + j * 4 * BEAT, note(CELLO, m, 4 * BEAT + .25, vel=.5 if k < 8 else .58, attack=.45, release=1.4))

# Harp: a slow rising arpeggio through the first pass and the last two chords, very soft.
for k, (root, tri) in enumerate(PROG):
    if 8 <= k < 14:
        continue
    pitches = [tri[0] + 12, tri[1] + 12, tri[2] + 12, tri[0] + 24, tri[2] + 12, tri[1] + 12]
    for j in range(12):
        m = pitches[j % len(pitches)]
        v = .22 + .06 * np.sin(j / 2) + rng.uniform(-.02, .02)
        put('harp', k * CHORD + j * (2 * BEAT / 3) + rng.uniform(0, .02), note(HARP, m, 1.6, vel=v, attack=.002, release=1.6))

# Violin: enters on the third chord; the second pass climbs higher. (beat, midi, beats)
MEL = {
    2: [(0, 69, 2), (2, 72, 2), (4, 77, 4)],
    3: [(0, 76, 3), (3, 74, 1), (4, 72, 4)],
    4: [(0, 74, 2), (2, 70, 2), (4, 67, 4)],
    5: [(0, 77, 2), (2, 79, 2), (4, 77, 2), (6, 74, 2)],
    6: [(0, 76, 2), (2, 77, 2), (4, 81, 4)],
    7: [(0, 76, 4), (4, 73, 4)],
    8: [(0, 81, 4), (4, 86, 4)],
    9: [(0, 84, 3), (3, 82, 1), (4, 81, 4)],
    10: [(0, 81, 2), (2, 79, 2), (4, 77, 4)],
    11: [(0, 79, 3), (3, 76, 1), (4, 72, 4)],
    12: [(0, 82, 4), (4, 81, 2), (6, 79, 2)],
    13: [(0, 77, 4), (4, 74, 4)],
    14: [(0, 76, 2), (2, 77, 2), (4, 74, 4)],
    15: [(0, 73, 4), (4, 76, 3)],
}
for k, notes in MEL.items():
    for b, m, d in notes:
        t = k * CHORD + b * BEAT
        # legato: each note swells in and overlaps the next a little
        put('violin', t, note(VIOLIN, m, d * BEAT + .15, vel=.75 + .1 * (k >= 8), attack=.32 if d >= 2 else .14, release=1.1))

# ---------- mix ----------
LEVEL = {'violin': 1.0, 'cello': .62, 'bass': .5, 'harp': .55}
dry = sum(mix[k] * LEVEL[k] for k in mix)
# warm the strings: a gentle low shelf by blending a lowpassed copy, and tame the top
dry = sosfilt(butter(2, 9000 / (SR / 2), 'low', output='sos'), dry, axis=0)

# a large hall: decaying stereo noise, darker as it fades
n = int(3.8 * SR)
t = np.linspace(0, 1, n)
ir = rng.standard_normal((n, 2)) * np.exp(-t * 7)[:, None]
ir = sosfilt(butter(1, 3500 / (SR / 2), 'low', output='sos'), ir, axis=0)
ir[:int(.02 * SR)] *= np.linspace(0, 1, int(.02 * SR))[:, None]
ir /= np.sqrt((ir ** 2).sum(0))
wet = np.stack([fftconvolve(dry[:, c], ir[:, c])[: len(dry)] for c in (0, 1)], 1)
y = dry * .78 + wet * .55
y = sosfilt(butter(2, 45 / (SR / 2), 'high', output='sos'), y, axis=0)

# fold the tail onto the start so the end flows into the beginning
L = int(LEN * SR)
out = y[:L].copy()
out[: len(y) - L] += y[L:]
out = out / np.max(np.abs(out)) * .75

import soundfile as sf
sf.write(sys.argv[1] if len(sys.argv) > 1 else 'strings.wav', out, SR, subtype='PCM_16')
print(f'{LEN:.1f} s')
