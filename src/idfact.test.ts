import { describe, expect, it } from "vitest";
import { buildIdfact } from "./idfact";

describe("buildIdfact", () => {
  it("joins NIF, full number and the UTC issue date as YYYYMMDD", () => {
    const date = new Date("2026-03-09T10:30:00.000Z");
    expect(buildIdfact("B12345678", "2026-0042", date)).toBe("B12345678-2026-0042-20260309");
  });

  it("zero-pads month and day", () => {
    const date = new Date("2026-01-05T00:00:00.000Z");
    expect(buildIdfact("B1", "1", date)).toBe("B1-1-20260105");
  });

  it("uses the UTC calendar day at the end-of-day boundary", () => {
    // 31 Dec 23:30 UTC must stay on the 31st (no local-timezone roll-over).
    const date = new Date("2026-12-31T23:30:00.000Z");
    expect(buildIdfact("B1", "X", date)).toBe("B1-X-20261231");
  });
});
