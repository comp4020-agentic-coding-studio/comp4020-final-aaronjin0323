// The hall's robots (ADR 24) and what they collect (ADR 25). A robot is one
// per visitor while a hall stream is open, kept here in memory; what it
// carries and what's been collected live in the store. The server is the
// only thing that says where a robot is and what it touched: a page sends
// launches, this moves robots by the shared rule in public/hall.js, and a
// tick walks every moving robot along its steps, checking each against the
// artifacts on the floor and the robot's own delivery zone.
// @ts-ignore -- plain JS module shared with the page
import { CARRY_MAX, HOMES, STEP_MS, advance, atHome, checkLaunch, launch, standing, touches } from "../public/hall.js";
import type { Store } from "./db.ts";
import { log } from "./log.ts";

type Robot = { pos: number[]; vel: number[]; t: number; seq: number };
type Who = { tag: string; name: string; colour: number };
type Entry = {
  robot: Robot; // the snapshot everyone advances
  walked: Robot; // how far the tick has checked it: the snapshot advanced in whole steps
  streams: number;
  home: number;
};
const moving = (r: Robot) => r.vel[0] !== 0 || r.vel[1] !== 0;

export function createHall(store: Store) {
  const robots = new Map<string, Entry>(); // by pid
  let floor = store.floor(); // the artifacts available, as the store last said

  const refill = (now: number) => {
    store.fillFloor(now, [...robots.values()].map((e) => e.walked.pos));
    floor = store.floor();
  };

  /** What a robot at `pos` touches: artifacts it can carry, and its zone.
   * Every change is the store's single conditional statement, so checking
   * the same place twice changes nothing. True if anything changed. */
  function contacts(pid: string, e: Entry, pos: number[], now: number): boolean {
    let changed = false;
    for (const a of floor) {
      if (!touches(pos, a.pos)) continue;
      if (store.cargo(pid).length >= CARRY_MAX) break;
      if (store.pickUp(pid, a.id, now).picked) {
        changed = true;
        log("pickup", { tag: store.who(pid)?.tag, id: a.id, kind: a.kind });
      }
    }
    if (changed) refill(now);
    if (atHome(pos, HOMES[e.home]) && store.cargo(pid).length) {
      const n = store.deliver(pid, now).delivered;
      if (n) {
        changed = true;
        log("deliver", { tag: store.who(pid)?.tag, count: n });
      }
    }
    return changed;
  }

  /** Checks a robot's every step up to `to`. True if anything changed. */
  function walk(pid: string, e: Entry, to: number): boolean {
    let changed = false;
    while (moving(e.walked) && e.walked.t + STEP_MS <= to) {
      e.walked = advance(e.walked, e.walked.t + STEP_MS);
      if (contacts(pid, e, e.walked.pos, e.walked.t)) changed = true;
    }
    return changed;
  }

  refill(Date.now());

  return {
    /** A hall stream opened: the visitor's robot, standing in their zone if
     * new (where anything they were carrying is delivered). */
    join(pid: string, now: number) {
      const e = robots.get(pid);
      if (e) return void e.streams++;
      const home = store.hallHome(pid, now);
      const robot = standing(HOMES[home], now);
      const fresh: Entry = { robot, walked: robot, streams: 1, home };
      robots.set(pid, fresh);
      contacts(pid, fresh, robot.pos, now);
    },
    /** A hall stream closed: the robot goes with the visitor's last one.
     * Its cargo stays in the store, theirs to deliver another time. */
    leave(pid: string) {
      const e = robots.get(pid);
      if (e && --e.streams <= 0) robots.delete(pid);
    },
    /** A launch from a page: checked; everything up to now is walked first,
     * then the robot is brought to now and sent. */
    launch(pid: string, body: unknown, now: number) {
      const e = robots.get(pid);
      if (!e) return { ok: false as const, status: 409, error: "no-robot", message: "Open the hall to have a robot" };
      const c = checkLaunch(body);
      if (!c.ok) return { ok: false as const, status: 400, error: "bad-launch", message: c.error };
      walk(pid, e, now);
      e.robot = launch(e.robot, c.launch, now);
      e.walked = e.robot;
      return { ok: true as const, robot: e.robot };
    },
    /** The tick: walk every moving robot up to now. True if anything was
     * picked up or delivered, so the pages need telling. */
    tick(now: number): boolean {
      let changed = false;
      for (const [pid, e] of robots) if (walk(pid, e, now)) changed = true;
      return changed;
    },
    floor: () => floor,
    homeOf: (pid: string) => robots.get(pid)?.home ?? store.hallHome(pid, Date.now()),
    /** Every robot's snapshot and cargo, as the people who own them. Settled
     * robots are brought up to now, so snapshots don't grow stale. */
    view(who: (pid: string) => Who, now: number) {
      return [...robots].map(([pid, e]) => {
        if (!moving(e.robot)) e.robot = { ...e.robot, t: advance(e.robot, now).t };
        return { ...who(pid), ...e.robot, home: e.home, carrying: store.cargo(pid) };
      });
    },
  };
}
