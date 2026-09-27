import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppTeacher } from "./teacher";

describe("server: choosing the app's Teacher", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("without an API key in production, fails only when the Teacher is asked something", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("APEDIA_FAKE_TEACHER", "");

    // Creating it at startup must not throw: the rest of the site needs no Teacher.
    const teacher = createAppTeacher();

    await expect(
      teacher.checkSafety({ subject: "Chess", why: "Beat my brother" }),
    ).rejects.toThrow("ANTHROPIC_API_KEY is not set.");
  });

  it("uses the stand-in Teacher when asked to, as the e2e smoke test does", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("APEDIA_FAKE_TEACHER", "1");

    await expect(
      createAppTeacher().checkSafety({ subject: "Chess", why: "Beat my brother" }),
    ).resolves.toMatchObject({ verdict: "allow" });
  });
});
