// The hall's robots (ADR 24), what they collect (ADR 25), how they meet
// (ADR 26), and what happens when their players leave (ADR 27). A robot is one per visitor while a hall stream is open, kept
// here in memory; what it carries and what's been collected live in the
// store. The server is the only thing that says where a robot is and what
// it touched: a page sends launches, and the tick steps every robot
// together on the shared 20 ms grid by the rule in public/hall.js, checking
// each step for robots meeting, artifacts touched and zones entered.
import {
  CARRY_MAX,
  DROP_PROTECT_MS,
  GRACE_MS,
  HOMES,
  PICKUP_DELAY_MS,
  STEP_MS,
  advance,
  atHome,
  checkLaunch,
  collide,
  dropSpot,
  knocks,
  launch,
  nearestFree,
  onGrid,
  standing,
  touches,
  // @ts-ignore -- plain JS module shared with the page
} from "../public/hall.js";
import type { Store } from "./db.ts";
import { log } from "./log.ts";

type Robot = { pos: number[]; vel: number[]; t: number; seq: number; home: number };
type Who = { tag: string; name: string; colour: number };
type Entry = {
  robot: Robot; // the snapshot every screen advances
  walked: Robot; // where the tick has stepped it to, on the grid
  streams: number;
  protectedUntil: number; // after dropping one, it can't be knocked again until then
  awayUntil: number | null; // with no stream open: a ghost until then, then gone
};
/** What happened that a page might show. */
export type News =
  | { kind: "knock"; by: string; from: string; artifact: { id: string; kind: string }; pos: number[]; at: number }
  | { kind: "released"; tag: string; name: string; count: number; at: number };
/** How a visitor's join went: a robot kept for them, recovered after a
 * restart, or new (saying how much cargo went back while they were away). */
export type Welcome = { kind: "restored" } | { kind: "recovered"; carrying: number } | { kind: "new"; released: number };
const SWEEP_STEPS = 50; // a second
const moving = (r: Robot) => r.vel[0] !== 0 || r.vel[1] !== 0;

export function createHall(store: Store, { now = Date.now(), random = Math.random }: { now?: number; random?: () => number } = {}) {
  const robots = new Map<string, Entry>(); // by pid
  let clock = onGrid(now); // every robot has been stepped up to here
  let floor = store.floor(); // the artifacts available, as the store last said
  let news: News[] = [];
  let steps = 0;
  const tagOf = (pid: string) => store.who(pid)?.tag ?? "";
  const away = (e: Entry) => e.awayUntil !== null;
  // after a restart, everyone carrying gets the grace from the start; and
  // anyone whose cargo went back while they were away hears so on return
  const pending = new Map<string, number>(store.holders().map((pid) => [pid, onGrid(now) + GRACE_MS]));
  const releasedWhileAway = new Map<string, number>();

  /** Everything `pid` carries back on the floor, at the free safe spots
   * nearest `at`. Each artifact goes only from carried by them, so this is
   * safe to call twice. How many went. */
  function release(pid: string, at: number[], t: number): number {
    const n = store.cargo(pid).length;
    if (!n) return 0;
    const back = store.releaseCargo(pid, t, nearestFree(at, floor.map((f) => f.pos), n));
    if (!back.length) return 0;
    refresh();
    news.push({ kind: "released", tag: tagOf(pid), name: store.who(pid)?.name ?? "Someone", count: back.length, at: t });
    log("release", { tag: tagOf(pid), count: back.length });
    return back.length;
  }

  const refresh = () => {
    floor = store.floor();
  };
  const refill = (t: number) => {
    store.fillFloor(t, [...robots.values()].map((e) => e.walked.pos), random);
    refresh();
  };

  /** What a robot touches on step `t`: artifacts it can carry (once
   * they're ready), and its own zone. Every change is the store's single
   * conditional statement, so whoever is checked first on a step wins, and
   * checking again changes nothing. True if anything changed. */
  function contacts(pid: string, e: Entry, t: number): boolean {
    if (away(e)) return false; // a ghost collects and delivers nothing
    let changed = false;
    const pos = e.walked.pos;
    for (const a of floor) {
      if (a.readyAt > t || !touches(pos, a.pos)) continue;
      if (store.cargo(pid).length >= CARRY_MAX) break;
      if (store.pickUp(pid, a.id, t).picked) {
        changed = true;
        log("pickup", { tag: tagOf(pid), id: a.id, kind: a.kind });
      }
    }
    if (changed) refill(t);
    // delivery needs a robot moving in its zone: standing in it (fresh, or
    // back after a restart) delivers nothing
    if (moving(e.walked) && atHome(pos, HOMES[e.walked.home]) && store.cargo(pid).length) {
      const n = store.deliver(pid, t).delivered;
      if (n) {
        changed = true;
        log("deliver", { tag: tagOf(pid), count: n });
      }
    }
    return changed;
  }

  /** Two robots met on step `t`: both bounce, and the struck one may drop
   * its newest carried artifact. Both get new snapshots. */
  function meet(pa: string, a: Entry, pb: string, b: Entry, t: number): boolean {
    if (away(a) || away(b)) return false; // ghosts collide with nobody
    const c = collide(a.walked, b.walked);
    if (!c) return false;
    a.walked = a.robot = { ...c.a, t };
    b.walked = b.robot = { ...c.b, t };
    if (!c.struck) return true;
    const [sp, s, strikerPid, outward]: [string, Entry, string, number[]] = c.struck === "b" ? [pb, b, pa, c.n] : [pa, a, pb, [-c.n[0], -c.n[1]]];
    if (!knocks(c, s.protectedUntil, t)) return true;
    const pos = dropSpot(s.walked.pos, outward);
    const lost = store.knockLoose(sp, t, pos, t + PICKUP_DELAY_MS);
    if (!lost) return true;
    s.protectedUntil = t + DROP_PROTECT_MS;
    refresh();
    news.push({ kind: "knock", by: tagOf(strikerPid), from: tagOf(sp), artifact: lost, pos, at: t });
    log("knock", { by: tagOf(strikerPid), from: tagOf(sp), id: lost.id, kind: lost.kind, closing: Math.round(c.closing * 100) / 100 });
    return true;
  }

  /** One step for every robot together: move, meet, touch, in a fixed order. */
  function stepAll(t: number): boolean {
    let changed = false;
    const all = [...robots].sort(([x], [y]) => (tagOf(x) < tagOf(y) ? -1 : 1));
    for (const [, e] of all) e.walked = moving(e.walked) ? advance(e.walked, t) : { ...e.walked, t };
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) if (meet(all[i][0], all[i][1], all[j][0], all[j][1], t)) changed = true;
    for (const [pid, e] of all) if (contacts(pid, e, t)) changed = true;
    // the grace runs out: cargo back to the floor nearest the robot, robot gone
    for (const [pid, e] of all) {
      if (e.awayUntil === null || e.awayUntil > t) continue;
      const n = release(pid, e.walked.pos, t);
      if (n) releasedWhileAway.set(pid, (releasedWhileAway.get(pid) ?? 0) + n);
      robots.delete(pid);
      changed = true;
    }
    for (const [pid, until] of pending) {
      if (until > t) continue;
      pending.delete(pid);
      const n = release(pid, HOMES[store.hallHome(pid, t)], t);
      if (n) {
        releasedWhileAway.set(pid, (releasedWhileAway.get(pid) ?? 0) + n);
        changed = true;
      }
    }
    // and nothing stays with anyone who has neither a robot nor a grace
    if (++steps % SWEEP_STEPS === 0) {
      for (const pid of store.holders()) {
        if (robots.has(pid) || pending.has(pid)) continue;
        const n = release(pid, HOMES[store.hallHome(pid, t)], t);
        if (n) {
          releasedWhileAway.set(pid, (releasedWhileAway.get(pid) ?? 0) + n);
          changed = true;
        }
      }
    }
    return changed;
  }
  /** Steps everything up to server time `to`. True if anything changed
   * that the pages need telling (a pickup, delivery or meeting). */
  function stepTo(to: number): boolean {
    let changed = false;
    for (const end = onGrid(to); clock + STEP_MS <= end; ) {
      clock += STEP_MS;
      if (stepAll(clock)) changed = true;
    }
    return changed;
  }

  refill(clock);

  return {
    /** A hall stream opened. The hall is stepped up to now first, so a
     * grace that has run out has already released; one that hasn't keeps
     * the robot for them, where it is, carrying what it carried. Otherwise
     * a robot in their zone (still carrying, after a restart's grace). */
    join(pid: string, now: number): Welcome {
      stepTo(now);
      const e = robots.get(pid);
      if (e) {
        e.streams++;
        if (e.awayUntil !== null) {
          e.awayUntil = null;
          log("hall-back", { tag: tagOf(pid) });
        }
        return { kind: "restored" };
      }
      const home = store.hallHome(pid, now);
      const robot = standing(HOMES[home], clock, home) as Robot;
      robots.set(pid, { robot, walked: robot, streams: 1, protectedUntil: 0, awayUntil: null });
      if (pending.delete(pid)) return { kind: "recovered", carrying: store.cargo(pid).length };
      const released = releasedWhileAway.get(pid) ?? 0;
      releasedWhileAway.delete(pid);
      return { kind: "new", released };
    },
    /** A hall stream closed. With the visitor's last one gone, their robot
     * is a ghost for GRACE_MS: it delivers nothing for leaving. */
    leave(pid: string, now: number) {
      const e = robots.get(pid);
      if (!e || --e.streams > 0) return;
      e.streams = 0;
      e.awayUntil = onGrid(now) + GRACE_MS;
    },
    /** A launch from a page: checked; everything is stepped up to now, then
     * the robot leaves from this step. */
    launch(pid: string, body: unknown, now: number) {
      const e = robots.get(pid);
      if (!e || away(e)) return { ok: false as const, status: 409, error: "no-robot", message: "Open the hall to have a robot" };
      const c = checkLaunch(body);
      if (!c.ok) return { ok: false as const, status: 400, error: "bad-launch", message: c.error };
      // a delayed or repeated request: not newer than the robot's last launch
      if (c.launch.seq <= e.robot.seq) return { ok: false as const, status: 409, error: "stale-launch", message: "That launch was already overtaken", robot: e.robot };
      stepTo(now);
      e.robot = e.walked = launch(e.walked, c.launch, clock) as Robot;
      return { ok: true as const, robot: e.robot };
    },
    /** The tick: step every robot up to now. True if the pages need telling. */
    tick: (now: number) => stepTo(now),
    /** What happened since the last call, for the next broadcast. */
    news() {
      const out = news;
      news = [];
      return out;
    },
    /** Re-reads the floor, after the store was changed from outside. */
    refresh,
    floor: () => floor,
    homeOf: (pid: string) => robots.get(pid)?.walked.home ?? store.hallHome(pid, clock),
    /** Every robot's snapshot, cargo, protection and public display, as the
     * people who own them. Settled robots are brought up to now. */
    view(who: (pid: string) => Who | null, now: number) {
      return [...robots].map(([pid, e]) => {
        if (!moving(e.robot)) e.robot = { ...e.robot, t: Math.max(e.robot.t, onGrid(now)) };
        return {
          ...(who(pid) ?? { tag: "", name: "Someone", colour: 0 }),
          ...e.robot,
          carrying: store.cargo(pid),
          protectedUntil: e.protectedUntil,
          away: away(e),
          display: store.publicDisplay(pid),
        };
      });
    },
  };
}
