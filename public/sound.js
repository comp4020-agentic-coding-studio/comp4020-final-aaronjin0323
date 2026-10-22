// Short synthesized sounds for what happens on the stage (CLAUDE.md, "Sound
// follows what's in view"): Web Audio only, no files. Silent until the
// visitor first touches something (browsers require it anyway), and one
// button mutes it. Each sound is a few oscillators with a quick envelope.

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

function tone({ freq, type = "sine", dur = 0.3, gain = 0.3, slide = 1, delay = 0 }) {
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

// a different pitch per sphere, so a chain of events is a little tune
const PITCH = { chrome: 1, teal: 1.26, gold: 1.5, dusk: 0.84 };

/** Plays the sounds for a batch of stage events (from stageview.update). */
export function play(events) {
  if (!ctx || muted || ctx.state !== "running" || !events.length) return;
  // at most a few at once, or a busy loop turns into noise
  for (const e of events.slice(0, 4)) {
    const p = PITCH[e.object] ?? 1;
    if (e.kind === "home") {
      // the glide home: a soft falling pair, like a breath out
      tone({ freq: 523, dur: 0.9, gain: 0.07, slide: 0.75 });
      tone({ freq: 784, dur: 0.9, gain: 0.04, slide: 0.75, delay: 0.08 });
    } else if (e.kind === "top") {
      // from the top: a soft chime
      for (const [f, d] of [[784, 0], [1047, 0.09]]) tone({ freq: f, dur: 0.8, gain: 0.06, type: "triangle", delay: d });
    } else if (e.kind === "ring") {
      // a bell: inharmonic partials, long tail
      for (const [mult, gain] of [[1, 0.22], [2.76, 0.1], [5.4, 0.05]]) tone({ freq: 660 * mult, dur: 1.6, gain });
    } else if (e.kind === "catch") tone({ freq: 520 * p, dur: 0.25, gain: 0.18, slide: 1.5, type: "triangle" });
    else if (e.kind === "fling") tone({ freq: 700 * p, dur: 0.3, gain: 0.16, slide: 0.45, type: "triangle" });
    else if (e.kind === "knock") tone({ freq: 220 * p, dur: 0.12, gain: 0.25, type: "square", slide: 0.7 });
    else if (e.kind === "hop") tone({ freq: 380 * p, dur: 0.18, gain: 0.14, slide: 1.8 });
    else if (e.kind === "throw") tone({ freq: 300 * p, dur: 0.22, gain: 0.12, slide: 2.2 });
    else if (e.kind === "pluck") {
      tone({ freq: 196, dur: 0.6, gain: 0.2, type: "sawtooth", slide: 0.98 });
      tone({ freq: 392, dur: 0.4, gain: 0.08, type: "triangle" });
    }
  }
}
