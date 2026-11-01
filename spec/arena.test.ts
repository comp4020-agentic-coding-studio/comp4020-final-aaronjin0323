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
