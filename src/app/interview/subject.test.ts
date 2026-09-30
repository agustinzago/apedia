import { describe, expect, it } from "vitest";
import { typedSubject } from "./subject";

describe("interview: the subject as typed", () => {
  it("keeps a word repeated in a row once", () => {
    expect(typedSubject("chess ".repeat(40))).toBe("chess");
    expect(typedSubject("Chess chess openings")).toBe("Chess openings");
    expect(typedSubject("New York history")).toBe("New York history");
    expect(typedSubject("café café")).toBe("café");
    expect(typedSubject("go going")).toBe("go going");
  });

  it("drops control characters and cuts to 120 characters", () => {
    expect(typedSubject("bread\nbaking")).toBe("bread baking");
    expect(typedSubject("a".repeat(200))).toHaveLength(120);
    expect(typedSubject(undefined)).toBe("");
  });
});
