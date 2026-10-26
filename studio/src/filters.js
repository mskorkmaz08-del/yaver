// One Euro filter (Casiez et al.): smooths a jittery signal heavily while it
// is nearly still, and lightly while it moves fast, so a resting hand stops
// shaking without making quick moves feel laggy.
export class OneEuro {
  // minCutoff: smoothing at rest (lower = steadier). beta: how quickly the
  // smoothing lets go as speed rises (higher = less lag on fast moves).
  constructor(minCutoff = 1, beta = 0, dCutoff = 1) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = null;
    this.dx = 0;
    this.t = 0;
  }

  // `t` is in milliseconds.
  filter(value, t) {
    if (this.x === null) {
      this.x = value;
      this.t = t;
      return value;
    }
    const dt = Math.max((t - this.t) / 1000, 1e-3);
    this.t = t;
    const alpha = (cutoff) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
    const dx = (value - this.x) / dt;
    this.dx += alpha(this.dCutoff) * (dx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += alpha(cutoff) * (value - this.x);
    return this.x;
  }
}
