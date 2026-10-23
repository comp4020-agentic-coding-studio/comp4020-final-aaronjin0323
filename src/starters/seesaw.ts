// The Tipping Point starter performance (ADR 18), by the museum (tag
// 000000), for plinth 6: the big stone dropped on one end and then the
// other, so the small stone is catapulted back and forth across the stage;
// the middle stone joins in, the plank is tipped and hopped. Tuned against
// public/sets/seesaw.js; written out as data, like the migrations' starters.
// Migration 4 seeds it (spec/sets-seesaw.test.ts holds it).
import type { Performance } from "../types.ts";

export const starter: { slot: number; title: string; parts: Performance } = {
  slot: 6,
  title: "Pebble Ping-Pong",
  parts: {
    set: "seesaw",
    gestures: [
      { kind: "throw", object: "boulder", at: 1, from: [1.2, 1.8, 0], v: [0, -0.5, 0], by: "000000" },
      { kind: "throw", object: "boulder", at: 5, from: [-1.2, 1.8, 0], v: [0, -0.5, 0], by: "000000" },
      { kind: "throw", object: "stone", at: 9, from: [1.25, 1.9, 0], v: [0, -2, 0], by: "000000" },
      { kind: "nudge", object: "plank", at: 12.5, side: -1, by: "000000" },
      { kind: "throw", object: "boulder", at: 16, from: [1.2, 1.8, 0], v: [0, -0.5, 0], by: "000000" },
      { kind: "throw", object: "boulder", at: 20, from: [-1.2, 1.8, 0], v: [0, -0.5, 0], by: "000000" },
      { kind: "nudge", object: "plank", at: 24, side: 0, by: "000000" },
    ],
  },
};
