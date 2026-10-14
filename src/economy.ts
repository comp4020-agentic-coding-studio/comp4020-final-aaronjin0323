// Every number the city economy runs on (docs/adr/0005), and the pure
// arithmetic over them. Nothing else in src/ holds a game number: the store,
// the server and the board import from here. public/diff.js mirrors these for
// the page, and spec/diff.test.ts holds the two equal.
//
// Money is integers. Coins are whole; income is counted in hundredths of a
// coin ("cents") so fractions aren't lost between settlements. Every function
// that needs the time takes it as an argument.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const STARTING_COINS = 100;

// Income: BASE_INCOME coins a minute per level, plus NEIGHBOUR_BONUS_PERCENT
// of that for each occupied neighbour.
export const BASE_INCOME = 10;
export const NEIGHBOUR_BONUS_PERCENT = 20;

// Uncollected income stops piling up once it holds this many minutes' worth
// at the building's current rate.
export const CAP_MINUTES = 4 * 60;

// Levels 1..5, by name; UPGRADE_COSTS[level - 1] is the price of going up
// from `level`.
export const LEVELS = ["Small House", "Townhouse", "Apartment", "Office Building", "Skyscraper"] as const;
export const MAX_LEVEL = LEVELS.length;
export const UPGRADE_COSTS = [150, 400, 900, 1800] as const;

export const RELOCATE_COST = 50;
export const RELOCATE_COOLDOWN_MS = 30 * MINUTE;

export const LEASE_MS = 24 * HOUR;
export const RENEWALS = [
  { hours: 6, cost: 100 },
  { hours: 12, cost: 180 },
  { hours: 24, cost: 300 },
] as const;
// No renewal may take a lease past this long after the ownership started.
export const LEASE_CAP_MS = 48 * HOUR;

export const HELP_GIFT = 50; // to the neighbour helped
export const HELP_REWARD = 20; // to the helper
export const HELP_COOLDOWN_MS = HOUR;

// "Welcome back" counts only after an absence at least this long, so a
// reload doesn't greet anyone.
export const WELCOME_AFTER_MS = 5 * MINUTE;

// A building's income in cents a minute:
//   10 coins × level × (1 + 0.2 × neighbours)  =  10 × level × (100 + 20n) cents
// which is a whole number for any whole level and neighbour count.
export function rate(level: number, neighbours: number): number {
  return BASE_INCOME * level * (100 + NEIGHBOUR_BONUS_PERCENT * neighbours);
}

// The most a building can hold uncollected, at a given rate.
export const capCents = (ratePerMinute: number): number => ratePerMinute * CAP_MINUTES;

// What `ms` of earning at `ratePerMinute` adds to `pending`, floored to whole
// cents and stopped at the cap. A building already over the cap (its rate
// fell since) keeps what it has and earns nothing more.
export function accrue(pending: number, ratePerMinute: number, ms: number): number {
  if (ms <= 0) return pending;
  const cap = capCents(ratePerMinute);
  if (pending >= cap) return pending;
  const earned = Math.floor((ratePerMinute * ms) / MINUTE);
  return Math.min(cap, pending + earned);
}

// The cost of upgrading from `level`, or null at the top (or a nonsense level).
export function upgradeCost(level: number): number | null {
  if (!Number.isInteger(level) || level < 1 || level >= MAX_LEVEL) return null;
  return UPGRADE_COSTS[level - 1];
}

export const buildingName = (level: number): string => LEVELS[Math.min(Math.max(level, 1), MAX_LEVEL) - 1];

export type RenewOption = { hours: number; cost: number; endsAt: Date; allowed: boolean };

// Each renewal on a lease ending at `leaseEndsAt` for an ownership that
// began at `ownedSince`: its cost, the new end, and whether it stays within
// LEASE_CAP_MS of the start. Coins are the caller's check.
export function renewOptions(leaseEndsAt: Date, ownedSince: Date): RenewOption[] {
  const cap = ownedSince.getTime() + LEASE_CAP_MS;
  return RENEWALS.map(({ hours, cost }) => {
    const endsAt = new Date(leaseEndsAt.getTime() + hours * HOUR);
    return { hours, cost, endsAt, allowed: endsAt.getTime() <= cap };
  });
}

export const renewal = (hours: number): { hours: number; cost: number } | null =>
  RENEWALS.find((r) => r.hours === hours) ?? null;

// The same numbers in the shape public/diff.js mirrors them (its ECONOMY),
// so spec/diff.test.ts can hold the two equal field by field. Units are in
// the names: coins unless it says otherwise.
export const ECONOMY = Object.freeze({
  startingCoins: STARTING_COINS,
  baseIncome: BASE_INCOME, // coins a minute, level 1, no neighbours
  neighbourBonus: NEIGHBOUR_BONUS_PERCENT / 100, // +20% per occupied neighbour
  capHours: CAP_MINUTES / 60,
  levels: Object.freeze([...LEVELS]),
  upgradeCosts: Object.freeze([...UPGRADE_COSTS]), // to level 2, 3, 4, 5
  relocateCost: RELOCATE_COST,
  relocateCooldownMinutes: RELOCATE_COOLDOWN_MS / MINUTE,
  leaseHours: LEASE_MS / HOUR,
  renewals: Object.freeze(RENEWALS.map((r) => Object.freeze({ hours: r.hours, cost: r.cost }))),
  leaseCapHours: LEASE_CAP_MS / HOUR,
  helpGift: HELP_GIFT,
  helpReward: HELP_REWARD,
  helpCooldownMinutes: HELP_COOLDOWN_MS / MINUTE,
});
