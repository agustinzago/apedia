import { describe, expect, it } from "vitest";
import { parseSignInRequest } from "./sign-in-request";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

describe("auth: reading the sign-in form", () => {
  it("accepts an email once the Learner confirms they are 13 or older", () => {
    expect(
      parseSignInRequest(form({ email: " Ana@Example.com ", over13: "on" })),
    ).toEqual({ ok: true, email: "ana@example.com" });
  });

  it("stops at the age gate when the box is not ticked, even with a valid email", () => {
    expect(parseSignInRequest(form({ email: "ana@example.com" }))).toEqual({
      ok: false,
      reason: "under-13",
    });
  });

  it("rejects a missing or malformed email", () => {
    expect(parseSignInRequest(form({ over13: "on" }))).toEqual({
      ok: false,
      reason: "invalid-email",
    });
    expect(
      parseSignInRequest(form({ email: "not-an-email", over13: "on" })),
    ).toEqual({ ok: false, reason: "invalid-email" });
  });
});
