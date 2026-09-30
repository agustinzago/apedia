import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppTeacher, createAppUrlFetcher } from "./teacher";

describe("server: choosing the app's Teacher", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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

  it("ignores APEDIA_FAKE_TEACHER on Vercel's Production, and complains", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("APEDIA_FAKE_TEACHER", "1");

    await expect(
      createAppTeacher().checkSafety({ subject: "Chess", why: "Beat my brother" }),
    ).rejects.toThrow("ANTHROPIC_API_KEY is not set.");
    expect(error).toHaveBeenCalledOnce();
    expect(error.mock.calls[0][0]).toContain("APEDIA_FAKE_TEACHER");
  });

  it("checks Resource URLs for real on Vercel's Production, whatever APEDIA_FAKE_TEACHER says", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null));
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.stubEnv("APEDIA_FAKE_TEACHER", "1");

    await createAppUrlFetcher()("https://example.com/");

    expect(fetch).toHaveBeenCalledOnce();
  });
});
