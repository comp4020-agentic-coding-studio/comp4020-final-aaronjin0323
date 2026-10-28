// Sound: synthesized with Web Audio, silent until the visitor first
// touches something (browsers require it), and one button mutes it.
let ctx = null;
let muted = false;
export function wake() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    ctx = new C();
  }
  if (ctx.state === "suspended") ctx.resume();
}
export const setMuted = (m) => (muted = m);
export const isMuted = () => muted;
/** One short tone: a frequency, a length, a shape, a loudness, and a slide. */
export function tone({ freq, dur = 0.2, type = "sine", gain = 0.15, slide = 1 }) {
  if (!ctx || muted || ctx.state !== "running") return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * slide), t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}
const BALL_NOTE = { teal: 392, coral: 494, gold: 587, plum: 330 };
/** The sound of one event of the fountain. */
export function play(e) {
  if (e.kind === "ring") {
    tone({ freq: 880, dur: 1.4, type: "sine", gain: 0.18, slide: 0.98 });
    tone({ freq: 1320, dur: 0.9, type: "sine", gain: 0.06, slide: 0.99 });
  } else if (e.kind === "knock") tone({ freq: 240, dur: 0.12, type: "triangle", gain: 0.2, slide: 0.7 });
  else if (e.kind === "flick") tone({ freq: BALL_NOTE[e.ball] ?? 400, dur: 0.25, type: "triangle", gain: 0.12, slide: 1.6 });
  else if (e.kind === "bounce") tone({ freq: (BALL_NOTE[e.ball] ?? 400) * 2, dur: 0.1, type: "sine", gain: 0.07, slide: 1.1 });
}
