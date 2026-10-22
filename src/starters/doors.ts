// The Swap Doors starter (ADR 18), by the museum (tag 000000): a loop of
// throws through the doors, with the teal door turned a quarter halfway, so
// the passes after it come out somewhere new. Written out as data, tuned
// against public/sets/doors.js (spec/sets-doors.test.ts holds that it
// plays). Migration 4 seeds it on slot 5 if that plinth is free.
import type { Performance } from "../types.ts";

export const starter: { slot: number; title: string; parts: Performance } = {
  slot: 5,
  title: "Wrong Door, Right Bounce",
  parts: {
    set: "doors",
    gestures: [
      { kind: "throw", object: "apricot", at: 1, from: [-0.55, 0.1, 0.85], v: [2.016, 2.605, -1.642], by: "000000" },
      { kind: "throw", object: "plum", at: 3.5, from: [0.286, 0.1, 0.682], v: [-1.973, 2.31, -1.693], by: "000000" },
      { kind: "throw", object: "lemon", at: 6, from: [0, 0.1, 1.15], v: [-1.29, 2.478, -2.257], by: "000000" },
      { kind: "throw", object: "apricot", at: 8.5, from: [1.497, 0.1, -0.195], v: [-2.599, 3.197, -0.062], by: "000000" },
      { kind: "throw", object: "plum", at: 11, from: [-0.419, 0.1, -0.27], v: [2.6, 2.136, 0.043], by: "000000" },
      { kind: "tap", object: "tealdoor", at: 14, by: "000000" },
      { kind: "throw", object: "apricot", at: 15, from: [0.146, 0.1, 1.512], v: [-1.23, 2.873, -2.291], by: "000000" },
      { kind: "throw", object: "plum", at: 17.5, from: [1.891, 0.1, -0.059], v: [-2.424, 2.1, -0.424], by: "000000" },
      { kind: "throw", object: "lemon", at: 20, from: [0.38, 0.1, -0.662], v: [0.933, 2.1, 0.916], by: "000000" },
      { kind: "throw", object: "apricot", at: 22.5, from: [-1.445, 0.1, -0.016], v: [2.586, 3.152, -0.27], by: "000000" },
      { kind: "throw", object: "plum", at: 25, from: [1.446, 0.1, 0.288], v: [-1.436, 2.1, -1.196], by: "000000" },
    ],
  },
};
