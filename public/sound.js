// Music, not noise (ADR 41): one small instrument on Web Audio for both
// pages. Soft sine and triangle voices through a low-pass filter, slow
// attacks, long releases and a gentle room reverb; every pitch is from D
// major pentatonic, so whatever lands together still harmonises. Nothing
// starts before a gesture, and off is silence, remembered in this browser.

const KEY = "sound";
// D major pentatonic, as MIDI notes: D E F# A B in each octave
const PENTA = [0, 2, 4, 7, 9];
const note = (octave, step) => 12 * (octave + 1) + 2 + PENTA[((step % 5) + 5) % 5] + 12 * Math.floor(step / 5);
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// the arena's chords, each a few pentatonic notes held for a while
const ARENA_CHORDS = [
  [note(2, 0), note(3, 3), note(3, 5), note(4, 2)], // D A D F#: home
  [note(1, 4), note(3, 2), note(3, 3), note(4, 0)], // B F# A D: a softer turn
  [note(2, 1), note(3, 4), note(4, 0), note(4, 3)], // E B D A: lifting
  [note(2, 3), note(3, 1), note(3, 4), note(4, 0)], // A E B D: waiting to come home
];
const ROOM_CHORDS = [
  [note(2, 0), note(3, 3), note(4, 2)],
  [note(1, 4), note(3, 2), note(4, 0)],
  [note(2, 3), note(3, 4), note(4, 1)],
];
const MUSIC = {
  arena: { chords: ARENA_CHORDS, chordEvery: 8, noteGap: [1.6, 3.4], noteChance: 0.65, octave: 5, level: 0.6 }, // turned down after playing it
  room: { chords: ROOM_CHORDS, chordEvery: 12, noteGap: [3.5, 7], noteChance: 0.55, octave: 4, level: 0.8 },
};

function remembered() {
  try { return localStorage.getItem(KEY) !== "off"; } catch { return true; }
}
function remember(on) {
  try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* private mode: this visit only */ }
}

/** A soft room: two seconds and a half of decaying stereo reflections. */
function reverb(ctx) {
  const len = Math.floor(ctx.sampleRate * 2.6);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  let seed = 4020;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = rand() * Math.pow(1 - i / len, 3.2);
  }
  const conv = ctx.createConvolver();
  conv.buffer = buf;
  return conv;
}

export function createSound(kind) {
  let on = remembered();
  let ctx = null, out = null, musicBus = null, sfxBus = null, wet = null;
  let music = null, timer = 0, nextChord = 0, nextNote = 0, chordAt = 0, step = 3;
  const played = [];

  function build() {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    out = ctx.createGain();
    out.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    out.connect(comp).connect(ctx.destination);
    const room = reverb(ctx);
    wet = ctx.createGain();
    wet.gain.value = 0.32;
    wet.connect(room).connect(out);
    musicBus = ctx.createGain();
    musicBus.gain.value = 0;
    const warm = ctx.createBiquadFilter();
    warm.type = "lowpass";
    warm.frequency.value = 1400;
    musicBus.connect(warm).connect(out);
    warm.connect(wet);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.55;
    sfxBus.connect(out);
    sfxBus.connect(wet);
    document.addEventListener("visibilitychange", () => {
      if (!ctx) return;
      if (document.hidden) ctx.suspend();
      else if (on) ctx.resume();
    });
    return true;
  }

  /** One voice: an oscillator (or a few, for a bell) shaped by an envelope. */
  function voice(freq, at, { type = "sine", attack = 0.01, hold = 0, release = 1.2, peak = 0.2, bus = sfxBus, cutoff = 2400, partials = null } = {}) {
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(peak, at + attack);
    env.gain.setValueAtTime(peak, at + attack + hold);
    env.gain.exponentialRampToValueAtTime(0.0001, at + attack + hold + release);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = cutoff;
    env.connect(lp).connect(bus);
    const end = at + attack + hold + release + 0.05;
    for (const [mult, level] of partials ?? [[1, 1]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq * mult;
      const g = ctx.createGain();
      g.gain.value = level;
      o.connect(g).connect(env);
      o.start(at);
      o.stop(end);
    }
  }
  const BELL = [[1, 1], [2, 0.28], [3.01, 0.09]];
  const bell = (m, at, peak = 0.16, release = 1.6) => voice(hz(m), at, { partials: BELL, attack: 0.006, release, peak, cutoff: 5000 });
  const pluck = (m, at, peak = 0.2) => voice(hz(m), at, { type: "triangle", attack: 0.005, release: 0.55, peak, cutoff: 1800 });

  // ---- the music: a slow pad, and now and then a note drifting over it
  function schedule() {
    if (!ctx || !music) return;
    const m = MUSIC[music], horizon = ctx.currentTime + 0.6;
    while (nextChord < horizon) {
      const chord = m.chords[chordAt++ % m.chords.length];
      for (const n of chord) {
        for (const detune of [-4, 4]) {
          voice(hz(n) * Math.pow(2, detune / 1200), nextChord, { type: "triangle", attack: 2.8, hold: m.chordEvery - 3.2, release: 4, peak: 0.032 * m.level, bus: musicBus, cutoff: 900 });
        }
      }
      nextChord += m.chordEvery;
    }
    while (nextNote < horizon) {
      if (Math.random() < m.noteChance) {
        step = Math.max(0, Math.min(9, step + [-2, -1, -1, 1, 1, 2][Math.floor(Math.random() * 6)]));
        bell(note(m.octave, step), nextNote, 0.05 * m.level, 3);
      }
      const [lo, hi] = m.noteGap;
      nextNote += lo + Math.random() * (hi - lo);
    }
  }
  function startMusic() {
    if (!ctx || !on || music) return;
    music = kind;
    nextChord = ctx.currentTime + 0.1;
    nextNote = ctx.currentTime + 2;
    musicBus.gain.cancelScheduledValues(ctx.currentTime);
    musicBus.gain.setValueAtTime(musicBus.gain.value, ctx.currentTime);
    musicBus.gain.linearRampToValueAtTime(1, ctx.currentTime + 3);
    schedule();
    timer = setInterval(schedule, 200);
  }
  function stopMusic() {
    if (!music) return;
    music = null;
    clearInterval(timer);
    if (ctx) {
      musicBus.gain.cancelScheduledValues(ctx.currentTime);
      musicBus.gain.setValueAtTime(musicBus.gain.value, ctx.currentTime);
      musicBus.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
    }
  }

  // ---- the sounds, each a short phrase in the key
  const SOUNDS = {
    /** your launch: a soft pluck, higher the harder you pull */
    launch: (t, { power = 0.5 } = {}) => pluck(note(3, 3 + Math.round(Math.max(0, Math.min(1, power)) * 5)), t, 0.16),
    /** a pickup: a little rising bell */
    pickup: (t) => { bell(note(5, 0), t, 0.14, 1.1); bell(note(5, 3), t + 0.09, 0.12, 1.4); },
    /** your cargo scattered: a falling phrase, low and soft */
    scatter: (t) => {
      [note(4, 3), note(4, 2), note(4, 0), note(3, 3)].forEach((m, i) => pluck(m, t + i * 0.1, 0.13));
      voice(hz(note(2, 0)), t, { attack: 0.03, release: 0.9, peak: 0.12, cutoff: 600 });
    },
    /** your delivery: a warm arpeggio over a held chord */
    deliver: (t) => {
      [note(4, 0), note(4, 3), note(5, 0), note(5, 2), note(5, 3)].forEach((m, i) => bell(m, t + i * 0.085, 0.12, 2.2));
      for (const m of [note(3, 0), note(3, 3), note(4, 2)]) voice(hz(m), t, { type: "triangle", attack: 0.2, hold: 0.6, release: 2.4, peak: 0.05, cutoff: 1200 });
    },
    /** anyone else's delivery: one faint chime */
    deliverOther: (t) => bell(note(5, 3), t, 0.04, 1.8),
    /** through a door: a rising chime */
    door: (t) => [note(4, 3), note(5, 0), note(5, 1), note(5, 3)].forEach((m, i) => bell(m, t + i * 0.07, 0.1, 1.3)),
    /** sitting down: two soft low notes settling */
    sit: (t) => { pluck(note(3, 3), t, 0.12); pluck(note(3, 0), t + 0.12, 0.1); },
    /** a close look: one clear bell */
    look: (t) => bell(note(5, 2), t, 0.1, 2.2),
    /** someone arrives in the room: a faint note */
    arrive: (t) => bell(note(4, 4), t, 0.05, 1.6),
  };

  return {
    /** A gesture happened: the browser now lets sound start. */
    gesture() {
      if (!on) return;
      if (!ctx && !build()) return;
      if (ctx.state === "suspended") ctx.resume();
      startMusic();
    },
    play(name, opts) {
      if (!on || !ctx || !SOUNDS[name]) return;
      played.push(name);
      SOUNDS[name](ctx.currentTime + 0.02, opts);
    },
    get on() { return on; },
    /** Turns sound on or off, remembered. Turning on counts as a gesture. */
    set(v) {
      on = !!v;
      remember(on);
      if (on) this.gesture();
      else {
        stopMusic();
        if (ctx) sfxBus.gain.setTargetAtTime(0.55, ctx.currentTime, 0.01);
      }
    },
    /** For the browser check: what has played, never a sound itself. */
    probe: () => ({ started: !!ctx, on, music, played: [...played] }),
  };
}

/** The sound button: an icon, pressed while sound is on. */
export function soundButton(button, sound) {
  const show = () => {
    button.setAttribute("aria-pressed", String(sound.on));
    button.dataset.off = sound.on ? "false" : "true";
  };
  button.addEventListener("click", () => {
    sound.set(!sound.on);
    show();
  });
  show();
}
