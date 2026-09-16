import { describe, expect, it } from "vitest";
import { computeStreak, dayKeyOf } from "../index";

// Local-calendar 9pm helper — the streak semantics live in local days.
const at = (y: number, m: number, d: number, h = 21): number =>
  new Date(y, m - 1, d, h, 0, 0).getTime();

const entry = (t: number) => ({
  id: `e-${t}`,
  recipeId: "r",
  recipeName: "R",
  cookedAt: t,
  servings: 1,
  proteinG: 20,
  calories: 400,
  cost: 50,
  deliveryCompareCost: 150,
});

describe("dayKeyOf", () => {
  it("produces a stable YYYY-MM-DD key in local time", () => {
    expect(dayKeyOf(at(2026, 9, 16))).toBe("2026-09-16");
  });
});

describe("computeStreak", () => {
  it("first meal today → 1", () => {
    const now = at(2026, 9, 16);
    expect(computeStreak([entry(at(2026, 9, 16))], now)).toBe(1);
  });

  it("two consecutive days → 2", () => {
    const now = at(2026, 9, 16);
    expect(computeStreak([entry(at(2026, 9, 16)), entry(at(2026, 9, 15))], now)).toBe(2);
  });

  it("missed day resets to 0", () => {
    const now = at(2026, 9, 16);
    expect(
      computeStreak([entry(at(2026, 9, 16)), entry(at(2026, 9, 14))], now),
    ).toBe(1);
  });

  it("two meals same day count once", () => {
    const now = at(2026, 9, 16);
    expect(
      computeStreak(
        [entry(at(2026, 9, 16, 13)), entry(at(2026, 9, 16, 21)), entry(at(2026, 9, 15))],
        now,
      ),
    ).toBe(2);
  });

  it("no meal today yet → counts from yesterday (today still open)", () => {
    const now = at(2026, 9, 16, 11);
    expect(computeStreak([entry(at(2026, 9, 15)), entry(at(2026, 9, 14))], now)).toBe(2);
  });

  it("stale streak (last cook 5 days ago) → 0", () => {
    const now = at(2026, 9, 16);
    expect(computeStreak([entry(at(2026, 9, 10))], now)).toBe(0);
  });

  it("future timestamp (clock skew) does not count", () => {
    const now = at(2026, 9, 16);
    expect(computeStreak([entry(at(2026, 9, 17))], now)).toBe(0);
  });

  it("empty history → 0", () => {
    expect(computeStreak([], at(2026, 9, 16))).toBe(0);
  });

  it("long streak across month boundary", () => {
    const now = at(2026, 9, 1);
    const hist = [
      at(2026, 8, 31),
      at(2026, 8, 30),
      at(2026, 8, 29),
    ].map(entry);
    expect(computeStreak(hist, now)).toBe(hist.length);
  });

  it("long streak across year boundary", () => {
    const now = at(2027, 1, 2);
    const hist = [at(2027, 1, 2), at(2027, 1, 1), at(2026, 12, 31)].map(entry);
    expect(computeStreak(hist, now)).toBe(3);
  });
});
