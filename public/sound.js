// Short synthesized sounds for what happens on the stage (CLAUDE.md, "Sound
// follows what's in view"): Web Audio only, no files. Silent until the
// visitor first touches something (browsers require it anyway), and one
// button mutes it. Each sound is a few oscillators with a quick envelope;
// what each set's events sound like is its view's (public/sets/<id>-view.js).
import { viewOf } from "./sets/views.js";

let ctx = null;
let master = null;
let muted = false;
const KEY = "museum-muted";
try {
  muted = localStorage.getItem(KEY) === "1";
} catch {
  // storage blocked: unmuted by default
}

/** Wakes the audio on the visitor's first touch. */
export function unlock() {
  if (ctx) return ctx.state === "suspended" ? ctx.resume() : undefined;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.5;
  master.connect(ctx.destination);
}

export const isMuted = () => muted;
export function setMuted(m) {
  muted = m;
  try {
    localStorage.setItem(KEY, m ? "1" : "0");
  } catch {
    // fine: it lasts for this visit
  }
  if (master) master.gain.setTargetAtTime(m ? 0 : 0.5, ctx.currentTime, 0.02);
}

/** One short synthesized note: an oscillator through a quick envelope.
 * Every set's view plays its sounds with this (`sounds(events, tone)`). */
export function tone({ freq, type = "sine", dur = 0.3, gain = 0.3, slide = 1, delay = 0 }) {
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide !== 1) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** Plays the sounds for a batch of stage events (from a view's update), on
 * set `set`: the loop's own marks here, everything else the set's view's
 * `sounds`. */
export function play(events, set) {
  if (!ctx || muted || ctx.state !== "running" || !events.length) return;
  // at most a few at once, or a busy loop turns into noise
  const some = events.slice(0, 4);
  for (const e of some) {
    if (e.kind === "home") {
      // the glide home: a soft falling pair, like a breath out
      tone({ freq: 523, dur: 0.9, gain: 0.07, slide: 0.75 });
      tone({ freq: 784, dur: 0.9, gain: 0.04, slide: 0.75, delay: 0.08 });
    } else if (e.kind === "top") {
      // from the top: a soft chime
      for (const [f, d] of [[784, 0], [1047, 0.09]]) tone({ freq: f, dur: 0.8, gain: 0.06, type: "triangle", delay: d });
    }
  }
  viewOf(set)?.sounds(some.filter((e) => e.kind !== "home" && e.kind !== "top"), tone);
}
