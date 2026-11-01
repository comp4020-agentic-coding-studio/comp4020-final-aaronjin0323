// The store's guarantees, over a real SQLite file where it matters.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { migrate, openStore } from "../src/db.ts";
import { DatabaseSync } from "node:sqlite";

const T = 1_800_000_000_000;

test("a visitor is a cookie; the tag isn't the pid", () => {
  const s = openStore(":memory:");
  const v = s.visitor(null, T);
  expect(v.isNew).toBe(true);
  expect(s.visitor(v.pid, T).isNew).toBe(false);
  expect(v.tag).toMatch(/^[0-9a-f]{8}$/);
  expect(v.pid).not.toContain(v.tag);
});

test("an artifact can't be picked up twice, or by two", () => {
  const s = openStore(":memory:");
  const a = s.visitor(null, T).pid, b = s.visitor(null, T).pid;
  s.spawn(T);
  s.spawn(T);
  const id = s.floor()[0].id;
  expect(s.pickUp(a, id, T).picked).toBe(true);
  expect(s.pickUp(b, id, T).picked).toBe(false);
  expect(s.pickUp(a, id, T).picked).toBe(false);
});

test("banked is final: the database refuses taking it back or deleting it", () => {
  const s = openStore(":memory:");
  const a = s.visitor(null, T).pid;
  s.spawn(T);
  s.spawn(T);
  const id = s.floor()[0].id;
  s.pickUp(a, id, T);
  expect(s.bank(a, T).banked).toBe(1);
  expect(s.bank(a, T).banked).toBe(0);
  expect(() => s.db.prepare("UPDATE artifacts SET state = 'available' WHERE id = ?").run(id)).toThrow();
  expect(() => s.db.prepare("DELETE FROM artifacts WHERE id = ?").run(id)).toThrow();
});

test("a failed migration leaves the file as it was, with a copy beside it", () => {
  const path = join(mkdtempSync(join(tmpdir(), "m-")), "x.db");
  const db = new DatabaseSync(path);
  migrate(db, path, ["CREATE TABLE a (x)"], T);
  expect(() => migrate(db, path, ["CREATE TABLE a (x)", "CREATE TABLE b (x); BROKEN"], T)).toThrow();
  expect(db.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 1 });
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'b'").get()).toBeUndefined();
});

test("the bank and the floor survive closing the file", () => {
  const path = join(mkdtempSync(join(tmpdir(), "p-")), "x.db");
  let s = openStore(path);
  const a = s.visitor(null, T).pid;
  s.spawn(T);
  s.spawn(T);
  const f = s.floor();
  s.pickUp(a, f[0].id, T);
  s.bank(a, T);
  s.close();
  s = openStore(path);
  expect(Object.values(s.collection(a)).reduce((x, y) => x + y, 0)).toBe(1);
  expect(s.floor()).toHaveLength(f.length - 1);
  expect(s.vaultTotal()).toBe(1);
  s.close();
});

test("the shelf is newest first and bounded; the catalog counts every entry", () => {
  const s = openStore(":memory:");
  const a = s.visitor(null, T).pid;
  for (let i = 0; i < 70; i++) {
    s.db.prepare("INSERT INTO artifacts (id, kind, material, seed, x, y, state, holder, owner, spawned_at, banked_at) VALUES (?, 'fish', 'gold', ?, 1, 1, 'banked', NULL, ?, 0, ?)").run(`a${i}`, i, a, T + i);
  }
  const shelf = s.shelf(a);
  expect(shelf).toHaveLength(60);
  expect(shelf[0].seed).toBe(69);
  expect(s.catalog(a)["fish:gold"]).toBe(70);
});
