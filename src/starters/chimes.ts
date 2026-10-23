// The Chime Tree starter (ADR 18), by the museum (tag 000000): a little
// tune picked out on the chimes, then the striker swung round the ring,
// which strikes chimes on its way and sets their neighbours knocking in a
// cascade, then the tune again, falling. Written out as data, tuned
// against public/sets/chimes.js (spec/sets-chimes.test.ts holds that it
// plays). Migration 4 seeds it on slot 4 if that plinth is free.
import type { Performance } from "../types.ts";

export const starter: { slot: number; title: string; parts: Performance } = {
  slot: 4,
  title: "Wind Up, Wind Down",
  parts: {
    set: "chimes",
    gestures: [
      { kind: "tap", object: "so", at: 0.5, by: "000000" },
      { kind: "tap", object: "mi", at: 1, by: "000000" },
      { kind: "tap", object: "so", at: 1.5, by: "000000" },
      { kind: "tap", object: "la", at: 2, by: "000000" },
      { kind: "tap", object: "so", at: 2.5, by: "000000" },
      { kind: "tap", object: "do", at: 3.5, by: "000000" },
      { kind: "throw", object: "striker", at: 7, from: [0.45, 1.45, -0.2], v: [0.9, 0.4, 2.6], by: "000000" },
      { kind: "tap", object: "hido", at: 17, by: "000000" },
      { kind: "tap", object: "la", at: 17.5, by: "000000" },
      { kind: "tap", object: "so", at: 18, by: "000000" },
      { kind: "tap", object: "mi", at: 19, by: "000000" },
      { kind: "tap", object: "do", at: 20, by: "000000" },
    ],
  },
};
