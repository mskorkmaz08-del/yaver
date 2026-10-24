"""Yaver interface sounds, built by modal synthesis: each sound is a sequence of physical
events (a pawl striking a ratchet tooth, a spring-steel detent snapping, a latch hitting its
stop, a gear train running) exciting banks of resonators tuned like real small parts
(spring steel, brass, a bakelite switch body, the instrument case), then a small room.
Run: python3 tools/mech_sfx.py OUTDIR  -> OUTDIR/<name>.wav, then encode each one to sounds/<name>.mp3
with ffmpeg -ac 2 -c:a libmp3lame -b:a 128k. Needs numpy, scipy and soundfile.
"""
import sys, os
import numpy as np
from scipy.signal import lfilter, butter, sosfilt, fftconvolve
import soundfile as sf

SR = 48000
rng = np.random.default_rng(11)

# ---------- materials: (freq Hz, decay s, gain) ----------
def material(f0, n, stretch, tau0, seed):
    """A dense, inharmonic set of modes like a small real part: higher modes die faster."""
    r = np.random.default_rng(seed)
    return [(f0 * (1 + 0.85 * k ** stretch) * r.uniform(.92, 1.08), tau0 / (1 + .45 * k), r.uniform(.5, 1) / (1 + .22 * k)) for k in range(n)]


STEEL = material(2900, 16, 1.35, .0055, 1)
SPRING = material(2050, 14, 1.3, .008, 2)
BRASS = material(1450, 14, 1.35, .014, 3)
BAKELITE = material(500, 12, 1.5, .0055, 4)
CASE = material(150, 9, 1.45, .028, 5)
WOOD = material(360, 12, 1.6, .009, 6)
BELL = [(1046, 1.0, 1.0), (2093 * 1.002, .6, .45), (2637 * 1.01, .42, .3), (3520 * .995, .28, .22), (5274, .15, .12), (7040, .08, .06)]


def resonators(x, modes, detune=0.03, scale=1.0):
    """Feed excitation x through a bank of two-pole resonators (one per mode)."""
    y = np.zeros_like(x)
    for f, tau, g in modes:
        f = f * scale * (1 + rng.uniform(-detune, detune))
        tau = tau * rng.uniform(.85, 1.15)
        r = np.exp(-1.0 / (tau * SR))
        w = 2 * np.pi * f / SR
        b = [g * (1 - r * r) * 0.5]
        a = [1, -2 * r * np.cos(w), r * r]
        y += lfilter(b, a, x)
    return y


def burst(n_ms=0.6, bright=9000):
    """A short excitation: a click of filtered noise, like a hard contact."""
    n = max(4, int(SR * n_ms / 1000))
    e = rng.standard_normal(n) * np.hanning(n * 2)[n:]  # sharp attack, quick release
    sos = butter(2, min(bright, SR / 2 - 100) / (SR / 2), 'low', output='sos')
    return sosfilt(sos, e)


class Track:
    def __init__(self, dur):
        self.y = np.zeros(int(SR * dur) + SR // 2)

    def hit(self, t, modes, amp=1.0, ms=0.6, bright=9000, scale=1.0, noise=0.15):
        """One impact at time t (s) on a part made of `modes`."""
        e = np.zeros(int(SR * min(4.0, max(m[1] for m in modes) * 8 + .05)))
        b = burst(ms, bright)
        e[:len(b)] = b
        out = resonators(e, modes, scale=scale)
        out = out / (np.max(np.abs(out)) + 1e-9)
        # the contact itself has a little broadband grit
        out[:len(b)] += b / (np.max(np.abs(b)) + 1e-9) * noise
        i = int(t * SR)
        seg = out[: len(self.y) - i]
        self.y[i:i + len(seg)] += seg * amp

    def scrape(self, t, dur, f_lo, f_hi, amp=0.2, rough=40):
        """Friction: band-limited noise with a grainy amplitude (a lever sliding, a slide moving)."""
        n = int(dur * SR)
        z = rng.standard_normal(n)
        sos = butter(2, [f_lo / (SR / 2), f_hi / (SR / 2)], 'band', output='sos')
        z = sosfilt(sos, z)
        grain = 0.6 + 0.4 * np.abs(np.sin(np.cumsum(rng.uniform(.5, 1.5, n)) * 2 * np.pi * rough / SR))
        env = np.sin(np.linspace(0, np.pi, n)) ** 1.5
        z = z / (np.max(np.abs(z)) + 1e-9) * env * grain * amp
        i = int(t * SR)
        self.y[i:i + n] += z[: len(self.y) - i]

    def render(self, room=0.12, lp=11000, hp=90, peak=0.7, tail=0.08):
        y = self.y
        # small, close room: a short dense decay
        n = int(SR * 0.22)
        ir = rng.standard_normal(n) * np.exp(-np.linspace(0, 9, n))
        ir = sosfilt(butter(1, 5000 / (SR / 2), 'low', output='sos'), ir)
        ir /= np.sqrt(np.sum(ir ** 2))
        wet = fftconvolve(y, ir)[: len(y)]
        y = y + wet * room
        y = sosfilt(butter(2, hp / (SR / 2), 'high', output='sos'), y)
        y = sosfilt(butter(2, lp / (SR / 2), 'low', output='sos'), y)
        # trim the silence and fade the end
        idx = np.where(np.abs(y) > np.max(np.abs(y)) * 0.002)[0]
        end = min(len(y), idx[-1] + int(SR * tail)) if len(idx) else len(y)
        y = y[:end]
        f = int(SR * 0.012)
        y[-f:] *= np.linspace(1, 0, f)
        y = y / (np.max(np.abs(y)) + 1e-9) * peak
        # a little width: the room is a few samples later on the right
        st = np.stack([y, np.concatenate([np.zeros(14), y[:-14]])], 1)
        return st


def detent(tr, t, amp=1.0, scale=1.0):
    """A spring-steel detent snapping into its notch: two contacts 2-3 ms apart, on a small body."""
    tr.hit(t, SPRING, amp * .55, ms=.4, scale=scale)
    tr.hit(t + .0024, STEEL, amp, ms=.35, bright=11000, scale=scale)
    tr.hit(t + .0026, BAKELITE, amp * .35, ms=.8, bright=4000)


SOUNDS = {}

def sound(name):
    def reg(fn):
        SOUNDS[name] = fn
        return fn
    return reg


@sound('tap')       # a small precise switch: press travel, the detent, a body knock
def _():
    tr = Track(.12)
    tr.scrape(0, .012, 1500, 5000, .05)
    detent(tr, .010, 1.0, scale=1.05)
    tr.hit(.0125, CASE, .25, ms=1.2, bright=1500, noise=0)
    return tr.render(room=.08, lp=10000)


@sound('on')        # a toggle lever: slides, then snaps over centre onto its stop
def _():
    tr = Track(.2)
    tr.scrape(0, .035, 900, 4200, .09, rough=60)
    detent(tr, .034, 1.0)
    tr.hit(.037, BRASS, .55, ms=.5, scale=1.08)
    tr.hit(.038, CASE, .5, ms=1.5, bright=1200, noise=0)
    return tr.render(room=.1)


@sound('off')       # the same lever back: a little lower and duller
def _():
    tr = Track(.2)
    tr.scrape(0, .03, 700, 3600, .08, rough=55)
    detent(tr, .029, .9, scale=.9)
    tr.hit(.032, BAKELITE, .6, ms=.9, bright=3500)
    tr.hit(.033, CASE, .55, ms=1.6, bright=1000, noise=0)
    return tr.render(room=.1, lp=9000)


@sound('enter')     # a rotary selector turning one position: two detents and the index pin seating
def _():
    tr = Track(.25)
    tr.scrape(0, .07, 1200, 6000, .05, rough=90)
    detent(tr, .028, .55, scale=1.1)
    detent(tr, .072, 1.0)
    tr.hit(.0745, CASE, .35, ms=1.4, bright=1200, noise=0)
    return tr.render(room=.12)


@sound('spin')      # winding a crown: a pawl clicking over ratchet teeth, faster, then the spring takes it
def _():
    tr = Track(.55)
    t = 0.0
    gaps = [.052, .046, .041, .037, .034, .032, .031, .030]
    for i, g in enumerate(gaps):
        tr.hit(t, STEEL, .75 - i * .03, ms=.3, bright=12000, scale=1.0 + i * .004)
        tr.hit(t + .0012, BRASS, .4, ms=.4, scale=1.15)
        t += g
    tr.scrape(.02, t, 2500, 9000, .035, rough=150)          # gear train running
    tr.hit(t + .02, BRASS, .9, ms=.6, scale=.95)              # spring catches
    tr.hit(t + .021, CASE, .6, ms=2, bright=900, noise=0)
    return tr.render(room=.14)


@sound('open')      # a latch released: catch lifts, the cover slides, a soft stop
def _():
    tr = Track(.4)
    detent(tr, 0, .8, scale=1.15)
    tr.scrape(.012, .16, 600, 3000, .14, rough=35)
    tr.hit(.17, BAKELITE, .55, ms=1.5, bright=2500)
    tr.hit(.171, CASE, .65, ms=2.5, bright=700, noise=0)
    return tr.render(room=.15, lp=8500)


@sound('close')     # the cover slides back and the latch engages with a firm clack
def _():
    tr = Track(.35)
    tr.scrape(0, .11, 700, 3400, .12, rough=40)
    tr.hit(.11, BRASS, 1.0, ms=.5)
    detent(tr, .113, .8, scale=.95)
    tr.hit(.112, CASE, .8, ms=2, bright=900, noise=0)
    return tr.render(room=.13)


@sound('save')      # a stamp: the handle goes down and the die meets the pad, then springs back
def _():
    tr = Track(.35)
    tr.scrape(0, .05, 500, 2500, .07, rough=30)
    tr.hit(.05, WOOD, 1.0, ms=2.5, bright=2500, noise=.05)
    tr.hit(.0505, CASE, .9, ms=3, bright=700, noise=0)
    tr.hit(.052, BRASS, .25, ms=.6, scale=.9)
    detent(tr, .16, .35, scale=1.1)                            # the return spring resets
    return tr.render(room=.12, lp=8000)


@sound('done')      # a counter wheel indexing on, then one strike of a small clock bell
def _():
    tr = Track(4)
    detent(tr, 0, .6)
    detent(tr, .06, .8)
    tr.hit(.09, CASE, .35, ms=1.5, bright=1000, noise=0)
    tr.hit(.16, BELL, .5, ms=.8, bright=6000, noise=.02)
    return tr.render(room=.25, lp=9000, tail=.3)


@sound('step')      # one tick of an escapement: tiny and dry
def _():
    tr = Track(.06)
    tr.hit(0, STEEL, .9, ms=.25, bright=12000, scale=1.08)
    tr.hit(.0016, BRASS, .35, ms=.35, scale=1.3)
    return tr.render(room=.05, lp=11000, peak=.5)


@sound('swipe')     # a gear train freewheeling briefly, a fast blur of teeth
def _():
    tr = Track(.3)
    t = 0
    for i in range(10):
        tr.hit(t, STEEL, .25 + .05 * np.sin(i), ms=.25, bright=10000, scale=1.0 - i * .01)
        t += .016 + i * .0018
    tr.scrape(0, t, 1800, 7000, .06, rough=200)
    return tr.render(room=.12, peak=.55)


@sound('stop')      # a pawl dropping in and locking the wheel: brake
def _():
    tr = Track(.3)
    tr.scrape(0, .06, 1500, 6000, .07, rough=120)
    tr.hit(.06, STEEL, .9, ms=.4)
    tr.hit(.0615, BRASS, .8, ms=.5, scale=.92)
    tr.hit(.062, CASE, .7, ms=2, bright=800, noise=0)
    return tr.render(room=.12)


@sound('bell')      # time's up: two strikes of a small clock bell, the second softer
def _():
    tr = Track(5)
    tr.hit(0, BELL, .8, ms=.8, bright=6000, noise=.02)
    tr.hit(.42, BELL, .5, ms=.8, bright=5000, noise=.02)
    return tr.render(room=.3, lp=9000, tail=.4)


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else 'sfx'
    os.makedirs(out, exist_ok=True)
    for name, fn in SOUNDS.items():
        y = fn()
        sf.write(os.path.join(out, f'{name}.wav'), y, SR, subtype='PCM_16')
        print(f'{name:6s} {len(y) / SR * 1000:6.0f} ms')
