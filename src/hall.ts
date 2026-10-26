// The hall's robots (ADR 24), what they collect (ADR 25) and how they meet
// (ADR 26). A robot is one per visitor while a hall stream is open, kept
// here in memory; what it carries and what's been collected live in the
// store. The server is the only thing that says where a robot is and what
// it touched: a page sends launches, and the tick steps every robot
// together on the shared 20 ms grid by the rule in public/hall.js, checking
// each step for robots meeting, artifacts touched and zones entered.
import {
  CARRY_MAX,
  DROP_PROTECT_MS,
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
};
/** What happened that a page might show: a knock, for now. */
export type News = { kind: "knock"; by: string; from: string; artifact: { id: string; kind: string }; pos: number[]; at: number };
const moving = (r: Robot) => r.vel[0] !== 0 || r.vel[1] !== 0;

export function createHall(store: Store, { now = Date.now(), random = Math.random }: { now?: number; random?: () => number } = {}) {
  const robots = new Map<string, Entry>(); // by pid
  let clock = onGrid(now); // every robot has been stepped up to here
  let floor = store.floor(); // the artifacts available, as the store last said
  let news: News[] = [];
  const tagOf = (pid: string) => store.who(pid)?.tag ?? "";

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
    if (atHome(pos, HOMES[e.walked.home]) && store.cargo(pid).length) {
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
    const c = collide(a.walked, b.walked);
    if (!c) return false;
    a.walked = a.robot = { ...c.a, t };
    b.walked = b.robot = { ...c.b, t };
    if (!c.struck) return true;
    const [sp, s, strikerPid, away]: [string, Entry, string, number[]] = c.struck === "b" ? [pb, b, pa, c.n] : [pa, a, pb, [-c.n[0], -c.n[1]]];
    if (!knocks(c, s.protectedUntil, t)) return true;
    const pos = dropSpot(s.walked.pos, away);
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
    /** A hall stream opened: the visitor's robot, standing in their zone if
     * new (where anything they were carrying is delivered). */
    join(pid: string, now: number) {
      stepTo(now);
      const e = robots.get(pid);
      if (e) return void e.streams++;
      const home = store.hallHome(pid, now);
      const robot = standing(HOMES[home], clock, home) as Robot;
      const fresh: Entry = { robot, walked: robot, streams: 1, protectedUntil: 0 };
      robots.set(pid, fresh);
      contacts(pid, fresh, clock);
    },
    /** A hall stream closed: the robot goes with the visitor's last one.
     * Its cargo stays in the store, theirs to deliver another time. */
    leave(pid: string) {
      const e = robots.get(pid);
      if (e && --e.streams <= 0) robots.delete(pid);
    },
    /** A launch from a page: checked; everything is stepped up to now, then
     * the robot leaves from this step. */
    launch(pid: string, body: unknown, now: number) {
      const e = robots.get(pid);
      if (!e) return { ok: false as const, status: 409, error: "no-robot", message: "Open the hall to have a robot" };
      const c = checkLaunch(body);
      if (!c.ok) return { ok: false as const, status: 400, error: "bad-launch", message: c.error };
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
          display: store.publicDisplay(pid),
        };
      });
    },
  };
}
