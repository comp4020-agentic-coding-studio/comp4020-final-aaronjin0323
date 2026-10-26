// The hall's robots (ADR 24): one per visitor while a hall stream is open,
// kept here in memory and never stored. The server is the only thing that
// says where a robot is: a page sends launches, this moves robots by the
// shared rule in public/hall.js, and every snapshot goes to every page.
// @ts-ignore -- plain JS module shared with the page
import { advance, checkLaunch, launch, spawnAt, standing } from "../public/hall.js";

type Robot = { pos: number[]; vel: number[]; t: number; seq: number };
type Who = { tag: string; name: string; colour: number };

export function createHall() {
  const robots = new Map<string, { robot: Robot; streams: number }>(); // by pid
  let arrivals = 0;

  return {
    /** A hall stream opened: the visitor's robot, at a spawn point if new. */
    join(pid: string, now: number) {
      const r = robots.get(pid);
      if (r) r.streams++;
      else robots.set(pid, { robot: standing(spawnAt(arrivals++), now), streams: 1 });
    },
    /** A hall stream closed: the robot goes with the visitor's last one. */
    leave(pid: string) {
      const r = robots.get(pid);
      if (!r) return;
      if (--r.streams <= 0) robots.delete(pid);
    },
    /** A launch from a page: checked, then the robot brought up to now and sent. */
    launch(pid: string, body: unknown, now: number) {
      const r = robots.get(pid);
      if (!r) return { ok: false as const, status: 409, error: "no-robot", message: "Open the hall to have a robot" };
      const c = checkLaunch(body);
      if (!c.ok) return { ok: false as const, status: 400, error: "bad-launch", message: c.error };
      r.robot = launch(r.robot, c.launch, now);
      return { ok: true as const, robot: r.robot };
    },
    /** Every robot's snapshot, as the people who own them. Settled robots
     * are brought up to now, so snapshots don't grow stale. */
    view(who: (pid: string) => Who, now: number) {
      return [...robots].map(([pid, r]) => {
        if (r.robot.vel[0] === 0 && r.robot.vel[1] === 0) r.robot = { ...r.robot, t: advance(r.robot, now).t };
        return { ...who(pid), ...r.robot };
      });
    },
  };
}
