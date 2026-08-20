import { describe, expect, it } from "vitest";

import { classifyReliability } from "@/lib/reliability";

describe("classifyReliability", () => {
  it("declares a breach when parking or an open circuit threatens recovery", () => {
    expect(classifyReliability({ parked: 1, successRate: 99.99, rails: [] })).toBe("BREACH");
    expect(
      classifyReliability({
        parked: 0,
        successRate: 100,
        rails: [{ circuitState: "OPEN" }],
      }),
    ).toBe("BREACH");
  });
});
