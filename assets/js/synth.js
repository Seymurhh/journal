// A small synthesized piano (no sample files). Used for live playback and for the sound in exported videos.

export function makeOutput(ctx) {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18; comp.ratio.value = 4;
  const out = ctx.createGain();
  out.gain.value = 0.9;
  out.connect(comp); comp.connect(ctx.destination);
  return out;
}

// when = context time the note starts; length = seconds until the sound is released.
export function voice(ctx, dest, pitch, vel, when, length) {
  const f = 440 * 2 ** ((pitch - 69) / 12);
  const peak = 0.04 + 0.3 * vel * vel;
  const tau = Math.max(0.3, 2.4 - ((pitch - 21) / 87) * 2); // low notes ring longer
  const rise = 0.006, off = when + Math.max(length, 0.05);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, when);
  env.gain.linearRampToValueAtTime(peak, when + rise);
  env.gain.setTargetAtTime(0, when + rise, tau);
  env.gain.setValueAtTime(peak * Math.exp(-(off - when - rise) / tau), off);
  env.gain.setTargetAtTime(0, off, 0.07);
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass'; tone.frequency.value = Math.min(11000, f * (3 + 6 * vel));
  tone.connect(env); env.connect(dest);
  for (const [mult, type, gain] of [[1, 'triangle', 1], [2, 'sine', 0.28], [3, 'sine', 0.1 * vel]]) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = f * mult; g.gain.value = gain;
    o.connect(g); g.connect(tone);
    o.start(when); o.stop(off + 0.6);
  }
}

// Render the whole piece to a stereo buffer (for video export).
export async function renderPiece(piece, lead, tail, rate = 48000) {
  const ctx = new OfflineAudioContext(2, Math.ceil((lead + piece.duration + tail) * rate), rate);
  const out = makeOutput(ctx);
  for (const n of piece.notes) voice(ctx, out, n.pitch, n.vel, lead + n.onset, n.end - n.onset);
  return ctx.startRendering();
}
