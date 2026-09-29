import { describe, expect, it } from "vitest";
import { answerPlaceholder } from "./placeholders";

describe("the Interview's example answers", () => {
  it("fit the Example courses' subjects", () => {
    expect(answerPlaceholder("Music theory", 2)).toMatch(/chords/);
    expect(answerPlaceholder("How to create your first vegetable garden", 1)).toMatch(/salad/);
    expect(answerPlaceholder("Phone photography", 3)).toMatch(/photo/);
  });

  it("never show another subject's answer", () => {
    for (const question of [1, 2, 3]) {
      expect(answerPlaceholder("Chess", question)).not.toMatch(/chord|song|salad|photo/);
    }
  });

  it("show nothing past the third question", () => {
    expect(answerPlaceholder("Chess", 4)).toBeUndefined();
  });
});
