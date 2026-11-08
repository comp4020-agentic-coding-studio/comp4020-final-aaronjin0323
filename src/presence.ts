// Who is in each room, and where (ADR 36). Memory only: nothing here is ever
// stored, and a restart empties every room. A walk is checked for its shape
// and that its sender has the room open; where it may go is the page's
// business, as it was before rooms were shared.
// @ts-ignore -- plain JS module shared with the page
import { ITEMS, WALK_START } from "../public/room.js";

export const PRESENCE_MAX = 12;
/** A page sends a walk at most every 100 ms; anything much faster is refused. */
export const WALK_GAP_MS = 40;

export type Walker = { tag: string; x: number; y: number; face: [number, number]; moving: boolean; sitting: boolean; seat: string | null };
type Fail = { ok: false; status: number; error: string; message: string };
const fail = (status: number, error: string, message: string): Fail => ({ ok: false, status, error, message });

const isFrac = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const isSeat = (v: unknown) => typeof v === "string" && Object.hasOwn(ITEMS, v) && (ITEMS as Record<string, { seat?: boolean }>)[v].seat === true;

export function createPresence() {
  // room tag -> visitor tag -> their walker, open tabs and last walk; a Map
  // keeps join order, so the earliest there are the ones shown
  const rooms = new Map<string, Map<string, { w: Walker; tabs: number; last: number }>>();

  function join(room: string, tag: string) {
    let r = rooms.get(room);
    if (!r) rooms.set(room, (r = new Map()));
    const there = r.get(tag);
    if (there) there.tabs++;
    else r.set(tag, { w: { tag, x: WALK_START.x, y: WALK_START.y, face: [-0.7071, -0.7071], moving: false, sitting: false, seat: null }, tabs: 1, last: -Infinity });
  }

  /** True when the visitor's walker left the room (their last tab closed). */
  function leave(room: string, tag: string): boolean {
    const r = rooms.get(room);
    const there = r?.get(tag);
    if (!r || !there) return false;
    if (--there.tabs > 0) return false;
    r.delete(tag);
    if (!r.size) rooms.delete(room);
    return true;
  }

  function walk(room: string, tag: string, b: Record<string, unknown>, now: number): { ok: true } | Fail {
    const there = rooms.get(room)?.get(tag);
    if (!there) return fail(409, "not-in-room", "Open the room before walking in it");
    const face = b.face;
    const shaped =
      isFrac(b.x) && isFrac(b.y) &&
      Array.isArray(face) && face.length === 2 && isNum(face[0]) && isNum(face[1]) &&
      typeof b.moving === "boolean" && typeof b.sitting === "boolean" &&
      (b.sitting ? isSeat(b.seat) : b.seat === null || b.seat === undefined);
    if (!shaped) return fail(400, "bad-walk", "A walk is { x, y, face: [x, y], moving, sitting, seat }, inside the room");
    if (now - there.last < WALK_GAP_MS) return fail(429, "too-fast", `At most one walk every ${WALK_GAP_MS} ms`);
    there.last = now;
    const len = Math.hypot(face[0] as number, face[1] as number);
    there.w = {
      tag,
      x: b.x as number,
      y: b.y as number,
      face: len > 1e-9 ? [(face[0] as number) / len, (face[1] as number) / len] : there.w.face,
      moving: b.moving as boolean,
      sitting: b.sitting as boolean,
      seat: b.sitting ? (b.seat as string) : null,
    };
    return { ok: true };
  }

  const walkers = (room: string): Walker[] => [...(rooms.get(room)?.values() ?? [])].slice(0, PRESENCE_MAX).map((t) => t.w);
  const has = (room: string, tag: string) => !!rooms.get(room)?.has(tag);

  return { join, leave, walk, walkers, has };
}
