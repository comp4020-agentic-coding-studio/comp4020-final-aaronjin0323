// The arena over the real store with a clock the test turns: pickups, load,
// knocks and steals, the vault, the line for a robot, leaving and restarts.
import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { openStore } from "../src/db.ts";
import { createArena } from "../src/arena.ts";
// @ts-ignore -- plain JS module shared with the page
import * as A from "../public/arena.js";

const T0 = 1_800_000_000_000; // on the 20 ms grid

function world(store: any = openStore(":memory:"), start = T0, spawn?: any) {
  let seed = 7;
  const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647; // fits a double exactly
  const arena = createArena(store, { now: start, random, ...(spawn ? { spawn } : {}) });
  let now = start;
  let seq = 0;
  const w = {
    store,
    arena,
    now: () => now,
    join(pid: string = store.visitor(null, now).pid) {
      arena.join(pid, now);
      return pid;
    },
    leave: (pid: string) => arena.leave(pid, now),
    robots: () => arena.view(now),
    robot(pid: string): any {
      const r = w.robots().find((x: any) => x.tag === store.who(pid).tag);
      return r ? { ...r, ...A.advance(r, now) } : null;
    },
    run(ms: number) {
      for (const end = now + ms; now < end; ) {
        now += 20;
        arena.tick(now);
      }
    },
    launch(pid: string, dir: number[], power = 1) {
      const r = arena.launch(pid, { dir, power, seq: ++seq }, now);
      expect(r.ok).toBe(true);
      return r;
    },
    give(pid: string, n = 1) {
      for (let i = 0; i < n; i++) {
        const id = randomUUID();
        store.db.prepare("INSERT INTO artifacts (id, kind, x, y, state, spawned_at) VALUES (?, 'fish', 0.5, 0.5, 'available', ?)").run(id, now + i);
        expect(store.pickUp(pid, id, now + i).picked).toBe(true);
      }
    },
    /** Puts a robot somewhere, as a page never can. */
    place(pid: string, pos: number[], vel: number[] = [0, 0]) {
      arena.place(pid, pos, vel, now);
    },
    clearFloor() {
      store.db.exec("UPDATE artifacts SET state = 'banked', owner = NULL WHERE state = 'available'");
      arena.refresh();
    },
  };
  return w;
}

test("up to four play, each in their own slot and spawn", () => {
  const w = world();
  const ps = [w.join(), w.join(), w.join(), w.join()];
  expect(w.robots().map((r: any) => r.slot).sort()).toEqual([0, 1, 2, 3]);
  ps.forEach((p) => {
    const r = w.robot(p);
    expect(r.pos).toEqual(A.SPAWNS[r.slot]);
  });
});

test("a fifth waits in line and gets the first free robot, after the grace", () => {
  const w = world();
  const ps = [w.join(), w.join(), w.join(), w.join()];
  const fifth = w.store.visitor(null, w.now()).pid;
  const sixth = w.store.visitor(null, w.now()).pid;
  expect(w.arena.join(fifth, w.now())).toEqual({ kind: "waiting" });
  w.arena.join(sixth, w.now());
  expect(w.arena.placeOf(fifth)).toBe(1);
  expect(w.arena.placeOf(sixth)).toBe(2);
  expect(w.arena.launch(fifth, { dir: [1, 0], power: 1, seq: 1 }, w.now())).toMatchObject({ ok: false, error: "no-robot" });
  w.leave(ps[1]);
  w.run(A.GRACE_MS - 200);
  expect(w.robot(fifth)).toBeNull();
  w.run(400);
  expect(w.robot(fifth)).not.toBeNull();
  expect(w.arena.placeOf(fifth)).toBe(0);
  expect(w.arena.placeOf(sixth)).toBe(1);
});

test("someone leaving the line leaves no gap", () => {
  const w = world();
  for (let i = 0; i < 4; i++) w.join();
  const a = w.store.visitor(null, w.now()).pid, b = w.store.visitor(null, w.now()).pid;
  w.arena.join(a, w.now());
  w.arena.join(b, w.now());
  w.leave(a);
  expect(w.arena.placeOf(b)).toBe(1);
});

test("touching an artifact collects it, up to CARRY_MAX, and the load shows in the launch", () => {
  const w = world();
  const p = w.join();
  w.give(p, A.CARRY_MAX);
  w.place(p, [3, 3]);
  w.launch(p, [1, 0]);
  expect(Math.hypot(...w.robot(p).vel as [number, number])).toBeLessThanOrEqual(A.loadCap(A.CARRY_MAX) + 1e-9);
  const floor = w.arena.floor()[0];
  w.place(p, floor.pos);
  w.run(40);
  expect(w.store.cargo(p)).toHaveLength(A.CARRY_MAX); // full: it stays
});

test("moving in the vault banks everything; standing there banks nothing", () => {
  const w = world();
  w.clearFloor();
  const p = w.join();
  w.give(p, 3);
  w.place(p, A.VAULT);
  w.run(100);
  expect(w.store.cargo(p)).toHaveLength(3);
  w.launch(p, [1, 0], 0.5);
  w.run(40);
  expect(w.store.cargo(p)).toHaveLength(0);
  expect(w.store.collection(p).fish).toBe(3);
  expect(w.store.vaultTotal()).toBeGreaterThanOrEqual(3);
});

test("the slightest contact scatters both robots' entire cargo, whoever moved", () => {
  const w = world();
  w.clearFloor();
  const a = w.join(), b = w.join();
  w.give(a, 3);
  w.give(b, 2);
  w.place(a, [5, 2], [0.5, 0]);
  w.place(b, [5.91, 2]);
  w.run(40);
  expect(w.store.cargo(a)).toHaveLength(0);
  expect(w.store.cargo(b)).toHaveLength(0);
  const loose = w.arena.floor().filter((x: any) => x.readyAt > w.now() - 40);
  expect(loose).toHaveLength(5);
});

test("a robot with nothing still costs the other everything, and a second contact is safe", () => {
  const w = world();
  w.clearFloor();
  const a = w.join(), b = w.join();
  w.give(b, A.CARRY_MAX);
  w.place(b, [5, 2]);
  w.place(a, [3.5, 2], [10, 0]);
  w.run(200);
  expect(w.store.cargo(b)).toHaveLength(0);
  expect(w.store.cargo(a)).toHaveLength(0);
});

test("nobody takes a scattered artifact until it settles; then its previous owner can", () => {
  const w = world();
  w.clearFloor();
  const a = w.join(), b = w.join();
  w.give(a, 2);
  const ids = w.store.cargo(a).map((c: any) => c.id);
  w.place(a, [5, 2], [0.5, 0]);
  w.place(b, [5.91, 2]);
  w.run(40);
  const f: any = w.arena.floor().find((x: any) => x.id === ids[0]);
  w.place(b, [14, 9]);
  w.place(a, f.pos);
  w.run(20);
  expect(w.store.cargo(a)).toHaveLength(0);
  w.run(A.SETTLE_MS);
  expect(w.store.cargo(a).map((c: any) => c.id)).toContain(ids[0]);
});

test("a third robot can take what's scattered", () => {
  const w = world();
  w.clearFloor();
  const a = w.join(), b = w.join(), thief = w.join();
  w.give(a, 1);
  const id = w.store.cargo(a)[0].id;
  w.place(a, [5, 2], [0.5, 0]);
  w.place(b, [5.91, 2]);
  w.place(thief, [14, 9]);
  w.run(40);
  const f: any = w.arena.floor().find((x: any) => x.id === id);
  w.run(A.SETTLE_MS);
  w.place(thief, f.pos);
  w.run(20);
  expect(w.store.cargo(thief).map((c: any) => c.id)).toContain(id);
});

test("what's sent to every page is where the store put each artifact", () => {
  const w = world();
  w.clearFloor();
  const a = w.join(), b = w.join();
  w.give(a, 2);
  w.give(b, 1);
  w.arena.hits();
  w.place(a, [5, 2], [0.5, 0]);
  w.place(b, [5.91, 2]);
  w.run(40);
  const [hit] = w.arena.hits();
  expect(hit.scattered).toHaveLength(3);
  for (const s of hit.scattered) expect(w.arena.floor().find((x: any) => x.id === s.id)?.pos).toEqual(s.to);
});

test("a contact in the vault scatters before banking; what's banked stays banked", () => {
  const w = world();
  w.clearFloor();
  const a = w.join(), b = w.join();
  w.give(a, 1);
  w.place(a, A.VAULT, [1, 0]);
  w.run(40);
  expect(w.store.collection(a).fish).toBe(1);
  w.give(a, 2);
  w.give(b, 1);
  w.place(a, [A.VAULT[0] - 0.4, A.VAULT[1]], [0.5, 0]); // already touching
  w.place(b, [A.VAULT[0] + 0.45, A.VAULT[1]]);
  w.run(40);
  expect(w.store.collection(a).fish).toBe(1);
  expect(w.store.collection(b).fish).toBe(0);
  expect(w.store.cargo(a)).toHaveLength(0);
});

test("a ghost touches nothing and keeps its robot; back in time it's the same robot", () => {
  const w = world();
  const a = w.join(), b = w.join();
  w.give(a, 2);
  const slot = w.robot(a).slot;
  w.leave(a);
  w.place(a, [5, 2]);
  w.place(b, [3.5, 2], [10, 0]);
  w.run(300);
  expect(w.store.cargo(a)).toHaveLength(2);
  expect(w.arena.join(a, w.now())).toEqual({ kind: "restored" });
  expect(w.robot(a).slot).toBe(slot);
});

test("past the grace the cargo goes back to the floor, once, and the robot goes", () => {
  const w = world();
  const a = w.join();
  w.give(a, 2);
  const before = w.arena.floor().length;
  w.leave(a);
  w.run(A.GRACE_MS + 100);
  expect(w.robot(a)).toBeNull();
  expect(w.store.cargo(a)).toHaveLength(0);
  expect(w.arena.floor().length).toBe(before + 2);
});

test("after a restart, the carrier gets the grace, then the sweep releases", () => {
  const store = openStore(":memory:");
  const w1 = world(store);
  const a = w1.join();
  w1.give(a, 1);
  const w2 = world(store, T0 + 1000);
  expect(w2.arena.join(a, w2.now())).toMatchObject({ kind: "recovered", carrying: 1 });
  const w3 = world(store, T0 + 2000);
  w3.run(A.GRACE_MS + 1100);
  expect(store.cargo(a)).toHaveLength(0);
});

test("the view holds nothing but tags: no pid, no name", () => {
  const w = world();
  const p = w.join();
  const s = JSON.stringify(w.robots());
  expect(s).not.toContain(p);
  expect(s).not.toContain("name");
});

test("the first arrival finds a floor, and it stops at the target for one player", () => {
  const w = world();
  w.join();
  expect(w.arena.floor()).toHaveLength(A.SPAWN.target[1]);
  w.run(A.SPAWN.everyMs[1] * 5);
  expect(w.arena.floor()).toHaveLength(A.SPAWN.target[1]);
});

test("more players raise the floor, by the table's target and gap", () => {
  const w = world();
  for (let i = 0; i < 4; i++) w.join();
  const start = w.arena.floor().length;
  w.run(A.SPAWN.everyMs[4] - 40);
  expect(w.arena.floor().length).toBeLessThanOrEqual(start + 1);
  w.run(A.SPAWN.everyMs[4] * 2);
  expect(w.arena.floor().length).toBeGreaterThan(start);
  w.run(A.SPAWN.everyMs[4] * (A.SPAWN.target[4] + 2));
  expect(w.arena.floor()).toHaveLength(A.SPAWN.target[4]);
});

test("a gap of its own: one player's floor refills only at one player's pace", () => {
  const w = world();
  w.join();
  w.clearFloor();
  w.run(A.SPAWN.everyMs[1] + 40);
  expect(w.arena.floor().length).toBeLessThanOrEqual(1);
  w.run(A.SPAWN.everyMs[1] * 2);
  expect(w.arena.floor().length).toBeGreaterThanOrEqual(2);
});

test("nothing spawns with nobody playing, and ghosts and the line don't count", () => {
  const w = world();
  w.clearFloor();
  w.run(10_000);
  expect(w.arena.floor()).toHaveLength(0);
  const p = w.join();
  w.leave(p);
  w.run(A.GRACE_MS - 100);
  expect(w.arena.floor()).toHaveLength(0);
});

test("the table can be swapped whole", () => {
  const custom = { target: [0, 2, 2, 2, 2], everyMs: [0, 100, 100, 100, 100], rarity: A.SPAWN.rarity.map(() => ({ common: 0, rare: 0, mythic: 1 })) };
  const w = world(openStore(":memory:"), T0, custom);
  w.join();
  w.clearFloor();
  w.run(500);
  const f: any[] = w.arena.floor();
  expect(f).toHaveLength(2);
  for (const a of f) expect(a.material).toBe("starlight");
});

test("more players, more rare and mythic artifacts actually spawned", () => {
  const rareShare = (players: number) => {
    const s = openStore(":memory:");
    const w = world(s, T0, { ...A.SPAWN, target: [0, 400, 400, 400, 400], everyMs: [0, 20, 20, 20, 20] });
    for (let i = 0; i < players; i++) w.join();
    // the floor has few spots, so clear them to sample enough spawns
    for (let i = 0; i < 40; i++) {
      w.run(20 * 30);
      s.db.exec("UPDATE artifacts SET state = 'banked' WHERE state = 'available'");
      w.arena.refresh();
    }
    const f: any[] = s.db.prepare("SELECT material FROM artifacts").all() as any[];
    expect(f.length).toBeGreaterThan(500);
    return f.filter((x) => x.material !== "tin").length / f.length;
  };
  expect(rareShare(4)).toBeGreaterThan(rareShare(1));
});

test("an artifact keeps its material and seed from floor to collection", () => {
  const w = world();
  w.clearFloor();
  const p = w.join();
  w.store.db.prepare("INSERT INTO artifacts (id, kind, material, seed, x, y, state, spawned_at) VALUES ('m', 'door', 'starlight', 77, 3, 3, 'available', 0)").run();
  w.arena.refresh();
  w.place(p, [3, 3]);
  w.run(20);
  expect(w.store.cargo(p)[0]).toMatchObject({ kind: "door", material: "starlight", seed: 77 });
  w.place(p, A.VAULT, [1, 0]);
  w.run(40);
  expect(w.store.shelf(p)[0]).toMatchObject({ kind: "door", material: "starlight", seed: 77 });
  expect(w.store.catalog(p)["door:starlight"]).toBe(1);
});

test("a picked-up artifact leaves the floor on that step", () => {
  const w = world();
  w.clearFloor();
  const p = w.join();
  w.store.db.prepare("INSERT INTO artifacts (id, kind, x, y, state, spawned_at) VALUES ('here', 'fish', 3, 3, 'available', 0)").run();
  w.arena.refresh();
  w.place(p, [3, 3]);
  w.run(20);
  expect(w.store.cargo(p)).toHaveLength(1);
  expect(w.arena.floor().map((a: any) => a.id)).not.toContain("here");
});

test("a delivery is an event, once, saying who and what", () => {
  const w = world();
  w.clearFloor();
  const p = w.join();
  w.give(p, 2);
  w.place(p, A.VAULT, [1, 0]);
  w.run(40);
  const [d, ...rest] = w.arena.deliveries();
  expect(rest).toHaveLength(0);
  expect(d.tag).toBe(w.store.who(p).tag);
  expect(d.items).toHaveLength(2);
  expect(d.items[0].kind).toBe("fish");
  expect(w.arena.deliveries()).toHaveLength(0);
});

test("a hit says whose each scattered artifact was, by tag", () => {
  const w = world();
  w.clearFloor();
  const a = w.join(), b = w.join();
  w.give(a, 2);
  w.arena.hits();
  w.place(a, [5, 2], [0.5, 0]);
  w.place(b, [5.91, 2]);
  w.run(40);
  const [hit] = w.arena.hits();
  expect(hit.scattered.map((s: any) => s.by)).toEqual([w.store.who(a).tag, w.store.who(a).tag]);
});

// ---- the door to your room (ADR 39)
/** Runs `ms` and says every tag that went through the door meanwhile. */
function through(w: any, ms: number): string[] {
  const out: string[] = [];
  for (let t = 0; t < ms; t += 20) {
    w.run(20);
    out.push(...w.arena.exits());
  }
  return out;
}
/** The weakest launch from `pos` along `dir` whose path stops in the door. */
function intoDoor(pos: number[], dir: number[], load = 0): number {
  for (let p = 0.05; p <= 1; p += 0.01) {
    const pts = A.path(A.standing(pos, 0), { dir, power: p, seq: 1 }, load);
    if (A.inExit(pts[pts.length - 1])) return p;
  }
  throw new Error("no launch stops in the door");
}

test("the door sits at the middle of the top wall, and nothing spawns or scatters into it", () => {
  expect(A.inExit([A.ARENA.w / 2, A.ROBOT_R])).toBe(true);
  expect(A.inExit(A.VAULT)).toBe(false);
  expect(A.SPOTS.every((s: number[]) => !A.inExit(s))).toBe(true);
  for (const away of [[0, -1], [1, 0], [-1, 0], [0.6, -0.8]]) {
    for (const s of A.scatterSpots([A.ARENA.w / 2, 1.2], away, A.CARRY_MAX)) expect(A.inExit(s)).toBe(false);
  }
});

test("coming to rest in the door from your own launch, carrying nothing, sends you through", () => {
  const w = world();
  w.clearFloor();
  const p = w.join();
  const from = [A.ARENA.w / 2, 3];
  w.place(p, from);
  w.launch(p, [0, -1], intoDoor(from, [0, -1]));
  expect(through(w, 3000)).toEqual([w.store.who(p).tag]);
  expect(A.inExit(w.robot(p).pos)).toBe(true);
  expect(through(w, 2000)).toEqual([]); // standing in it sends you once, not again
});

test("coasting through the door sends nobody", () => {
  const w = world();
  w.clearFloor();
  const p = w.join();
  w.place(p, [4, 0.8]);
  w.launch(p, [1, 0], 1);
  expect(through(w, 6000)).toEqual([]);
  expect(A.inExit(w.robot(p).pos)).toBe(false);
});

test("a robot knocked into the door stays; it must launch itself", () => {
  const w = world();
  w.clearFloor();
  const a = w.join(), b = w.join();
  w.place(a, [A.ARENA.w / 2, 2.2]);
  w.place(b, [A.ARENA.w / 2, 3.2], [0, -3.2]);
  expect(through(w, 4000)).toEqual([]);
  expect(A.inExit(w.robot(a).pos)).toBe(true); // it did come to rest in the door
});

test("the door is shut to a robot that carries anything", () => {
  const w = world();
  w.clearFloor();
  const p = w.join();
  w.give(p, 1);
  const from = [A.ARENA.w / 2, 3];
  w.place(p, from);
  w.launch(p, [0, -1], intoDoor(from, [0, -1], 1));
  expect(through(w, 3000)).toEqual([]);
  expect(A.inExit(w.robot(p).pos)).toBe(true);
  expect(w.store.cargo(p)).toHaveLength(1);
});

test("back within the grace, a robot standing in the door stays in the arena", () => {
  const w = world();
  w.clearFloor();
  const p = w.join();
  const from = [A.ARENA.w / 2, 3];
  w.place(p, from);
  w.launch(p, [0, -1], intoDoor(from, [0, -1]));
  expect(through(w, 3000)).toHaveLength(1);
  w.leave(p);
  through(w, 2000);
  w.join(p);
  expect(through(w, 3000)).toEqual([]);
});
