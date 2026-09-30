import { describe, expect, it } from "vitest";
import { shortSubject } from "./short-subject";
import { openingMessages } from "./interview";

describe("interview: a long subject inside a sentence", () => {
  it("keeps a short subject, and cuts a long one at a word", () => {
    expect(shortSubject("Music theory")).toBe("Music theory");
    expect(shortSubject("chess ".repeat(20).trim())).toBe("chess chess chess chess chess chess…");
    expect(shortSubject("x".repeat(60))).toBe(`${"x".repeat(40)}…`);
  });

  it("asks why with the short subject, keeping the Learner's words whole", () => {
    const subject = "chess ".repeat(20).trim();
    const [, learner, why] = openingMessages(subject);
    expect(learner.text).toBe(subject);
    expect(why.text).toMatch(/^Why do you want to learn chess chess chess chess chess chess…\?/);
  });
});
