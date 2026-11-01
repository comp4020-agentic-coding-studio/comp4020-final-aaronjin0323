// The arena's robots: one per player, in memory, at most MAX_PLAYERS, with
// anyone else in line. What they carry and bank lives in the store. The
// server is the only thing that says where a robot is and what it touched:
// a page sends launches, and the tick steps every robot together on the
// shared 20 ms grid by the rule in public/arena.js.
import {
  GRACE_MS,
  MAX_PLAYERS,
  SETTLE_MS,
  SPAWN,
  SPAWNS,
  STEP_MS,
  VAULT,
  advance,
  checkLaunch,
  collide,
  inVault,
  launch,
  nearestFree,
  onGrid,
  rollMaterial,
  scatterSpots,
  standing,
  touches,
  // @ts-ignore -- plain JS module shared with the page
} from "../public/arena.js";
import type { Store } from "./db.ts";
import { log } from "./log.ts";

type Robot = { pos: number[]; vel: number[]; t: number; seq: number };
type Entry = {
  slot: number;
  robot: Robot; // the snapshot every screen advances
  walked: Robot; // where the tick has stepped it to, on the grid
  streams: number;
  awayUntil: number | null; // with no stream open: a ghost until then, then gone
};
/** A contact: where, and every artifact it sent out, the same for every page. */
export type Hit = { pos: number[]; at: number; scattered: { id: string; kind: string; from: number[]; to: number[] }[] };
export type Welcome = { kind: "restored" } | { kind: "recovered"; carrying: number } | { kind: "new" } | { kind: "waiting" };
const SWEEP_STEPS = 50; // a second
const moving = (r: Robot) => r.vel[0] !== 0 || r.vel[1] !== 0;

export function createArena(store: Store, { now = Date.now(), random = Math.random, spawn = SPAWN }: { now?: number; random?: () => number; spawn?: typeof SPAWN } = {}) {
  const robots = new Map<string, Entry>(); // by pid
  const line: { pid: string; streams: number }[] = []; // waiting for a robot, in order
  let clock = onGrid(now); // every robot has been stepped up to here
  let floor = store.floor(); // the artifacts available, as the store last said
  let hits: Hit[] = [];
  let steps = 0;
  let nextSpawnAt = clock + spawn.everyMs[1];
  const tagOf = (pid: string) => store.who(pid)?.tag ?? "";
  const away = (e: Entry) => e.awayUntil !== null;
  // after a restart, everyone carrying gets the grace from the start
  const pending = new Map<string, number>(store.holders().map((pid) => [pid, onGrid(now) + GRACE_MS]));

  const refresh = () => {
    floor = store.floor();
  };
  /** One artifact on the floor, rolled for `players` active. */
  function spawnOne(t: number, players: number): boolean {
    const added = store.spawn(t, [...robots.values()].map((e) => e.walked.pos), random, () => rollMaterial(players, random(), random(), spawn));
    if (added) refresh();
    return added;
  }
  /** The spawn timer: one artifact per gap, with someone playing, under the
   * target for how many are playing. Ghosts and the line don't count. */
  function spawnDue(t: number): boolean {
    const players = Math.min([...robots.values()].filter((e) => !away(e)).length, spawn.target.length - 1);
    const gap = spawn.everyMs[players];
    if (!gap || t < nextSpawnAt) return false;
    nextSpawnAt = t + gap;
    return floor.length < spawn.target[players] && spawnOne(t, players);
  }
  const freeSlot = () => {
    for (let s = 0; s < MAX_PLAYERS; s++) if (![...robots.values()].some((e) => e.slot === s)) return s;
    return -1;
  };
  /** A robot for `pid` at the lowest free slot's spawn. */
  function seat(pid: string, streams: number) {
    const slot = freeSlot();
    const robot = standing(SPAWNS[slot], clock) as Robot;
    robots.set(pid, { slot, robot, walked: robot, streams, awayUntil: null });
  }

  /** Everything `pid` carries back on the floor, nearest `at`. Safe twice. */
  function release(pid: string, at: number[], t: number): boolean {
    const n = store.cargo(pid).length;
    if (!n) return false;
    const back = store.releaseCargo(pid, t, nearestFree(at, floor.map((f) => f.pos), n));
    refresh();
    log("release", { tag: tagOf(pid), count: back });
    return back > 0;
  }

  /** What a robot touches on step `t`. Each change is the store's single
   * conditional statement, so whoever is checked first on a step wins. */
  function contacts(pid: string, e: Entry, t: number): boolean {
    if (away(e)) return false; // a ghost collects and banks nothing
    let changed = false;
    const pos = e.walked.pos;
    for (const a of floor) {
      if (a.readyAt > t || !touches(pos, a.pos)) continue;
      if (store.pickUp(pid, a.id, t).picked) {
        changed = true;
        log("pickup", { tag: tagOf(pid), id: a.id, kind: a.kind });
      }
    }
    if (changed) refresh();
    // banking needs a robot moving in the vault: standing in it banks nothing
    if (moving(e.walked) && inVault(pos)) {
      const n = store.bank(pid, t).banked;
      if (n) {
        changed = true;
        log("bank", { tag: tagOf(pid), count: n });
      }
    }
    return changed;
  }

  /** Two robots touched on step `t`: both bounce, and both lose everything
   * they carry, fanned out away from each other. Speed and who moved don't
   * matter. Both get new snapshots. */
  function meet(pa: string, a: Entry, pb: string, b: Entry, t: number): boolean {
    if (away(a) || away(b)) return false; // ghosts meet nobody
    const c = collide(a.walked, b.walked);
    if (!c) return false;
    a.walked = a.robot = { ...c.a, t };
    b.walked = b.robot = { ...c.b, t };
    const from = { [pa]: c.a.pos, [pb]: c.b.pos };
    const lost = store.scatter(
      [
        { pid: pa, spots: scatterSpots(c.a.pos, [-c.n[0], -c.n[1]], store.cargo(pa).length) },
        { pid: pb, spots: scatterSpots(c.b.pos, c.n, store.cargo(pb).length) },
      ],
      t + SETTLE_MS,
    );
    if (lost.length) {
      refresh();
      log("scatter", { a: tagOf(pa), b: tagOf(pb), count: lost.length, closing: Math.round(c.closing * 100) / 100 });
    }
    hits.push({ pos: [(c.a.pos[0] + c.b.pos[0]) / 2, (c.a.pos[1] + c.b.pos[1]) / 2], at: t, scattered: lost.map((l) => ({ id: l.id, kind: l.kind, from: from[l.pid], to: l.to })) });
    return true;
  }

  /** One step for every robot together: move, meet, touch, in a fixed order. */
  function stepAll(t: number): boolean {
    let changed = false;
    const all = [...robots].sort(([, x], [, y]) => x.slot - y.slot);
    for (const [, e] of all) e.walked = moving(e.walked) ? advance(e.walked, t) : { ...e.walked, t };
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (meet(all[i][0], all[i][1], all[j][0], all[j][1], t)) changed = true;
    for (const [pid, e] of all) if (contacts(pid, e, t)) changed = true;
    // the grace runs out: cargo back to the floor nearest the robot, robot gone
    for (const [pid, e] of all) {
      if (e.awayUntil === null || e.awayUntil > t) continue;
      release(pid, e.walked.pos, t);
      robots.delete(pid);
      changed = true;
      const next = line.shift();
      if (next) seat(next.pid, next.streams);
    }
    for (const [pid, until] of pending) {
      if (until > t) continue;
      pending.delete(pid);
      if (release(pid, VAULT, t)) changed = true;
    }
    if (spawnDue(t)) changed = true;
    // and nothing stays with anyone who has neither a robot nor a grace
    if (++steps % SWEEP_STEPS === 0) {
      for (const pid of store.holders()) {
        if (robots.has(pid) || pending.has(pid)) continue;
        if (release(pid, VAULT, t)) changed = true;
      }
    }
    return changed;
  }
  /** Steps everything up to `to`. True if the pages need telling. */
  function stepTo(to: number): boolean {
    let changed = false;
    for (const end = onGrid(to); clock + STEP_MS <= end; ) {
      clock += STEP_MS;
      if (stepAll(clock)) changed = true;
    }
    return changed;
  }

  // the first arrival finds a floor
  while (floor.length < spawn.target[1] && spawnOne(clock, 1));

  return {
    /** A stream opened: their robot kept for them, a new one, or a place in
     * line. Stepped up to now first, so a passed grace has already run out. */
    join(pid: string, now: number): Welcome {
      stepTo(now);
      const e = robots.get(pid);
      if (e) {
        e.streams++;
        if (e.awayUntil === null) return { kind: "restored" };
        e.awayUntil = null;
        log("back", { tag: tagOf(pid) });
        return { kind: "restored" };
      }
      const waiting = line.find((w) => w.pid === pid);
      if (waiting) {
        waiting.streams++;
        return { kind: "waiting" };
      }
      if (freeSlot() < 0) {
        line.push({ pid, streams: 1 });
        return { kind: "waiting" };
      }
      seat(pid, 1);
      if (pending.delete(pid)) return { kind: "recovered", carrying: store.cargo(pid).length };
      return { kind: "new" };
    },
    /** A stream closed. With their last one gone, a robot is a ghost for
     * GRACE_MS; someone in line just leaves it. */
    leave(pid: string, now: number) {
      const w = line.findIndex((x) => x.pid === pid);
      if (w >= 0) {
        if (--line[w].streams <= 0) line.splice(w, 1);
        return;
      }
      const e = robots.get(pid);
      if (!e || --e.streams > 0) return;
      e.streams = 0;
      e.awayUntil = onGrid(now) + GRACE_MS;
    },
    /** A launch from a page: checked; everything is stepped up to now, then
     * the robot leaves from this step, whether or not it was moving. */
    launch(pid: string, body: unknown, now: number) {
      const e = robots.get(pid);
      if (!e || away(e)) return { ok: false as const, status: 409, error: "no-robot", message: "You have no robot right now" };
      const c = checkLaunch(body);
      if (!c.ok) return { ok: false as const, status: 400, error: "bad-launch", message: c.error };
      // a delayed or repeated request: not newer than the robot's last launch
      if (c.launch.seq <= e.robot.seq) return { ok: false as const, status: 409, error: "stale-launch", message: "That launch was already overtaken", robot: e.robot };
      stepTo(now);
      e.robot = e.walked = launch(e.walked, c.launch, clock, store.cargo(pid).length) as Robot;
      return { ok: true as const, robot: e.robot };
    },
    /** The tick: step every robot up to now. True if the pages need telling. */
    tick: (now: number) => stepTo(now),
    /** Hits since the last call, for the next broadcast. */
    hits() {
      const out = hits;
      hits = [];
      return out;
    },
    /** Re-reads the floor, after the store was changed from outside. */
    refresh,
    floor: () => floor,
    /** Your place in line, from 1; 0 if you're not in it. */
    placeOf: (pid: string) => line.findIndex((w) => w.pid === pid) + 1,
    /** For tests: a robot put somewhere, as no page can. */
    place(pid: string, pos: number[], vel: number[], t: number) {
      const e = robots.get(pid);
      if (e) e.robot = e.walked = { ...e.robot, pos: [pos[0], pos[1]], vel: [vel[0], vel[1]], t: onGrid(t) };
    },
    /** Every robot, as tags only. Settled robots are brought up to now. */
    view(now: number) {
      return [...robots].map(([pid, e]) => {
        if (!moving(e.robot)) e.robot = { ...e.robot, t: Math.max(e.robot.t, onGrid(now)) };
        const banked = Object.values(store.collection(pid)).reduce((a, b) => a + b, 0);
        return { tag: tagOf(pid), slot: e.slot, ...e.robot, carrying: store.cargo(pid), away: away(e), banked };
      });
    },
  };
}
