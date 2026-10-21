import { describe, expect, it } from "vitest";
import { newRows } from "@/plugins/statement-import/import";

const row = (date: string, amount = -15) => ({ date, description: "Autopilot Transfer", amount });

describe("newRows", () => {
  it("matches a daily transfer to the feed's row on the same day, not the next one free", () => {
    // The feed starts Jul 21; the statement has a $15 transfer every day.
    const statement = ["2026-07-18", "2026-07-19", "2026-07-20", "2026-07-21", "2026-07-22", "2026-07-23"].map((d) => row(d));
    const feed = ["2026-07-21", "2026-07-22", "2026-07-23"].map((d) => ({ id: d, date: d, amount: -15 }));
    expect(newRows(statement, feed).map((r) => r.date)).toEqual(["2026-07-18", "2026-07-19", "2026-07-20"]);
  });

  it("still matches a feed row dated a day or two off", () => {
    expect(newRows([row("2026-07-30", -42)], [{ id: "f", date: "2026-08-01", amount: -42 }])).toEqual([]);
  });

  it("lets each feed row stand for one statement row", () => {
    const statement = [row("2026-07-30"), row("2026-07-30")];
    expect(newRows(statement, [{ id: "f", date: "2026-07-30", amount: -15 }])).toHaveLength(1);
  });
});
